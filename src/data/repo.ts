// Consultas do app. Toda regra de soma segue a UX v0.3 e as premissas do PM:
// - saldo total = contas BANK + "Dinheiro" (manuais); cartões fora (RF-004.1, RF-007.1)
// - somas do extrato sem ocultas (PM-7), sem transferências próprias (PM-8) e sem Investimentos (R-3)
import type { Db, SqlValue } from './db';
import { normalizeSearch, spDateKey } from '../domain/format';
import { detectTransfers } from '../domain/transfers';
import { isBillPayment, ownTransferSignal } from '../domain/recognition';
import { monthsBetween } from '../domain/monthly';
import { buildSaldoHistory, type SaldoConn, type SaldoHistory, type SaldoPoint } from '../domain/saldoHistory';
import { isCardRefund, RECIPIENT_DOC_SQL, RECIPIENT_TYPE_SQL, recipientKey, type RecipientKey } from '../domain/recipient';

export type ConnectionRow = {
  item_id: string;
  connector_id: number | null;
  institution_name: string | null;
  status: string | null;
  execution_status: string | null;
  error_code: string | null;
  origin_updated_at: string | null;
  consent_json: string | null;
  consent_checked: number;
  item_created_at: string | null;
  last_sync_attempt_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  display_number: number | null;
  user_name: string | null;
  suggested_base: string | null;
  suggested_name: string | null;
  suggested_account_id: string | null;
  /** Conexão repetida: as contas dela estão nesta outra conexão (UX 0.8). */
  duplicate_of: string | null;
  /** JSON: [{id, number, type, name}] das contas que esta conexão trouxe na última leitura. */
  account_refs: string | null;
  /** item.consentExpiresAt: validade da autorização dada a este app (RF-002.3.1). */
  auth_expires_at: string | null;
  /** UX 0.11: quando a autorização foi excluída no Pluggy para ser substituída; os dados aguardam (R-14.2, R-18). */
  replaced_at: string | null;
  /** Ciclo 2: quantos investimentos a conexão trouxe na última leitura (null = ainda não lido). */
  investments_count: number | null;
  /** Nome pela regra 7.4 (calculado). */
  name: string;
  /** true quando o nome veio da pessoa ou do Pluggy (não é "Conexão N"). */
  has_real_name: number;
};

export type AccountRef = { id: string; name: string; number: string | null; type: string };

export type AccountRow = {
  id: string;
  item_id: string;
  type: string;
  subtype: string | null;
  name: string;
  number: string | null;
  balance: number;
  due_date: string | null;
  /** R-17: conta que não veio na nova autorização; data dos dados dela. Não soma no saldo. */
  unauthorized_at: string | null;
  /** RF-004.4: quanto do saldo rende automaticamente (já incluído em balance). */
  auto_invested: number | null;
};

export type TransactionRow = {
  id: string;
  account_id: string;
  date: string;
  date_key: string;
  description: string;
  amount: number;
  category: string | null; // categoria efetiva
  hidden: number;
  manual: number;
  transfer: number; // efetiva (override ?? auto)
  transfer_auto: number;
  /** RF-008.8 */
  out_of_summary: number;
  /** RF-008.10: estorno de compra no cartão. */
  refund?: number;
  /** RF-006.3: 1 quando a categoria efetiva veio da lembrança do destinatário. */
  remembered?: number;
  account_name: string;
  account_type: string | null;
  account_subtype?: string | null;
  institution_name: string | null;
  connection_name: string | null;
};

/** Regra 7.4 (UX 0.8): nome da pessoa → nome sugerido pela conta → banco informado pelo Pluggy → "Conexão N". */
const CONN_NAME = (c: string) =>
  `COALESCE(NULLIF(TRIM(${c}.user_name), ''), NULLIF(${c}.suggested_name, ''), CASE WHEN ${c}.institution_name IS NOT NULL AND ${c}.institution_name <> 'MeuPluggy' THEN ${c}.institution_name END, 'Conexão ' || COALESCE(${c}.display_number, 0))`;
const CONN_REAL = (c: string) =>
  `CASE WHEN NULLIF(TRIM(${c}.user_name), '') IS NOT NULL OR NULLIF(${c}.suggested_name, '') IS NOT NULL OR (${c}.institution_name IS NOT NULL AND ${c}.institution_name <> 'MeuPluggy') THEN 1 ELSE 0 END`;
const CONN_COLS = `c.*, ${CONN_NAME('c')} AS name, ${CONN_REAL('c')} AS has_real_name`;

// RF-006.3: a escolha da pessoa no lançamento > a lembrança do destinatário > a sugestão automática (mapa, R-8.5, MCC).
const EFFECTIVE_CATEGORY = `CASE WHEN t.user_category_set = 1 THEN t.user_category ELSE COALESCE(t.remembered_category, t.auto_category) END`;
const EFFECTIVE_TRANSFER = `COALESCE(t.transfer_override, t.transfer_auto)`;

export type TxFilter = {
  accountIds?: string[];
  from?: string; // AAAA-MM-DD inclusive
  to?: string; // AAAA-MM-DD inclusive
  /** ids de categoria; use 'none' para "Sem categoria" */
  categories?: string[];
  search?: string;
  showHidden?: boolean;
  /** RF-005.3 (UX 0.8/0.9): 'only' = só futuras (data depois de hoje); 'exclude' = sem futuras. */
  future?: 'only' | 'exclude';
  /** Hoje em São Paulo, AAAA-MM-DD (futura = date_key > today). */
  today?: string;
  /** UX 0.14: "Só fora do Resumo" (T-14) e os motivos da folha "Ver quais" (T-13). */
  only?: 'out' | 'transfer' | 'bill';
  /** UX 0.17 (T-22 "Ver lançamentos"): só os lançamentos de um destinatário (PIX ou boleto em conta). */
  recipient?: RecipientKey;
};

function whereFor(filter: TxFilter): { sql: string; params: SqlValue[] } {
  const parts: string[] = [];
  const params: SqlValue[] = [];
  if (filter.accountIds && filter.accountIds.length) {
    parts.push(`t.account_id IN (${filter.accountIds.map(() => '?').join(',')})`);
    params.push(...filter.accountIds);
  }
  if (filter.from) {
    parts.push('t.date_key >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    parts.push('t.date_key <= ?');
    params.push(filter.to);
  }
  if (filter.categories && filter.categories.length) {
    const real = filter.categories.filter((c) => c !== 'none');
    const ors: string[] = [];
    if (real.length) {
      ors.push(`${EFFECTIVE_CATEGORY} IN (${real.map(() => '?').join(',')})`);
      params.push(...real);
    }
    if (filter.categories.includes('none')) ors.push(`${EFFECTIVE_CATEGORY} IS NULL`);
    parts.push(`(${ors.join(' OR ')})`);
  }
  const q = filter.search ? normalizeSearch(filter.search) : '';
  if (q) {
    parts.push(`t.search_text LIKE ? ESCAPE '\\'`);
    params.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  if (!filter.showHidden) parts.push('t.hidden = 0');
  if (filter.only === 'out') parts.push('t.out_of_summary = 1');
  if (filter.only === 'transfer') parts.push(`${EFFECTIVE_TRANSFER} = 1`);
  // R-2.1: pagamentos de fatura sem par e ainda não marcados à mão.
  if (filter.only === 'bill') parts.push('t.bill_unpaired = 1 AND t.transfer_override IS NULL');
  if (filter.recipient) {
    parts.push(`t.account_id IN (SELECT id FROM accounts WHERE type = 'BANK') AND t.operation_type IN ('PIX', 'BOLETO')
      AND ((t.amount < 0 AND t.receiver_doc_type = ? AND t.receiver_doc = ?) OR (t.amount >= 0 AND t.payer_doc_type = ? AND t.payer_doc = ?))`);
    params.push(filter.recipient.type, filter.recipient.doc, filter.recipient.type, filter.recipient.doc);
  }
  if (filter.future && filter.today) {
    parts.push(filter.future === 'only' ? 't.date_key > ?' : 't.date_key <= ?');
    params.push(filter.today);
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

export function createRepo(db: Db) {
  return {
    // ---------- estado do app ----------
    async getState(key: string): Promise<string | null> {
      const r = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM app_state WHERE key = ?', [key]);
      return r?.value ?? null;
    },
    async setState(key: string, value: string | null): Promise<void> {
      await db.runAsync('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
    },

    // ---------- conexões ----------
    listConnections(): Promise<ConnectionRow[]> {
      return db.getAllAsync<ConnectionRow>(`SELECT ${CONN_COLS} FROM connections c ORDER BY c.created_at`);
    },
    getConnection(itemId: string): Promise<ConnectionRow | null> {
      return db.getFirstAsync<ConnectionRow>(`SELECT ${CONN_COLS} FROM connections c WHERE c.item_id = ?`, [itemId]);
    },
    /** Conexões que ocupam vaga no Pluggy: as que aguardam nova autorização já foram excluídas lá (UX 0.11). */
    async countConnections(): Promise<number> {
      const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM connections WHERE replaced_at IS NULL');
      return r?.n ?? 0;
    },
    async countAwaiting(): Promise<number> {
      const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM connections WHERE replaced_at IS NOT NULL');
      return r?.n ?? 0;
    },
    /** R-14.2 (1): excluída no Pluggy; os dados ficam no aparelho, aguardando nova autorização. */
    async markReplaced(itemId: string, nowIso: string): Promise<void> {
      await db.runAsync('UPDATE connections SET replaced_at = ? WHERE item_id = ?', [nowIso, itemId]);
    },
    /**
     * R-14.2 (3): a nova autorização (`newId`, já sincronizada) concluiu. As contas casadas já passaram à nova na
     * sincronização (mesmo id ou número, com as categorias). As que não vieram passam à nova marcadas "Sem
     * autorização", com a data dos dados (R-17). O nome da antiga passa à nova (7.4) e a antiga sai do aparelho.
     */
    async finishReplacement(oldId: string, newId: string): Promise<{ unmatched: string[]; dataDate: string | null }> {
      const old = await this.getConnection(oldId);
      if (!old) return { unmatched: [], dataDate: null };
      await this.passNameOnRevoke(oldId, newId);
      const left = await db.getAllAsync<{ id: string; name: string; updated_at: string | null }>(
        'SELECT id, name, updated_at FROM accounts WHERE item_id = ? ORDER BY type, name', [oldId]);
      const dataDate = old.origin_updated_at ?? left[0]?.updated_at ?? null;
      await db.withTransactionAsync(async () => {
        for (const a of left) {
          await db.runAsync('UPDATE accounts SET item_id = ?, unauthorized_at = ? WHERE id = ?', [newId, dataDate ?? a.updated_at, a.id]);
        }
        await db.runAsync('DELETE FROM connections WHERE item_id = ?', [oldId]);
        await db.runAsync('UPDATE connections SET duplicate_of = NULL WHERE duplicate_of = ?', [oldId]);
        await db.runAsync('UPDATE connections SET duplicate_of = NULL WHERE item_id = ? AND duplicate_of IS NOT NULL', [newId]);
      });
      await this.recomputeTransfers();
      return { unmatched: left.map((a) => a.name), dataDate };
    },
    /** R-17: apagar uma conta "Sem autorização" (transações dela e categorias mudadas saem do aparelho). */
    async deleteAccountLocal(accountId: string): Promise<void> {
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM transactions WHERE manual = 0 AND account_id = ?', [accountId]);
        await db.runAsync('DELETE FROM accounts WHERE id = ?', [accountId]);
      });
      await this.recomputeTransfers();
    },
    async countUnauthorizedAccounts(): Promise<number> {
      const r = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM accounts WHERE unauthorized_at IS NOT NULL AND type = 'BANK'");
      return r?.n ?? 0;
    },
    /** Registra o id da conexão assim que o Pluggy Connect devolve (GET /items não lista — DEV-9). */
    async addConnection(itemId: string, nowIso: string): Promise<void> {
      if (await db.getFirstAsync('SELECT 1 FROM connections WHERE item_id = ?', [itemId])) return;
      // Número dado na criação; não muda nem é reaproveitado quando outra conexão é revogada (7.4).
      const next = Number((await this.getState('next_connection_number')) ?? '1') || 1;
      await db.runAsync('INSERT INTO connections (item_id, created_at, display_number) VALUES (?, ?, ?)', [itemId, nowIso, next]);
      await this.setState('next_connection_number', String(next + 1));
    },
    /** T-10/T-12: nome dado pela pessoa (até 30 caracteres); vazio volta à regra 7.4. */
    async renameConnection(itemId: string, name: string | null): Promise<void> {
      const clean = name ? name.trim().slice(0, 30) : '';
      await db.runAsync('UPDATE connections SET user_name = ? WHERE item_id = ?', [clean || null, itemId]);
    },
    /**
     * Antes de revogar a conexão repetida `fromId`: o nome passa para `toId` se esta ainda usa o nome sugerido
     * [UX 0.8]. Sem nome dado pela pessoa, a nova herda o nome sugerido da antiga quando é a mesma conta, para não
     * ficar com " (2)" depois que a antiga sai (UX-072: renovar não perde o nome).
     */
    async passNameOnRevoke(fromId: string, toId: string): Promise<void> {
      const from = await db.getFirstAsync<{ user_name: string | null; suggested_base: string | null; suggested_name: string | null }>(
        'SELECT user_name, suggested_base, suggested_name FROM connections WHERE item_id = ?', [fromId]);
      const to = await db.getFirstAsync<{ user_name: string | null; suggested_base: string | null }>(
        'SELECT user_name, suggested_base FROM connections WHERE item_id = ?', [toId]);
      if (!from || !to || to.user_name?.trim()) return;
      if (from.user_name?.trim()) {
        await db.runAsync('UPDATE connections SET user_name = ? WHERE item_id = ?', [from.user_name, toId]);
      } else if (from.suggested_name && from.suggested_base && from.suggested_base === to.suggested_base) {
        await db.runAsync('UPDATE connections SET suggested_name = ? WHERE item_id = ?', [from.suggested_name, toId]);
      }
    },
    /**
     * RF-009.1.2 (Q20 a): contas desta conexão que também vêm de outra conexão ativa (mesmo id ou mesmo número)
     * e as que vêm só dela.
     */
    async accountSharing(itemId: string): Promise<{ shared: { id: string; name: string; otherItemId: string; otherName: string }[]; exclusive: { id: string; name: string }[] }> {
      const conns = await this.listConnections();
      const parse = (s: string | null) => { try { return (s ? JSON.parse(s) : []) as AccountRef[]; } catch { return []; } };
      const me = conns.find((c) => c.item_id === itemId);
      const owned = await db.getAllAsync<{ id: string; name: string; number: string | null; type: string }>('SELECT id, name, number, type FROM accounts WHERE item_id = ?', [itemId]);
      const mine = new Map<string, AccountRef>();
      for (const r of parse(me?.account_refs ?? null)) mine.set(r.id, r);
      for (const o of owned) if (!mine.has(o.id)) mine.set(o.id, { id: o.id, name: o.name, number: o.number, type: o.type });
      const shared: { id: string; name: string; otherItemId: string; otherName: string }[] = [];
      const exclusive: { id: string; name: string }[] = [];
      for (const a of mine.values()) {
        const other = conns.find((c) => c.item_id !== itemId && parse(c.account_refs).some((r) => r.id === a.id || (a.number && r.number === a.number && r.type === a.type)));
        if (other) shared.push({ id: a.id, name: a.name, otherItemId: other.item_id, otherName: other.name });
        else if (owned.some((o) => o.id === a.id)) exclusive.push({ id: a.id, name: a.name });
      }
      return { shared, exclusive };
    },
    /**
     * RF-009.1: apaga do aparelho a conexão e o que vem só dela (contas, transações, categorias mudadas).
     * RF-009.1.2: conta que também vem de outra conexão fica, ligada à outra, com transações e categorias.
     */
    async deleteConnectionData(itemId: string): Promise<{ kept: number; keptWith: string | null }> {
      const { shared } = await this.accountSharing(itemId);
      await db.withTransactionAsync(async () => {
        for (const s of shared) {
          // mesmo id: passa para a outra conexão; mesmo número com id diferente: a outra já tem a sua própria linha
          await db.runAsync('UPDATE accounts SET item_id = ? WHERE id = ? AND item_id = ?', [s.otherItemId, s.id, itemId]);
        }
        await db.runAsync('DELETE FROM transactions WHERE manual = 0 AND account_id IN (SELECT id FROM accounts WHERE item_id = ?)', [itemId]);
        await db.runAsync('DELETE FROM accounts WHERE item_id = ?', [itemId]);
        await db.runAsync('DELETE FROM investments WHERE item_id = ?', [itemId]);
        await db.runAsync('DELETE FROM wealth_points WHERE item_id = ?', [itemId]);
        await db.runAsync('DELETE FROM connections WHERE item_id = ?', [itemId]);
        // A conexão que estava marcada como repetida desta volta a ser normal (recebe as contas na próxima leitura).
        await db.runAsync('UPDATE connections SET duplicate_of = NULL WHERE duplicate_of = ?', [itemId]);
      });
      await this.recomputeTransfers();
      return { kept: shared.length, keptWith: shared[0]?.otherName ?? null };
    },

    // ---------- contas ----------
    listAccounts(): Promise<(AccountRow & { institution_name: string | null; connection_name: string })[]> {
      return db.getAllAsync(
        `SELECT a.*, c.institution_name, ${CONN_NAME('c')} AS connection_name FROM accounts a JOIN connections c ON c.item_id = a.item_id
         ORDER BY c.created_at, a.type, a.name`,
      );
    },
    /** RF-004.1 + RF-007.1: contas BANK + soma dos lançamentos manuais ("Dinheiro"); cartões fora. */
    async totalBalance(): Promise<{ total: number; manual: number; hasManual: boolean }> {
      const bank = await db.getFirstAsync<{ s: number | null }>(
        // R-17: conta "Sem autorização" não soma; R-18: as que aguardam nova autorização continuam somando.
        `SELECT SUM(a.balance) AS s FROM accounts a JOIN connections c ON c.item_id = a.item_id WHERE a.type = 'BANK' AND a.unauthorized_at IS NULL`,
      );
      const man = await db.getFirstAsync<{ s: number | null; n: number }>(
        'SELECT SUM(amount) AS s, COUNT(*) AS n FROM transactions WHERE manual = 1',
      );
      const manual = man?.s ?? 0;
      return { total: Math.round(((bank?.s ?? 0) + manual) * 100) / 100, manual, hasManual: (man?.n ?? 0) > 0 };
    },

    // ---------- RF-017 / T-23: visão por mês ----------
    /**
     * Uma linha por mês, da primeira transação até o mês atual. Gasto, Receita e Economia de cada mês são exatamente
     * "Despesas", "Receitas" e "Resultado" de T-18 (RF-017.5): vêm da mesma função monthSummary.
     */
    async monthlyOverview(today: string): Promise<{ firstDate: string | null; rows: { month: string; receitas: number; despesas: number; resultado: number }[] }> {
      const t0 = today.replace(/[^0-9-]/g, '');
      const first = (await db.getFirstAsync<{ d: string | null }>(`SELECT MIN(date_key) AS d FROM transactions WHERE date_key <= '${t0}'`))?.d ?? null;
      if (!first) return { firstDate: null, rows: [] };
      const rows = [];
      for (const m of monthsBetween(first.slice(0, 7), t0.slice(0, 7))) {
        const s = await this.monthSummary(m, t0);
        rows.push({ month: m, receitas: s.receitas, despesas: s.despesas, resultado: s.resultado });
      }
      return { firstDate: first, rows };
    },
    /** RF-017.7/.8/.8.1/.12 (ux.md 0.20): dados de "Saldo em contas" por mês, reais e estimados. */
    async saldoHistory(today: string): Promise<SaldoHistory> {
      const conns = await db.getAllAsync<{ item_id: string; name: string }>(
        `SELECT c.item_id, ${CONN_NAME('c')} AS name FROM connections c
         WHERE c.duplicate_of IS NULL
           -- Como no Início (R-18): a conexão que aguarda nova autorização continua somando.
           AND EXISTS (SELECT 1 FROM accounts a WHERE a.item_id = c.item_id AND a.type = 'BANK' AND a.unauthorized_at IS NULL)
         ORDER BY c.created_at`);
      const out: SaldoConn[] = [];
      for (const c of conns) {
        const bal = await db.getFirstAsync<{ s: number | null; auto: number }>(
          `SELECT SUM(balance) AS s, SUM(CASE WHEN auto_invested IS NOT NULL THEN 1 ELSE 0 END) AS auto
           FROM accounts WHERE item_id = ? AND type = 'BANK' AND unauthorized_at IS NULL`, [c.item_id]);
        const txs = await db.getAllAsync<{ date: string; date_key: string; amount: number; y: number }>(
          `SELECT t.date, t.date_key, t.amount, CASE WHEN t.pluggy_category_id = '03060000' THEN 1 ELSE 0 END AS y
           FROM transactions t JOIN accounts a ON a.id = t.account_id
           WHERE a.item_id = ? AND a.type = 'BANK' AND a.unauthorized_at IS NULL AND t.manual = 0`, [c.item_id]);
        const pts = await db.getAllAsync<{ date_key: string; accounts: number; data_at: string | null }>(
          'SELECT date_key, accounts, data_at FROM wealth_points WHERE item_id = ? ORDER BY date_key', [c.item_id]);
        // Um saldo por hora de dado: dias seguidos sem dado novo repetem o mesmo ponto e não contam duas vezes.
        const seen = new Set<string>(); const points: SaldoPoint[] = [];
        for (const p of pts) {
          const at = p.data_at ?? `${p.date_key}T15:00:00Z`;
          if (seen.has(at)) continue; seen.add(at); points.push({ dataAt: at, balance: p.accounts });
        }
        out.push({
          id: c.item_id, name: c.name, currentBalance: Math.round((bal?.s ?? 0) * 100) / 100,
          yieldOnlyInBalance: (bal?.auto ?? 0) > 0 && !txs.some((t) => t.y === 1),
          points, txs: txs.map((t) => ({ date: t.date, dateKey: t.date_key, amount: t.amount, isYield: t.y === 1 })),
        });
      }
      const manual = await db.getAllAsync<{ date_key: string; amount: number }>('SELECT date_key, amount FROM transactions WHERE manual = 1');
      return buildSaldoHistory(out, manual.map((m) => ({ dateKey: m.date_key, amount: m.amount })), today);
    },

    // ---------- Patrimônio (RF-016, T-21) ----------
    /** Soma por conexão: contas BANK (sem as "Sem autorização") e investimentos. Cartões não entram (E-3 a). */
    async wealthNow(): Promise<{ accounts: number; manual: number; investments: number; total: number; byConnection: { item_id: string; name: string; investments: number; autoInvested: number; origin: string | null }[] }> {
      const bal = await this.totalBalance();
      const inv = await db.getAllAsync<{ item_id: string; name: string; investments: number; autoInvested: number | null; origin: string | null; n: number }>(
        `SELECT c.item_id, ${CONN_NAME('c')} AS name,
           (SELECT COALESCE(SUM(i.balance), 0) FROM investments i WHERE i.item_id = c.item_id) AS investments,
           (SELECT SUM(a.auto_invested) FROM accounts a WHERE a.item_id = c.item_id AND a.type = 'BANK' AND a.unauthorized_at IS NULL) AS autoInvested,
           c.origin_updated_at AS origin,
           (SELECT COUNT(*) FROM investments i WHERE i.item_id = c.item_id) AS n
         FROM connections c WHERE c.duplicate_of IS NULL ORDER BY c.created_at`,
      );
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const investments = r2(inv.reduce((t, c) => t + (c.investments ?? 0), 0));
      return {
        accounts: bal.total, manual: bal.manual, investments, total: r2(bal.total + investments),
        byConnection: inv.filter((c) => c.n > 0 || (c.autoInvested ?? 0) > 0).map((c) => ({ item_id: c.item_id, name: c.name, investments: r2(c.investments ?? 0), autoInvested: r2(c.autoInvested ?? 0), origin: c.origin })),
      };
    },
    /** RF-016.4: grava (ou atualiza, só no próprio dia) o ponto da conexão e o da conta "Dinheiro". */
    /** Ponto de hoje da conta "Dinheiro" depois de criar, editar ou excluir um lançamento manual. */
    async recordManualPoint(dateKey: string = spDateKey(new Date())): Promise<void> {
      const man = await db.getFirstAsync<{ s: number | null; n: number }>('SELECT SUM(amount) AS s, COUNT(*) AS n FROM transactions WHERE manual = 1');
      const had = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM wealth_points WHERE item_id = 'manual'");
      if (!(man?.n ?? 0) && !(had?.n ?? 0)) return;
      await db.runAsync(
        `INSERT INTO wealth_points (date_key, item_id, accounts, investments, data_at) VALUES (?, 'manual', ?, 0, NULL)
         ON CONFLICT(date_key, item_id) DO UPDATE SET accounts = excluded.accounts`, [dateKey, man?.s ?? 0]);
    },
    async recordWealthPoint(itemId: string, dateKey: string, dataAt: string | null): Promise<void> {
      const acc = await db.getFirstAsync<{ s: number | null }>(
        "SELECT SUM(balance) AS s FROM accounts WHERE item_id = ? AND type = 'BANK' AND unauthorized_at IS NULL", [itemId]);
      const inv = await db.getFirstAsync<{ s: number | null }>('SELECT SUM(balance) AS s FROM investments WHERE item_id = ?', [itemId]);
      const man = await db.getFirstAsync<{ s: number | null; n: number }>('SELECT SUM(amount) AS s, COUNT(*) AS n FROM transactions WHERE manual = 1');
      const up = `INSERT INTO wealth_points (date_key, item_id, accounts, investments, data_at) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(date_key, item_id) DO UPDATE SET accounts = excluded.accounts, investments = excluded.investments, data_at = excluded.data_at`;
      await db.runAsync(up, [dateKey, itemId, acc?.s ?? 0, inv?.s ?? 0, dataAt]);
      if ((man?.n ?? 0) > 0) await db.runAsync(up, [dateKey, 'manual', man?.s ?? 0, 0, null]);
    },
    /**
     * RF-016.2/.4 e R-4: série do patrimônio, um ponto por data com dado. Para cada conexão ativa, vale o ponto do
     * dia; sem ele, o último conhecido até 7 dias antes (ponto parcial). Sem nenhum ponto do dia, ou com alguma
     * conexão sem dado há mais de 7 dias, a data fica sem ponto. Nada é inventado.
     */
    async wealthSeries(): Promise<WealthPoint[]> {
      const items = (await db.getAllAsync<{ item_id: string; name: string }>(
        `SELECT c.item_id, ${CONN_NAME('c')} AS name FROM connections c WHERE c.duplicate_of IS NULL`)).concat(
        (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM wealth_points WHERE item_id = 'manual'"))?.n ? [{ item_id: 'manual', name: 'Dinheiro' }] : []);
      const rows = await db.getAllAsync<{ date_key: string; item_id: string; accounts: number; investments: number }>(
        'SELECT date_key, item_id, accounts, investments FROM wealth_points ORDER BY date_key');
      const byItem = new Map<string, { date_key: string; accounts: number; investments: number }[]>();
      for (const r of rows) (byItem.get(r.item_id) ?? byItem.set(r.item_id, []).get(r.item_id)!).push(r);
      const days = [...new Set(rows.filter((r) => items.some((i) => i.item_id === r.item_id)).map((r) => r.date_key))].sort();
      const DAY = 86400000;
      const toMs = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
      const out: WealthPoint[] = [];
      for (const d of days) {
        let accounts = 0; let investments = 0; let ok = true; const partial: { name: string; date: string }[] = [];
        for (const it of items) {
          const list = byItem.get(it.item_id) ?? [];
          const last = [...list].reverse().find((r) => r.date_key <= d);
          // Conexão que ainda não existia neste dia (primeiro ponto depois) não entra nem bloqueia.
          if (!last) { if (list.length && list[0].date_key > d) continue; continue; }
          // A conta "Dinheiro" é do próprio aparelho: o último valor vale até mudar (não é dado atrasado de banco).
          if (last.date_key !== d && it.item_id !== 'manual') {
            if ((toMs(d) - toMs(last.date_key)) / DAY > 7) { ok = false; break; }
            partial.push({ name: it.name, date: last.date_key });
          }
          accounts += last.accounts; investments += last.investments;
        }
        if (!ok) continue;
        const r2 = (v: number) => Math.round(v * 100) / 100;
        out.push({ date: d, accounts: r2(accounts), investments: r2(investments), total: r2(accounts + investments), partial });
      }
      return out;
    },

    // ---------- Resumo mensal (RF-008, T-18) ----------
    /**
     * Mesma regra das somas do Extrato (RF-008.1): conta o que não está oculto (PM-7), não é transferência entre
     * contas próprias (RF-008.2), não é "Investimentos" (R-3) e não é futuro (RF-008.4). Receita e despesa pelo sinal.
     */
    async monthSummary(month: string, today: string): Promise<MonthSummary> {
      const from = `${month}-01`;
      const to = `${month}-31`;
      const t0 = today.replace(/[^0-9-]/g, '');
      const base = `t.date_key BETWEEN ? AND ? AND t.hidden = 0 AND ${EFFECTIVE_TRANSFER} = 0 AND t.date_key <= '${t0}'`;
      // RF-008.8: "Fora do Resumo" sai das receitas e despesas (e da lista por categoria).
      const notInv = `COALESCE(${EFFECTIVE_CATEGORY}, '') <> 'investimentos' AND t.out_of_summary = 0`;
      const isInv = `COALESCE(${EFFECTIVE_CATEGORY}, '') = 'investimentos'`;
      const totals = await db.getFirstAsync<{ rec: number | null; desp: number | null; rfN: number | null; rfV: number | null; rend: number | null; apl: number | null; res: number | null; outS: number | null; outE: number | null; outN: number | null; n: number }>(
        `SELECT
           -- RF-008.10: estorno no cartão não é receita; reduz as despesas (o líquido).
           SUM(CASE WHEN ${notInv} AND t.amount > 0 AND t.refund = 0 THEN t.amount END) AS rec,
           SUM(CASE WHEN ${notInv} AND (t.amount < 0 OR t.refund = 1) THEN -t.amount END) AS desp,
           SUM(CASE WHEN ${notInv} AND t.refund = 1 THEN 1 ELSE 0 END) AS rfN,
           SUM(CASE WHEN ${notInv} AND t.refund = 1 THEN t.amount END) AS rfV,
           SUM(CASE WHEN ${notInv} AND ${EFFECTIVE_CATEGORY} = 'rendimentos' AND t.amount > 0 AND t.refund = 0 THEN t.amount END) AS rend,
           SUM(CASE WHEN ${isInv} AND t.amount < 0 THEN -t.amount END) AS apl,
           SUM(CASE WHEN ${isInv} AND t.amount > 0 THEN t.amount END) AS res,
           -- RF-008.8.1/.2 (N-1, N-2): só o que cai em "fora do Resumo" (não oculta, não futura, não transferência, não investimento)
           SUM(CASE WHEN NOT ${isInv} AND t.out_of_summary = 1 AND t.amount < 0 THEN -t.amount END) AS outS,
           SUM(CASE WHEN NOT ${isInv} AND t.out_of_summary = 1 AND t.amount > 0 THEN t.amount END) AS outE,
           SUM(CASE WHEN NOT ${isInv} AND t.out_of_summary = 1 THEN 1 ELSE 0 END) AS outN,
           COUNT(*) AS n
         FROM transactions t WHERE ${base}`,
        [from, to],
      );
      // RF-008.10: cada categoria com o líquido (gastos − estornos do mês) e os estornos descontados.
      const cats = await db.getAllAsync<{ category: string | null; total: number; rfN: number; rfV: number | null }>(
        `SELECT ${EFFECTIVE_CATEGORY} AS category, SUM(-t.amount) AS total,
                SUM(t.refund) AS rfN, SUM(CASE WHEN t.refund = 1 THEN t.amount END) AS rfV
         FROM transactions t
         WHERE ${base} AND ${notInv} AND (t.amount < 0 OR t.refund = 1) GROUP BY ${EFFECTIVE_CATEGORY} ORDER BY total DESC`,
        [from, to],
      );
      const fut = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM transactions t WHERE t.date_key BETWEEN ? AND ? AND t.date_key > '${t0}' AND t.hidden = 0`,
        [from, to],
      );
      const any = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM transactions t WHERE t.date_key BETWEEN ? AND ?', [from, to]);
      // R-5 (RF-008.3): conexão com investimentos e nenhum lançamento que o PLUGGY identificou como rendimento no mês.
      // Marcar "Rendimentos" à mão não conta (R-5.4).
      const noYield = await db.getAllAsync<{ name: string }>(
        `SELECT ${CONN_NAME('c')} AS name FROM connections c
         WHERE COALESCE(c.investments_count, 0) > 0 AND c.replaced_at IS NULL AND c.duplicate_of IS NULL
           AND NOT EXISTS (SELECT 1 FROM transactions t JOIN accounts a ON a.id = t.account_id
                           WHERE a.item_id = c.item_id AND t.pluggy_category_id = '03060000' AND t.date_key BETWEEN ? AND ?)
         ORDER BY c.created_at`,
        [from, to],
      );
      const card = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM accounts WHERE type = 'CREDIT'");
      // R-2.1: o aviso da fatura só existe no mês com pagamento de fatura sem par e sem marcação manual.
      const bill = await db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM transactions t WHERE t.date_key BETWEEN ? AND ? AND t.bill_unpaired = 1 AND t.transfer_override IS NULL AND t.hidden = 0', [from, to]);
      const r2 = (v: number | null | undefined) => Math.round((v ?? 0) * 100) / 100;
      const receitas = r2(totals?.rec);
      const despesas = r2(totals?.desp);
      return {
        receitas, despesas, resultado: r2(receitas - despesas), rendimentos: r2(totals?.rend),
        aplicado: r2(totals?.apl), resgatado: r2(totals?.res),
        outOfSummary: { saidas: r2(totals?.outS), entradas: r2(totals?.outE), count: totals?.outN ?? 0 },
        byCategory: cats.map((c) => ({ category: c.category, total: r2(c.total), refunds: { count: c.rfN ?? 0, total: r2(c.rfV) } })),
        refunds: { count: totals?.rfN ?? 0, total: r2(totals?.rfV) },
        futureCount: fut?.n ?? 0, movementCount: any?.n ?? 0,
        yieldWarnings: noYield.map((c) => c.name), hasCard: (card?.n ?? 0) > 0, unpairedBills: bill?.n ?? 0,
      };
    },

    // ---------- lançamento manual (RF-007, T-17) ----------
    /** RF-007.1: conta única "Dinheiro" (account_id 'manual'), sem saldo inicial; valor com sinal (saída negativa). */
    async addManual(m: { amount: number; description: string; dateKey: string; category: string | null }, nowIso: string): Promise<string> {
      const id = `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const desc = m.description.trim() || 'Lançamento manual';
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, auto_category, manual, updated_at)
         VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, 1, ?)`,
        [id, `${m.dateKey}T15:00:00.000Z`, m.dateKey, desc, normalizeSearch(desc), Math.round(m.amount * 100) / 100, m.category, nowIso],
      );
      await this.recordManualPoint();
      return id;
    },
    async updateManual(id: string, m: { amount: number; description: string; dateKey: string; category: string | null }, nowIso: string): Promise<void> {
      const desc = m.description.trim() || 'Lançamento manual';
      await db.runAsync(
        `UPDATE transactions SET date = ?, date_key = ?, description = ?, search_text = ?, amount = ?, auto_category = ?,
           user_category = NULL, user_category_set = 0, updated_at = ? WHERE id = ? AND manual = 1`,
        [`${m.dateKey}T15:00:00.000Z`, m.dateKey, desc, normalizeSearch(desc), Math.round(m.amount * 100) / 100, m.category, nowIso, id],
      );
      await this.recordManualPoint();
    },
    /** RF-007.2: só lançamento manual pode ser excluído; importada não (só ocultar). */
    async deleteManual(id: string): Promise<void> {
      await db.runAsync('DELETE FROM transactions WHERE id = ? AND manual = 1', [id]);
      await this.recordManualPoint();
    },

    // ---------- transações ----------
    async listTransactions(filter: TxFilter, limit = 50, offset = 0): Promise<TransactionRow[]> {
      const w = whereFor(filter);
      return db.getAllAsync<TransactionRow>(
        `SELECT t.id, t.account_id, t.date, t.date_key, t.description, t.amount,
                ${EFFECTIVE_CATEGORY} AS category, t.hidden, t.manual,
                ${EFFECTIVE_TRANSFER} AS transfer, t.transfer_auto, t.out_of_summary, t.refund,
                CASE WHEN t.user_category_set = 0 AND t.remembered_category IS NOT NULL THEN 1 ELSE 0 END AS remembered,
                COALESCE(a.name, 'Dinheiro') AS account_name, a.type AS account_type, a.subtype AS account_subtype, c.institution_name,
                CASE WHEN c.item_id IS NULL THEN NULL ELSE ${CONN_NAME('c')} END AS connection_name
         FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN connections c ON c.item_id = a.item_id
         ${w.sql}
         ORDER BY t.date_key DESC, t.date DESC, t.id
         LIMIT ? OFFSET ?`,
        [...w.params, limit, offset],
      );
    },
    getTransaction(id: string): Promise<TransactionRow | null> {
      return db.getFirstAsync<TransactionRow>(
        `SELECT t.id, t.account_id, t.date, t.date_key, t.description, t.amount,
                ${EFFECTIVE_CATEGORY} AS category, t.hidden, t.manual,
                ${EFFECTIVE_TRANSFER} AS transfer, t.transfer_auto, t.out_of_summary, t.refund,
                CASE WHEN t.user_category_set = 0 AND t.remembered_category IS NOT NULL THEN 1 ELSE 0 END AS remembered,
                COALESCE(a.name, 'Dinheiro') AS account_name, a.type AS account_type, a.subtype AS account_subtype, c.institution_name,
                CASE WHEN c.item_id IS NULL THEN NULL ELSE ${CONN_NAME('c')} END AS connection_name
         FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN connections c ON c.item_id = a.item_id WHERE t.id = ?`,
        [id],
      );
    },
    /** Linha de resultado do extrato (T-13): contagem e somas do que está filtrado. */
    async sums(filter: TxFilter): Promise<{ count: number; entradas: number; saidas: number; refunds: number; excluded: number; byReason: ExclusionCounts; out: { count: number; saidas: number; entradas: number } }> {
      // UX 0.16 (E-11 a): as ocultas contam sempre em "Fora das somas", mesmo com "Mostrar ocultas" desligado.
      // Por isso a consulta inclui as ocultas e o total da lista ({n} transações) só as conta quando estão à mostra.
      const w = whereFor({ ...filter, showHidden: true });
      const shown = filter.showHidden ? '1' : 't.hidden = 0';
      // Futuras (data depois de hoje) ficam fora das somas até a data chegar; no próprio dia já contam (UX 0.9).
      // RF-008.8.1 (N-1): cada lançamento fora das somas conta num motivo só, nesta ordem:
      // oculta, futura, transferência, investimentos, fora do Resumo.
      const today = (filter.today ?? '9999-12-31').replace(/[^0-9-]/g, '');
      const reason = `CASE WHEN t.hidden = 1 THEN 'hidden' WHEN t.date_key > '${today}' THEN 'future'
        WHEN ${EFFECTIVE_TRANSFER} = 1 THEN 'transfer' WHEN COALESCE(${EFFECTIVE_CATEGORY}, '') = 'investimentos' THEN 'investments'
        WHEN t.out_of_summary = 1 THEN 'out' ELSE NULL END`;
      const r = await db.getFirstAsync<{ n: number; e: number | null; s: number | null; rf: number | null; h: number; f: number; tr: number; i: number; o: number; oS: number | null; oE: number | null }>(
        `SELECT SUM(shown) AS n,
                -- RF-008.10: o estorno no cartão não entra em "Entradas"; ele reduz "Saídas".
                SUM(CASE WHEN r IS NULL AND amount > 0 AND refund = 0 THEN amount ELSE 0 END) AS e,
                SUM(CASE WHEN r IS NULL AND (amount < 0 OR refund = 1) THEN amount ELSE 0 END) AS s,
                SUM(CASE WHEN r IS NULL AND refund = 1 THEN 1 ELSE 0 END) AS rf,
                SUM(r = 'hidden') AS h, SUM(r = 'future') AS f, SUM(r = 'transfer') AS tr, SUM(r = 'investments') AS i, SUM(r = 'out') AS o,
                -- UX 0.16 (C2-07): a soma dos marcados "Fora do Resumo", a mesma da linha do Resumo (N-1, N-2)
                SUM(CASE WHEN r = 'out' AND amount < 0 THEN -amount ELSE 0 END) AS oS,
                SUM(CASE WHEN r = 'out' AND amount > 0 THEN amount ELSE 0 END) AS oE
         FROM (SELECT t.amount AS amount, t.refund AS refund, ${reason} AS r, CASE WHEN ${shown} THEN 1 ELSE 0 END AS shown FROM transactions t ${w.sql})`,
        w.params,
      );
      const round = (v: number | null | undefined) => Math.round((v ?? 0) * 100) / 100;
      const byReason = { hidden: r?.h ?? 0, future: r?.f ?? 0, transfer: r?.tr ?? 0, investments: r?.i ?? 0, out: r?.o ?? 0 };
      const excluded = byReason.hidden + byReason.future + byReason.transfer + byReason.investments + byReason.out;
      return { count: r?.n ?? 0, entradas: round(r?.e), saidas: round(r?.s), refunds: r?.rf ?? 0, excluded, byReason, out: { count: byReason.out, saidas: round(r?.oS), entradas: round(r?.oE) } };
    },
    /** RF-008.8: marca "Fora do Resumo" (importadas e manuais). Não muda pares de transferência (N-3). */
    async setOutOfSummary(id: string, value: boolean): Promise<void> {
      await db.runAsync('UPDATE transactions SET out_of_summary = ? WHERE id = ?', [value ? 1 : 0, id]);
    },
    async countAllTransactions(): Promise<number> {
      const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
      return r?.n ?? 0;
    },
    /** RF-006.2. category null = "Sem categoria" escolhido pela pessoa. */
    async setCategory(id: string, category: string | null): Promise<void> {
      await db.runAsync('UPDATE transactions SET user_category = ?, user_category_set = 1 WHERE id = ?', [category, id]);
    },
    // ---------- RF-006.3: categoria lembrada por destinatário (UX 0.17; requisitos v1.21 a v1.23) ----------
    // A lembrança guarda só tipo e número do documento, categoria, contagem e data do último lançamento (v1.23, 11.17).

    /** Destinatário do lançamento (PIX ou boleto em conta, com CPF ou CNPJ); null nos demais, inclusive cartão. */
    async recipientOf(id: string): Promise<RecipientKey | null> {
      const r = await db.getFirstAsync<{ account_type: string | null; operation_type: string | null; amount: number; payer_doc_type: string | null; payer_doc: string | null; receiver_doc_type: string | null; receiver_doc: string | null }>(
        `SELECT a.type AS account_type, t.operation_type, t.amount, t.payer_doc_type, t.payer_doc, t.receiver_doc_type, t.receiver_doc
         FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id WHERE t.id = ?`, [id]);
      if (!r) return null;
      return recipientKey({ accountType: r.account_type, operationType: r.operation_type, amount: r.amount, payerType: r.payer_doc_type, payer: r.payer_doc, receiverType: r.receiver_doc_type, receiver: r.receiver_doc });
    },
    async getRemembered(key: RecipientKey): Promise<RememberedRow | null> {
      return db.getFirstAsync<RememberedRow>('SELECT * FROM recipient_categories WHERE doc_type = ? AND doc = ?', [key.type, key.doc]);
    },
    /**
     * T-16: a pessoa troca a categoria de um lançamento. Com destinatário, o app lembra a categoria (Sem categoria
     * apaga a lembrança, N-5; "Investimentos" não vira lembrança, porque a lembrança não mexe nessa categoria).
     * Devolve o que é preciso para "Desfazer" (a troca e a lembrança) e quantos outros lançamentos do mesmo
     * destinatário estão em outra categoria e podem mudar (sem os categorizados à mão, N-4).
     */
    async changeCategory(id: string, category: string | null): Promise<CategoryChange> {
      const prev = await db.getFirstAsync<{ user_category: string | null; user_category_set: number }>('SELECT user_category, user_category_set FROM transactions WHERE id = ?', [id]);
      const key = await this.recipientOf(id);
      const prevMemory = key ? await this.getRemembered(key) : null;
      const now = new Date().toISOString();
      const remembers = Boolean(key && category && category !== 'investimentos');
      await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE transactions SET user_category = ?, user_category_set = 1 WHERE id = ?', [category, id]);
        if (key && category === null) await db.runAsync('DELETE FROM recipient_categories WHERE doc_type = ? AND doc = ?', [key.type, key.doc]);
        if (key && remembers) {
          await db.runAsync(
            `INSERT INTO recipient_categories (doc_type, doc, category, created_at, used_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(doc_type, doc) DO UPDATE SET category = excluded.category, used_at = excluded.used_at`,
            [key.type, key.doc, category, now, now]);
        }
      });
      if (key && remembers) await this.refreshRecipientStats(key);
      const others = key && remembers ? (await this.othersToApply(id, key, category as string)).length : 0;
      return { key, remembered: remembers, prev: { user_category: prev?.user_category ?? null, user_category_set: prev?.user_category_set ?? 0 }, prevMemory, others };
    },
    /** "Desfazer" de T-16: devolve a categoria do lançamento e a lembrança como estavam. */
    async undoCategoryChange(id: string, change: CategoryChange): Promise<void> {
      await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE transactions SET user_category = ?, user_category_set = ? WHERE id = ?', [change.prev.user_category, change.prev.user_category_set, id]);
        if (change.key) {
          await db.runAsync('DELETE FROM recipient_categories WHERE doc_type = ? AND doc = ?', [change.key.type, change.key.doc]);
          if (change.prevMemory) await this.restoreRemembered(change.prevMemory);
        }
      });
    },
    /** Outros lançamentos do mesmo destinatário em outra categoria, que "Aplicar a eles" pode mudar (N-4: não os à mão). */
    async othersToApply(id: string, key: RecipientKey, category: string): Promise<{ id: string; prev: string | null }[]> {
      return db.getAllAsync<{ id: string; prev: string | null }>(
        `SELECT t.id, t.remembered_category AS prev FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
         WHERE t.id <> ? AND (${RECIPIENT_TYPE_SQL}) = ? AND (${RECIPIENT_DOC_SQL}) = ? AND t.user_category_set = 0
           AND COALESCE(${EFFECTIVE_CATEGORY}, '') <> ? AND COALESCE(${EFFECTIVE_CATEGORY}, '') <> 'investimentos'`,
        [id, key.type, key.doc, category]);
    },
    /** "Aplicar a eles" (UX-092). Devolve a lista para "Desfazer". */
    async applyToOthers(id: string, key: RecipientKey, category: string): Promise<{ id: string; prev: string | null }[]> {
      const list = await this.othersToApply(id, key, category);
      await db.withTransactionAsync(async () => {
        for (const o of list) await db.runAsync('UPDATE transactions SET remembered_category = ? WHERE id = ?', [category, o.id]);
      });
      return list;
    },
    async undoApplyToOthers(list: { id: string; prev: string | null }[]): Promise<void> {
      await db.withTransactionAsync(async () => {
        for (const o of list) await db.runAsync('UPDATE transactions SET remembered_category = ? WHERE id = ?', [o.prev, o.id]);
      });
    },
    /** Sincronização: só os lançamentos NOVOS de um destinatário lembrado recebem a categoria (vale daqui para a frente). */
    async applyMemoryToNew(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;
      const mem = await db.getAllAsync<RememberedRow>('SELECT * FROM recipient_categories');
      if (mem.length === 0) return 0;
      const byKey = new Map(mem.map((m) => [`${m.doc_type}:${m.doc}`, m]));
      const now = new Date().toISOString();
      let applied = 0;
      for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400);
        const rows = await db.getAllAsync<{ id: string; account_type: string | null; operation_type: string | null; amount: number; payer_doc_type: string | null; payer_doc: string | null; receiver_doc_type: string | null; receiver_doc: string | null; auto_category: string | null; user_category_set: number }>(
          `SELECT t.id, a.type AS account_type, t.operation_type, t.amount, t.payer_doc_type, t.payer_doc, t.receiver_doc_type, t.receiver_doc, t.auto_category, t.user_category_set
           FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id WHERE t.id IN (${chunk.map(() => '?').join(',')})`, chunk);
        for (const r of rows) {
          const key = recipientKey({ accountType: r.account_type, operationType: r.operation_type, amount: r.amount, payerType: r.payer_doc_type, payer: r.payer_doc, receiverType: r.receiver_doc_type, receiver: r.receiver_doc });
          const m = key ? byKey.get(`${key.type}:${key.doc}`) : undefined;
          if (!m || r.user_category_set === 1 || r.auto_category === 'investimentos') continue;
          await db.runAsync('UPDATE transactions SET remembered_category = ? WHERE id = ?', [m.category, r.id]);
          await db.runAsync('UPDATE recipient_categories SET used_at = ? WHERE doc_type = ? AND doc = ?', [now, m.doc_type, m.doc]);
          applied++;
        }
      }
      return applied;
    },
    /** Contagem e data do último lançamento de cada destinatário lembrado, enquanto houver lançamento no aparelho. */
    async refreshRecipientStats(key?: RecipientKey): Promise<void> {
      const match = `(${RECIPIENT_TYPE_SQL}) = recipient_categories.doc_type AND (${RECIPIENT_DOC_SQL}) = recipient_categories.doc`;
      await db.runAsync(
        `UPDATE recipient_categories SET
           tx_count = (SELECT COUNT(*) FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id WHERE ${match}),
           last_tx_date = (SELECT MAX(t.date_key) FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id WHERE ${match})
         WHERE EXISTS (SELECT 1 FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id WHERE ${match})
           ${key ? 'AND doc_type = ? AND doc = ?' : ''}`,
        key ? [key.type, key.doc] : []);
    },
    /** Para T-22 (espera o ajuste do Designer para E-14 b): lista da lembrança usada mais recentemente para a mais antiga. */
    async listRemembered(): Promise<RememberedListRow[]> {
      // E-14 (b) / v1.23 (11.17): a descrição, a data e o valor vêm do último lançamento que ainda está no aparelho;
      // a lembrança não guarda cópia. Sem lançamento (por exemplo, depois de revogar), vêm nulos.
      const match = `(${RECIPIENT_TYPE_SQL}) = rc.doc_type AND (${RECIPIENT_DOC_SQL}) = rc.doc`;
      const rows = await db.getAllAsync<RememberedRow & { last_tx_id: string | null }>(
        `SELECT rc.*, (SELECT t.id FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id WHERE ${match}
                       ORDER BY t.date_key DESC, t.date DESC LIMIT 1) AS last_tx_id
         FROM recipient_categories rc ORDER BY rc.used_at DESC`);
      const out: RememberedListRow[] = [];
      for (const r of rows) {
        const t = r.last_tx_id ? await db.getFirstAsync<{ description: string; date_key: string; amount: number }>('SELECT description, date_key, amount FROM transactions WHERE id = ?', [r.last_tx_id]) : null;
        out.push({ ...r, last: t ?? null });
      }
      return out;
    },
    async countRemembered(): Promise<number> {
      return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM recipient_categories'))?.n ?? 0;
    },
    /** Esquecer um (N-7: os lançamentos já categorizados ficam como estão). Devolve a linha para "Desfazer". */
    async forgetRemembered(key: RecipientKey): Promise<RememberedRow | null> {
      const row = await this.getRemembered(key);
      await db.runAsync('DELETE FROM recipient_categories WHERE doc_type = ? AND doc = ?', [key.type, key.doc]);
      return row;
    },
    async restoreRemembered(row: RememberedRow): Promise<void> {
      await db.runAsync(
        `INSERT OR REPLACE INTO recipient_categories (doc_type, doc, category, tx_count, last_tx_date, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [row.doc_type, row.doc, row.category, row.tx_count, row.last_tx_date, row.created_at, row.used_at]);
    },
    async forgetAllRemembered(): Promise<void> {
      await db.runAsync('DELETE FROM recipient_categories');
    },
    /** Sincronização: quais destes ids já estão no aparelho (para saber os novos). */
    async existingTxIds(ids: string[]): Promise<Set<string>> {
      const out = new Set<string>();
      for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400);
        for (const r of await db.getAllAsync<{ id: string }>(`SELECT id FROM transactions WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk)) out.add(r.id);
      }
      return out;
    },
    /** RF-007.2 / PM-7: ocultar e reexibir (importadas). */
    async setHidden(id: string, hidden: boolean): Promise<void> {
      await db.runAsync('UPDATE transactions SET hidden = ? WHERE id = ? AND manual = 0', [hidden ? 1 : 0, id]);
    },
    /** PM-8: marcar/desmarcar transferência. null volta ao reconhecimento automático. */
    async setTransferOverride(id: string, value: boolean | null): Promise<void> {
      await db.runAsync('UPDATE transactions SET transfer_override = ? WHERE id = ?', [value === null ? null : value ? 1 : 0, id]);
    },
    /**
     * Reaplica PM-8/R-2 (decisão do PM, 18/11/2026): 1º o sinal do Pluggy (categoria 04 "Transferência mesma
     * titularidade" ou 05100000 "Pagamento de cartão de crédito"); 2º, para as demais, o par de mesmo valor
     * entre contas da pessoa em até 2 dias. A marcação manual (transfer_override) sempre prevalece.
     */
    /**
     * R-8.2 (requisitos v1.18): transferência própria se (a) o Pluggy marca mesma titularidade (04…), ou (b) pagador e
     * recebedor com o mesmo CPF, ou (c) o par de mesmo valor entre contas do app em até 2 dias (PM-8). Pagador CNPJ
     * nunca é transferência própria (RF-008.5), nem pelo sinal (a). A marca "Fora do Resumo" não muda nada aqui (N-3).
     * A escolha manual da pessoa (transfer_override) sempre prevalece.
     */
    async recomputeTransfers(): Promise<void> {
      const rows = await db.getAllAsync<{ id: string; account_id: string; account_type: string | null; date_key: string; amount: number; pluggy_category_id: string | null; operation_type: string | null; payer_doc_type: string | null; payer_doc: string | null; receiver_doc_type: string | null; receiver_doc: string | null }>(
        `SELECT t.id, t.account_id, a.type AS account_type, t.date_key, t.amount, t.pluggy_category_id, t.operation_type,
                t.payer_doc_type, t.payer_doc, t.receiver_doc_type, t.receiver_doc
         FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id WHERE t.manual = 0`,
      );
      const sig = (r: (typeof rows)[number]) => ownTransferSignal({ pluggyCategoryId: r.pluggy_category_id, payerType: r.payer_doc_type, payer: r.payer_doc, receiverType: r.receiver_doc_type, receiver: r.receiver_doc });
      // RF-008.10: estorno de compra no cartão nunca entra no par de transferência (não é dinheiro entre contas suas).
      const billIds = new Set(rows.filter((r) => isBillPayment({ accountType: r.account_type, amount: r.amount, operationType: r.operation_type, pluggyCategoryId: r.pluggy_category_id })).map((r) => r.id));
      const refunds = rows.filter((r) => isCardRefund({ accountType: r.account_type, amount: r.amount, isBill: billIds.has(r.id), pluggyCategoryId: r.pluggy_category_id })).map((r) => r.id);
      const refundSet = new Set(refunds);
      const yes = rows.filter((r) => sig(r) === 'yes');
      const maybe = rows.filter((r) => sig(r) === 'maybe' && !refundSet.has(r.id));
      const paired = detectTransfers(maybe.map((r) => ({ id: r.id, accountId: r.account_id, date: r.date_key, amount: r.amount })));
      for (const r of yes) paired.add(r.id);
      // R-2.1: pagamento de fatura = saída PAGAMENTO_FATURA na conta, ou crédito "Pagamento recebido" (05100000 /
      // PAGAMENTO_FATURA) no cartão. Sem par por R-8.2 → "sem par" (aviso do Resumo). O crédito no cartão nunca conta
      // como receita: fica fora das somas mesmo sem par, até a pessoa marcar.
      const bills = rows.filter((r) => isBillPayment({ accountType: r.account_type, amount: r.amount, operationType: r.operation_type, pluggyCategoryId: r.pluggy_category_id }));
      const unpaired = bills.filter((r) => !paired.has(r.id)).map((r) => r.id);
      const cardBillCredits = bills.filter((r) => r.account_type === 'CREDIT' && r.amount > 0).map((r) => r.id);
      const auto = new Set([...paired, ...cardBillCredits]);
      await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE transactions SET transfer_auto = 0, bill_unpaired = 0, refund = 0 WHERE manual = 0 AND (transfer_auto = 1 OR bill_unpaired = 1 OR refund = 1)');
        const set = async (col: string, list: string[]) => {
          for (let i = 0; i < list.length; i += 400) {
            const chunk = list.slice(i, i + 400);
            await db.runAsync(`UPDATE transactions SET ${col} = 1 WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
          }
        };
        await set('transfer_auto', [...auto]);
        await set('bill_unpaired', unpaired);
        await set('refund', refunds);
      });
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;

/** RF-006.3: uma lembrança. Só documento, categoria, contagem, data do último lançamento e datas de uso (v1.23). */
export type RememberedRow = { doc_type: string; doc: string; category: string; tx_count: number; last_tx_date: string | null; created_at: string; used_at: string };
export type RememberedListRow = RememberedRow & { last_tx_id: string | null; last: { description: string; date_key: string; amount: number } | null };
export type CategoryChange = {
  key: RecipientKey | null;
  /** O aviso de T-16 diz que o app vai sugerir a categoria nos próximos. */
  remembered: boolean;
  prev: { user_category: string | null; user_category_set: number };
  prevMemory: RememberedRow | null;
  /** Lançamentos do mesmo destinatário em outra categoria que "Aplicar a eles" muda (UX-092). */
  others: number;
};

export type ExclusionCounts = { hidden: number; future: number; transfer: number; investments: number; out: number };

export type WealthPoint = { date: string; accounts: number; investments: number; total: number; partial: { name: string; date: string }[] };

export type MonthSummary = {
  receitas: number;
  despesas: number;
  resultado: number;
  /** Parte das receitas que é "Rendimentos" (UX 0.7, RF-008.3). */
  rendimentos: number;
  aplicado: number;
  resgatado: number;
  /** RF-008.8 (N-2): soma das saídas e das entradas marcadas "Fora do Resumo" e quantos lançamentos. */
  outOfSummary: { saidas: number; entradas: number; count: number };
  /** RF-008.10: total = líquido do mês (gastos − estornos); refunds = estornos descontados. */
  byCategory: { category: string | null; total: number; refunds: { count: number; total: number } }[];
  /** RF-008.10: estornos de compras no cartão do mês, já descontados das despesas. */
  refunds: { count: number; total: number };
  futureCount: number;
  movementCount: number;
  /** Nomes das conexões do aviso "rendimentos desta instituição não identificados" (R-5). */
  yieldWarnings: string[];
  hasCard: boolean;
  /** R-2.1: pagamentos de fatura sem par no mês. */
  unpairedBills: number;
};

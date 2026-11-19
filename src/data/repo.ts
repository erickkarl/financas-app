// Consultas do app. Toda regra de soma segue a UX v0.3 e as premissas do PM:
// - saldo total = contas BANK + "Dinheiro" (manuais); cartões fora (RF-004.1, RF-007.1)
// - somas do extrato sem ocultas (PM-7), sem transferências próprias (PM-8) e sem Investimentos (R-3)
import type { Db, SqlValue } from './db';
import { normalizeSearch } from '../domain/format';
import { detectTransfers } from '../domain/transfers';
import { isPluggyTransferSignal } from '../domain/categories';

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
  account_name: string;
  account_type: string | null;
  institution_name: string | null;
  connection_name: string | null;
};

/** Regra 7.4 (UX 0.8): nome da pessoa → nome sugerido pela conta → banco informado pelo Pluggy → "Conexão N". */
const CONN_NAME = (c: string) =>
  `COALESCE(NULLIF(TRIM(${c}.user_name), ''), NULLIF(${c}.suggested_name, ''), CASE WHEN ${c}.institution_name IS NOT NULL AND ${c}.institution_name <> 'MeuPluggy' THEN ${c}.institution_name END, 'Conexão ' || COALESCE(${c}.display_number, 0))`;
const CONN_REAL = (c: string) =>
  `CASE WHEN NULLIF(TRIM(${c}.user_name), '') IS NOT NULL OR NULLIF(${c}.suggested_name, '') IS NOT NULL OR (${c}.institution_name IS NOT NULL AND ${c}.institution_name <> 'MeuPluggy') THEN 1 ELSE 0 END`;
const CONN_COLS = `c.*, ${CONN_NAME('c')} AS name, ${CONN_REAL('c')} AS has_real_name`;

const EFFECTIVE_CATEGORY = `CASE WHEN t.user_category_set = 1 THEN t.user_category ELSE t.auto_category END`;
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

    // ---------- transações ----------
    async listTransactions(filter: TxFilter, limit = 50, offset = 0): Promise<TransactionRow[]> {
      const w = whereFor(filter);
      return db.getAllAsync<TransactionRow>(
        `SELECT t.id, t.account_id, t.date, t.date_key, t.description, t.amount,
                ${EFFECTIVE_CATEGORY} AS category, t.hidden, t.manual,
                ${EFFECTIVE_TRANSFER} AS transfer, t.transfer_auto,
                COALESCE(a.name, 'Dinheiro') AS account_name, a.type AS account_type, c.institution_name,
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
                ${EFFECTIVE_TRANSFER} AS transfer, t.transfer_auto,
                COALESCE(a.name, 'Dinheiro') AS account_name, a.type AS account_type, c.institution_name,
                CASE WHEN c.item_id IS NULL THEN NULL ELSE ${CONN_NAME('c')} END AS connection_name
         FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
         LEFT JOIN connections c ON c.item_id = a.item_id WHERE t.id = ?`,
        [id],
      );
    },
    /** Linha de resultado do extrato (T-13): contagem e somas do que está filtrado. */
    async sums(filter: TxFilter): Promise<{ count: number; entradas: number; saidas: number; excluded: number }> {
      const w = whereFor(filter);
      // Futuras (data depois de hoje) ficam fora das somas até a data chegar; no próprio dia já contam (UX 0.9).
      const today = filter.today ?? '9999-12-31';
      const counted = `t.hidden = 0 AND ${EFFECTIVE_TRANSFER} = 0 AND COALESCE(${EFFECTIVE_CATEGORY}, '') <> 'investimentos' AND t.date_key <= '${today.replace(/[^0-9-]/g, '')}'`;
      const r = await db.getFirstAsync<{ n: number; e: number | null; s: number | null; x: number | null }>(
        `SELECT COUNT(*) AS n,
                SUM(CASE WHEN ${counted} AND t.amount > 0 THEN t.amount ELSE 0 END) AS e,
                SUM(CASE WHEN ${counted} AND t.amount < 0 THEN t.amount ELSE 0 END) AS s,
                SUM(CASE WHEN ${counted} THEN 0 ELSE 1 END) AS x
         FROM transactions t ${w.sql}`,
        w.params,
      );
      const round = (v: number | null | undefined) => Math.round((v ?? 0) * 100) / 100;
      return { count: r?.n ?? 0, entradas: round(r?.e), saidas: round(r?.s), excluded: r?.x ?? 0 };
    },
    async countAllTransactions(): Promise<number> {
      const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
      return r?.n ?? 0;
    },
    /** RF-006.2. category null = "Sem categoria" escolhido pela pessoa. */
    async setCategory(id: string, category: string | null): Promise<void> {
      await db.runAsync('UPDATE transactions SET user_category = ?, user_category_set = 1 WHERE id = ?', [category, id]);
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
    async recomputeTransfers(): Promise<void> {
      const rows = await db.getAllAsync<{ id: string; account_id: string; date_key: string; amount: number; pluggy_category_id: string | null }>(
        'SELECT id, account_id, date_key, amount, pluggy_category_id FROM transactions WHERE manual = 0',
      );
      const signaled = rows.filter((r) => isPluggyTransferSignal(r.pluggy_category_id));
      const rest = rows.filter((r) => !isPluggyTransferSignal(r.pluggy_category_id));
      const paired = detectTransfers(rest.map((r) => ({ id: r.id, accountId: r.account_id, date: r.date_key, amount: r.amount })));
      for (const r of signaled) paired.add(r.id);
      await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE transactions SET transfer_auto = 0 WHERE manual = 0 AND transfer_auto = 1');
        const ids = [...paired];
        for (let i = 0; i < ids.length; i += 400) {
          const chunk = ids.slice(i, i + 400);
          await db.runAsync(`UPDATE transactions SET transfer_auto = 1 WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
        }
      });
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;

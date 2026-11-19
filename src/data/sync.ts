// Sincronização de uma conexão (RF-003). Relê o que o Pluggy já tem (PM-1): não pede atualização ao banco.
// Falha em qualquer etapa mantém os dados salvos e registra o erro (RF-003.2).
import type { Db } from './db';
import type { Repo } from './repo';
import type { PluggyClient } from '../pluggy/client';
import { PluggyError } from '../pluggy/client';
import type { PluggyTransaction } from '../pluggy/types';
import { categoryFromMcc, mapPluggyCategory } from '../domain/categories';
import { normalizeSearch, spDateKey } from '../domain/format';
import { docOf, incomeFromTransferCategory, suggestTaxCategory } from '../domain/recognition';

export type SyncResult =
  | {
      ok: true; accounts: number; transactions: number; originChanged: boolean; originUpdatedAt: string | null;
      /** Conexões antigas que tinham as mesmas contas (UX 0.8, "Esta instituição já estava conectada"). */
      repeatedOf: string[];
    }
  | { ok: false; error: PluggyError };

/** Sinal pelo tipo: DEBIT = saída (negativo), CREDIT = entrada (positivo). Vale para conta e cartão. */
export function signedAmount(t: Pick<PluggyTransaction, 'amount' | 'type'>): number {
  const abs = Math.abs(t.amount);
  if (t.type === 'DEBIT') return -abs;
  if (t.type === 'CREDIT') return abs;
  return t.amount;
}

/** UX 0.8 §7.4 / R-13: a conta bancária vem antes do cartão; depois, a ordem em que o Pluggy entrega. */
export function suggestedAccount<T extends { type: string; name: string; marketingName?: string | null }>(accounts: T[]): { account: T; name: string } | null {
  const ordered = [...accounts.filter((a) => a.type === 'BANK'), ...accounts.filter((a) => a.type !== 'BANK')];
  for (const a of ordered) {
    const name = (a.marketingName ?? '').trim() || (a.name ?? '').trim();
    if (name) return { account: a, name };
  }
  return null;
}

export async function syncConnection(
  db: Db,
  repo: Repo,
  client: PluggyClient,
  itemId: string,
  opts: { now?: () => Date; onProgress?: (msg: { accounts: number; transactions: number }) => void } = {},
): Promise<SyncResult> {
  const now = opts.now ?? (() => new Date());
  const nowIso = now().toISOString();
  await db.runAsync('UPDATE connections SET last_sync_attempt_at = ? WHERE item_id = ?', [nowIso, itemId]);
  const before = await repo.getConnection(itemId);
  try {
    const item = await client.getItem(itemId);
    const consents = before?.consent_checked ? null : await client.getConsents(itemId);
    const accounts = await client.getAccounts(itemId);
    // Ciclo 2 (RF-016, R-5): investimentos. Falha aqui não derruba a leitura das contas (null = não lido).
    const investments = await client.getInvestments(itemId).catch(() => null);
    // Conexão repetida: contas que já estão no aparelho ligadas a outra conexão (mesmo id ou mesmo número).
    const others = await db.getAllAsync<{ id: string; item_id: string; number: string | null; type: string }>(
      `SELECT a.id, a.item_id, a.number, a.type FROM accounts a JOIN connections c ON c.item_id = a.item_id WHERE a.item_id <> ?`,
      [itemId],
    );
    const shared = others.filter((o) => accounts.some((a) => a.id === o.id || (a.number && o.number && a.number === o.number && a.type === o.type)));
    const ownerIds = [...new Set(shared.map((o) => o.item_id))];
    // Esta conexão já foi marcada como repetida de outra que ainda existe: não toma as contas de volta.
    const stillDuplicate = Boolean(before?.duplicate_of) && Boolean(await repo.getConnection(before!.duplicate_of!));
    const txByAccount: { accountId: string; txs: PluggyTransaction[] }[] = [];
    const newIds: string[] = [];
    let txCount = 0;
    for (const a of stillDuplicate ? [] : accounts) {
      const txs = await client.getTransactions(a.id);
      txCount += txs.length;
      txByAccount.push({ accountId: a.id, txs });
      opts.onProgress?.({ accounts: accounts.length, transactions: txCount });
    }

    await db.withTransactionAsync(async () => {
      const consent = consents ? consents.find((c) => !c.revokedAt) ?? consents[0] ?? null : undefined;
      await db.runAsync(
        `UPDATE connections SET connector_id = ?, institution_name = ?, status = ?, execution_status = ?, error_code = ?,
           origin_updated_at = ?, item_created_at = ?, auth_expires_at = ?, last_sync_error = NULL
           ${consent !== undefined ? ', consent_json = ?, consent_checked = 1' : ''}
         WHERE item_id = ?`,
        [
          item.connector?.id ?? null,
          item.connector?.name ?? null,
          item.status ?? null,
          item.executionStatus ?? null,
          item.error?.code ?? null,
          item.lastUpdatedAt ?? null,
          item.createdAt ?? null,
          item.consentExpiresAt ?? null,
          ...(consent !== undefined ? [consent ? JSON.stringify(consent) : null] : []),
          itemId,
        ],
      );
      if (investments && !stillDuplicate) {
        await db.runAsync('DELETE FROM investments WHERE item_id = ?', [itemId]);
        for (const inv of investments) {
          await db.runAsync(
            'INSERT OR REPLACE INTO investments (id, item_id, type, subtype, name, balance, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [inv.id, itemId, inv.type ?? null, inv.subtype ?? null, inv.name ?? null, inv.balance ?? inv.amount ?? 0, nowIso],
          );
        }
        await db.runAsync('UPDATE connections SET investments_count = ? WHERE item_id = ?', [investments.length, itemId]);
      }
      // RF-009.1.2: guarda quais contas esta conexão traz (mesmo sendo repetida).
      await db.runAsync('UPDATE connections SET account_refs = ? WHERE item_id = ?', [
        JSON.stringify(accounts.map((a) => ({ id: a.id, name: a.marketingName || a.name, number: a.number ?? null, type: a.type }))), itemId]);
      if (!stillDuplicate) {
        // Nome sugerido (7.4): fixado na primeira vez; " (2)", " (3)" para a mais nova com nome igual.
        const sug = suggestedAccount(accounts);
        if (sug && before?.suggested_base !== sug.name) {
          const same = await db.getFirstAsync<{ n: number }>(
            `SELECT COUNT(*) AS n FROM connections WHERE item_id <> ? AND suggested_base = ? AND COALESCE(display_number, 0) < ?`,
            [itemId, sug.name, before?.display_number ?? 0],
          );
          const n = same?.n ?? 0;
          await db.runAsync('UPDATE connections SET suggested_base = ?, suggested_name = ?, suggested_account_id = ? WHERE item_id = ?',
            [sug.name, n > 0 ? `${sug.name} (${n + 1})` : sug.name, sug.account.id, itemId]);
        }
        if (ownerIds.length) {
          await db.runAsync(`UPDATE connections SET duplicate_of = ? WHERE item_id IN (${ownerIds.map(() => '?').join(',')})`, [itemId, ...ownerIds]);
          // Mesmo número com id diferente: a conta antiga sai, para o saldo e as transações aparecerem uma vez só.
          const numberOnly = shared.filter((o) => !accounts.some((a) => a.id === o.id));
          for (const o of numberOnly) {
            await db.runAsync('DELETE FROM transactions WHERE manual = 0 AND account_id = ?', [o.id]);
            await db.runAsync('DELETE FROM accounts WHERE id = ?', [o.id]);
          }
        }
      }
      for (const a of stillDuplicate ? [] : accounts) {
        await db.runAsync(
          `INSERT INTO accounts (id, item_id, type, subtype, name, number, balance, due_date, updated_at, auto_invested)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET item_id = excluded.item_id, type = excluded.type, subtype = excluded.subtype,
             name = excluded.name, number = excluded.number, balance = excluded.balance, due_date = excluded.due_date,
             updated_at = excluded.updated_at, unauthorized_at = NULL, auto_invested = excluded.auto_invested`,
          [a.id, itemId, a.type, a.subtype ?? null, a.marketingName || a.name, a.number ?? null, a.balance,
            a.creditData?.balanceDueDate ?? null, nowIso, a.bankData?.automaticallyInvestedBalance ?? null],
        );
      }
      const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
      // RF-006.3: a lembrança vale daqui para a frente, então só os lançamentos que chegam agora a recebem.
      const incoming = txByAccount.flatMap(({ txs }) => txs.map((t) => t.id));
      const known = await repo.existingTxIds(incoming);
      newIds.push(...incoming.filter((id) => !known.has(id)));
      for (const { accountId, txs } of txByAccount) {
        for (const t of txs) {
          const date = new Date(t.date);
          // Campos da pessoa (categoria escolhida, oculta, transferência marcada) não são sobrescritos.
          // RNF-007: do pagador e do recebedor, só tipo e número do documento; o nome é usado aqui, na hora, para a
          // sugestão de R-8.5, e não é guardado.
          const payer = docOf(t.paymentData?.payer);
          const receiver = docOf(t.paymentData?.receiver);
          const auto = suggestTaxCategory({ operationType: t.operationType, description: t.description, descriptionRaw: t.descriptionRaw, receiverName: t.paymentData?.receiver?.name })
            ? 'impostos'
            // R-8.1 vale para a conta pessoal (BANK); crédito no cartão (estorno, pagamento) não é receita por categoria.
            : typeOf.get(accountId) === 'BANK' && incomeFromTransferCategory(signedAmount(t), t.categoryId) ? 'receitas'
            // requisitos v1.21: no cartão, 5968/5499 trocam "Outros" ou "Sem categoria" por "Assinaturas"/"Mercado".
            : categoryFromMcc(mapPluggyCategory(t.categoryId), typeOf.get(accountId), t.creditCardMetadata?.payeeMCC);
          await db.runAsync(
            `INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount,
               pluggy_category_id, auto_category, manual, updated_at, operation_type, payer_doc_type, payer_doc, receiver_doc_type, receiver_doc)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id, date = excluded.date, date_key = excluded.date_key,
               description = excluded.description, search_text = excluded.search_text, amount = excluded.amount,
               pluggy_category_id = excluded.pluggy_category_id, auto_category = excluded.auto_category,
               updated_at = excluded.updated_at, operation_type = excluded.operation_type,
               payer_doc_type = excluded.payer_doc_type, payer_doc = excluded.payer_doc,
               receiver_doc_type = excluded.receiver_doc_type, receiver_doc = excluded.receiver_doc`,
            [t.id, accountId, date.toISOString(), spDateKey(date), t.description, normalizeSearch(t.description),
              signedAmount(t), t.categoryId ?? null, auto, nowIso, t.operationType ?? null,
              payer.type, payer.number, receiver.type, receiver.number],
          );
        }
      }
    });
    await repo.recomputeTransfers();
    await repo.applyMemoryToNew(newIds);
    await repo.refreshRecipientStats();
    // RF-016.4: ponto do patrimônio de hoje para esta conexão (e a conta "Dinheiro").
    if (!stillDuplicate) await repo.recordWealthPoint(itemId, spDateKey(now()), item.lastUpdatedAt ?? nowIso);
    return {
      ok: true,
      accounts: accounts.length,
      transactions: txCount,
      originChanged: (before?.origin_updated_at ?? null) !== (item.lastUpdatedAt ?? null),
      originUpdatedAt: item.lastUpdatedAt ?? null,
      repeatedOf: stillDuplicate ? [] : ownerIds,
    };
  } catch (e) {
    const err = e instanceof PluggyError ? e : new PluggyError('unexpected', null, null);
    await db.runAsync('UPDATE connections SET last_sync_error = ? WHERE item_id = ?', [err.kind + (err.code ? `:${err.code}` : ''), itemId]);
    return { ok: false, error: err };
  }
}

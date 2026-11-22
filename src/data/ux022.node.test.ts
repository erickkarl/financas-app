// ux.md 0.22 (UX-114 a UX-118; RF-005.4 a .6, requisitos v1.32): dados do novo Extrato. Dados de exemplo.
import { createNodeDb } from '../test/nodeDb';
import { migrate } from './db';
import { createRepo } from './repo';
import { normalizeSearch } from '../domain/format';

async function setup() {
  const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
  await repo.addConnection('c1', '2026-01-01T10:00:00Z');
  await db.runAsync(`INSERT INTO accounts (id, item_id, type, name, balance, updated_at) VALUES ('cc','c1','BANK','Conta',0,'x'),('k','c1','CREDIT','Cartão',0,'x')`);
  const ins = (id: string, acc: string, d: string, amount: number, desc = 'x', o: { op?: string; cat?: string; doc?: string } = {}) =>
    db.runAsync(`INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, auto_category, manual, updated_at, operation_type, payer_doc_type, payer_doc, receiver_doc_type, receiver_doc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'x', ?, ?, ?, ?, ?)`,
      [id, acc, `${d}T15:00:00Z`, d, desc, normalizeSearch(desc), amount, o.cat ?? (amount > 0 ? 'receitas' : 'compras'), o.op ?? 'PIX',
        amount > 0 ? 'CNPJ' : null, amount > 0 ? (o.doc ?? null) : null, amount < 0 ? 'CNPJ' : null, amount < 0 ? (o.doc ?? null) : null]);
  await ins('sal', 'cc', '2026-11-05', 5000, 'Salário');
  await ins('mer', 'cc', '2026-11-06', -300, 'Mercado');
  await ins('k1', 'k', '2026-11-07', -80, 'Loja', { op: 'COMPRA' });
  await ins('k2', 'k', '2026-11-09', 80, 'Loja estorno', { op: 'ESTORNO', cat: 'compras' }); // estorno no cartão
  await ins('d1', 'cc', '2026-11-10', -50, 'Pedido', { doc: '11222333000100' });
  await ins('c1', 'cc', '2026-11-12', 50, 'Pedido devolvido', { doc: '11222333000100' }); // reembolso
  await ins('old', 'cc', '2026-09-01', -20, 'Farmácia antiga');
  await repo.recomputeTransfers();
  return { db, repo };
}
const NOV = { from: '2026-11-01', to: '2026-11-30', today: '2026-11-21' };

describe('UX-117 / RF-005.6: Tipo', () => {
  test('lista pelo sinal; soma pela classificação do Resumo; Todas bate com T-18', async () => {
    const { repo } = await setup();
    const all = await repo.sums(NOV);
    const s = await repo.monthSummary('2026-11', '2026-11-21');
    expect([all.entradas, Math.abs(all.saidas)]).toEqual([s.receitas, s.despesas]); // 5000; 300 + 80 − 80
    const ent = await repo.sums({ ...NOV, type: 'in' });
    expect((await repo.listTransactions({ ...NOV, type: 'in' })).map((t) => t.id).sort()).toEqual(['c1', 'k2', 'sal']);
    expect(ent.entradas).toBe(5000); // estorno e reembolso aparecem e não somam
    const sai = await repo.sums({ ...NOV, type: 'out' });
    expect((await repo.listTransactions({ ...NOV, type: 'out' })).map((t) => t.id).sort()).toEqual(['d1', 'k1', 'mer']);
    expect(Math.abs(sai.saidas)).toBe(380); // não abate o estorno
    expect(sai.refundsNotIncluded).toBe(1); // "Não inclui 1 estorno que abate despesas."
    expect(ent.refundsNotIncluded).toBe(0);
  });
});

describe('UX-118 (E-21 a): busca no período e em outros períodos', () => {
  test('conta o que bate fora do período; zero sem busca ou sem período', async () => {
    const { repo } = await setup();
    expect(await repo.countOtherPeriods({ ...NOV, search: 'farmacia' })).toBe(1);
    expect(await repo.countOtherPeriods({ ...NOV, search: 'mercado' })).toBe(0);
    expect(await repo.countOtherPeriods({ ...NOV })).toBe(0);
    expect(await repo.countOtherPeriods({ search: 'farmacia' })).toBe(0); // "Todo o período"
  });
  test('mês da transação mais antiga', async () => {
    const { repo } = await setup();
    expect(await repo.firstMonth()).toBe('2026-09');
  });
});

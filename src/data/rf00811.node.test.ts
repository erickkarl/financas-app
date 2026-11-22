// RF-008.11 (requisitos v1.32) / ux.md 0.21 (UX-108 a UX-113): reembolso na conta em par com a saída devolvida.
// Dados de exemplo (documentos fictícios, com dígito verificador inválido).
import { createNodeDb } from '../test/nodeDb';
import { migrate } from './db';
import { createRepo } from './repo';

const LOJA = '11222333000100';
const OUTRA = '99888777000199';

async function setup() {
  const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
  await repo.addConnection('c1', '2026-01-01T10:00:00Z');
  await db.runAsync(`INSERT INTO accounts (id, item_id, type, name, balance, updated_at) VALUES ('cc','c1','BANK','Conta',1000,'x'),('k','c1','CREDIT','Cartão',0,'x')`);
  const ins = (id: string, acc: string, d: string, amount: number, o: { doc?: string | null; op?: string; cat?: string | null; pcat?: string | null } = {}) =>
    db.runAsync(
      `INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, auto_category, pluggy_category_id, manual, updated_at,
         operation_type, payer_doc_type, payer_doc, receiver_doc_type, receiver_doc)
       VALUES (?, ?, ?, ?, 'x', 'x', ?, ?, ?, 0, 'x', ?, ?, ?, ?, ?)`,
      [id, acc, `${d}T15:00:00Z`, d, amount, o.cat === undefined ? (amount > 0 ? 'receitas' : 'compras') : o.cat, o.pcat ?? null, o.op ?? 'PIX',
        amount > 0 ? 'CNPJ' : null, amount > 0 ? (o.doc === undefined ? LOJA : o.doc) : null,
        amount < 0 ? 'CNPJ' : null, amount < 0 ? (o.doc === undefined ? LOJA : o.doc) : null]);
  return { db, repo, ins };
}

describe('RF-008.11: reconhecimento', () => {
  test('par no mesmo mês e em meses diferentes; o que não casa continua receita', async () => {
    const { repo, ins } = await setup();
    await ins('d1', 'cc', '2026-10-03', -249.9);
    await ins('c1', 'cc', '2026-11-21', 249.9); // casa com d1 (outubro → novembro)
    await ins('d2', 'cc', '2026-11-05', -60);
    await ins('c2', 'cc', '2026-11-06', 60); // mesmo mês
    await ins('c3', 'cc', '2026-11-07', 40); // sem saída de mesmo valor: receita
    await ins('c4', 'cc', '2026-11-08', 60, { doc: OUTRA }); // outro documento: receita
    await repo.recomputeTransfers();
    const pairs = await repo.listRefundPairs();
    expect(pairs).toEqual([{ creditId: 'c2', debitId: 'd2' }, { creditId: 'c1', debitId: 'd1' }]); // pela data do crédito
  });
  test('RF-008.11.8 e .15: fatura, Investimentos e cashback não entram', async () => {
    const { repo, ins } = await setup();
    await ins('d1', 'cc', '2026-11-01', -100, { op: 'PAGAMENTO_FATURA' });
    await ins('c1', 'cc', '2026-11-02', 100);
    await ins('d2', 'cc', '2026-11-03', -500, { cat: 'investimentos' });
    await ins('c2', 'cc', '2026-11-04', 500);
    await ins('d3', 'cc', '2026-11-05', -10);
    await ins('c3', 'cc', '2026-11-06', 10, { pcat: '08090000' });
    await repo.recomputeTransfers();
    expect(await repo.listRefundPairs()).toEqual([]);
  });
  test('estorno no cartão continua como antes (RF-008.11.1)', async () => {
    const { repo, ins, db } = await setup();
    await ins('k1', 'k', '2026-11-01', -80, { op: 'COMPRA', doc: null });
    await ins('k2', 'k', '2026-11-03', 80, { op: 'ESTORNO', doc: null, cat: 'compras' });
    await repo.recomputeTransfers();
    expect(await repo.listRefundPairs()).toEqual([]);
    expect((await db.getFirstAsync<{ refund: number }>("SELECT refund FROM transactions WHERE id = 'k2'"))?.refund).toBe(1);
  });
});

describe('UX-113 / RF-008.11.9: mesmas somas em T-18, T-23 e no Extrato; Saldo em contas não muda', () => {
  test('o par sai dos dois meses; o resto conta', async () => {
    const { repo, ins, db } = await setup();
    await ins('base', 'cc', '2026-10-01', 3000);
    await ins('d1', 'cc', '2026-10-03', -249.9);
    await ins('g1', 'cc', '2026-10-10', -100);
    await ins('c1', 'cc', '2026-11-21', 249.9);
    await ins('c3', 'cc', '2026-11-07', 40);
    await db.runAsync("INSERT INTO wealth_points (date_key, item_id, accounts, investments, data_at) VALUES ('2026-11-21','c1',1000,0,'2026-11-21T15:00:00Z')");
    const saldoAntes = await repo.saldoHistory('2026-11-21');
    await repo.recomputeTransfers();
    const out = await repo.monthSummary('2026-10', '2026-11-21');
    const nov = await repo.monthSummary('2026-11', '2026-11-21');
    expect([out.receitas, out.despesas]).toEqual([3000, 100]); // d1 fora
    expect([nov.receitas, nov.despesas]).toEqual([40, 0]); // c1 fora
    expect(out.outOfSummary).toMatchObject({ count: 1, saidas: 249.9, reimbursements: 1 });
    expect(nov.outOfSummary).toMatchObject({ count: 1, entradas: 249.9, reimbursements: 1 });
    const ov = await repo.monthlyOverview('2026-11-21');
    for (const r of ov.rows) {
      const s = await repo.monthSummary(r.month, '2026-11-21');
      const e = await repo.sums({ from: `${r.month}-01`, to: `${r.month}-31`, today: '2026-11-21' });
      expect([r.receitas, r.despesas]).toEqual([s.receitas, s.despesas]);
      expect([e.entradas, Math.abs(e.saidas)]).toEqual([s.receitas, s.despesas]);
      expect(e.byReason.out).toBe(s.outOfSummary.count);
    }
    expect((await repo.saldoHistory('2026-11-21')).months).toEqual(saldoAntes.months);
  });
  test('Ver quais: "Reembolsos" e "Marcados por você" somam o total; N-17 (oculta conta como oculta, o par continua)', async () => {
    const { repo, ins, db } = await setup();
    await ins('d1', 'cc', '2026-11-03', -50);
    await ins('c1', 'cc', '2026-11-05', 50);
    await ins('m1', 'cc', '2026-11-06', -20, { doc: OUTRA });
    await repo.recomputeTransfers();
    await repo.setOutOfSummary('m1', true);
    let e = await repo.sums({ from: '2026-11-01', to: '2026-11-30', today: '2026-11-21' });
    expect(e.byReason).toMatchObject({ out: 3, reimb: 2, manualOut: 1 });
    expect((await repo.listTransactions({ only: 'reimb' })).map((t) => t.id).sort()).toEqual(['c1', 'd1']);
    expect((await repo.listTransactions({ only: 'manualOut' })).map((t) => t.id)).toEqual(['m1']);
    await db.runAsync("UPDATE transactions SET hidden = 1 WHERE id = 'd1'");
    await repo.recomputeTransfers();
    e = await repo.sums({ from: '2026-11-01', to: '2026-11-30', today: '2026-11-21' });
    expect(e.byReason).toMatchObject({ hidden: 1, reimb: 1, manualOut: 1, out: 2 });
    expect(await repo.listRefundPairs()).toEqual([{ creditId: 'c1', debitId: 'd1' }]);
  });
});

describe('UX-110 / N-18: "Não é reembolso" e "Tratar como reembolso de novo"', () => {
  test('desfazer volta a contar; atualização não refaz; refazer volta ao par', async () => {
    const { repo, ins } = await setup();
    await ins('d1', 'cc', '2026-10-03', -249.9);
    await ins('c1', 'cc', '2026-11-21', 249.9);
    await ins('d2', 'cc', '2026-11-01', -249.9); // outra saída igual: não pode casar sozinha com c1 depois do desfazer
    await repo.recomputeTransfers();
    expect(await repo.listRefundPairs()).toEqual([{ creditId: 'c1', debitId: 'd2' }]); // a mais recente
    expect(await repo.rejectRefund('c1')).toEqual({ creditId: 'c1', debitId: 'd2' });
    expect((await repo.monthSummary('2026-11', '2026-11-21')).receitas).toBe(249.9);
    await repo.recomputeTransfers();
    expect(await repo.listRefundPairs()).toEqual([]); // N-18
    expect(await repo.refundInfo('d2')).toMatchObject({ state: 'rejected', role: 'debit' });
    expect(await repo.restoreRefund('d2')).toBe(true);
    expect(await repo.listRefundPairs()).toEqual([{ creditId: 'c1', debitId: 'd2' }]);
    expect(await repo.refundInfo('c1')).toMatchObject({ state: 'paired', role: 'credit', other: { id: 'd2' } });
  });
});

describe('UX-112 / N-19: avisos de mês que mudou', () => {
  test('primeira vez: aviso único; depois, aviso do mês fechado; par no mês atual não avisa; Fechar', async () => {
    const { repo, ins } = await setup();
    await ins('d1', 'cc', '2026-09-03', -30);
    await ins('c1', 'cc', '2026-09-05', 30);
    await repo.recomputeRefunds('2026-11-21');
    let n = await repo.refundNotices();
    expect(n.first).toEqual({ pairs: 1, months: 1 });
    expect(await repo.refundMonthNotice('2026-09')).toBeNull(); // a primeira vez tem aviso único (T-23)
    await repo.dismissRefundNotices();
    expect((await repo.refundNotices()).first).toBeNull();
    // Reembolso que chega depois, de uma saída de outubro (mês fechado), e um par inteiro no mês atual
    await ins('d2', 'cc', '2026-10-03', -249.9);
    await ins('c2', 'cc', '2026-11-21', 249.9);
    await ins('d3', 'cc', '2026-11-02', -15);
    await ins('c3', 'cc', '2026-11-04', 15);
    await repo.recomputeRefunds('2026-11-21');
    n = await repo.refundNotices();
    expect(n.first).toBeNull();
    expect(n.months).toEqual([{ month: '2026-10', date: '2026-11-21' }]);
    expect(await repo.refundMonthNotice('2026-10')).toEqual({ count: 1, total: 249.9, date: '2026-11-21', side: 'despesas' });
    expect(await repo.refundMonthNotice('2026-11')).toBeNull();
    await repo.dismissRefundMonth('2026-10');
    expect((await repo.refundNotices()).months).toEqual([]);
  });
});

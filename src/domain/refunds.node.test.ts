// RF-008.11 (requisitos v1.32) / ux.md 0.21: casamento de reembolso na conta. Dados de exemplo.
import { matchRefunds, sameRecipient, type RefundCandidate } from './refunds';

const tx = (id: string, date: string, amount: number, o: Partial<RefundCandidate> = {}): RefundCandidate =>
  ({ id, accountId: 'c1', date: `${date}T15:00:00Z`, amount, eligible: true, doc: '11222333000199', ...o });

describe('RF-008.11.2 a .4: casamento um para um', () => {
  test('mesmo documento, mesmo valor, débito anterior: casa', () => {
    expect(matchRefunds([tx('d', '2026-10-03', -249.9), tx('c', '2026-11-21', 249.9)], [], new Set())).toEqual([{ creditId: 'c', debitId: 'd' }]);
  });
  test('valor diferente (reembolso parcial) não casa', () => {
    expect(matchRefunds([tx('d', '2026-10-03', -249.9), tx('c', '2026-10-10', 200)], [], new Set())).toEqual([]);
  });
  test('débito depois do crédito não casa; mesmo dia casa se a hora for anterior', () => {
    expect(matchRefunds([tx('d', '2026-10-10', -50), tx('c', '2026-10-03', 50)], [], new Set())).toEqual([]);
    const d = { ...tx('d', '2026-10-03', -50), date: '2026-10-03T10:00:00Z' };
    const c = { ...tx('c', '2026-10-03', 50), date: '2026-10-03T18:00:00Z' };
    expect(matchRefunds([d, c], [], new Set())).toHaveLength(1);
  });
  test('janela de 90 dias', () => {
    expect(matchRefunds([tx('d', '2026-08-01', -80), tx('c', '2026-10-30', 80)], [], new Set())).toHaveLength(1); // 90 dias
    expect(matchRefunds([tx('d', '2026-08-01', -80), tx('c', '2026-10-31', 80)], [], new Set())).toEqual([]); // 91 dias
  });
  test('documento diferente, ou só um dos dois com documento, não casa', () => {
    expect(matchRefunds([tx('d', '2026-10-03', -50, { doc: '99888777000166' }), tx('c', '2026-10-05', 50)], [], new Set())).toEqual([]);
    expect(matchRefunds([tx('d', '2026-10-03', -50, { doc: null }), tx('c', '2026-10-05', 50)], [], new Set())).toEqual([]);
  });
  test('cada débito entra em um par só: o crédito fica com o débito mais recente ainda sem par', () => {
    const r = matchRefunds([tx('d1', '2026-10-01', -30), tx('d2', '2026-10-05', -30), tx('c1', '2026-10-07', 30), tx('c2', '2026-10-08', 30), tx('c3', '2026-10-09', 30)], [], new Set());
    expect(r).toEqual([{ creditId: 'c1', debitId: 'd2' }, { creditId: 'c2', debitId: 'd1' }]); // c3 fica sem par: entra como receita
  });
  test('outra conta não casa', () => {
    expect(matchRefunds([tx('d', '2026-10-03', -50, { accountId: 'c2' }), tx('c', '2026-10-05', 50)], [], new Set())).toEqual([]);
  });
  test('RF-008.11.8 e .15: lançamento não elegível (fatura, transferência, Investimentos, cashback, futura) não entra', () => {
    expect(matchRefunds([tx('d', '2026-10-03', -50, { eligible: false }), tx('c', '2026-10-05', 50)], [], new Set())).toEqual([]);
    expect(matchRefunds([tx('d', '2026-10-03', -50), tx('c', '2026-10-05', 50, { eligible: false })], [], new Set())).toEqual([]);
  });
});

describe('RF-008.11.3 (Q51 b): só o documento', () => {
  test('sem documento nos dois lados, não casa', () => {
    expect(sameRecipient({ doc: null }, { doc: null })).toBe(false);
    expect(matchRefunds([tx('d', '2026-10-03', -50, { doc: null }), tx('c', '2026-10-05', 50, { doc: null })], [], new Set())).toEqual([]);
  });
});

describe('N-17 e N-18: par existente e par desfeito', () => {
  test('par existente continua mesmo que uma ponta deixe de ser elegível (marcada como transferência à mão)', () => {
    const r = matchRefunds([tx('d', '2026-10-03', -50), tx('c', '2026-10-05', 50, { eligible: false })], [{ creditId: 'c', debitId: 'd' }], new Set());
    expect(r).toEqual([{ creditId: 'c', debitId: 'd' }]);
  });
  test('par some quando uma ponta some ou o valor muda', () => {
    expect(matchRefunds([tx('c', '2026-10-05', 50)], [{ creditId: 'c', debitId: 'd' }], new Set())).toEqual([]);
    expect(matchRefunds([tx('d', '2026-10-03', -51), tx('c', '2026-10-05', 50)], [{ creditId: 'c', debitId: 'd' }], new Set())).toEqual([]);
  });
  test('lançamento de par desfeito não casa sozinho com nenhum outro', () => {
    const txs = [tx('d', '2026-10-03', -50), tx('d2', '2026-10-04', -50), tx('c', '2026-10-05', 50)];
    expect(matchRefunds(txs, [], new Set(['c', 'd']))).toEqual([]);
  });
});

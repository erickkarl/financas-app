// UX 0.16 (aprovada em 2026-11-19, E-11 a): C2-07 a C2-10 e o aviso da fatura (R-2.1, UX-044).
import { createNodeDb } from '../test/nodeDb';
import { migrate } from './db';
import { createRepo } from './repo';
import { accountConnectionLine } from '../domain/format';

async function setup() {
  const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
  await repo.addConnection('c1', '2026-11-01T10:00:00Z');
  await db.runAsync(`INSERT INTO accounts (id, item_id, type, subtype, name, balance, updated_at) VALUES
    ('cc','c1','BANK','CHECKING_ACCOUNT','Banco Aurora S.A.',0,'x'), ('k','c1','CREDIT','CREDIT_CARD','cartao-roxo',0,'x')`);
  await db.runAsync(`UPDATE connections SET user_name = 'Banco Aurora S.A.' WHERE item_id = 'c1'`);
  const ins = (id: string, acc: string, day: string, amount: number, cat: string | null, op: string | null, auto: string | null) =>
    db.runAsync(`INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, pluggy_category_id, operation_type, auto_category, manual, updated_at)
      VALUES (?, ?, ?, ?, 'x', 'x', ?, ?, ?, ?, 0, 'x')`, [id, acc, `2026-11-${day}T15:00:00Z`, `2026-11-${day}`, amount, cat, op, auto]);
  await ins('compra', 'k', '02', -800, '10000000', 'PAGAMENTO', 'mercado');
  await ins('recebido1', 'k', '10', 800, '05100000', 'PAGAMENTO_FATURA', null);
  await ins('recebido2', 'k', '12', 300, '05100000', 'PAGAMENTO_FATURA', null);
  await ins('luz', 'cc', '05', -120, null, 'BOLETO', 'moradia');
  await ins('oculta', 'cc', '06', -30, null, 'PIX', null);
  await repo.recomputeTransfers();
  return { db, repo };
}
const month = { from: '2026-11-01', to: '2026-11-30', today: '2026-11-19' };

describe('UX 0.16', () => {
  test('C2-08 / E-11 (a): oculta conta sempre em "Fora das somas"; a lista só a mostra com "Mostrar ocultas"', async () => {
    const { repo } = await setup();
    await repo.setHidden('oculta', true);
    const off = await repo.sums(month);
    const on = await repo.sums({ ...month, showHidden: true });
    expect(off.byReason.hidden).toBe(1);
    expect(on.byReason.hidden).toBe(1);
    expect(off.count).toBe(on.count - 1); // {n} transações: só o que está à mostra
    expect([off.entradas, off.saidas]).toEqual([on.entradas, on.saidas]); // a oculta nunca soma
    expect((await repo.listTransactions(month)).some((t) => t.id === 'oculta')).toBe(false);
  });
  test('C2-07: com "Só fora do Resumo", a soma dos marcados é a mesma da linha do Resumo', async () => {
    const { repo } = await setup();
    await repo.setOutOfSummary('luz', true);
    const ex = await repo.sums({ ...month, only: 'out' });
    const s = await repo.monthSummary('2026-11', '2026-11-19');
    expect(ex.out).toEqual({ count: 1, saidas: 120, entradas: 0 });
    expect({ ...ex.out, reimbursements: 0 }).toEqual(s.outOfSummary);
  });
  test('Aviso da fatura: contagem dos sem par; "Ver no extrato" só com eles; some ao marcar o último', async () => {
    const { repo } = await setup();
    expect((await repo.monthSummary('2026-11', '2026-11-19')).unpairedBills).toBe(2);
    expect((await repo.listTransactions({ ...month, only: 'bill' })).map((t) => t.id).sort()).toEqual(['recebido1', 'recebido2']);
    await repo.setTransferOverride('recebido1', true);
    expect((await repo.monthSummary('2026-11', '2026-11-19')).unpairedBills).toBe(1);
    await repo.setTransferOverride('recebido2', true);
    expect((await repo.monthSummary('2026-11', '2026-11-19')).unpairedBills).toBe(0);
    expect(await repo.listTransactions({ ...month, only: 'bill' })).toEqual([]);
    expect((await repo.monthSummary('2026-11', '2026-11-19')).receitas).toBe(0); // "Pagamento recebido" nunca é receita
  });
  test('C2-09: conta com o mesmo nome da conexão mostra o tipo da conta', async () => {
    const { repo } = await setup();
    const t = await repo.getTransaction('luz');
    expect(t?.account_subtype).toBe('CHECKING_ACCOUNT');
    expect(accountConnectionLine(t!.account_name, t!.account_subtype, t!.connection_name)).toBe('Conta corrente · Banco Aurora S.A.');
    expect(accountConnectionLine('cartao-roxo', 'CREDIT_CARD', 'Banco Aurora S.A.')).toBe('cartao-roxo · Banco Aurora S.A.');
    expect(accountConnectionLine('Dinheiro', null, null)).toBe('Dinheiro');
  });
});

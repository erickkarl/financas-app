// Ciclo 2 · RF-008 Resumo mensal (T-18), parte desenhada até a ux.md 0.13.
import { createNodeDb } from '../test/nodeDb';
import { migrate } from './db';
import { createRepo } from './repo';
import { mapPluggyCategory } from '../domain/categories';

async function setup() {
  const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
  await repo.addConnection('c1', '2026-01-01T10:00:00Z');
  await repo.addConnection('c2', '2026-01-02T10:00:00Z');
  await db.runAsync(`UPDATE connections SET suggested_name = 'Banco Um' WHERE item_id = 'c1'`);
  await db.runAsync(`UPDATE connections SET suggested_name = 'Banco Dois' WHERE item_id = 'c2'`);
  await db.runAsync(`INSERT INTO accounts (id, item_id, type, name, balance, updated_at) VALUES ('a1','c1','BANK','Conta 1',0,'x'),('a2','c2','BANK','Conta 2',0,'x'),('k1','c1','CREDIT','Cartão',0,'x')`);
  let n = 0;
  const tx = (acc: string, date: string, amount: number, cat: string | null, extra: Partial<{ hidden: number; transfer_override: number; pluggy: string }> = {}) =>
    db.runAsync(
      `INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, pluggy_category_id, auto_category, manual, hidden, transfer_override, updated_at)
       VALUES (?, ?, ?, ?, 'x', 'x', ?, ?, ?, 0, ?, ?, 'x')`,
      [`t${++n}`, acc, `${date}T15:00:00Z`, date, amount, extra.pluggy ?? null, cat, extra.hidden ?? 0, extra.transfer_override ?? null],
    );
  return { db, repo, tx };
}

describe('RF-008 Resumo mensal', () => {
  test('receitas, despesas e resultado; fora: ocultas, transferências, investimentos, futuras e outros meses', async () => {
    const { repo, tx } = await setup();
    await tx('a1', '2026-11-05', 5000, 'receitas');
    await tx('a1', '2026-11-06', -850, 'mercado');
    await tx('k1', '2026-11-07', -150, 'mercado');
    await tx('a1', '2026-11-08', -300, 'restaurantes');
    await tx('a1', '2026-11-09', -999, 'compras', { hidden: 1 }); // PM-7
    await tx('a1', '2026-11-10', -1000, null, { transfer_override: 1 }); // RF-008.2
    await tx('a2', '2026-11-10', 1000, null, { transfer_override: 1 });
    await tx('a1', '2026-11-11', -2000, 'investimentos'); // R-3 aplicação
    await tx('a2', '2026-11-12', 500, 'investimentos'); // resgate
    await tx('k1', '2026-11-27', -77, 'lazer'); // futura (hoje = 19)
    await tx('a1', '2026-10-30', -40, 'mercado'); // outro mês
    const s = await repo.monthSummary('2026-11', '2026-11-19');
    expect(s).toMatchObject({ receitas: 5000, despesas: 1300, resultado: 3700, aplicado: 2000, resgatado: 500, futureCount: 1, hasCard: true });
    expect(s.byCategory).toEqual([{ category: 'mercado', total: 1000, refunds: { count: 0, total: 0 } }, { category: 'restaurantes', total: 300, refunds: { count: 0, total: 0 } }]);
    // RF-008.1: confere com o Extrato filtrado do mesmo mês
    const ex = await repo.sums({ from: '2026-11-01', to: '2026-11-30', today: '2026-11-19' });
    expect([ex.entradas, -ex.saidas]).toEqual([s.receitas, s.despesas]);
  });
  test('futura entra no mês dela quando a data chega (RF-008.4)', async () => {
    const { repo, tx } = await setup();
    await tx('k1', '2026-11-27', -77, 'lazer');
    expect((await repo.monthSummary('2026-11', '2026-11-26')).despesas).toBe(0);
    expect((await repo.monthSummary('2026-11', '2026-11-27')).despesas).toBe(77);
  });
  test('RF-008.3 rendimentos identificados pelo Pluggy (03060000) viram "Rendimentos" e ficam dentro de receitas', async () => {
    const { repo, tx } = await setup();
    expect(mapPluggyCategory('03060000')).toBe('rendimentos');
    await tx('a2', '2026-11-03', 12.34, 'rendimentos', { pluggy: '03060000' });
    await tx('a2', '2026-11-04', 100, 'receitas');
    const s = await repo.monthSummary('2026-11', '2026-11-19');
    expect(s).toMatchObject({ receitas: 112.34, rendimentos: 12.34 });
  });
  test('R-5: aviso para conexão com investimentos sem rendimento identificado no mês; marcação manual não tira (R-5.4)', async () => {
    const { db, repo, tx } = await setup();
    await db.runAsync(`UPDATE connections SET investments_count = 6`);
    await tx('a2', '2026-11-03', 10, 'rendimentos', { pluggy: '03060000' }); // Banco Dois tem rendimento do Pluggy
    await tx('a1', '2026-11-03', 5, 'rendimentos'); // Banco Um: marcado à mão
    expect((await repo.monthSummary('2026-11', '2026-11-19')).yieldWarnings).toEqual(['Banco Um']);
    expect((await repo.monthSummary('2026-10', '2026-11-19')).yieldWarnings).toEqual(['Banco Um', 'Banco Dois']);
    await db.runAsync(`UPDATE connections SET investments_count = 0 WHERE item_id = 'c1'`);
    expect((await repo.monthSummary('2026-10', '2026-11-19')).yieldWarnings).toEqual(['Banco Dois']);
  });
  test('lançamento manual entra no Resumo (RF-007.1); mês vazio', async () => {
    const { repo } = await setup();
    await repo.addManual({ amount: -20, description: 'Feira', dateKey: '2026-11-15', category: 'mercado' }, 'x');
    expect(await repo.monthSummary('2026-11', '2026-11-19')).toMatchObject({ despesas: 20, movementCount: 1 });
    expect((await repo.monthSummary('2026-09', '2026-11-19')).movementCount).toBe(0);
  });
});

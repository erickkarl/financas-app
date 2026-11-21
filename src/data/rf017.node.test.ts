// RF-017 (requisitos v1.25) / T-23 (ux.md 0.19): visão por mês. UX-097 a UX-104 no que é dado.
import { createNodeDb } from '../test/nodeDb';
import { migrate } from './db';
import { createRepo } from './repo';
import { applyPeriod, axisTicks, monthsBetween, monthTick, partialFirstMonth, patrimonioByMonth, shiftMonth } from '../domain/monthly';

describe('RF-017: regras da visão por mês', () => {
  test('meses e período: termina no mês atual; 6, 12 e Tudo', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    const months = monthsBetween('2025-11', '2026-11');
    expect(months).toHaveLength(13);
    const rows = months.map((month) => ({ month }));
    expect(applyPeriod(rows, 6, '2026-11').map((r) => r.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(applyPeriod(rows, 12, '2026-11')[0].month).toBe('2025-12');
    expect(applyPeriod(rows, 'tudo', '2026-11')).toHaveLength(13);
  });
  test('N-11: primeiro mês parcial quando a primeira transação não é do dia 1', () => {
    expect(partialFirstMonth('2025-11-07')).toEqual({ month: '2025-11', since: '2025-11-07' });
    expect(partialFirstMonth('2025-11-01')).toBeNull();
    expect(partialFirstMonth(null)).toBeNull();
  });
  test('RF-017.6: Patrimônio = último ponto de cada mês, só meses com ponto', () => {
    const r = patrimonioByMonth([{ date: '2026-10-05', total: 1 }, { date: '2026-10-30', total: 2 }, { date: '2026-11-19', total: 3 }]);
    expect(r).toEqual([{ month: '2026-10', value: 2, date: '2026-10-30' }, { month: '2026-11', value: 3, date: '2026-11-19' }]);
  });
  test('rótulos do eixo: mês abreviado, com o ano quando muda', () => {
    expect(monthTick('2026-01', '2025-12')).toBe('jan/26');
    expect(monthTick('2026-02', '2026-01')).toBe('fev');
    expect(monthTick('2025-12', undefined)).toBe('dez/25');
  });
});

describe('RF-017.5 / UX-098: Gasto, Receita e Economia iguais a T-18 em cada mês', () => {
  test('monthlyOverview usa monthSummary; mês sem movimento no meio aparece com zero', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    await repo.addConnection('c1', '2026-01-01T10:00:00Z');
    await db.runAsync(`INSERT INTO accounts (id, item_id, type, name, balance, updated_at) VALUES ('cc','c1','BANK','Conta',0,'x'),('k','c1','CREDIT','Cartão',0,'x')`);
    const ins = (id: string, acc: string, d: string, amount: number, auto: string | null) =>
      db.runAsync(`INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, auto_category, manual, updated_at) VALUES (?, ?, ?, ?, 'x', 'x', ?, ?, 0, 'x')`,
        [id, acc, `${d}T15:00:00Z`, d, amount, auto]);
    await ins('a', 'cc', '2026-08-12', 1000, 'receitas');
    await ins('b', 'k', '2026-08-20', -300, 'mercado');
    await ins('c', 'k', '2026-10-03', -1200, 'compras'); // economia negativa em outubro
    await ins('d', 'k', '2026-10-09', 50, 'compras'); // estorno (RF-008.10)
    await ins('e', 'k', '2026-12-01', -80, 'compras'); // futura: fora
    await repo.recomputeTransfers();
    const ov = await repo.monthlyOverview('2026-10-15');
    expect(ov.firstDate).toBe('2026-08-12');
    expect(ov.rows.map((r) => r.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    for (const r of ov.rows) {
      const s = await repo.monthSummary(r.month, '2026-10-15');
      expect([r.despesas, r.receitas, r.resultado]).toEqual([s.despesas, s.receitas, s.resultado]);
    }
    expect(ov.rows[1]).toEqual({ month: '2026-09', receitas: 0, despesas: 0, resultado: 0 });
    expect(ov.rows[2]).toMatchObject({ despesas: 1150, resultado: -1150 });
  });
  test('UX-103: sem transações, nenhum mês', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    expect(await repo.monthlyOverview('2026-11-21')).toEqual({ firstDate: null, rows: [] });
  });
});

describe('C3-15: rótulos do eixo sem se tocar nem sair da borda', () => {
  const months = monthsBetween('2025-11', '2026-11');
  const check = (slot: number, scale: number) => {
    const t = axisTicks(months, slot, scale);
    const inner = slot * months.length;
    const box = t.map((x) => { const cx = x.i * slot + slot / 2; const l = Math.min(Math.max(0, cx - x.w / 2), inner - x.w); return [l, l + x.w]; });
    for (let k = 1; k < box.length; k++) expect(box[k][0] - box[k - 1][1]).toBeGreaterThanOrEqual(8);
    for (const [l, r] of box) { expect(l).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(inner); }
    expect(t[t.length - 1].i).toBe(months.length - 1); // o mês mais recente sempre tem rótulo
    expect(t[0].text).toMatch(/\/\d\d$/); // o primeiro leva o ano
    return t;
  };
  test('12 meses em 100%: todos os meses com rótulo; janeiro com o ano', () => {
    const t = check(60, 1);
    expect(t.map((x) => x.text)).toEqual(['nov/25', 'dez', 'jan/26', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov']);
  });
  test('colunas estreitas e fonte em 200%: menos rótulos, sem colar ("nov/25jan/26")', () => {
    expect(check(28, 1).length).toBeLessThan(13);
    expect(check(28, 2).length).toBeLessThan(check(28, 1).length + 1);
    check(16, 2);
    // 12 meses em 200% num telefone (coluna de ~32 dp): um mês sim, um não, e não só três rótulos.
    expect(check(31.6, 2).length).toBeGreaterThanOrEqual(5);
  });
});

describe('RF-017.7: mês atual do "Saldo em contas" igual ao Início', () => {
  test('soma as mesmas contas, inclusive a conexão que aguarda nova autorização (R-18) e o Dinheiro', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    await repo.addConnection('c1', '2026-11-10T10:00:00Z');
    await repo.addConnection('c2', '2026-11-10T10:00:00Z');
    await db.runAsync(`INSERT INTO accounts (id, item_id, type, name, balance, updated_at) VALUES ('a1','c1','BANK','Conta A',1000,'x'),('a2','c2','BANK','Conta B',250.5,'x'),('k','c1','CREDIT','Cartão',-300,'x')`);
    await db.runAsync(`UPDATE connections SET replaced_at = '2026-11-15T10:00:00Z' WHERE item_id = 'c2'`);
    await db.runAsync(`INSERT INTO wealth_points (date_key, item_id, accounts, investments, data_at) VALUES ('2026-11-10','c1',1000,0,'2026-11-10T15:00:00Z'),('2026-11-10','c2',250.5,0,'2026-11-10T15:00:00Z')`);
    await db.runAsync(`INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, auto_category, manual, updated_at) VALUES ('m','manual','2026-11-12T15:00:00Z','2026-11-12','x','x',40,'outros',1,'x')`);
    const h = await repo.saldoHistory('2026-11-21');
    const t = await repo.totalBalance();
    const nov = h.months.find((m) => m.month === '2026-11')!;
    expect(nov.estimated).toBe(false);
    expect(nov.value).toBeCloseTo(t.total, 2);
    expect(nov.value).toBeCloseTo(1290.5, 2);
  });
});

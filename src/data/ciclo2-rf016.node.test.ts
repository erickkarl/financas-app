// Ciclo 2 · RF-016 patrimônio (T-21): série diária por conexão, R-4 (até 7 dias), RF-016.7 (revogar tira tudo).
import { createNodeDb } from '../test/nodeDb';
import { migrate, wipeAll } from './db';
import { createRepo } from './repo';
import { syncConnection } from './sync';
import { createPluggyClient } from '../pluggy/client';
import { spDateKey } from '../domain/format';

async function setup() {
  const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
  for (const [id, name] of [['c1', 'Banco Um'], ['c2', 'Banco Dois']]) {
    await repo.addConnection(id, '2026-11-01T10:00:00Z');
    await db.runAsync('UPDATE connections SET suggested_name = ? WHERE item_id = ?', [name, id]);
  }
  const pt = (d: string, item: string, acc: number, inv: number) =>
    db.runAsync('INSERT INTO wealth_points (date_key, item_id, accounts, investments) VALUES (?, ?, ?, ?)', [d, item, acc, inv]);
  return { db, repo, pt };
}

describe('RF-016 série do patrimônio', () => {
  test('soma por data; parcial até 7 dias (R-4); mais de 7 dias sem dado tira o ponto; dia sem nenhum ponto não existe', async () => {
    const { repo, pt } = await setup();
    await pt('2026-11-01', 'c1', 100, 50); await pt('2026-11-01', 'c2', 10, 0);
    await pt('2026-11-02', 'c1', 110, 50); // c2 não atualizou: usa 01/11 (parcial)
    await pt('2026-11-12', 'c1', 120, 60); // c2 sem dado há 11 dias: sem ponto
    await pt('2026-11-13', 'c1', 121, 60); await pt('2026-11-13', 'c2', 20, 0);
    const s = await repo.wealthSeries();
    expect(s.map((p) => [p.date, p.total, p.partial.map((x) => `${x.name}@${x.date}`)])).toEqual([
      ['2026-11-01', 160, []],
      ['2026-11-02', 170, ['Banco Dois@2026-11-01']],
      ['2026-11-13', 201, []],
    ]);
  });
  test('conexão nova não bloqueia os dias anteriores a ela', async () => {
    const { repo, pt } = await setup();
    await pt('2026-11-01', 'c1', 100, 0);
    await pt('2026-11-05', 'c1', 100, 0); await pt('2026-11-05', 'c2', 5, 0);
    expect((await repo.wealthSeries()).map((p) => p.total)).toEqual([100, 105]);
  });
  test('RF-016.7: revogar tira os pontos e investimentos da instituição em todas as datas; apagar tudo limpa', async () => {
    const { db, repo, pt } = await setup();
    await db.runAsync("INSERT INTO investments (id, item_id, type, balance) VALUES ('i1','c2','FIXED_INCOME',500)");
    await pt('2026-11-01', 'c1', 100, 0); await pt('2026-11-01', 'c2', 10, 500);
    await repo.deleteConnectionData('c2');
    expect((await repo.wealthSeries()).map((p) => p.total)).toEqual([100]);
    expect((await repo.wealthNow()).investments).toBe(0);
    await wipeAll(db);
    expect(await repo.wealthSeries()).toEqual([]);
  });
  test('sincronizar grava investimentos, o valor que rende na conta e o ponto de hoje; cartão não entra', async () => {
    const { db, repo } = await setup();
    const client = createPluggyClient({
      getCredentials: async () => ({ clientId: 'id', clientSecret: 's' }),
      fetchImpl: async (url) => {
        const u = new URL(url);
        const json = (b: unknown) => ({ status: 200, json: async () => b });
        if (u.pathname === '/auth') return json({ apiKey: 'k' });
        if (u.pathname.startsWith('/items/')) return json({ id: 'c1', connector: { id: 200, name: 'MeuPluggy' }, status: 'UPDATED', createdAt: '2026-11-01T10:00:00Z', lastUpdatedAt: '2026-11-19T09:00:00Z' });
        if (u.pathname === '/consents') return json({ results: [] });
        if (u.pathname === '/accounts') return json({ results: [
          { id: 'b', itemId: 'c1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', number: '1', balance: 300, name: 'Conta', currencyCode: 'BRL', bankData: { automaticallyInvestedBalance: 300 } },
          { id: 'k', itemId: 'c1', type: 'CREDIT', subtype: 'CREDIT_CARD', number: '2', balance: 999, name: 'Cartão', currencyCode: 'BRL' },
        ] });
        if (u.pathname === '/investments') return json({ results: [{ id: 'i1', itemId: 'c1', type: 'FIXED_INCOME', subtype: 'CDB', balance: 1000 }, { id: 'i2', itemId: 'c1', type: 'EQUITY', balance: 234.56 }], totalPages: 1 });
        if (u.pathname === '/v2/transactions') return json({ results: [], next: null });
        return json({});
      },
    });
    await syncConnection(db, repo, client, 'c1', { now: () => new Date('2026-11-19T12:00:00Z') });
    const now = await repo.wealthNow();
    expect(now).toMatchObject({ accounts: 300, investments: 1234.56, total: 1534.56 });
    expect(now.byConnection).toEqual([expect.objectContaining({ item_id: 'c1', investments: 1234.56, autoInvested: 300 })]);
    expect((await repo.getConnection('c1'))?.investments_count).toBe(2);
    expect(await repo.wealthSeries()).toEqual([{ date: '2026-11-19', accounts: 300, investments: 1234.56, total: 1534.56, partial: [] }]);
  });
  test('a conta "Dinheiro" não fica velha: ponto de 20 dias atrás continua valendo, sem marcar parcial', async () => {
    const { repo, pt } = await setup();
    await pt('2026-10-01', 'manual', 50, 0);
    await pt('2026-10-21', 'c1', 100, 0); await pt('2026-10-21', 'c2', 0, 0);
    expect(await repo.wealthSeries()).toEqual([
      { date: '2026-10-01', accounts: 50, investments: 0, total: 50, partial: [] },
      { date: '2026-10-21', accounts: 150, investments: 0, total: 150, partial: [] },
    ]);
  });
  test('lançamento manual entra no patrimônio pela conta "Dinheiro"', async () => {
    const { repo, pt } = await setup();
    const hoje = spDateKey(new Date()); // o ponto da conta "Dinheiro" é gravado no dia de hoje
    await pt(hoje, 'c1', 100, 0); await pt(hoje, 'c2', 0, 0);
    await repo.addManual({ amount: 50, description: 'x', dateKey: hoje, category: null }, 'x');
    const last = (await repo.wealthSeries()).at(-1);
    expect(last?.accounts).toBe(150);
  });
});

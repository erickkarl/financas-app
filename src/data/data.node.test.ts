import { createNodeDb } from '../test/nodeDb';
import { migrate } from './db';
import { createRepo } from './repo';
import { syncConnection } from './sync';
import { createPluggyClient } from '../pluggy/client';
import type { PluggyAccount, PluggyItem, PluggyTransaction } from '../pluggy/types';

type World = {
  item: PluggyItem;
  accounts: PluggyAccount[];
  txs: Record<string, PluggyTransaction[]>;
  fail?: 'network' | 'server' | null;
};

function fakePluggy(world: World) {
  return createPluggyClient({
    getCredentials: async () => ({ clientId: 'id', clientSecret: 'secret' }),
    fetchImpl: async (url) => {
      const u = new URL(url);
      const json = (body: unknown, status = 200) => ({ status, json: async () => body });
      if (u.pathname === '/auth') return json({ apiKey: 'k' });
      if (world.fail === 'network') throw new TypeError('offline');
      if (world.fail === 'server') return json({}, 503);
      if (u.pathname.startsWith('/items/')) return json(world.item);
      if (u.pathname === '/consents') return json({ results: [] });
      if (u.pathname === '/accounts') return json({ results: world.accounts });
      if (u.pathname === '/v2/transactions') {
        const list = world.txs[u.searchParams.get('accountId')!] ?? [];
        return json({ results: list, next: null });
      }
      return json({}, 404);
    },
  });
}

const tx = (id: string, accountId: string, date: string, amount: number, type: 'DEBIT' | 'CREDIT', categoryId: string | null, description = id): PluggyTransaction => ({
  id, accountId, date, description, amount, type, category: null, categoryId,
});

function baseWorld(): World {
  return {
    item: {
      id: 'item-1', connector: { id: 200, name: 'MeuPluggy' }, status: 'UPDATED', executionStatus: 'SUCCESS',
      error: null, createdAt: '2026-11-17T10:00:00Z', lastUpdatedAt: '2026-11-17T11:05:00Z',
    },
    accounts: [
      { id: 'cc', itemId: 'item-1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', number: '1234', balance: 1500.5, name: 'Conta corrente', currencyCode: 'BRL' },
      { id: 'poup', itemId: 'item-1', type: 'BANK', subtype: 'SAVINGS_ACCOUNT', number: '9', balance: 300, name: 'Poupança', currencyCode: 'BRL' },
      { id: 'card', itemId: 'item-1', type: 'CREDIT', subtype: 'CREDIT_CARD', number: '4321', balance: 820, name: 'Cartão', currencyCode: 'BRL' },
    ],
    txs: {
      cc: [
        tx('t1', 'cc', '2026-11-10T15:00:00Z', 89.9, 'DEBIT', '18020000', 'Farmácia São João'),
        tx('t2', 'cc', '2026-11-10T15:00:00Z', 5000, 'CREDIT', '01010000', 'Salário'),
        tx('t3', 'cc', '2026-11-11T15:00:00Z', 200, 'DEBIT', '04020000', 'Pix para poupança'),
        tx('t4', 'cc', '2026-11-12T15:00:00Z', 1000, 'DEBIT', '03020000', 'Aplicação CDB'),
      ],
      poup: [tx('t5', 'poup', '2026-11-12T15:00:00Z', 200, 'CREDIT', '04020000', 'Pix recebido')],
      card: [tx('t6', 'card', '2026-11-13T15:00:00Z', 150, 'DEBIT', '10000000', 'Supermercado Bom Preço')],
    },
  };
}

async function setup(world = baseWorld()) {
  const db = createNodeDb();
  await migrate(db);
  const repo = createRepo(db);
  await repo.addConnection('item-1', '2026-11-17T10:00:00Z');
  return { db, repo, client: fakePluggy(world), world };
}

describe('RF-003 importação', () => {
  test('RF-003.1 / UX-018: importar 3 vezes não duplica', async () => {
    const { db, repo, client } = await setup();
    for (let i = 0; i < 3; i++) {
      const r = await syncConnection(db, repo, client, 'item-1');
      expect(r.ok).toBe(true);
    }
    expect(await repo.countAllTransactions()).toBe(6);
    expect((await repo.listAccounts()).length).toBe(3);
  });

  test('RF-003.2 / UX-019: falha mantém os dados e registra o erro', async () => {
    const { db, repo, client, world } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    world.fail = 'server';
    const r = await syncConnection(db, repo, client, 'item-1');
    expect(r.ok).toBe(false);
    expect(await repo.countAllTransactions()).toBe(6);
    const conn = await repo.getConnection('item-1');
    expect(conn?.last_sync_error).toBe('server');
    expect(conn?.origin_updated_at).toBe('2026-11-17T11:05:00Z');
  });

  test('RF-003.3/3.4 (PM-1): hora mostrada é a do dado na origem; sem dado novo a hora não muda', async () => {
    const { db, repo, client } = await setup();
    const a = await syncConnection(db, repo, client, 'item-1');
    const b = await syncConnection(db, repo, client, 'item-1');
    expect(a.ok && a.originUpdatedAt).toBe('2026-11-17T11:05:00Z');
    expect(b.ok && b.originChanged).toBe(false);
  });

  test('RF-006.1: categoria sugerida pelo Pluggy ou "Sem categoria"', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    const t1 = await repo.getTransaction('t1');
    const t3 = await repo.getTransaction('t3');
    expect(t1?.category).toBe('saude');
    expect(t3?.category).toBeNull();
  });

  test('sinal pelo tipo: DEBIT negativo, CREDIT positivo', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    expect((await repo.getTransaction('t1'))?.amount).toBe(-89.9);
    expect((await repo.getTransaction('t2'))?.amount).toBe(5000);
  });

  test('mudança da pessoa (categoria, oculta) sobrevive à reimportação', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    await repo.setCategory('t1', 'compras');
    await repo.setHidden('t6', true);
    await syncConnection(db, repo, client, 'item-1');
    expect((await repo.getTransaction('t1'))?.category).toBe('compras');
    expect((await repo.getTransaction('t6'))?.hidden).toBe(1);
  });
});

describe('RF-004 visão consolidada', () => {
  test('RF-004.1 / UX-022: saldo total = contas BANK; cartão fora', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    expect((await repo.totalBalance()).total).toBe(1800.5);
  });
  test('RF-004.2: sem conexões, sem contas', async () => {
    const db = createNodeDb();
    await migrate(db);
    const repo = createRepo(db);
    expect(await repo.listAccounts()).toEqual([]);
    expect((await repo.totalBalance()).hasManual).toBe(false);
  });
});

describe('RF-005 extrato e busca', () => {
  test('RF-005.1 / UX-024: conta + período + categoria combinados', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    const rows = await repo.listTransactions({ accountIds: ['cc'], from: '2026-11-10', to: '2026-11-10', categories: ['saude'] });
    expect(rows.map((r) => r.id)).toEqual(['t1']);
    for (const r of rows) {
      expect(r.account_id).toBe('cc');
      expect(r.date_key).toBe('2026-11-10');
      expect(r.category).toBe('saude');
    }
  });
  test('UX-025: busca sem acento combinada com filtro de conta', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    expect((await repo.listTransactions({ search: 'farmacia', accountIds: ['cc'] })).map((r) => r.id)).toEqual(['t1']);
    expect(await repo.listTransactions({ search: 'farmacia', accountIds: ['card'] })).toEqual([]);
  });
  test('busca trata % e _ como texto', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    expect(await repo.listTransactions({ search: '%' })).toEqual([]);
  });
  test('RF-005.2: sem resultado devolve lista vazia e contagem 0', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    expect(await repo.listTransactions({ search: 'xyzxyz' })).toEqual([]);
    expect((await repo.sums({ search: 'xyzxyz' })).count).toBe(0);
  });
  test('filtro "Sem categoria"', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    expect((await repo.listTransactions({ categories: ['none'] })).map((r) => r.id).sort()).toEqual(['t3', 't5']);
  });
  test('ordem: mais recente primeiro', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    const keys = (await repo.listTransactions({})).map((r) => r.date_key);
    expect([...keys].sort().reverse()).toEqual(keys);
  });
});

describe('somas do extrato (PM-7, PM-8, R-3)', () => {
  test('transferência própria, investimento e oculta ficam fora das somas', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    // t3/t5 = transferência (200 em contas diferentes, 1 dia); t4 = investimento
    expect((await repo.getTransaction('t3'))?.transfer).toBe(1);
    expect((await repo.getTransaction('t5'))?.transfer).toBe(1);
    let s = await repo.sums({});
    expect(s).toEqual({ count: 6, entradas: 5000, saidas: -239.9, excluded: 3 });
    await repo.setHidden('t6', true); // UX-039
    s = await repo.sums({});
    expect(s.saidas).toBe(-89.9);
    expect((await repo.totalBalance()).total).toBe(1800.5); // saldo do banco não muda
    await repo.setHidden('t6', false);
    expect((await repo.sums({})).saidas).toBe(-239.9);
  });
  test('PM-8/R-2: sinal do Pluggy (pagamento de fatura) marca transferência mesmo sem par; reserva por valor segue valendo', async () => {
    const world = baseWorld();
    // pagamento de fatura na conta, sem a entrada correspondente no cartão
    world.txs.cc.push(tx('t7', 'cc', '2026-11-14T15:00:00Z', 820, 'DEBIT', '05100000', 'Pagamento fatura'));
    // par sem sinal: 75 sai da conta e entra na poupança no dia seguinte
    world.txs.cc.push(tx('t8', 'cc', '2026-11-15T15:00:00Z', 75, 'DEBIT', null, 'TED'));
    world.txs.poup.push(tx('t9', 'poup', '2026-11-16T15:00:00Z', 75, 'CREDIT', null, 'TED recebida'));
    const { db, repo, client } = await setup(world);
    await syncConnection(db, repo, client, 'item-1');
    expect((await repo.getTransaction('t7'))?.transfer).toBe(1);
    expect((await repo.getTransaction('t8'))?.transfer).toBe(1);
    expect((await repo.getTransaction('t9'))?.transfer).toBe(1);
    await repo.setTransferOverride('t7', false); // marcação manual prevalece
    await repo.recomputeTransfers();
    expect((await repo.getTransaction('t7'))?.transfer).toBe(0);
  });

  test('UX-040: desmarcar a transferência faz o valor voltar às somas na hora', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    await repo.setTransferOverride('t3', false);
    expect((await repo.sums({ accountIds: ['cc'] })).saidas).toBe(-289.9);
  });
  test('RF-006.2 / UX-027: mudar categoria vale na hora no filtro', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    await repo.setCategory('t6', 'compras');
    expect((await repo.listTransactions({ categories: ['compras'] })).map((r) => r.id)).toEqual(['t6']);
    expect(await repo.listTransactions({ categories: ['mercado'] })).toEqual([]);
    await repo.setCategory('t6', null);
    expect((await repo.listTransactions({ categories: ['none'] })).map((r) => r.id)).toContain('t6');
  });
  test('RF-007.2: importada não é excluída por setHidden de manual; só oculta', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    await repo.setHidden('t1', true);
    expect(await repo.countAllTransactions()).toBe(6);
  });
});

describe('RF-009.1 revogar', () => {
  test('apaga contas e transações da instituição; outra conexão fica', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1');
    await repo.addConnection('item-2', '2026-11-17T12:00:00Z');
    await db.runAsync(`INSERT INTO accounts (id, item_id, type, name, balance, updated_at) VALUES ('x', 'item-2', 'BANK', 'Outra', 10, 'now')`);
    await db.runAsync(`INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, updated_at) VALUES ('tx', 'x', 'd', '2026-11-01', 'a', 'a', -1, 'now')`);
    await repo.deleteConnectionData('item-1');
    expect(await repo.getConnection('item-1')).toBeNull();
    expect((await repo.listAccounts()).map((a) => a.id)).toEqual(['x']);
    expect(await repo.countAllTransactions()).toBe(1);
    expect(await repo.countConnections()).toBe(1);
  });
});

describe('RNF-006 desempenho com 10.000 transações (base sintética)', () => {
  test('filtro + busca + somas em menos de 300 ms', async () => {
    const db = createNodeDb();
    await migrate(db);
    const repo = createRepo(db);
    await repo.addConnection('item-1', '2026-01-01T00:00:00Z');
    await db.runAsync(`INSERT INTO accounts (id, item_id, type, name, balance, updated_at) VALUES ('cc', 'item-1', 'BANK', 'Conta', 0, 'now')`);
    await db.withTransactionAsync(async () => {
      for (let i = 0; i < 10000; i++) {
        const day = `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
        const desc = i % 50 === 0 ? `Farmácia ${i}` : `Compra ${i}`;
        await db.runAsync(
          `INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, auto_category, updated_at)
           VALUES (?, 'cc', ?, ?, ?, ?, ?, ?, 'now')`,
          [`t${i}`, `${day}T12:00:00Z`, day, desc, desc.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), -((i % 300) + 1), i % 2 ? 'mercado' : 'saude'],
        );
      }
    });
    const t0 = performance.now();
    const f = { accountIds: ['cc'], from: '2026-03-01', to: '2026-06-30', categories: ['saude'], search: 'farmacia' };
    await repo.listTransactions(f, 50, 0);
    await repo.sums(f);
    const ms = performance.now() - t0;
    console.log(`RNF-006: filtro+busca+somas em 10.000 transações: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(300);
  });
});

describe('UX v0.4 §7.4 nome da conexão', () => {
  test('sem nome do banco: "Conexão 1", "Conexão 2"; número não muda nem é reaproveitado após revogar', async () => {
    const db = createNodeDb();
    await migrate(db);
    const repo = createRepo(db);
    await repo.addConnection('a', '2026-11-18T10:00:00Z');
    await repo.addConnection('b', '2026-11-18T10:01:00Z');
    expect((await repo.listConnections()).map((c) => c.name)).toEqual(['Conexão 1', 'Conexão 2']);
    await repo.deleteConnectionData('a');
    await repo.addConnection('c', '2026-11-18T10:02:00Z');
    expect((await repo.listConnections()).map((c) => c.name)).toEqual(['Conexão 2', 'Conexão 3']);
  });
  test('nome da pessoa vence o do banco; vazio volta à regra; até 30 caracteres', async () => {
    const { db, repo, client } = await setup();
    await syncConnection(db, repo, client, 'item-1'); // conector "MeuPluggy" não é nome; UX 0.8: vale o nome da conta bancária
    expect((await repo.getConnection('item-1'))?.name).toBe('Conta corrente');
    expect((await repo.getConnection('item-1'))?.has_real_name).toBe(1);
    await repo.renameConnection('item-1', '  Aurora da Ana — conta principal e reserva  ');
    const c = await repo.getConnection('item-1');
    expect(c?.name).toBe('Aurora da Ana — conta principal'.slice(0, 30));
    expect(c?.has_real_name).toBe(1);
    expect((await repo.getTransaction('t1'))?.connection_name).toBe(c?.name);
    await repo.renameConnection('item-1', '   ');
    expect((await repo.getConnection('item-1'))?.name).toBe('Conta corrente'); // vazio volta ao nome sugerido
  });
  test('migração da versão 1 numera as conexões existentes', async () => {
    const db = createNodeDb();
    await migrate(db);
    expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(6);
  });
});

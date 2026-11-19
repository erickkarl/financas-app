// Ciclo 2 · RF-007 lançamento manual (T-17): conta única "Dinheiro", sem saldo inicial, somada ao total; só manual exclui.
import { createNodeDb } from '../test/nodeDb';
import { migrate, wipeAll } from './db';
import { createRepo } from './repo';
import { maskMoneyInput, NBSP, parseMoneyInput } from '../domain/format';

const R = (v: string) => `R$${NBSP}${v}`;

describe('RF-007 máscara de valor (T-17)', () => {
  test('dígitos entram pelos centavos; zero e vazio', () => {
    expect(maskMoneyInput('')).toBe(R('0,00'));
    expect(maskMoneyInput('5')).toBe(R('0,05'));
    expect(maskMoneyInput('123456')).toBe(R('1.234,56'));
    expect(maskMoneyInput('R$ 0,123')).toBe(R('1,23'));
    expect(parseMoneyInput('R$ 1.234,56')).toBe(1234.56);
    expect(parseMoneyInput('R$ 0,00')).toBe(0);
  });
});

describe('RF-007.1 e RF-007.2 lançamento manual', () => {
  async function setup() {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    return { db, repo };
  }
  test('criar: conta "Dinheiro", selo manual, descrição padrão e soma no total', async () => {
    const { repo } = await setup();
    const id = await repo.addManual({ amount: -42.5, description: '  ', dateKey: '2026-11-18', category: 'mercado' }, '2026-11-19T12:00:00Z');
    await repo.addManual({ amount: 100, description: 'Venda de livro', dateKey: '2026-11-17', category: null }, '2026-11-19T12:00:00Z');
    const t = await repo.getTransaction(id);
    expect(t).toMatchObject({ manual: 1, account_name: 'Dinheiro', description: 'Lançamento manual', amount: -42.5, category: 'mercado', date_key: '2026-11-18' });
    const total = await repo.totalBalance();
    expect(total).toEqual({ total: 57.5, manual: 57.5, hasManual: true });
    const found = await repo.listTransactions({ search: 'livro' });
    expect(found.map((x) => x.description)).toEqual(['Venda de livro']);
  });
  test('editar muda valor, sinal, data, descrição e categoria', async () => {
    const { repo } = await setup();
    const id = await repo.addManual({ amount: -10, description: 'Café', dateKey: '2026-11-18', category: null }, '2026-11-19T12:00:00Z');
    await repo.setCategory(id, 'compras');
    await repo.updateManual(id, { amount: 30, description: 'Reembolso', dateKey: '2026-11-15', category: 'receitas' }, '2026-11-19T13:00:00Z');
    expect(await repo.getTransaction(id)).toMatchObject({ amount: 30, description: 'Reembolso', date_key: '2026-11-15', category: 'receitas' });
    expect((await repo.totalBalance()).total).toBe(30);
  });
  test('excluir só apaga lançamento manual; importada não se exclui (RF-007.2)', async () => {
    const { db, repo } = await setup();
    await repo.addConnection('c1', '2026-11-18T10:00:00Z');
    await db.runAsync(`INSERT INTO accounts (id, item_id, type, name, balance, updated_at) VALUES ('a1','c1','BANK','Conta',100,'x')`);
    await db.runAsync(`INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, manual, updated_at) VALUES ('imp','a1','2026-11-10T12:00:00Z','2026-11-10','Importada','importada',-5,0,'x')`);
    const id = await repo.addManual({ amount: -1, description: 'x', dateKey: '2026-11-18', category: null }, 'x');
    await repo.deleteManual('imp');
    await repo.deleteManual(id);
    expect(await repo.getTransaction('imp')).not.toBeNull();
    expect(await repo.getTransaction(id)).toBeNull();
    await repo.updateManual('imp', { amount: 999, description: 'hack', dateKey: '2026-11-18', category: null }, 'x');
    expect((await repo.getTransaction('imp'))?.amount).toBe(-5);
  });
  test('"Apagar todos os dados" também apaga os lançamentos manuais', async () => {
    const { db, repo } = await setup();
    await repo.addManual({ amount: 5, description: 'x', dateKey: '2026-11-18', category: null }, 'x');
    await wipeAll(db);
    expect(await repo.countAllTransactions()).toBe(0);
  });
});

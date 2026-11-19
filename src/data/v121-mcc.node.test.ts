// requisitos v1.21 (11.16): mapa por payeeMCC no cartão (5968 → Assinaturas, 5499 → Mercado), conferido no manual da Visa.
import { createNodeDb } from '../test/nodeDb';
import { migrate } from './db';
import { createRepo } from './repo';
import { syncConnection } from './sync';
import { createPluggyClient } from '../pluggy/client';
import { categoryFromMcc } from '../domain/categories';

describe('v1.21: categoria pelo MCC do cartão', () => {
  test('só no cartão, só 5968 e 5499, só no lugar de "Outros" ou "Sem categoria"', () => {
    expect(categoryFromMcc('outros', 'CREDIT', '5968')).toBe('assinaturas');
    expect(categoryFromMcc(null, 'CREDIT', 5499)).toBe('mercado');
    expect(categoryFromMcc('restaurantes', 'CREDIT', '5499')).toBe('restaurantes'); // não troca categoria mais específica
    expect(categoryFromMcc('outros', 'BANK', '5968')).toBe('outros'); // conta: não
    expect(categoryFromMcc('outros', 'CREDIT', '5411')).toBe('outros'); // outros códigos: não (só com evidência)
    expect(categoryFromMcc('outros', 'CREDIT', null)).toBe('outros');
  });
  test('na sincronização: sugestão aplicada; a escolha da pessoa prevalece', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    await repo.addConnection('c1', '2026-11-01T10:00:00Z');
    const tx = (id: string, amount: number, categoryId: string | null, mcc: string | null) =>
      ({ id, accountId: 'k', date: '2026-11-05T15:00:00Z', description: 'x', amount, type: 'DEBIT', category: null, categoryId, creditCardMetadata: mcc ? { payeeMCC: mcc } : null });
    const client = createPluggyClient({
      getCredentials: async () => ({ clientId: 'id', clientSecret: 's' }),
      fetchImpl: async (url) => {
        const u = new URL(url);
        const json = (b: unknown) => ({ status: 200, json: async () => b });
        if (u.pathname === '/auth') return json({ apiKey: 'k' });
        if (u.pathname.startsWith('/items/')) return json({ id: 'c1', connector: { id: 200, name: 'MeuPluggy' }, status: 'UPDATED', createdAt: '2026-11-01T10:00:00Z', lastUpdatedAt: '2026-11-19T09:00:00Z' });
        if (u.pathname === '/consents' || u.pathname === '/investments') return json({ results: [] });
        if (u.pathname === '/accounts') return json({ results: [{ id: 'k', itemId: 'c1', type: 'CREDIT', subtype: 'CREDIT_CARD', number: '1', balance: 0, name: 'Cartão', currencyCode: 'BRL' }] });
        if (u.pathname === '/v2/transactions') return json({ results: [tx('assin', 30, '07000000', '5968'), tx('conv', 20, null, '5499'), tx('rest', 50, '11000000', '5499')], next: null });
        return json({});
      },
    });
    await syncConnection(db, repo, client, 'c1');
    expect((await repo.getTransaction('assin'))?.category).toBe('assinaturas');
    expect((await repo.getTransaction('conv'))?.category).toBe('mercado');
    expect((await repo.getTransaction('rest'))?.category).toBe('restaurantes');
    await repo.setCategory('assin', 'lazer');
    await syncConnection(db, repo, client, 'c1');
    expect((await repo.getTransaction('assin'))?.category).toBe('lazer');
  });
});

import { createPluggyClient, PluggyError } from './client';

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeFetch(handler: (c: Call) => { status: number; body?: unknown } | 'throw') {
  const calls: Call[] = [];
  const impl = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const r = handler(call);
    if (r === 'throw') throw new TypeError('Network request failed');
    return { status: r.status, json: async () => r.body ?? null };
  };
  return { impl, calls };
}

const CREDS = { clientId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', clientSecret: 'pluggy_sk_SEGREDO_DE_TESTE' };

describe('RF-000.2 testar credenciais (DEV-7)', () => {
  test('401 CLIENT_KEYS_UNAUTHORIZED vira invalid_credentials', async () => {
    const f = fakeFetch(() => ({ status: 401, body: { message: 'client keys are invalid', code: 401, codeDescription: 'CLIENT_KEYS_UNAUTHORIZED' } }));
    const c = createPluggyClient({ getCredentials: async () => null, fetchImpl: f.impl });
    await expect(c.testCredentials(CREDS)).rejects.toMatchObject({ kind: 'invalid_credentials' });
  });
  test('sem rede é "network", nunca "inválidas"', async () => {
    const f = fakeFetch(() => 'throw');
    const c = createPluggyClient({ getCredentials: async () => null, fetchImpl: f.impl });
    await expect(c.testCredentials(CREDS)).rejects.toMatchObject({ kind: 'network' });
  });
  test('5xx é "server"', async () => {
    const f = fakeFetch(() => ({ status: 503 }));
    const c = createPluggyClient({ getCredentials: async () => null, fetchImpl: f.impl });
    await expect(c.testCredentials(CREDS)).rejects.toMatchObject({ kind: 'server' });
  });
  test('RF-000.3: mensagem de erro nunca contém o segredo nem o Client ID', async () => {
    const f = fakeFetch(() => ({ status: 401, body: { codeDescription: 'CLIENT_KEYS_UNAUTHORIZED' } }));
    const c = createPluggyClient({ getCredentials: async () => null, fetchImpl: f.impl });
    const err = (await c.testCredentials(CREDS).catch((e) => e)) as PluggyError;
    const text = `${err.message} ${String(err)} ${JSON.stringify(err)}`;
    expect(text).not.toContain(CREDS.clientSecret);
    expect(text).not.toContain(CREDS.clientId);
  });
});

describe('requisições autenticadas', () => {
  test('reusa a apiKey e renova uma vez em 401', async () => {
    let authCount = 0;
    let itemCalls = 0;
    const f = fakeFetch((c) => {
      if (c.url.endsWith('/auth')) {
        authCount++;
        return { status: 200, body: { apiKey: `key-${authCount}` } };
      }
      itemCalls++;
      if (itemCalls === 2) return { status: 401 }; // apiKey expirada
      return { status: 200, body: { id: 'item-1', status: 'UPDATED' } };
    });
    const c = createPluggyClient({ getCredentials: async () => CREDS, fetchImpl: f.impl });
    await c.getItem('item-1');
    await c.getItem('item-1');
    expect(authCount).toBe(2);
    const last = f.calls[f.calls.length - 1];
    expect(last.headers['X-API-KEY']).toBe('key-2');
  });
  test('transações por cursor em /v2/transactions percorrem todas as páginas', async () => {
    const f = fakeFetch((c) => {
      if (c.url.endsWith('/auth')) return { status: 200, body: { apiKey: 'k' } };
      const u = new URL(c.url);
      expect(u.pathname).toBe('/v2/transactions');
      const after = u.searchParams.get('after');
      if (!after) return { status: 200, body: { results: [{ id: 't1' }], next: '?accountId=acc&after=c1' } };
      if (after === 'c1') return { status: 200, body: { results: [{ id: 't2' }], next: '?accountId=acc&after=c2' } };
      return { status: 200, body: { results: [{ id: 't3' }], next: null } };
    });
    const c = createPluggyClient({ getCredentials: async () => CREDS, fetchImpl: f.impl });
    const txs = await c.getTransactions('acc');
    expect(txs.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });
  test('connect token abre conexão nova ou atualiza a existente', async () => {
    const f = fakeFetch((c) => (c.url.endsWith('/auth') ? { status: 200, body: { apiKey: 'k' } } : { status: 200, body: { accessToken: 'tok' } }));
    const c = createPluggyClient({ getCredentials: async () => CREDS, fetchImpl: f.impl });
    expect(await c.createConnectToken()).toBe('tok');
    await c.createConnectToken('item-9');
    expect(JSON.parse(f.calls[f.calls.length - 1].body!)).toEqual({ itemId: 'item-9' });
  });
  test('excluir conexão que já não existe conta como revogada', async () => {
    const f = fakeFetch((c) => (c.url.endsWith('/auth') ? { status: 200, body: { apiKey: 'k' } } : { status: 404 }));
    const c = createPluggyClient({ getCredentials: async () => CREDS, fetchImpl: f.impl });
    await expect(c.deleteItem('x')).resolves.toBeUndefined();
  });
  test('excluir conexão com falha de rede propaga o erro (RF-009.1 nunca diz que revogou)', async () => {
    const f = fakeFetch((c) => (c.url.endsWith('/auth') ? { status: 200, body: { apiKey: 'k' } } : 'throw'));
    const c = createPluggyClient({ getCredentials: async () => CREDS, fetchImpl: f.impl });
    await expect(c.deleteItem('x')).rejects.toMatchObject({ kind: 'network' });
  });
});

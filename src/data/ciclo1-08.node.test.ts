// UX 0.8 / requisitos v1.9 (parte do ciclo 1): nome sugerido, conexão repetida, exclusão da conta em duas fases.
import { createNodeDb } from '../test/nodeDb';
import { migrate } from './db';
import { createRepo } from './repo';
import { suggestedAccount, syncConnection } from './sync';
import { deleteAccountData, deletionMessage } from './accountDeletion';
import { createPluggyClient, PluggyError } from '../pluggy/client';
import type { PluggyAccount } from '../pluggy/types';

const acc = (id: string, type: 'BANK' | 'CREDIT', name: string, marketingName: string | null, number: string): PluggyAccount => ({
  id, itemId: '', type, subtype: type === 'BANK' ? 'CHECKING_ACCOUNT' : 'CREDIT_CARD', number, balance: 10, name, marketingName, currencyCode: 'BRL',
});

/** Pluggy simulado: cada item devolve as contas do mapa; transações vazias. */
function fakePluggy(byItem: Record<string, PluggyAccount[]>) {
  return createPluggyClient({
    getCredentials: async () => ({ clientId: 'id', clientSecret: 's' }),
    fetchImpl: async (url) => {
      const u = new URL(url);
      const json = (b: unknown, status = 200) => ({ status, json: async () => b });
      if (u.pathname === '/auth') return json({ apiKey: 'k' });
      if (u.pathname.startsWith('/items/')) return json({ id: u.pathname.split('/')[2], connector: { id: 200, name: 'MeuPluggy' }, status: 'UPDATED', executionStatus: 'SUCCESS', error: null, createdAt: '2026-11-18T10:00:00Z', lastUpdatedAt: '2026-11-18T09:00:00Z' });
      if (u.pathname === '/consents') return json({ results: [] });
      if (u.pathname === '/accounts') return json({ results: byItem[u.searchParams.get('itemId')!] ?? [] });
      if (u.pathname === '/v2/transactions') return json({ results: [{ id: `t-${u.searchParams.get('accountId')}`, accountId: u.searchParams.get('accountId'), date: '2026-11-10T12:00:00Z', description: 'x', amount: 5, type: 'DEBIT', category: null, categoryId: null }], next: null });
      return json({}, 404);
    },
  });
}

const AU_BANK = acc('au-cc', 'BANK', 'Banco Aurora S.A.', 'Banco Aurora S.A. (Conta Pré-paga)', '123-3');
const AU_CARD = acc('au-card', 'CREDIT', 'cartao-roxo', '', '0000');

describe('7.4 nome sugerido pela conta (R-13)', () => {
  test('conta bancária antes do cartão; marketingName, senão name', () => {
    expect(suggestedAccount([AU_CARD, AU_BANK])?.name).toBe('Banco Aurora S.A. (Conta Pré-paga)');
    expect(suggestedAccount([acc('x', 'BANK', 'BANCO AZUL', null, '1')])?.name).toBe('BANCO AZUL');
    expect(suggestedAccount([AU_CARD])?.name).toBe('cartao-roxo');
    expect(suggestedAccount([])).toBeNull();
  });
  test('sincronizar dá o nome sugerido; o da pessoa prevalece; nomes iguais ganham " (2)"', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    const azul2 = acc('azul-b', 'BANK', 'BANCO AZUL', null, '9');
    const client = fakePluggy({ a: [acc('azul-a', 'BANK', 'BANCO AZUL', null, '1')], b: [azul2] });
    await repo.addConnection('a', '2026-11-18T10:00:00Z');
    await repo.addConnection('b', '2026-11-18T10:01:00Z');
    expect((await repo.getConnection('a'))?.name).toBe('Conexão 1'); // antes de as contas chegarem
    await syncConnection(db, repo, client, 'a');
    await syncConnection(db, repo, client, 'b');
    expect((await repo.getConnection('a'))?.name).toBe('BANCO AZUL');
    expect((await repo.getConnection('b'))?.name).toBe('BANCO AZUL (2)');
    await repo.renameConnection('b', 'Azul da Ana');
    expect((await repo.getConnection('b'))?.name).toBe('Azul da Ana');
    await syncConnection(db, repo, client, 'b'); // reler não troca o nome da pessoa nem o sufixo
    expect((await repo.getConnection('b'))?.name).toBe('Azul da Ana');
    expect((await repo.getConnection('a'))?.suggested_account_id).toBe('azul-a');
  });
});

describe('conexão repetida (UX-067)', () => {
  test('mesmo id de conta: a nova fica com as contas, a antiga vira repetida e não toma de volta', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    const client = fakePluggy({ old: [AU_BANK, AU_CARD], novo: [AU_BANK, AU_CARD] });
    await repo.addConnection('old', '2026-11-18T10:00:00Z');
    await repo.addConnection('novo', '2026-11-18T10:05:00Z');
    const r1 = await syncConnection(db, repo, client, 'old');
    expect(r1.ok && r1.repeatedOf).toEqual([]);
    const r2 = await syncConnection(db, repo, client, 'novo');
    expect(r2.ok && r2.repeatedOf).toEqual(['old']);
    expect((await repo.getConnection('old'))?.duplicate_of).toBe('novo');
    // reler a antiga não devolve as contas para ela
    await syncConnection(db, repo, client, 'old');
    const owners = (await repo.listAccounts()).map((a) => a.item_id);
    expect(owners).toEqual(['novo', 'novo']);
    // saldo e transações uma vez só
    expect(await repo.countAllTransactions()).toBe(2);
    expect((await repo.totalBalance()).total).toBe(10);
  });
  test('revogar a antiga (sem contas) não apaga contas nem transações da nova; a nova perde a marca se for revogada', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    const client = fakePluggy({ old: [AU_BANK], novo: [AU_BANK] });
    await repo.addConnection('old', '2026-11-18T10:00:00Z');
    await repo.addConnection('novo', '2026-11-18T10:05:00Z');
    await syncConnection(db, repo, client, 'old');
    await syncConnection(db, repo, client, 'novo');
    await repo.deleteConnectionData('old');
    expect((await repo.listAccounts()).length).toBe(1);
    expect(await repo.countAllTransactions()).toBe(1);
  });
  test('mesmo número com id diferente: a conta antiga sai, saldo conta uma vez', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    const client = fakePluggy({ old: [AU_BANK], novo: [{ ...AU_BANK, id: 'au-cc-novo' }] });
    await repo.addConnection('old', '2026-11-18T10:00:00Z');
    await repo.addConnection('novo', '2026-11-18T10:05:00Z');
    await syncConnection(db, repo, client, 'old');
    await syncConnection(db, repo, client, 'novo');
    expect((await repo.listAccounts()).map((a) => a.id)).toEqual(['au-cc-novo']);
    expect((await repo.getConnection('old'))?.duplicate_of).toBe('novo');
  });
});

describe('exclusão da conta em duas fases (RF-009.2.2, RF-009.2.3, R-9)', () => {
  const conns = [{ item_id: 'a', name: 'Aurora' }, { item_id: 'b', name: 'Azul' }];
  const run = async (remote: (id: string) => Promise<void>) => {
    const local: string[] = [];
    let wiped = false;
    const r = await deleteAccountData({ conns, deleteRemote: remote, deleteLocal: async (id) => { local.push(id); }, wipeAll: async () => { wiped = true; } });
    return { r, local, wiped };
  };
  test('todas excluídas: apaga cada uma e depois o resto', async () => {
    const { r, local, wiped } = await run(async () => undefined);
    expect(r).toEqual({ kind: 'done' });
    expect(local).toEqual(['a', 'b']);
    expect(wiped).toBe(true);
  });
  test('falha no meio: apaga do aparelho só a excluída e lista por nome', async () => {
    const { r, local, wiped } = await run(async (id) => { if (id === 'b') throw new PluggyError('network', null, null); });
    expect(r).toEqual({ kind: 'partial', deleted: ['Aurora'], failed: ['Azul'] });
    expect(local).toEqual(['a']);
    expect(wiped).toBe(false);
    const msg = deletionMessage(r as never);
    expect(msg).toContain('Excluídas no Pluggy e apagadas deste aparelho: Aurora.');
    expect(msg).toContain('Não foi possível excluir: Azul.');
  });
  test('nenhuma excluída: nada apagado', async () => {
    const { r, local } = await run(async () => { throw new PluggyError('server', 503, null); });
    expect(r).toEqual({ kind: 'none' });
    expect(local).toEqual([]);
  });
  test('credenciais recusadas no meio: para e diz o que já foi', async () => {
    const { r, local } = await run(async (id) => { if (id === 'b') throw new PluggyError('invalid_credentials', 401, 'CLIENT_KEYS_UNAUTHORIZED'); });
    expect(r).toEqual({ kind: 'rejected', deleted: ['Aurora'], remaining: ['Azul'] });
    expect(local).toEqual(['a']);
  });
  test('falha ao apagar o aparelho depois de excluir tudo no Pluggy', async () => {
    const r = await deleteAccountData({ conns, deleteRemote: async () => undefined, deleteLocal: async () => undefined, wipeAll: async () => { throw new Error('io'); } });
    expect(r).toEqual({ kind: 'localFailed' });
  });
});

describe('RF-009.1.2 revogar com contas compartilhadas (Q20 a, UX-073)', () => {
  test('revogar a mais nova (dona das contas) mantém as compartilhadas na outra, com transações e categorias', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    const exclusiva = acc('so-novo', 'BANK', 'Poupança só da nova', null, '777');
    const client = fakePluggy({ old: [AU_BANK, AU_CARD], novo: [AU_BANK, AU_CARD, exclusiva] });
    await repo.addConnection('old', '2026-11-18T10:00:00Z');
    await repo.addConnection('novo', '2026-11-18T10:05:00Z');
    await syncConnection(db, repo, client, 'old');
    await syncConnection(db, repo, client, 'novo'); // nova é dona; antiga marcada repetida
    await repo.setCategory('t-au-cc', 'compras');
    const sharing = await repo.accountSharing('novo');
    expect(sharing.shared.map((s) => s.id).sort()).toEqual(['au-card', 'au-cc']);
    expect(sharing.exclusive.map((s) => s.id)).toEqual(['so-novo']);
    const r = await repo.deleteConnectionData('novo');
    expect(r).toEqual({ kept: 2, keptWith: 'Banco Aurora S.A. (Conta Pré-paga)' });
    const accs = await repo.listAccounts();
    expect(accs.map((a) => `${a.id}@${a.item_id}`).sort()).toEqual(['au-card@old', 'au-cc@old']);
    expect((await repo.getTransaction('t-au-cc'))?.category).toBe('compras'); // categoria mantida
    expect(await repo.getTransaction('t-so-novo')).toBeNull(); // exclusiva saiu
    expect((await repo.getConnection('old'))?.duplicate_of).toBeNull(); // a antiga volta a ser normal
  });
  test('conexão sem contas compartilhadas: apaga tudo dela, como antes', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    const client = fakePluggy({ a: [AU_BANK], b: [acc('azul', 'BANK', 'BANCO AZUL', null, '1')] });
    await repo.addConnection('a', '2026-11-18T10:00:00Z');
    await repo.addConnection('b', '2026-11-18T10:05:00Z');
    await syncConnection(db, repo, client, 'a');
    await syncConnection(db, repo, client, 'b');
    expect(await repo.deleteConnectionData('b')).toEqual({ kept: 0, keptWith: null });
    expect((await repo.listAccounts()).map((x) => x.id)).toEqual(['au-cc']);
  });
});

describe('RF-005.3 futuras (UX-065/066, Q18 a)', () => {
  test('futura fica fora das somas e da lista principal; no próprio dia já conta', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    await repo.addConnection('a', '2026-11-18T10:00:00Z');
    await db.runAsync(`INSERT INTO accounts (id, item_id, type, name, balance, updated_at) VALUES ('card', 'a', 'CREDIT', 'Cartão', 0, 'x')`);
    const ins = (id: string, day: string, amount: number) => db.runAsync(
      `INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, updated_at) VALUES (?, 'card', ?, ?, 'x', 'x', ?, 'x')`, [id, `${day}T12:00:00Z`, day, amount]);
    await ins('ontem', '2026-11-17', -10); await ins('hoje', '2026-11-18', -20); await ins('amanha', '2026-11-19', -40); await ins('marco', '2027-03-06', -80);
    const today = '2026-11-18';
    expect((await repo.sums({ today })).saidas).toBe(-30);
    expect((await repo.sums({ today })).excluded).toBe(2);
    expect((await repo.listTransactions({ future: 'exclude', today })).map((t) => t.id)).toEqual(['hoje', 'ontem']);
    expect((await repo.listTransactions({ future: 'only', today })).map((t) => t.id)).toEqual(['marco', 'amanha']);
    // no dia seguinte, a de amanhã passa a contar
    expect((await repo.sums({ today: '2026-11-19' })).saidas).toBe(-70);
    expect((await repo.listTransactions({ future: 'only', today })).every((t) => t.account_type === 'CREDIT')).toBe(true);
  });
});

describe('RF-002.3.2 autorizar de novo por conexão nova (V-D, UX-072)', () => {
  // V-D: o Pluggy recusa atualizar conexão do Meu Pluggy (400 MEU_PLUGGY_ITEM_UPDATE_NOT_ALLOWED);
  // a renovação cria uma conexão nova e segue o fluxo de conexão repetida.
  const AZUL = acc('azul-cc', 'BANK', 'BANCO AZUL', null, '1');
  test('nova conexão fica com as contas; revogar a antiga mantém contas, categorias e o nome sugerido, sem " (2)"', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    const client = fakePluggy({ velha: [AZUL], renovada: [AZUL] });
    await repo.addConnection('velha', '2025-11-20T10:00:00Z');
    await syncConnection(db, repo, client, 'velha');
    await repo.setCategory('t-azul-cc', 'compras');
    await repo.addConnection('renovada', '2026-11-18T10:00:00Z');
    const r = await syncConnection(db, repo, client, 'renovada');
    expect(r.ok && r.repeatedOf).toEqual(['velha']);
    expect((await repo.getConnection('renovada'))?.name).toBe('BANCO AZUL (2)'); // enquanto as duas existem
    await repo.passNameOnRevoke('velha', 'renovada');
    const res = await repo.deleteConnectionData('velha');
    expect(res).toEqual({ kept: 1, keptWith: 'BANCO AZUL' }); // a conta fica, ligada à nova (já com o nome)
    expect((await repo.listAccounts()).map((a) => `${a.id}@${a.item_id}`)).toEqual(['azul-cc@renovada']);
    expect((await repo.getTransaction('t-azul-cc'))?.category).toBe('compras');
    expect((await repo.getConnection('renovada'))?.name).toBe('BANCO AZUL');
  });
  test('o nome dado pela pessoa passa para a nova; o nome que a pessoa deu à nova prevalece', async () => {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    const client = fakePluggy({ velha: [AZUL], renovada: [AZUL] });
    await repo.addConnection('velha', '2025-11-20T10:00:00Z');
    await syncConnection(db, repo, client, 'velha');
    await repo.renameConnection('velha', 'Azul da Bia');
    await repo.addConnection('renovada', '2026-11-18T10:00:00Z');
    await syncConnection(db, repo, client, 'renovada');
    await repo.passNameOnRevoke('velha', 'renovada');
    await repo.deleteConnectionData('velha');
    expect((await repo.getConnection('renovada'))?.name).toBe('Azul da Bia');

    await repo.addConnection('terceira', '2026-11-19T10:00:00Z');
    await repo.renameConnection('terceira', 'Meu Azul');
    await syncConnection(db, repo, fakePluggy({ terceira: [AZUL] }), 'terceira');
    await repo.passNameOnRevoke('renovada', 'terceira');
    expect((await repo.getConnection('terceira'))?.name).toBe('Meu Azul');
  });
});

describe('UX 0.11 substituir a autorização com 5 de 5 (R-14.2, R-16, R-17, R-18)', () => {
  const CC = acc('cc', 'BANK', 'BANCO EXEMPLO', null, '11');
  const POUP = acc('poup', 'BANK', 'Poupança Exemplo', null, '22');
  async function setup() {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    const client = fakePluggy({ velha: [CC, POUP], nova: [CC], outro: [acc('x', 'BANK', 'OUTRO BANCO', null, '9')] });
    await repo.addConnection('velha', '2025-11-20T10:00:00Z');
    await syncConnection(db, repo, client, 'velha');
    await repo.setCategory('t-cc', 'compras');
    return { db, repo, client };
  }
  test('aguardando: não ocupa vaga, continua somando (R-18) e não é relida', async () => {
    const { repo } = await setup();
    expect(await repo.countConnections()).toBe(1);
    const before = (await repo.totalBalance()).total;
    await repo.markReplaced('velha', '2026-11-19T10:00:00Z');
    expect(await repo.countConnections()).toBe(0);
    expect(await repo.countAwaiting()).toBe(1);
    expect((await repo.totalBalance()).total).toBe(before); // 20: as duas contas continuam somando
    expect(before).toBe(20);
  });
  test('nova autorização: conta casada mantém categoria e nome; a sem par fica "Sem autorização" e sai do saldo (R-17)', async () => {
    const { db, repo, client } = await setup();
    await repo.markReplaced('velha', '2026-11-19T10:00:00Z');
    await repo.addConnection('nova', '2026-11-19T10:05:00Z');
    const r = await syncConnection(db, repo, client, 'nova');
    expect(r.ok && r.repeatedOf).toEqual(['velha']);
    const done = await repo.finishReplacement('velha', 'nova');
    expect(done.unmatched).toEqual(['Poupança Exemplo']);
    expect(await repo.getConnection('velha')).toBeNull();
    const accs = await repo.listAccounts();
    expect(accs.map((a) => `${a.id}@${a.item_id}:${a.unauthorized_at ? 'sem' : 'ok'}`).sort()).toEqual(['cc@nova:ok', 'poup@nova:sem']);
    expect((await repo.getTransaction('t-cc'))?.category).toBe('compras');
    expect((await repo.getConnection('nova'))?.name).toBe('BANCO EXEMPLO'); // sem " (2)"
    expect((await repo.totalBalance()).total).toBe(10); // a poupança sem autorização não soma
    expect(await repo.countUnauthorizedAccounts()).toBe(1);
    expect(await repo.countAllTransactions()).toBe(2); // transações da sem par continuam (provisório da 0.11)
    expect(await repo.countConnections()).toBe(1);
    // apagar a conta sem autorização
    await repo.deleteAccountLocal('poup');
    expect(await repo.getTransaction('t-poup')).toBeNull();
    expect(await repo.countUnauthorizedAccounts()).toBe(0);
  });
  test('se a conta volta numa leitura seguinte, deixa de ser "Sem autorização"', async () => {
    const { db, repo, client } = await setup();
    await repo.markReplaced('velha', '2026-11-19T10:00:00Z');
    await repo.addConnection('nova', '2026-11-19T10:05:00Z');
    await syncConnection(db, repo, client, 'nova');
    await repo.finishReplacement('velha', 'nova');
    await syncConnection(db, repo, fakePluggy({ nova: [CC, POUP] }), 'nova');
    expect((await repo.listAccounts()).every((a) => !a.unauthorized_at)).toBe(true);
    expect((await repo.totalBalance()).total).toBe(20);
  });
  test('R-16: apagar só os dados da conexão que aguarda, sem Pluggy', async () => {
    const { repo } = await setup();
    await repo.markReplaced('velha', '2026-11-19T10:00:00Z');
    await repo.deleteConnectionData('velha');
    expect(await repo.countAwaiting()).toBe(0);
    expect(await repo.countAllTransactions()).toBe(0);
  });
  test('outro banco na janela: nada casa; a antiga continua aguardando', async () => {
    const { db, repo, client } = await setup();
    await repo.markReplaced('velha', '2026-11-19T10:00:00Z');
    await repo.addConnection('outro', '2026-11-19T10:05:00Z');
    const r = await syncConnection(db, repo, client, 'outro');
    expect(r.ok && r.repeatedOf).toEqual([]);
    expect((await repo.getConnection('velha'))?.replaced_at).toBe('2026-11-19T10:00:00Z');
    expect((await repo.totalBalance()).total).toBe(30);
  });
});

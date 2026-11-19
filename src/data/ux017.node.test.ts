// UX 0.17 (aprovada: E-12 a, E-13 a, N-4 a N-9) / requisitos v1.22–v1.23: RF-008.10 (estorno no cartão) e
// RF-006.3 (categoria lembrada por destinatário). UX-091 a UX-096.
import { createNodeDb } from '../test/nodeDb';
import { migrate, wipeAll } from './db';
import { createRepo } from './repo';
import { syncConnection } from './sync';
import { createPluggyClient } from '../pluggy/client';
import { maskDoc, recipientKey } from '../domain/recipient';

const month = { from: '2026-11-01', to: '2026-11-30', today: '2026-11-19' };

describe('RF-008.10: estorno de compra no cartão', () => {
  async function setup() {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    await repo.addConnection('c1', '2026-11-01T10:00:00Z');
    await db.runAsync(`INSERT INTO accounts (id, item_id, type, name, balance, updated_at) VALUES ('cc','c1','BANK','Conta',0,'x'),('k','c1','CREDIT','Cartão',0,'x')`);
    const ins = (id: string, acc: string, day: string, amount: number, cat: string | null, op: string | null, auto: string | null) =>
      db.runAsync(`INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, pluggy_category_id, operation_type, auto_category, manual, updated_at)
        VALUES (?, ?, ?, ?, 'x', 'x', ?, ?, ?, ?, 0, 'x')`, [id, acc, `2026-11-${day}T15:00:00Z`, `2026-11-${day}`, amount, cat, op, auto]);
    await ins('mercado', 'k', '02', -300, '10000000', 'PAGAMENTO', 'mercado');
    await ins('loja', 'k', '03', -100, '08000000', 'PAGAMENTO', 'compras');
    await ins('estMercado', 'k', '05', 50, '10000000', 'ESTORNO', 'mercado'); // estorno com ESTORNO
    await ins('iof', 'k', '06', 4, '15030000', 'PAGAMENTO', 'impostos'); // IOF devolvido: estorno sem ESTORNO
    await ins('estLoja', 'k', '07', 130, '08000000', 'PAGAMENTO', 'compras'); // estorno maior que o gasto da categoria
    await ins('cashback', 'k', '08', 10, '08090000', 'PAGAMENTO', 'receitas'); // cashback segue receita
    await ins('fatura', 'k', '10', 400, '05100000', 'PAGAMENTO_FATURA', null); // pagamento de fatura (R-2.1), não é estorno
    await ins('estConta', 'cc', '11', 20, '05000000', 'OUTROS', 'receitas'); // "estorno" na conta: entrada comum (v1.22)
    await ins('pixIgual', 'cc', '05', -50, '05000000', 'PIX', 'outros'); // mesma data e valor do estorno: não vira par
    await ins('salario', 'cc', '05', 1000, '05000000', 'PIX', 'receitas');
    await repo.recomputeTransfers();
    return { db, repo };
  }

  test('sinal: crédito no cartão que não é fatura nem Cashback; conta nunca', async () => {
    const { db } = await setup();
    const ids = (await db.getAllAsync<{ id: string }>('SELECT id FROM transactions WHERE refund = 1 ORDER BY id')).map((r) => r.id);
    expect(ids).toEqual(['estLoja', 'estMercado', 'iof']);
  });
  test('o estorno nunca forma par de transferência', async () => {
    const { repo } = await setup();
    expect((await repo.getTransaction('estMercado'))?.transfer).toBe(0);
    expect((await repo.getTransaction('pixIgual'))?.transfer).toBe(0);
  });
  test('UX-095: Resumo com o líquido; cashback e entrada da conta seguem receita; Extrato do mês bate', async () => {
    const { repo } = await setup();
    const s = await repo.monthSummary('2026-11', '2026-11-19');
    expect(s.receitas).toBe(1000 + 10 + 20);
    expect(s.despesas).toBe(300 + 100 + 50 - 50 - 4 - 130); // 266
    expect(s.refunds).toEqual({ count: 3, total: 184 });
    const ex = await repo.sums(month);
    expect(ex.entradas).toBe(s.receitas); // RF-008.1
    expect(-ex.saidas).toBe(s.despesas);
    expect(ex.refunds).toBe(3); // "Saídas já descontam 3 estornos."
  });
  test('UX-096: categoria com o líquido e os estornos descontados; estorno maior que o gasto fica negativo', async () => {
    const { repo } = await setup();
    const s = await repo.monthSummary('2026-11', '2026-11-19');
    const by = Object.fromEntries(s.byCategory.map((c) => [c.category, c]));
    expect(by.mercado).toEqual({ category: 'mercado', total: 250, refunds: { count: 1, total: 50 } });
    expect(by.compras).toEqual({ category: 'compras', total: -30, refunds: { count: 1, total: 130 } });
    expect(by.impostos).toEqual({ category: 'impostos', total: -4, refunds: { count: 1, total: 4 } });
    expect(by.outros.total).toBe(50);
    expect(s.byCategory.reduce((a, c) => a + c.total, 0)).toBeCloseTo(s.despesas, 2);
  });
  test('trocar a categoria do estorno decide de qual categoria ele é descontado', async () => {
    const { repo } = await setup();
    await repo.setCategory('estLoja', 'mercado');
    const by = Object.fromEntries((await repo.monthSummary('2026-11', '2026-11-19')).byCategory.map((c) => [c.category, c.total]));
    expect(by.mercado).toBe(120);
    expect(by.compras).toBe(100);
  });
});

// ---------------- RF-006.3 ----------------
const CPF_PESSOA = '111.222.333-44';
const CNPJ_ESCOLA = '12.345.678/0001-90';
const party = (type: string, value: string, name: string) => ({ name, documentNumber: { type, value } });

function makeClient(txs: () => unknown[]) {
  return createPluggyClient({
    getCredentials: async () => ({ clientId: 'id', clientSecret: 's' }),
    fetchImpl: async (url) => {
      const u = new URL(url);
      const json = (b: unknown) => ({ status: 200, json: async () => b });
      if (u.pathname === '/auth') return json({ apiKey: 'k' });
      if (u.pathname.startsWith('/items/')) return json({ id: 'c1', connector: { id: 200, name: 'MeuPluggy' }, status: 'UPDATED', createdAt: '2026-11-01T10:00:00Z', lastUpdatedAt: '2026-11-19T09:00:00Z' });
      if (u.pathname === '/consents' || u.pathname === '/investments') return json({ results: [] });
      if (u.pathname === '/accounts') return json({ results: [
        { id: 'a1', itemId: 'c1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', number: '1', balance: 0, name: 'Conta Exemplo', currencyCode: 'BRL' },
        { id: 'k1', itemId: 'c1', type: 'CREDIT', subtype: 'CREDIT_CARD', number: '2', balance: 0, name: 'Cartão Exemplo', currencyCode: 'BRL' },
      ] });
      if (u.pathname === '/v2/transactions') return json({ results: (txs() as { accountId: string }[]).filter((t) => t.accountId === u.searchParams.get('accountId')), next: null });
      return json({});
    },
  });
}
const pix = (id: string, day: string, amount: number, doc: string, docType = 'CPF', categoryId = '05000000', op = 'PIX') => ({
  id, accountId: 'a1', date: `2026-11-${day}T15:00:00Z`, description: `Transferência enviada pelo Pix - Fulana de Tal Exemplo ${id}`,
  amount, type: amount < 0 ? 'DEBIT' : 'CREDIT', category: null, categoryId, operationType: op,
  paymentData: amount < 0 ? { payer: party('CPF', '999.888.777-66', 'Titular Exemplo'), receiver: party(docType, doc, 'Fulana de Tal Exemplo') }
    : { payer: party(docType, doc, 'Fulana de Tal Exemplo'), receiver: party('CPF', '999.888.777-66', 'Titular Exemplo') },
});

async function setupMemory() {
  const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
  await repo.addConnection('c1', '2026-11-01T10:00:00Z');
  let list: unknown[] = [
    pix('p1', '01', -100, CPF_PESSOA), pix('p2', '03', -80, CPF_PESSOA), pix('p3', '04', -60, CPF_PESSOA), pix('p4', '05', -40, CPF_PESSOA),
    pix('p5', '06', -20, CPF_PESSOA, 'CPF', '05000000'),
    pix('inv', '07', -500, CPF_PESSOA, 'CPF', '03000000'), // "Investimentos" pelo mapa: a lembrança não mexe
    pix('esc', '02', -900, CNPJ_ESCOLA, 'CNPJ', '07020002', 'BOLETO'),
    { id: 'card', accountId: 'k1', date: '2026-11-02T15:00:00Z', description: 'Loja Exemplo', amount: 30, type: 'DEBIT', category: null, categoryId: '08000000', operationType: 'PAGAMENTO' },
  ];
  const client = makeClient(() => list);
  await syncConnection(db, repo, client, 'c1');
  return { db, repo, client, add: (t: unknown) => { list = [...list, t]; } };
}

describe('RF-006.3: categoria lembrada por destinatário', () => {
  test('destinatário: só PIX ou boleto em conta, com CPF ou CNPJ; recebedor na saída, pagador na entrada', () => {
    expect(recipientKey({ accountType: 'BANK', operationType: 'PIX', amount: -1, payerType: 'CPF', payer: '1', receiverType: 'CNPJ', receiver: '2' })).toEqual({ type: 'CNPJ', doc: '2' });
    expect(recipientKey({ accountType: 'BANK', operationType: 'PIX', amount: 1, payerType: 'CPF', payer: '1', receiverType: 'CNPJ', receiver: '2' })).toEqual({ type: 'CPF', doc: '1' });
    expect(recipientKey({ accountType: 'CREDIT', operationType: 'PIX', amount: -1, payerType: null, payer: null, receiverType: 'CPF', receiver: '2' })).toBeNull();
    expect(recipientKey({ accountType: 'BANK', operationType: 'CONVENIO_ARRECADACAO', amount: -1, payerType: null, payer: null, receiverType: 'CNPJ', receiver: '2' })).toBeNull();
  });
  test('N-6: máscara do documento', () => {
    expect(maskDoc('CPF', '12345678901')).toBe('CPF •••.456.789-••');
    expect(maskDoc('CNPJ', '12345678000190')).toBe('CNPJ ••.345.678/0001-••');
  });
  test('UX-091: mudar a categoria de um PIX lembra; o próximo lançamento do destinatário chega com ela; a escolha à mão prevalece', async () => {
    const { db, repo, client, add } = await setupMemory();
    const change = await repo.changeCategory('p1', 'moradia');
    expect(change.remembered).toBe(true);
    // A lembrança guarda só documento, categoria, contagem e datas (v1.23).
    const mem = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM recipient_categories');
    expect(mem).toHaveLength(1);
    expect(Object.keys(mem[0]).sort()).toEqual(['category', 'created_at', 'doc', 'doc_type', 'last_tx_date', 'tx_count', 'used_at']);
    expect(mem[0]).toMatchObject({ doc_type: 'CPF', doc: '11122233344', category: 'moradia', tx_count: 6, last_tx_date: '2026-11-07' });
    // os anteriores não mudam sozinhos
    expect((await repo.getTransaction('p2'))?.category).toBe('outros');
    add(pix('p6', '10', -70, CPF_PESSOA));
    await syncConnection(db, repo, client, 'c1');
    const p6 = await repo.getTransaction('p6');
    expect(p6?.category).toBe('moradia');
    expect(p6?.remembered).toBe(1); // "Lembrada para este destinatário."
    expect((await repo.getTransaction('p2'))?.category).toBe('outros');
    await repo.setCategory('p6', 'lazer');
    expect((await repo.getTransaction('p6'))?.category).toBe('lazer');
    expect((await repo.getTransaction('p6'))?.remembered).toBe(0);
  });
  test('compra no cartão não gera lembrança', async () => {
    const { repo } = await setupMemory();
    const change = await repo.changeCategory('card', 'compras');
    expect(change.remembered).toBe(false);
    expect(await repo.countRemembered()).toBe(0);
  });
  test('UX-092 / N-4: aplicar aos anteriores muda só os não categorizados à mão e não "Investimentos"; "Desfazer" devolve todos', async () => {
    const { repo } = await setupMemory();
    await repo.setCategory('p4', 'saude'); // à mão
    const change = await repo.changeCategory('p1', 'moradia');
    expect(change.others).toBe(3); // p2, p3, p5 (não p4, à mão; não inv)
    const list = await repo.applyToOthers('p1', change.key!, 'moradia');
    expect(list.map((o) => o.id).sort()).toEqual(['p2', 'p3', 'p5']);
    for (const id of ['p2', 'p3', 'p5']) expect((await repo.getTransaction(id))?.category).toBe('moradia');
    expect((await repo.getTransaction('p4'))?.category).toBe('saude');
    expect((await repo.getTransaction('inv'))?.category).toBe('investimentos');
    await repo.undoApplyToOthers(list);
    for (const id of ['p2', 'p3', 'p5']) expect((await repo.getTransaction(id))?.category).toBe('outros');
  });
  test('"Desfazer" da troca desfaz a categoria e a lembrança; N-5: "Sem categoria" apaga a lembrança', async () => {
    const { repo } = await setupMemory();
    const first = await repo.changeCategory('p1', 'moradia');
    const second = await repo.changeCategory('p2', 'lazer'); // troca a lembrança
    expect((await repo.getRemembered(second.key!))?.category).toBe('lazer');
    await repo.undoCategoryChange('p2', second);
    expect((await repo.getRemembered(second.key!))?.category).toBe('moradia');
    expect((await repo.getTransaction('p2'))?.category).toBe('outros');
    await repo.undoCategoryChange('p1', first);
    expect(await repo.countRemembered()).toBe(0);
    expect((await repo.getTransaction('p1'))?.category).toBe('outros');
    await repo.changeCategory('p1', 'moradia');
    await repo.changeCategory('p3', null);
    expect(await repo.countRemembered()).toBe(0);
  });
  test('UX-093 / N-7: esquecer um ou todos; os lançamentos ficam como estão e os novos voltam à sugestão automática', async () => {
    const { db, repo, client, add } = await setupMemory();
    await repo.changeCategory('p1', 'moradia');
    await repo.changeCategory('esc', 'outros'); // boleto da escola (CNPJ)
    expect(await repo.countRemembered()).toBe(2);
    const listed = await repo.listRemembered();
    expect(listed.map((r) => r.doc_type).sort()).toEqual(['CNPJ', 'CPF']);
    add(pix('p7', '12', -10, CPF_PESSOA));
    await syncConnection(db, repo, client, 'c1');
    expect((await repo.getTransaction('p7'))?.category).toBe('moradia');
    const row = await repo.forgetRemembered({ type: 'CPF', doc: '11122233344' });
    expect(row?.category).toBe('moradia');
    expect((await repo.getTransaction('p7'))?.category).toBe('moradia'); // fica como está
    add(pix('p8', '13', -10, CPF_PESSOA));
    await syncConnection(db, repo, client, 'c1');
    expect((await repo.getTransaction('p8'))?.category).toBe('outros'); // sugestão automática
    await repo.restoreRemembered(row!); // "Desfazer"
    expect(await repo.countRemembered()).toBe(2);
    await repo.forgetAllRemembered();
    expect(await repo.countRemembered()).toBe(0);
  });
  test('T-22 (E-14 b): a lista lê a descrição, a data e o valor do último lançamento no aparelho; "Ver lançamentos" filtra pelo destinatário', async () => {
    const { repo } = await setupMemory();
    await repo.changeCategory('p1', 'moradia');
    const [row] = await repo.listRemembered();
    expect(row.last).toMatchObject({ date_key: '2026-11-07', amount: -500 }); // o mais recente do destinatário
    expect(row.last?.description).toContain('Fulana'); // lido do lançamento, não guardado na lembrança
    const ids = (await repo.listTransactions({ recipient: { type: 'CPF', doc: '11122233344' } })).map((t) => t.id).sort();
    expect(ids).toEqual(['inv', 'p1', 'p2', 'p3', 'p4', 'p5']);
    const sums = await repo.sums({ recipient: { type: 'CPF', doc: '11122233344' }, today: '2026-11-19' });
    expect(sums.count).toBe(6);
  });
  test('T-22: depois de revogar, a linha fica sem lançamento no aparelho (sem descrição nem nome)', async () => {
    const { repo } = await setupMemory();
    await repo.changeCategory('p1', 'moradia');
    await repo.deleteConnectionData('c1');
    const [row] = await repo.listRemembered();
    expect(row.last).toBeNull();
    expect(row.last_tx_id).toBeNull();
    expect(row).toMatchObject({ doc_type: 'CPF', category: 'moradia', tx_count: 6, last_tx_date: '2026-11-07' });
  });
  test('v1.23 / N-8 / UX-090: revogar mantém a lembrança e não deixa descrição nem nome no banco; "Apagar tudo" apaga', async () => {
    const { db, repo } = await setupMemory();
    await repo.changeCategory('p1', 'moradia');
    const before = await repo.getRemembered({ type: 'CPF', doc: '11122233344' });
    await repo.deleteConnectionData('c1');
    const after = await repo.getRemembered({ type: 'CPF', doc: '11122233344' });
    expect(after).toEqual(before); // contagem e data do último lançamento guardadas
    const tables = (await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name);
    let dump = '';
    for (const t of tables) dump += JSON.stringify(await db.getAllAsync(`SELECT * FROM ${t}`));
    expect(dump).not.toMatch(/Fulana|Titular|Transferência enviada|Loja Exemplo|Conta Exemplo|Cartão Exemplo/);
    await wipeAll(db);
    expect(await repo.countRemembered()).toBe(0);
  });
});

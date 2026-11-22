// UX 0.14 / requisitos v1.18–1.19: RF-008.5 a .9, RNF-007, N-1 a N-3 (UX-085 a UX-090).
import { createNodeDb } from '../test/nodeDb';
import { migrate, wipeAll } from './db';
import { createRepo } from './repo';
import { syncConnection } from './sync';
import { createPluggyClient } from '../pluggy/client';
import { isPublicBodyText, ownTransferSignal, suggestTaxCategory } from '../domain/recognition';

const CPF_A = '111.222.333-44'; const CPF_B = '555.666.777-88'; const CNPJ_PJ = '12.345.678/0001-90';
const party = (type: string, value: string, name = 'Pessoa Exemplo') => ({ name, documentNumber: { type, value } });

function world() {
  const tx = (id: string, accountId: string, day: string, amount: number, type: 'DEBIT' | 'CREDIT', extra: Record<string, unknown> = {}) =>
    ({ id, accountId, date: `2026-11-${day}T15:00:00Z`, description: 'x', amount, type, category: null, categoryId: null, ...extra });
  return {
    a1: [
      tx('sal', 'a1', '05', 5000, 'CREDIT', { categoryId: '05000000', paymentData: { payer: party('CNPJ', CNPJ_PJ, 'Empresa Exemplo'), receiver: party('CPF', CPF_A) } }), // UX-085
      tx('sal04', 'a1', '06', 100, 'CREDIT', { categoryId: '04000000', paymentData: { payer: party('CNPJ', CNPJ_PJ), receiver: party('CPF', CPF_A) } }), // CNPJ vence o sinal
      tx('mesmo', 'a1', '07', -300, 'DEBIT', { paymentData: { payer: party('CPF', CPF_A), receiver: party('CPF', CPF_A) } }), // (b)
      tx('outro', 'a1', '08', -40, 'DEBIT', { paymentData: { payer: party('CPF', CPF_A), receiver: party('CPF', CPF_B) } }),
      tx('dare', 'a1', '09', -120, 'DEBIT', { operationType: 'CONVENIO_ARRECADACAO', description: 'Pagamento efetuado|SEFAZ EXEMPLO-DARE', categoryId: '05000000' }), // UX-089
      tx('agua', 'a1', '10', -90, 'DEBIT', { operationType: 'CONVENIO_ARRECADACAO', description: 'Pagamento efetuado|EMPRESA DE AGUA EXEMPLO', categoryId: '05000000' }),
      tx('pixsefaz', 'a1', '11', -200, 'DEBIT', { operationType: 'PIX', description: 'Transferência enviada pelo Pix', paymentData: { receiver: party('CNPJ', '98.765.432/0001-10', 'SECRETARIA DA FAZENDA EXEMPLO') } }),
      tx('das', 'a1', '12', -70, 'DEBIT', { operationType: 'BOLETO', description: 'Pagamento de boleto' }), // DAS: sem reconhecimento (R-8.4)
      tx('ida', 'a1', '13', -250, 'DEBIT'), // par (c) com 'volta'
    ],
    a2: [tx('volta', 'a2', '14', 250, 'CREDIT')],
  };
}

async function setup() {
  const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
  await repo.addConnection('c1', '2026-11-01T10:00:00Z');
  const w = world();
  const client = createPluggyClient({
    getCredentials: async () => ({ clientId: 'id', clientSecret: 's' }),
    fetchImpl: async (url) => {
      const u = new URL(url);
      const json = (b: unknown) => ({ status: 200, json: async () => b });
      if (u.pathname === '/auth') return json({ apiKey: 'k' });
      if (u.pathname.startsWith('/items/')) return json({ id: 'c1', connector: { id: 200, name: 'MeuPluggy' }, status: 'UPDATED', createdAt: '2026-11-01T10:00:00Z', lastUpdatedAt: '2026-11-19T09:00:00Z' });
      if (u.pathname === '/consents' || u.pathname === '/investments') return json({ results: [] });
      if (u.pathname === '/accounts') return json({ results: [
        { id: 'a1', itemId: 'c1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', number: '1', balance: 0, name: 'Conta 1', currencyCode: 'BRL' },
        { id: 'a2', itemId: 'c1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', number: '2', balance: 0, name: 'Conta 2', currencyCode: 'BRL' },
      ] });
      if (u.pathname === '/v2/transactions') return json({ results: (w as Record<string, unknown[]>)[u.searchParams.get('accountId')!] ?? [], next: null });
      return json({});
    },
  });
  await syncConnection(db, repo, client, 'c1');
  return { db, repo };
}

describe('R-8 reconhecimento (domínio)', () => {
  test('R-8.2: CNPJ nunca; 04… sim; mesmo CPF sim; resto depende do par', () => {
    expect(ownTransferSignal({ pluggyCategoryId: '04000000', payerType: 'CNPJ', payer: '1', receiverType: 'CPF', receiver: '2' })).toBe('never');
    expect(ownTransferSignal({ pluggyCategoryId: '04000000', payerType: null, payer: null, receiverType: null, receiver: null })).toBe('yes');
    expect(ownTransferSignal({ pluggyCategoryId: null, payerType: 'CPF', payer: '1', receiverType: 'CPF', receiver: '1' })).toBe('yes');
    expect(ownTransferSignal({ pluggyCategoryId: '05100000', payerType: null, payer: null, receiverType: null, receiver: null })).toBe('maybe');
  });
  test('R-8.5: só órgão público em maiúsculas; água e luz por convênio não; "das" em nome não', () => {
    expect(suggestTaxCategory({ operationType: 'CONVENIO_ARRECADACAO', description: 'Pagamento efetuado|SEFAZ EXEMPLO-DARE' })).toBe(true);
    expect(suggestTaxCategory({ operationType: 'CONVENIO_ARRECADACAO', description: 'Pagamento efetuado|EMPRESA DE AGUA' })).toBe(false);
    expect(suggestTaxCategory({ operationType: 'PIX', description: 'Pix', receiverName: 'SECRETARIA DA FAZENDA EXEMPLO' })).toBe(true);
    expect(suggestTaxCategory({ operationType: 'PIX', description: 'Pagamento a prefeitura de exemplo' })).toBe(false); // PIX sem recebedor de órgão
    expect(isPublicBodyText('Maria das Neves')).toBe(false);
    expect(isPublicBodyText('PREFEITURA MUNICIPAL DE EXEMPLO')).toBe(true);
  });
});

describe('UX 0.14 com sincronização', () => {
  test('UX-085: entrada de CNPJ é receita, nunca transferência (nem com 04…); mesmo CPF e par são transferência', async () => {
    const { repo } = await setup();
    const t = async (id: string) => (await repo.getTransaction(id))!;
    expect((await t('sal')).transfer).toBe(0);
    expect((await t('sal')).category).toBe('receitas'); // R-8.1: Pluggy manda "Transfers" (05…); vira "Receitas"
    expect((await t('sal04')).transfer).toBe(0);
    expect((await t('mesmo')).transfer).toBe(1);
    expect((await t('outro')).transfer).toBe(0);
    expect([(await t('ida')).transfer, (await t('volta')).transfer]).toEqual([1, 1]);
    const s = await repo.monthSummary('2026-11', '2026-11-19');
    expect(s.receitas).toBe(5100);
  });
  test('UX-089: DARE e PIX à Secretaria da Fazenda sugerem "Impostos e taxas" e contam como despesa; água não; DAS conta como despesa até marcar', async () => {
    const { repo } = await setup();
    expect((await repo.getTransaction('dare'))?.category).toBe('impostos');
    expect((await repo.getTransaction('pixsefaz'))?.category).toBe('impostos');
    expect((await repo.getTransaction('agua'))?.category).not.toBe('impostos');
    let s = await repo.monthSummary('2026-11', '2026-11-19');
    expect(s.despesas).toBe(120 + 90 + 200 + 70 + 40);
    await repo.setOutOfSummary('das', true); // RF-008.7: a pessoa marca
    s = await repo.monthSummary('2026-11', '2026-11-19');
    expect(s.despesas).toBe(120 + 90 + 200 + 40);
    expect(s.outOfSummary).toEqual({ saidas: 70, entradas: 0, count: 1, reimbursements: 0 });
  });
  test('UX-087/088 e N-1/N-2: fora das somas num motivo só; Resumo e Extrato batem; entradas à parte', async () => {
    const { repo } = await setup();
    await repo.setOutOfSummary('das', true);
    await repo.setOutOfSummary('sal', true); // entrada marcada
    await repo.setOutOfSummary('mesmo', true); // já é transferência: conta em "transferência" (N-1)
    await repo.setHidden('outro', true);
    await repo.setOutOfSummary('outro', true); // oculta vence
    const ex = await repo.sums({ from: '2026-11-01', to: '2026-11-30', today: '2026-11-19' });
    // UX 0.16 (E-11 a): a oculta conta em "Fora das somas" mesmo sem "Mostrar ocultas"; a lista ({n}) não a inclui.
    expect(ex.byReason).toEqual({ hidden: 1, future: 0, transfer: 3, investments: 0, out: 2, reimb: 0, manualOut: 2 });
    const exAll = await repo.sums({ from: '2026-11-01', to: '2026-11-30', today: '2026-11-19', showHidden: true });
    expect(exAll.byReason).toEqual({ hidden: 1, future: 0, transfer: 3, investments: 0, out: 2, reimb: 0, manualOut: 2 });
    const s = await repo.monthSummary('2026-11', '2026-11-19');
    expect([ex.entradas, -ex.saidas]).toEqual([s.receitas, s.despesas]); // RF-008.1
    expect(s.outOfSummary).toEqual({ saidas: 70, entradas: 5000, count: 2, reimbursements: 0 });
    const only = await repo.sums({ from: '2026-11-01', to: '2026-11-30', today: '2026-11-19', only: 'out' });
    expect(only.count).toBe(3); // 'das', 'sal' e 'mesmo' (marcados, sem as ocultas)
    // UX 0.16 (C2-07): no Extrato filtrado, a contagem e a soma dos marcados são as mesmas da linha do Resumo.
    expect({ ...only.out, reimbursements: 0 }).toEqual(s.outOfSummary);
    const onlyAll = await repo.sums({ from: '2026-11-01', to: '2026-11-30', today: '2026-11-19', only: 'out', showHidden: true });
    expect({ ...onlyAll.out, reimbursements: 0 }).toEqual(s.outOfSummary); // a oculta marcada conta como oculta, não como fora do Resumo (N-1)
    // N-3: a marca não desfaz par de transferência
    expect((await repo.getTransaction('mesmo'))?.transfer).toBe(1);
  });
  test('RNF-007 (UX-090): só tipo e número do documento; nenhum nome; somem com a conexão e com "Apagar tudo"', async () => {
    const { db, repo } = await setup();
    const row = await db.getFirstAsync<Record<string, unknown>>("SELECT * FROM transactions WHERE id = 'sal'");
    expect(row).toMatchObject({ payer_doc_type: 'CNPJ', payer_doc: '12345678000190', receiver_doc_type: 'CPF', receiver_doc: '11122233344' });
    const all = JSON.stringify(await db.getAllAsync('SELECT * FROM transactions'));
    expect(all).not.toMatch(/Pessoa Exemplo|Empresa Exemplo|SECRETARIA DA FAZENDA/);
    await repo.deleteConnectionData('c1');
    expect((await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE payer_doc IS NOT NULL OR receiver_doc IS NOT NULL'))?.n).toBe(0);
    await wipeAll(db);
  });
});

describe('R-2.1 (requisitos v1.20): pagamento de fatura', () => {
  async function setupBills(withPair: boolean) {
    const db = createNodeDb(); await migrate(db); const repo = createRepo(db);
    await repo.addConnection('c1', '2026-11-01T10:00:00Z');
    await db.runAsync(`INSERT INTO accounts (id, item_id, type, name, balance, updated_at) VALUES ('cc','c1','BANK','Conta',0,'x'),('k','c1','CREDIT','Cartão',0,'x')`);
    const ins = (id: string, acc: string, day: string, amount: number, cat: string | null, op: string | null, auto: string | null) =>
      db.runAsync(`INSERT INTO transactions (id, account_id, date, date_key, description, search_text, amount, pluggy_category_id, operation_type, auto_category, manual, updated_at)
        VALUES (?, ?, ?, ?, 'x', 'x', ?, ?, ?, ?, 0, 'x')`, [id, acc, `2026-11-${day}T15:00:00Z`, `2026-11-${day}`, amount, cat, op, auto]);
    await ins('compra', 'k', '02', -800, '10000000', 'PAGAMENTO', 'mercado');
    await ins('recebido', 'k', '10', 800, '05100000', 'PAGAMENTO_FATURA', null); // "Pagamento recebido" no cartão
    if (withPair) await ins('saida', 'cc', '10', -800, '05000000', 'OUTROS', null); // saída na conta, mesmo valor
    await ins('estorno', 'k', '11', 50, '05000000', 'PAGAMENTO', null); // estorno no cartão: assunto do PM, não é fatura
    await repo.recomputeTransfers();
    return { db, repo };
  }
  test('com par: sem aviso; o crédito no cartão e a saída na conta ficam fora; a compra conta uma vez', async () => {
    const { repo } = await setupBills(true);
    const s = await repo.monthSummary('2026-11', '2026-11-19');
    expect(s.unpairedBills).toBe(0);
    expect(s.despesas).toBe(750); // RF-008.10 (v1.22): o estorno de 50 no cartão reduz a despesa
    expect(s.receitas).toBe(0); // e não é receita
  });
  test('sem par: aviso com a contagem; o "Pagamento recebido" NÃO entra em receitas; filtro do Extrato acha o lançamento', async () => {
    const { repo } = await setupBills(false);
    const s = await repo.monthSummary('2026-11', '2026-11-19');
    expect(s.unpairedBills).toBe(1);
    expect(s.receitas).toBe(0); // nem o "Pagamento recebido" nem o estorno (RF-008.10) são receita
    expect((await repo.listTransactions({ only: 'bill' })).map((t) => t.id)).toEqual(['recebido']);
    await repo.setTransferOverride('recebido', true); // marcado à mão: sai do aviso
    expect((await repo.monthSummary('2026-11', '2026-11-19')).unpairedBills).toBe(0);
  });
  test('R-8.1 só na conta: crédito 05… no cartão não vira "Receitas" por categoria', async () => {
    const { repo } = await setup();
    expect((await repo.getTransaction('sal'))?.category).toBe('receitas'); // conta: vira
  });
});

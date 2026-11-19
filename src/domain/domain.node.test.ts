import {
  maskDateInput, parseDateBR,
  amountA11y, formatBalance, formatDayHeader, formatMonth, formatSignedAmount, formatUpdated, normalizeSearch, spDateKey,
} from './format';
import { CATEGORIES, categoryById, mapPluggyCategory } from './categories';
import { detectTransfers } from './transfers';
import { connectionStatusView } from './connectionStatus';
import { cleanPasted, clientIdHint, connectionLimitState, maskedClientId } from './credentials';

describe('RNF-004 formatos (UX §3.1, UX-035)', () => {
  test('entrada, saída e saldo com sinal de menos real e espaço sem quebra', () => {
    expect(formatSignedAmount(1234.56)).toBe('+R$ 1.234,56');
    expect(formatSignedAmount(-89.9)).toBe('−R$ 89,90');
    expect(formatBalance(-120)).toBe('−R$ 120,00');
    expect(formatBalance(1234567.891)).toBe('R$ 1.234.567,89');
    expect(formatBalance(0)).toBe('R$ 0,00');
    // UX v0.5 (REV-18): zero sem sinal
    expect(formatSignedAmount(0)).toBe('R$ 0,00');
    expect(formatSignedAmount(-0.001)).toBe('R$ 0,00');
    expect(amountA11y(0)).toBe('zero reais');
  });
  test('nome lido pelo leitor de tela', () => {
    expect(amountA11y(-89.9)).toBe('Saída de 89,90 reais');
    expect(amountA11y(1234.56)).toBe('Entrada de 1.234,56 reais');
  });
  test('última atualização em America/Sao_Paulo', () => {
    const now = new Date('2026-11-17T20:00:00Z'); // 17:00 em SP
    expect(formatUpdated(new Date('2026-11-17T17:32:00Z'), now)).toBe('Atualizado hoje às 14:32');
    expect(formatUpdated(new Date('2026-11-16T12:10:00Z'), now)).toBe('Atualizado ontem às 09:10');
    expect(formatUpdated(new Date('2026-11-12T12:10:00Z'), now)).toBe('Atualizado em 12/11/2026 às 09:10');
  });
  test('virada do dia respeita o fuso de SP (02:30 UTC ainda é ontem em SP)', () => {
    expect(spDateKey(new Date('2026-11-18T02:30:00Z'))).toBe('2026-11-17');
  });
  test('cabeçalho do dia e mês por extenso', () => {
    const now = new Date('2026-11-17T15:00:00Z');
    expect(formatDayHeader('2026-11-17', now)).toBe('Hoje');
    expect(formatDayHeader('2026-11-16', now)).toBe('Ontem');
    expect(formatDayHeader('2026-11-13', now)).toBe('sex., 13/11/2026');
    expect(formatMonth(2026, 11)).toBe('novembro de 2026');
  });
  test('UX-025: busca ignora maiúsculas e acentos', () => {
    expect(normalizeSearch('  FARMÁCIA São João ')).toBe('farmacia sao joao');
  });
});

describe('RF-006.1 categorias (UX v0.3 §7.3, DEV-10)', () => {
  test('lista tem as 11 categorias + Rendimentos (UX 0.7) + Investimentos; "Sem categoria" é o padrão', () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual([
      'Moradia e contas', 'Mercado', 'Restaurantes e delivery', 'Transporte', 'Saúde', 'Lazer e viagem',
      'Compras', 'Assinaturas', 'Impostos e taxas', 'Receitas', 'Outros',
      'Rendimentos', 'Investimentos',
    ]);
    expect(categoryById(null).name).toBe('Sem categoria');
  });
  test('mapeamento do Pluggy', () => {
    expect(mapPluggyCategory('10000000')).toBe('mercado');
    expect(mapPluggyCategory('11020000')).toBe('restaurantes');
    expect(mapPluggyCategory('18020000')).toBe('saude');
    expect(mapPluggyCategory('19050001')).toBe('transporte');
    expect(mapPluggyCategory('19050006')).toBe('impostos');
    expect(mapPluggyCategory('07010001')).toBe('moradia');
    expect(mapPluggyCategory('09020000')).toBe('assinaturas');
    expect(mapPluggyCategory('01010000')).toBe('receitas');
    expect(mapPluggyCategory('03020000')).toBe('investimentos');
    expect(mapPluggyCategory('200300000')).toBe('saude');
    expect(mapPluggyCategory('99999999')).toBe('outros');
    expect(mapPluggyCategory('05100000')).toBeNull();
    expect(mapPluggyCategory('04020000')).toBeNull();
    expect(mapPluggyCategory(null)).toBeNull();
    expect(mapPluggyCategory('77000000')).toBeNull();
  });
});

describe('PM-8 transferências entre contas próprias (RF-008.2, UX-040)', () => {
  test('saída e entrada de mesmo valor em contas diferentes até 2 dias formam par', () => {
    const r = detectTransfers([
      { id: 'a', accountId: 'c1', date: '2026-11-10', amount: -500 },
      { id: 'b', accountId: 'c2', date: '2026-11-12', amount: 500 },
      { id: 'c', accountId: 'c1', date: '2026-11-10', amount: -80 },
      { id: 'd', accountId: 'c2', date: '2026-11-14', amount: 80 }, // 4 dias: não
      { id: 'e', accountId: 'c1', date: '2026-11-10', amount: 30 }, // mesma conta: não
      { id: 'f', accountId: 'c1', date: '2026-11-10', amount: -30 },
    ]);
    expect([...r].sort()).toEqual(['a', 'b']);
  });
  test('cada transação entra em um único par; escolhe a mais próxima', () => {
    const r = detectTransfers([
      { id: 'out', accountId: 'c1', date: '2026-11-10', amount: -100 },
      { id: 'in-far', accountId: 'c2', date: '2026-11-12', amount: 100 },
      { id: 'in-near', accountId: 'c3', date: '2026-11-10', amount: 100 },
    ]);
    expect([...r].sort()).toEqual(['in-near', 'out']);
  });
});

describe('Tabela 7.1 estado da conexão', () => {
  const base = { executionStatus: null, errorCode: null, originUpdatedAt: new Date('2026-11-16T11:05:00Z') };
  test('UPDATED, UPDATING e indisponível com data', () => {
    expect(connectionStatusView({ ...base, status: 'UPDATED' }).label).toBe('Atualizada');
    expect(connectionStatusView({ ...base, status: 'UPDATING' }).label).toBe('Atualizando…');
    const v = connectionStatusView({ ...base, status: 'OUTDATED', errorCode: 'SITE_NOT_AVAILABLE' });
    expect(v.label).toBe('Instituição indisponível. Dados de 16/11/2026 às 08:05.');
    expect(v.stale).toBe(true);
  });
  test('pendente, atenção, parcial e bloqueada', () => {
    expect(connectionStatusView({ ...base, status: 'LOGIN_ERROR', errorCode: 'USER_AUTHORIZATION_PENDING' }).label).toBe('Aguardando autorização no banco');
    expect(connectionStatusView({ ...base, status: 'LOGIN_ERROR', errorCode: 'INVALID_CREDENTIALS' }).needsAttention).toBe(true);
    expect(connectionStatusView({ ...base, status: 'UPDATED', executionStatus: 'PARTIAL_SUCCESS' }).label).toBe('Atualizada em parte');
    expect(connectionStatusView({ ...base, status: 'LOGIN_ERROR', errorCode: 'ACCOUNT_LOCKED' }).action).toBe('reconnect');
  });
  test('nenhum código técnico vira texto principal', () => {
    const v = connectionStatusView({ ...base, status: 'WEIRD', errorCode: 'XYZ_CODE' });
    expect(v.label).not.toMatch(/XYZ|WEIRD/);
  });
});

describe('RF-000 credenciais (T-06/T-07, UX-008, UX-010)', () => {
  test('limpa espaços e quebras de linha nas pontas', () => {
    expect(cleanPasted('  \n abc-123 \t\n')).toBe('abc-123');
  });
  test('dicas de formato', () => {
    expect(clientIdHint('pluggy_sk_xxx')).toBe('Este parece ser o Client Secret. Cole no campo de baixo.');
    expect(clientIdHint('nao-e-uuid')).toBe('Este código não parece um Client ID. Confira se copiou o campo certo.');
    expect(clientIdHint('3fa85f64-5717-4562-b3fc-2c963f66afa6')).toBeNull();
  });
  test('Client ID só com os 4 últimos caracteres', () => {
    expect(maskedClientId('3fa85f64-5717-4562-b3fc-2c963f66a3f9')).toBe('termina em a3f9');
  });
  test('PM-4 contador de conexões', () => {
    expect(connectionLimitState(3)).toBe('ok');
    expect(connectionLimitState(4)).toBe('last');
    expect(connectionLimitState(5)).toBe('full');
  });
});

describe('T-14 datas por digitação (UX v0.4)', () => {
  test('barras inseridas sozinhas e só dígitos', () => {
    expect(maskDateInput('1')).toBe('1');
    expect(maskDateInput('171')).toBe('17/1');
    expect(maskDateInput('17112026')).toBe('17/11/2026');
    expect(maskDateInput('17/11/20269')).toBe('17/11/2026');
    expect(maskDateInput('ab17-11')).toBe('17/11');
  });
  test('data inexistente é recusada', () => {
    expect(parseDateBR('17/11/2026')).toBe('2026-11-17');
    expect(parseDateBR('31/02/2026')).toBeNull();
    expect(parseDateBR('29/02/2024')).toBe('2024-02-29');
    expect(parseDateBR('1/11/2026')).toBeNull();
  });
});

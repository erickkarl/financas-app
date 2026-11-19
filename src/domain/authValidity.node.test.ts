import { authMessage, authStatusShort, authValidity } from './authValidity';

// 2026-11-18 12:00 em São Paulo
const now = new Date('2026-11-18T15:00:00Z');
describe('RF-002.3.1/.2 validade da autorização (UX-070, UX-071, UX-072)', () => {
  test('sem data: desconhecida', () => {
    expect(authValidity(null, now)).toEqual({ state: 'unknown' });
  });
  test('mais de 30 dias: só a data', () => {
    expect(authValidity('2027-11-18T18:38:58Z', now)).toEqual({ state: 'ok', date: '18/11/2027' });
  });
  test('30, 1 e 0 dias', () => {
    const v30 = authValidity('2026-12-18T18:00:00Z', now);
    expect(v30).toEqual({ state: 'soon', date: '18/12/2026', days: 30 });
    expect(authMessage(v30)).toBe('A autorização desta conexão vence em 30 dias, em 18/12/2026.');
    expect(authMessage(authValidity('2026-11-19T18:00:00Z', now))).toBe('A autorização desta conexão vence amanhã.');
    expect(authMessage(authValidity('2026-11-18T23:00:00Z', now))).toBe('A autorização desta conexão vence hoje.');
    expect(authStatusShort(v30)).toBe('Autorização vence em 30 dias');
  });
  test('31 dias: ainda sem aviso', () => {
    expect(authValidity('2026-12-19T18:00:00Z', now).state).toBe('ok');
  });
  test('vencida', () => {
    const v = authValidity('2026-11-18T10:00:00Z', now);
    expect(v).toEqual({ state: 'expired', date: '18/11/2026' });
    expect(authMessage(v)).toBe('A autorização desta conexão venceu em 18/11/2026. O app não consegue mais ler os dados desta conexão.');
    expect(authStatusShort(v)).toBe('Autorização vencida em 18/11/2026');
  });
});

import { accountTypeLabel, formatCount, formatWhen } from './format';

describe('ux.md 0.10: REV-31, REV-34, REV-30', () => {
  test('REV-31 milhar com ponto', () => {
    expect(formatCount(1919)).toBe('1.919');
    expect(formatCount(5)).toBe('5');
    expect(formatCount(1234567)).toBe('1.234.567');
  });
  test('REV-34 "hoje às" no mesmo dia, "ontem às", data e hora depois', () => {
    const now = new Date('2026-11-18T20:30:00Z'); // 17:30 em SP
    expect(formatWhen(new Date('2026-11-18T20:21:00Z'), now)).toBe('hoje às 17:21');
    expect(formatWhen(new Date('2026-11-17T12:10:00Z'), now)).toBe('ontem às 09:10');
    expect(formatWhen(new Date('2026-11-16T11:05:00Z'), now)).toBe('16/11/2026 às 08:05');
  });
  test('REV-30 tipo da conta informado pelo Pluggy', () => {
    expect(accountTypeLabel('CHECKING_ACCOUNT')).toBe('Conta corrente');
    expect(accountTypeLabel('SAVINGS_ACCOUNT')).toBe('Conta poupança');
    expect(accountTypeLabel(null)).toBe('Conta');
  });
});

// RF-017.7, .8, .8.1, .12 (requisitos v1.28) / T-23 "Saldo em contas" (ux.md 0.20). Dados de exemplo.
import { buildSaldoHistory, measuredRate, monthEnd, type SaldoConn } from './saldoHistory';

const tx = (date: string, amount: number, isYield = false) => ({ date, dateKey: date.slice(0, 10), amount, isYield });

// Conta A: rende sem lançamento (o rendimento só aparece no saldo). Conectada em 10/11/2026 (saldo 1000); dois dias depois, 1002 sem transação.
const contaA = (): SaldoConn => ({
  id: 'nu', name: 'Banco A', currentBalance: 1002, yieldOnlyInBalance: true,
  points: [{ dataAt: '2026-11-10T15:00:00Z', balance: 1000 }, { dataAt: '2026-11-12T15:00:00Z', balance: 1002 }],
  txs: [tx('2026-09-15T15:00:00Z', -50), tx('2026-10-20T15:00:00Z', 200), tx('2026-11-05T15:00:00Z', 100)],
});
// Conta B: o rendimento vem como lançamento.
const contaB = (): SaldoConn => ({
  id: 'in', name: 'Banco B', currentBalance: 500, yieldOnlyInBalance: false,
  points: [{ dataAt: '2026-11-10T15:00:00Z', balance: 500 }, { dataAt: '2026-11-12T15:00:00Z', balance: 500 }],
  txs: [tx('2026-09-30T15:00:00Z', 3, true), tx('2026-10-31T15:00:00Z', 4, true), tx('2026-11-01T15:00:00Z', 5, true)],
});

describe('RF-017.7: Saldo em contas real e estimado', () => {
  test('taxa medida no que as transações não explicam', () => {
    const { rate } = measuredRate(contaA().points, contaA().txs);
    expect(rate).toBeCloseTo(2 / (1000 * 2), 6); // 0,1% ao dia
  });
  test('real desde o mês da conexão; estimado antes, partindo do primeiro saldo real, desfazendo transações e rendimento', () => {
    const h = buildSaldoHistory([contaA()], [], '2026-11-12');
    expect(h.months.map((m) => [m.month, m.estimated])).toEqual([['2026-09', true], ['2026-10', true], ['2026-11', false]]);
    const nov = h.months[2]; const oct = h.months[1];
    expect(nov.value).toBe(1002); // mês atual = saldo de hoje (igual ao Início)
    const rate = 0.001; const days = (new Date('2026-11-10T15:00:00Z').getTime() - monthEnd('2026-10')) / 86400e3;
    expect(oct.value).toBeCloseTo((1000 - 100) / (1 + rate * days), 2);
    expect(oct.value).toBeLessThan(900); // o rendimento estimado é descontado (sem ele, 900)
    // Rendimento de novembro: parte medida (real) e parte antes da conexão (estimada) — E-16 (a)
    expect(nov.yieldReal).toBeCloseTo(2, 2);
    expect(nov.yieldEst).toBeGreaterThan(0);
    expect(oct.yieldReal).toBe(0);
    expect(oct.yieldEst).toBeGreaterThan(0);
  });
  test('conta que traz o rendimento como lançamento: sem taxa; o rendimento é real e está nas transações', () => {
    const h = buildSaldoHistory([contaB()], [], '2026-11-12');
    const by = Object.fromEntries(h.months.map((m) => [m.month, m]));
    expect(by['2026-10'].value).toBe(495); // 500 − 5 (rendimento de novembro)
    expect(by['2026-09'].value).toBe(491); // − 4
    expect(by['2026-10'].yieldReal).toBe(4);
    expect(by['2026-10'].yieldEst).toBe(0);
    expect(by['2026-11'].yieldReal).toBe(5);
  });
  test('soma as contas e o "Dinheiro"; o mês só é real com todas as contas conectadas (N-16)', () => {
    const late = contaB(); late.points = [{ dataAt: '2026-11-11T15:00:00Z', balance: 500 }];
    const h = buildSaldoHistory([contaA(), late], [{ dateKey: '2026-10-01', amount: 30 }], '2026-11-12');
    const nov = h.months.find((m) => m.month === '2026-11')!;
    expect(nov.value).toBe(1002 + 500 + 30);
    expect(nov.estimated).toBe(false);
    expect(h.months.find((m) => m.month === '2026-10')!.estimated).toBe(true);
  });
  test('mês real sem saldo guardado fica sem ponto (N-16)', () => {
    const c = contaA();
    c.points = [{ dataAt: '2026-09-10T15:00:00Z', balance: 900 }, { dataAt: '2026-11-12T15:00:00Z', balance: 1100 }];
    c.currentBalance = 1100;
    const h = buildSaldoHistory([c], [], '2026-11-12');
    expect(h.months.map((m) => m.month)).toEqual(['2026-09', '2026-11']); // outubro: sem saldo guardado
  });
  test('RF-017.8.1: não estima antes do primeiro mês com transações', () => {
    const h = buildSaldoHistory([contaA()], [], '2026-11-12');
    expect(h.months[0].month).toBe('2026-09');
  });
  test('RF-017.7.4 (N-15): aviso de taxa pouco medida com menos de 14 dias, só para a conta que usa taxa', () => {
    const h = buildSaldoHistory([contaA(), contaB()], [], '2026-11-12');
    expect(h.fewDays).toEqual([{ name: 'Banco A', days: 2 }]);
    const long = contaA(); long.points = [{ dataAt: '2026-10-01T15:00:00Z', balance: 900 }, { dataAt: '2026-11-12T15:00:00Z', balance: 1002 }];
    expect(buildSaldoHistory([long], [], '2026-11-12').fewDays).toEqual([]);
  });
  test('sem saldo guardado: nada', () => {
    const c = contaA(); c.points = [];
    expect(buildSaldoHistory([c], [], '2026-11-12').months).toEqual([]);
  });
});

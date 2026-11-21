// RF-017.7, RF-017.8, RF-017.8.1 e RF-017.12 (requisitos v1.28) / T-23 "Saldo em contas" (ux.md 0.20).
// Real desde a conexão (último saldo guardado no mês); estimado antes, partindo do PRIMEIRO saldo real da conta (o
// passado não muda a cada dia) e desfazendo as transações das contas. Nas contas em que o rendimento automático não vira
// transação (V-10), desconta também um rendimento estimado por uma taxa medida nos próprios saldos reais
// (variação do saldo que as transações não explicam), recalculada a cada atualização. Cartão e futuras ficam fora.

export type SaldoPoint = { dataAt: string; balance: number };
export type SaldoTx = { date: string; dateKey: string; amount: number; isYield: boolean };
export type SaldoConn = {
  id: string;
  name: string;
  /** Saldo de hoje das contas bancárias da conexão (o mesmo do Início). */
  currentBalance: number;
  /** Rendimento automático sem lançamento (campo preenchido e nenhum lançamento de rendimento). */
  yieldOnlyInBalance: boolean;
  /** Saldos reais guardados (um por dia, RF-016.4), com a hora do dado na origem. */
  points: SaldoPoint[];
  /** Transações reais das contas bancárias da conexão (todas: transferências, aplicações, ocultas, fora do Resumo). */
  txs: SaldoTx[];
};
export type SaldoMonth = {
  month: string;
  value: number;
  estimated: boolean;
  /** Rendimento do mês: parte real (lançamentos do banco e medida nos saldos reais) e parte estimada (pela taxa). */
  yieldReal: number;
  yieldEst: number;
};
export type SaldoHistory = {
  months: SaldoMonth[];
  /** Primeiro mês real (todas as contas com saldo guardado). */
  realStart: string | null;
  /** Data da conexão mais recente (a partir dela tudo é real). */
  connectedSince: string | null;
  /** RF-017.7.4 (N-15): contas com menos de 14 dias corridos de saldo real. */
  fewDays: { name: string; days: number }[];
  yieldOnlyInBalance: string[];
  yieldAsTx: string[];
};

export const MIN_RATE_DAYS = 14;
const DAY = 86400e3;
const r2 = (v: number) => Math.round(v * 100) / 100;
const spDate = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(0, 10);
/** Fim do mês "AAAA-MM" em São Paulo, como instante. */
export function monthEnd(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return Date.UTC(y, m, 1, 3) - 1000;
}
const monthOfTime = (t: number) => spDate(new Date(t).toISOString()).slice(0, 7);
const prevMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const nextMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

/** Taxa diária medida: soma do que as transações não explicam ÷ soma de (saldo × dias), entre saldos reais seguidos. */
export function measuredRate(points: SaldoPoint[], txs: SaldoTx[]): { rate: number; residuals: { at: number; value: number }[] } {
  const ps = [...points].sort((a, b) => a.dataAt.localeCompare(b.dataAt));
  let num = 0; let den = 0; const residuals: { at: number; value: number }[] = [];
  for (let i = 1; i < ps.length; i++) {
    const a = new Date(ps[i - 1].dataAt).getTime(); const b = new Date(ps[i].dataAt).getTime();
    if (b <= a) continue;
    const moved = txs.filter((t) => { const x = new Date(t.date).getTime(); return x > a && x <= b; }).reduce((s, t) => s + t.amount, 0);
    const res = ps[i].balance - ps[i - 1].balance - moved;
    residuals.push({ at: b, value: res });
    num += res; den += ps[i - 1].balance * ((b - a) / DAY);
  }
  return { rate: den > 0 ? num / den : 0, residuals };
}

export function buildSaldoHistory(conns: SaldoConn[], manual: { dateKey: string; amount: number }[], today: string): SaldoHistory {
  const current = today.slice(0, 7);
  const usable = conns.filter((c) => c.points.length > 0);
  const empty: SaldoHistory = { months: [], realStart: null, connectedSince: null, fewDays: [], yieldOnlyInBalance: [], yieldAsTx: [] };
  if (usable.length === 0) return empty;
  const realTxs = (c: SaldoConn) => c.txs.filter((t) => t.dateKey <= today);
  // RF-017.8.1: a estimativa vai até o fim do primeiro mês com transações completas depois dele em todas as contas.
  const firstTxMonths = usable.map((c) => realTxs(c).map((t) => t.dateKey).sort()[0]?.slice(0, 7)).filter(Boolean) as string[];
  const firstPointMonth = (c: SaldoConn) => monthOfTime(new Date([...c.points].sort((a, b) => a.dataAt.localeCompare(b.dataAt))[0].dataAt).getTime());
  const connMonths = usable.map(firstPointMonth);
  const realStart = connMonths.sort()[connMonths.length - 1];
  const earliest = firstTxMonths.length ? firstTxMonths.sort()[firstTxMonths.length - 1] : realStart;
  const start = earliest < realStart ? earliest : realStart;
  const months: string[] = [];
  for (let m = start; m <= current; m = nextMonth(m)) months.push(m);

  // Por conexão: valor do fim de cada mês, real ou estimado, e o rendimento do mês.
  type Cell = { value: number | null; estimated: boolean; yReal: number; yEst: number };
  const perConn = usable.map((c) => {
    const pts = [...c.points].sort((a, b) => a.dataAt.localeCompare(b.dataAt));
    const t0 = new Date(pts[0].dataAt).getTime();
    const m0 = monthOfTime(t0);
    const { rate: measured, residuals } = measuredRate(pts, c.txs);
    const rate = c.yieldOnlyInBalance ? measured : 0;
    const txs = realTxs(c);
    const cells = new Map<string, Cell>();
    // Meses reais: último saldo guardado no mês; no mês atual, o saldo de hoje. Sem saldo guardado: sem ponto (N-16).
    for (const m of months.filter((x) => x >= m0)) {
      const inMonth = pts.filter((p) => monthOfTime(new Date(p.dataAt).getTime()) === m);
      const value = m === current ? c.currentBalance : inMonth.length ? inMonth[inMonth.length - 1].balance : null;
      const yTx = txs.filter((t) => t.isYield && t.dateKey.slice(0, 7) === m).reduce((s, t) => s + t.amount, 0);
      const yMeasured = c.yieldOnlyInBalance ? residuals.filter((r) => monthOfTime(r.at) === m).reduce((s, r) => s + r.value, 0) : 0;
      cells.set(m, { value, estimated: false, yReal: yTx + yMeasured, yEst: 0 });
    }
    // Para trás, a partir do primeiro saldo real: desfaz as transações e o rendimento estimado, um mês por vez. O
    // primeiro trecho é o do mês da conexão antes do primeiro saldo real (parte estimada do rendimento desse mês).
    let B = pts[0].balance; let tEnd = t0;
    for (let m = m0; m >= start; m = prevMonth(m)) {
      const tStart = monthEnd(prevMonth(m));
      const segTx = txs.filter((t) => { const x = new Date(t.date).getTime(); return x > tStart && x <= tEnd; }).reduce((s2, t) => s2 + t.amount, 0);
      const days = (tEnd - tStart) / DAY;
      const before = (B - segTx) / (1 + rate * days);
      const cell = cells.get(m);
      if (cell) cell.yEst = B - segTx - before;
      const pm = prevMonth(m);
      if (pm >= start) {
        const yTx = txs.filter((t) => t.isYield && t.dateKey.slice(0, 7) === pm).reduce((s2, t) => s2 + t.amount, 0);
        cells.set(pm, { value: before, estimated: true, yReal: yTx, yEst: 0 });
      }
      B = before; tEnd = tStart;
    }
    const days = (new Date(pts[pts.length - 1].dataAt).getTime() - t0) / DAY;
    return { c, cells, days };
  });

  // Dinheiro (RF-007): saldo exato no fim de cada mês; não rende.
  const manualAt = (m: string) => manual.filter((t) => t.dateKey <= (m === current ? today : `${m}-31`)).reduce((s, t) => s + t.amount, 0);

  const out: SaldoMonth[] = [];
  for (const m of months) {
    const cells = perConn.map((p) => p.cells.get(m));
    if (cells.some((x) => !x || x.value === null)) continue; // mês real sem saldo guardado em alguma conta: sem ponto
    const value = cells.reduce((s, x) => s + (x!.value as number), 0) + manualAt(m);
    out.push({
      month: m,
      value: r2(value),
      estimated: cells.some((x) => x!.estimated),
      yieldReal: r2(cells.reduce((s, x) => s + x!.yReal, 0)),
      yieldEst: r2(cells.reduce((s, x) => s + x!.yEst, 0)),
    });
  }
  const latestConn = usable.map((c) => [...c.points].sort((a, b) => a.dataAt.localeCompare(b.dataAt))[0].dataAt).sort().pop() ?? null;
  return {
    months: out,
    realStart,
    connectedSince: latestConn ? spDate(latestConn) : null,
    fewDays: perConn.filter((p) => p.c.yieldOnlyInBalance && p.days < MIN_RATE_DAYS).map((p) => ({ name: p.c.name, days: Math.max(0, Math.floor(p.days)) })),
    yieldOnlyInBalance: usable.filter((c) => c.yieldOnlyInBalance).map((c) => c.name),
    yieldAsTx: usable.filter((c) => !c.yieldOnlyInBalance).map((c) => c.name),
  };
}

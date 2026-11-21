// RF-017 (requisitos v1.25) / T-23 (ux.md 0.19): visão por mês na aba Resumo.

export type Criterio = 'gasto' | 'receita' | 'economia' | 'patrimonio' | 'saldo';
export type Periodo = 6 | 12 | 'tudo';

export const CRITERIOS: { id: Criterio; label: string; titulo: string }[] = [
  { id: 'gasto', label: 'Gasto', titulo: 'Gasto por mês' },
  { id: 'receita', label: 'Receita', titulo: 'Receita por mês' },
  { id: 'economia', label: 'Economia', titulo: 'Economia por mês (receita − gasto)' },
  { id: 'patrimonio', label: 'Patrimônio', titulo: 'Patrimônio no fim de cada mês' },
  { id: 'saldo', label: 'Saldo em contas', titulo: 'Saldo em contas no fim de cada mês' },
];

/** "AAAA-MM" somando n meses. */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Meses de `from` a `to`, inclusive, do mais antigo para o mais recente. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** RF-017.2: o período termina no mês atual; "Tudo" = todos os meses com dado. */
export function applyPeriod<T extends { month: string }>(rows: T[], periodo: Periodo, current: string): T[] {
  if (periodo === 'tudo') return rows;
  const start = shiftMonth(current, -(periodo - 1));
  return rows.filter((r) => r.month >= start && r.month <= current);
}

/** N-11: o primeiro mês do histórico é parcial quando a primeira transação não é do dia 1. */
export function partialFirstMonth(firstDateKey: string | null): { month: string; since: string } | null {
  if (!firstDateKey || firstDateKey.endsWith('-01')) return null;
  return { month: firstDateKey.slice(0, 7), since: firstDateKey };
}

/** RF-017.6: Patrimônio no fim de cada mês = o último ponto guardado naquele mês (só meses com ponto). */
export function patrimonioByMonth(points: { date: string; total: number }[]): { month: string; value: number; date: string }[] {
  const by = new Map<string, { date: string; total: number }>();
  for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) by.set(p.date.slice(0, 7), p);
  return [...by.entries()].sort().map(([month, p]) => ({ month, value: p.total, date: p.date }));
}


const ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** Eixo do gráfico: "nov", com o ano quando ele muda ("jan/27"). */
export function monthTick(month: string, prev: string | undefined): string {
  const [y, m] = month.split('-');
  const label = ABBR[Number(m) - 1];
  return !prev || prev.slice(0, 4) !== y ? `${label}/${y.slice(2)}` : label;
}

/** Largura estimada de um rótulo do eixo em dp (labelSmall: 11 sp com espaçamento), com folga. */
// labelSmall (11 sp, peso médio, espaçamento 0,5): larguras aproximadas por letra, com folga.
const CHAR_W: Record<string, number> = { m: 9.5, w: 8.5, '/': 4, j: 3.5, i: 3.5, l: 3.5, t: 4, f: 4, r: 4.5 };
const tickWidth = (text: string, scale: number) => Math.ceil([...text].reduce((s, c) => s + (CHAR_W[c] ?? 6.5) + 0.5, 0) * scale) + 2;

/**
 * C3-15: escolhe os meses com rótulo, do mais recente para o mais antigo, sem que dois rótulos se toquem (folga de 8 dp).
 * O ano aparece em janeiro e no primeiro rótulo mostrado.
 */
export function axisTicks(months: string[], slot: number, scale: number): { i: number; text: string; w: number }[] {
  if (!slot || months.length === 0) return [];
  const GAP = 8;
  const label = (i: number, first: boolean) => monthTick(months[i], first || months[i].endsWith('-01') ? undefined : months[i]);
  const out: { i: number; text: string; w: number }[] = [];
  const inner = slot * months.length;
  // Mesma posição que o gráfico usa: centrado no mês, sem passar das bordas.
  const leftOf = (i: number, w: number) => Math.min(Math.max(0, i * slot + slot / 2 - w / 2), Math.max(0, inner - w));
  let leftEdge = Infinity;
  for (let i = months.length - 1; i >= 0; i--) {
    const text = label(i, false);
    const w = tickWidth(text, scale);
    if (leftOf(i, w) + w + GAP > leftEdge) continue;
    out.unshift({ i, text, w });
    leftEdge = leftOf(i, w);
  }
  // O primeiro rótulo leva o ano; se assim ele encostar no seguinte, o seguinte sai (o mais recente nunca sai).
  if (out.length) {
    const f = out[0];
    const text = label(f.i, true);
    const w = tickWidth(text, scale);
    const right = leftOf(f.i, w) + w;
    while (out.length > 2 && right + GAP > leftOf(out[1].i, out[1].w)) out.splice(1, 1);
    if (out.length === 2 && right + GAP > leftOf(out[1].i, out[1].w)) out.shift();
    else out[0] = { i: f.i, text, w };
    if (out.length && !/\//.test(out[0].text)) { const t0 = label(out[0].i, true); out[0] = { i: out[0].i, text: t0, w: tickWidth(t0, scale) }; }
  }
  return out;
}

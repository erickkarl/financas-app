// Formatos pt-BR / BRL da UX §3.1 (RNF-004). Implementação própria, sem depender de Intl/fuso do aparelho.
// America/Sao_Paulo não tem horário de verão desde 2019: deslocamento fixo de -3 h.

export const NBSP = ' ';
export const MINUS = '−';
const SP_OFFSET_MS = -3 * 60 * 60 * 1000;

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const WEEKDAYS_SHORT = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

// Só para capturas de evidência no build de desenvolvimento: esconde valores reais ("•••").
let maskValues = false;
export function setMaskValues(v: boolean) {
  maskValues = v;
}
export function isMaskingValues() {
  return maskValues;
}

/** Captura mascarada: troca a descrição real por "Compra", mantendo a parcela ("4/4"). */
export function displayDescription(desc: string): string {
  if (!maskValues) return desc;
  const inst = /\b(\d{1,2}\/\d{1,2})\s*$/.exec(desc);
  return inst ? `Compra ${inst[1]}` : 'Compra';
}

/** "1.234,56" a partir do valor absoluto. */
export function formatNumberBR(value: number): string {
  if (maskValues) return '•••,••';
  const cents = Math.round(Math.abs(value) * 100);
  const intPart = Math.floor(cents / 100).toString();
  const dec = (cents % 100).toString().padStart(2, '0');
  const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withDots},${dec}`;
}

/** Saldo: "R$ 1.234,56" ou "−R$ 120,00". */
export function formatBalance(value: number): string {
  const sign = Math.round(value * 100) < 0 ? MINUS : '';
  return `${sign}R$${NBSP}${formatNumberBR(value)}`;
}

/** Valor de transação: entrada "+R$ 1.234,56", saída "−R$ 89,90". */
export function formatSignedAmount(value: number): string {
  const cents = Math.round(value * 100);
  // UX v0.5, tabela 3.1: zero aparece como "R$ 0,00", sem sinal.
  if (cents === 0) return `R$${NBSP}0,00`;
  const sign = cents < 0 ? MINUS : '+';
  return `${sign}R$${NBSP}${formatNumberBR(value)}`;
}

/** Nome lido pelo leitor de tela: "Entrada de R$ 1.234,56" / "Saída de R$ 89,90". */
export function amountA11y(value: number): string {
  if (Math.round(value * 100) === 0) return 'zero reais';
  const kind = value < 0 ? 'Saída' : 'Entrada';
  return `${kind} de ${formatNumberBR(value)} reais`;
}

export function balanceA11y(value: number): string {
  return `${value < 0 ? 'negativo ' : ''}${formatNumberBR(value)} reais`;
}

type SpParts = { y: number; m: number; d: number; hh: number; mm: number; wd: number };

export function spParts(date: Date): SpParts {
  const t = new Date(date.getTime() + SP_OFFSET_MS);
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
    hh: t.getUTCHours(), mm: t.getUTCMinutes(), wd: t.getUTCDay(),
  };
}

const p2 = (n: number) => n.toString().padStart(2, '0');

/** Data local de São Paulo em "AAAA-MM-DD" (usada para filtrar e agrupar). */
export function spDateKey(date: Date): string {
  const p = spParts(date);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}`;
}

export function formatDate(date: Date): string {
  const p = spParts(date);
  return `${p2(p.d)}/${p2(p.m)}/${p.y}`;
}

export function formatTime(date: Date): string {
  const p = spParts(date);
  return `${p2(p.hh)}:${p2(p.mm)}`;
}

function dayDiff(a: Date, b: Date): number {
  const ka = Date.UTC(...(spDateKey(a).split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]));
  const kb = Date.UTC(...(spDateKey(b).split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]));
  return Math.round((kb - ka) / 86400000);
}

/** "Atualizado hoje às 14:32" · "Atualizado ontem às 09:10" · "Atualizado em 12/11/2026 às 09:10". */
export function formatUpdated(date: Date, now: Date = new Date()): string {
  const diff = dayDiff(date, now);
  if (diff === 0) return `Atualizado hoje às ${formatTime(date)}`;
  if (diff === 1) return `Atualizado ontem às ${formatTime(date)}`;
  return `Atualizado em ${formatDate(date)} às ${formatTime(date)}`;
}

/** [0.10] REV-34: data e hora relativas como na tabela 3.1: "hoje às 17:21", "ontem às 09:10", "16/11/2026 às 08:05". */
export function formatWhen(date: Date, now: Date = new Date()): string {
  const diff = dayDiff(date, now);
  if (diff === 0) return `hoje às ${formatTime(date)}`;
  if (diff === 1) return `ontem às ${formatTime(date)}`;
  return formatDateTime(date);
}

/** Pontos de milhar: 1919 → "1.919" (REV-31). */
export function formatCount(n: number): string {
  return Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Tipo da conta informado pelo Pluggy (subtype), para a linha da conta quando o nome repete o da conexão (REV-30). */
export function accountTypeLabel(subtype: string | null | undefined): string {
  switch (subtype) {
    case 'CHECKING_ACCOUNT': return 'Conta corrente';
    case 'SAVINGS_ACCOUNT': return 'Conta poupança';
    case 'CREDIT_CARD': return 'Cartão de crédito';
    default: return 'Conta';
  }
}

/** "{data e hora}" usado nos avisos: "16/11/2026 às 08:05". */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)} às ${formatTime(date)}`;
}

/** Cabeçalho do dia no extrato a partir da chave "AAAA-MM-DD". */
export function formatDayHeader(dateKey: string, now: Date = new Date()): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  // meio-dia em SP evita qualquer borda de fuso
  const date = new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
  const diff = dayDiff(date, now);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return `${WEEKDAYS_SHORT[spParts(date).wd]}, ${p2(d)}/${p2(m)}/${y}`;
}

/** "17 de novembro" para leitura em voz. */
export function spokenDate(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${d} de ${MONTHS[m - 1]}`;
}

export function formatMonth(year: number, month: number): string {
  return `${MONTHS[month - 1]} de ${year}`;
}

/** Busca sem maiúsculas e sem acentos ("farmacia" acha "Farmácia"). */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** T-14: só dígitos, barras inseridas sozinhas: "17112026" → "17/11/2026". */
export function maskDateInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** "dd/mm/aaaa" → "aaaa-mm-dd", ou null se a data não existe. */
export function parseDateBR(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  if (date.getUTCDate() !== +d || date.getUTCMonth() !== +mo - 1 || date.getUTCFullYear() !== +y) return null;
  return `${y}-${mo}-${d}`;
}

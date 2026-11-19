// RF-002.3.1/.2 (UX 0.9): validade da autorização do app no MeuPluggy (item.consentExpiresAt).
// Aviso a 30 dias ou menos; vencida depois da data. Datas no fuso de São Paulo.
import { formatDate, spDateKey } from './format';

export type AuthValidity =
  | { state: 'unknown' }
  | { state: 'ok'; date: string }
  | { state: 'soon'; date: string; days: number }
  | { state: 'expired'; date: string };

const DAY = 86400000;
const keyToUtc = (k: string) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };

// Só para capturas no build de desenvolvimento (?validade=30|1|0|vencida|real): troca a data lida da conexão
// por uma relativa a hoje, sem mexer no banco nem no Pluggy.
let previewValidity: string | null = null;
export function setPreviewValidity(p: string | null) {
  previewValidity = p && p !== 'real' ? p : null;
}

export function authValidity(expiresAt: string | null | undefined, now: Date = new Date()): AuthValidity {
  if (!expiresAt) return { state: 'unknown' };
  if (previewValidity) {
    const n = previewValidity === 'vencida' ? -8 : Number(previewValidity);
    if (Number.isFinite(n)) expiresAt = new Date(now.getTime() + n * DAY + (n === 0 ? 60000 : 0)).toISOString();
  }
  const exp = new Date(expiresAt);
  if (Number.isNaN(exp.getTime())) return { state: 'unknown' };
  const date = formatDate(exp);
  if (exp.getTime() <= now.getTime()) return { state: 'expired', date };
  const days = Math.round((keyToUtc(spDateKey(exp)) - keyToUtc(spDateKey(now))) / DAY);
  return days <= 30 ? { state: 'soon', date, days } : { state: 'ok', date };
}

/** Texto do aviso no grupo da conexão (T-04, T-12). [0.10] REV-30: o nome já está logo acima, então "desta conexão". */
export function authMessage(v: AuthValidity): string | null {
  if (v.state === 'soon') {
    if (v.days <= 0) return 'A autorização desta conexão vence hoje.';
    if (v.days === 1) return 'A autorização desta conexão vence amanhã.';
    return `A autorização desta conexão vence em ${v.days} dias, em ${v.date}.`;
  }
  if (v.state === 'expired') return `A autorização desta conexão venceu em ${v.date}. O app não consegue mais ler os dados desta conexão.`;
  return null;
}

/** Estado curto da tabela 7.1 (T-11). */
export function authStatusShort(v: AuthValidity): string | null {
  if (v.state === 'soon') return v.days <= 0 ? 'Autorização vence hoje' : v.days === 1 ? 'Autorização vence amanhã' : `Autorização vence em ${v.days} dias`;
  if (v.state === 'expired') return `Autorização vencida em ${v.date}`;
  return null;
}

// Abrir o Extrato com filtros vindos de outra tela (Início, Resumo, conexão).
// O Extrato é uma aba que continua montada: sem um marcador novo a cada ida, os mesmos parâmetros da ida
// anterior não mudam e o filtro não é aplicado de novo (achado na revisão da 0.16).
import { router } from 'expo-router';
import type { RecipientKey } from '../domain/recipient';

export type ExtratoParams = { account?: string; from?: string; to?: string; category?: string; only?: 'out' | 'bill'; futuras?: '1'; recipient?: RecipientKey };

// O documento do destinatário não vai na rota (RNF-007): a rota leva só um marcador, e o documento fica em memória.
const recipients = new Map<string, RecipientKey>();
export function recipientFromToken(token: string | undefined): RecipientKey | null {
  return token ? recipients.get(token) ?? null : null;
}

let seq = 0;
export function openExtrato(params: ExtratoParams): void {
  seq += 1;
  const k = `${Date.now()}-${seq}`;
  const { recipient, ...rest } = params;
  if (recipient) recipients.set(k, recipient);
  router.push({ pathname: '/extrato', params: { ...rest, ...(recipient ? { rk: k } : {}), k } });
}

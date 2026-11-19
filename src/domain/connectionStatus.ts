// Tabela 7.1 da UX: estado do Pluggy → texto e ação. Código técnico nunca é a mensagem principal.
import { formatDateTime } from './format';

export type ConnectionAction = 'refresh' | 'retry' | 'reconnect' | 'continue' | null;
export type ConnectionTone = 'ok' | 'progress' | 'warning' | 'error' | 'pending';

export type ConnectionStatusView = {
  label: string;
  action: ConnectionAction;
  tone: ConnectionTone;
  /** true quando a conexão precisa de ação da pessoa (Início mostra "Esta conexão precisa da sua atenção."). */
  needsAttention: boolean;
  /** true quando a última atualização falhou e os dados mostrados são antigos (RF-003.2). */
  stale: boolean;
};

export type ConnectionStatusInput = {
  status: string | null; // Item.status
  executionStatus: string | null; // Item.executionStatus
  errorCode: string | null; // Item.error?.code
  originUpdatedAt: Date | null; // Item.lastUpdatedAt
  consentRevokedAt?: Date | null;
  consentExpiresAt?: Date | null;
  now?: Date;
};

const UNAVAILABLE = new Set(['SITE_NOT_AVAILABLE', 'CONNECTION_ERROR']);
const ATTENTION = new Set(['INVALID_CREDENTIALS', 'ACCOUNT_NEEDS_ACTION', 'INVALID_CREDENTIALS_MFA', 'ACCOUNT_CREDENTIALS_RESET']);

export function connectionStatusView(input: ConnectionStatusInput): ConnectionStatusView {
  const { status, executionStatus, errorCode, originUpdatedAt } = input;
  const now = input.now ?? new Date();
  const code = errorCode ?? executionStatus ?? '';
  const dataDe = originUpdatedAt ? ` Dados de ${formatDateTime(originUpdatedAt)}.` : '';

  const consentEnded =
    code === 'USER_AUTHORIZATION_REVOKED' ||
    Boolean(input.consentRevokedAt) ||
    (input.consentExpiresAt != null && input.consentExpiresAt.getTime() < now.getTime());
  if (consentEnded) {
    const when = input.consentRevokedAt ?? input.consentExpiresAt;
    return {
      label: when ? `Consentimento encerrado em ${formatDateTime(when).split(' às ')[0]}` : 'Consentimento encerrado',
      action: 'reconnect', tone: 'error', needsAttention: true, stale: true,
    };
  }
  if (status === 'UPDATING' || status === 'MERGING') {
    return { label: 'Atualizando…', action: null, tone: 'progress', needsAttention: false, stale: false };
  }
  if (code === 'USER_AUTHORIZATION_PENDING' || status === 'WAITING_USER_ACTION') {
    return { label: 'Aguardando autorização no banco', action: null, tone: 'pending', needsAttention: false, stale: false };
  }
  if (code === 'USER_AUTHORIZATION_NOT_GRANTED') {
    return { label: 'Autorização não concedida', action: 'retry', tone: 'warning', needsAttention: true, stale: true };
  }
  if (code === 'ACCOUNT_LOCKED') {
    return { label: 'Conta bloqueada no banco. Resolva com o banco e reconecte.', action: 'reconnect', tone: 'error', needsAttention: true, stale: true };
  }
  if (status === 'WAITING_USER_INPUT') {
    return { label: 'Falta uma confirmação sua', action: 'continue', tone: 'warning', needsAttention: true, stale: false };
  }
  if (status === 'LOGIN_ERROR' || ATTENTION.has(code)) {
    return { label: 'Precisa da sua atenção', action: 'reconnect', tone: 'warning', needsAttention: true, stale: true };
  }
  if (executionStatus === 'PARTIAL_SUCCESS') {
    return { label: 'Atualizada em parte', action: 'retry', tone: 'warning', needsAttention: false, stale: true };
  }
  if (status === 'OUTDATED' || UNAVAILABLE.has(code)) {
    return { label: `Instituição indisponível.${dataDe}`, action: 'retry', tone: 'warning', needsAttention: false, stale: true };
  }
  if (status === 'UPDATED') {
    return { label: 'Atualizada', action: 'refresh', tone: 'ok', needsAttention: false, stale: false };
  }
  return { label: `Não foi possível atualizar.${dataDe}`, action: 'retry', tone: 'warning', needsAttention: false, stale: true };
}

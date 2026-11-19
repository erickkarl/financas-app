// Exclusão da conta (RF-009.2.2, RF-009.2.3, R-9 a): primeiro o Pluggy, conexão a conexão.
// Cada conexão excluída no Pluggy tem os dados apagados do aparelho na hora; o resto da conta só sai
// quando todas foram excluídas. Credenciais recusadas no meio param o processo.
import { PluggyError } from '../pluggy/client';

export type DeletionConn = { item_id: string; name: string };

export type DeletionResult =
  | { kind: 'done' }
  | { kind: 'none' } // nenhuma conexão excluída: nada apagado
  | { kind: 'partial'; deleted: string[]; failed: string[] }
  | { kind: 'rejected'; deleted: string[]; remaining: string[] }
  | { kind: 'localFailed' }; // todas excluídas no Pluggy; falhou ao apagar o aparelho

export async function deleteAccountData(opts: {
  conns: DeletionConn[];
  deleteRemote: (itemId: string) => Promise<void>;
  deleteLocal: (itemId: string) => Promise<void>;
  wipeAll: () => Promise<void>;
  onProgress?: (p: { phase: 'remote'; done: number; total: number } | { phase: 'local' }) => void;
}): Promise<DeletionResult> {
  const { conns, deleteRemote, deleteLocal, wipeAll, onProgress } = opts;
  const deleted: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < conns.length; i++) {
    const c = conns[i];
    onProgress?.({ phase: 'remote', done: i + 1, total: conns.length });
    try {
      await deleteRemote(c.item_id);
    } catch (e) {
      if (e instanceof PluggyError && e.kind === 'invalid_credentials') {
        return { kind: 'rejected', deleted, remaining: conns.slice(i).map((x) => x.name) };
      }
      failed.push(c.name);
      continue;
    }
    // Excluída no Pluggy: os dados dela saem do aparelho já (R-9).
    await deleteLocal(c.item_id);
    deleted.push(c.name);
  }
  if (failed.length > 0) {
    return deleted.length === 0 ? { kind: 'none' } : { kind: 'partial', deleted, failed };
  }
  onProgress?.({ phase: 'local' });
  try {
    await wipeAll();
    return { kind: 'done' };
  } catch {
    return { kind: 'localFailed' };
  }
}

/** Textos da UX 0.8 (T-20, "Falha por outro motivo"). */
export function deletionMessage(r: Exclude<DeletionResult, { kind: 'done' }>): string {
  switch (r.kind) {
    case 'none':
      return 'Não foi possível excluir agora. Nada foi apagado, nem no Pluggy nem neste aparelho. Tente de novo.';
    case 'partial':
      return `Nem todos os dados foram apagados.\nExcluídas no Pluggy e apagadas deste aparelho: ${r.deleted.join(', ')}.\nNão foi possível excluir: ${r.failed.join(', ')}. Os dados delas continuam neste aparelho.`;
    case 'rejected':
      return r.deleted.length
        ? `Nem todos os dados foram apagados.\nExcluídas no Pluggy e apagadas deste aparelho: ${r.deleted.join(', ')}.\nO Pluggy recusou suas credenciais antes de excluir: ${r.remaining.join(', ')}. Os dados delas continuam neste aparelho.`
        : 'O Pluggy recusou suas credenciais. Nada foi apagado.';
    case 'localFailed':
      return 'Suas conexões foram excluídas no Pluggy, mas não foi possível apagar os dados deste aparelho. Tente de novo.';
  }
}

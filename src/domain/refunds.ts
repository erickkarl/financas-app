// RF-008.11 (requisitos v1.29) / ux.md 0.21: reembolso ou estorno na CONTA em par com a saída que ele devolveu.
// Um crédito casa com um débito ANTERIOR da mesma conta: mesmo destinatário pelo número do documento (Q51 b: só o
// documento; o nome não é usado nem guardado), valor igual e no máximo 90 dias antes. Um para um: cada crédito, do mais antigo para o mais
// novo, fica com o débito mais recente que ainda não tem par. Não usa a descrição. O par todo sai do Resumo.

export const REFUND_WINDOW_DAYS = 90;
const DAY = 86400e3;

export type RefundCandidate = {
  id: string;
  accountId: string;
  /** ISO com hora (a ordem "anterior" usa o instante). */
  date: string;
  amount: number;
  /** Pode entrar num par novo: conta bancária, não manual, não futura, não transferência própria, não fatura e, no
   * crédito, não Cashback (RF-008.11.1, .8). */
  eligible: boolean;
  /** Documento da outra ponta, só dígitos (crédito: pagador; débito: recebedor). */
  doc: string | null;
};
export type RefundPair = { creditId: string; debitId: string };

const cents = (v: number) => Math.round(Math.abs(v) * 100);

/** RF-008.11.3 (Q51 b): mesmo destinatário = mesmo número de documento; sem documento nos dois, não casa. */
export function sameRecipient(credit: Pick<RefundCandidate, 'doc'>, debit: Pick<RefundCandidate, 'doc'>): boolean {
  return Boolean(credit.doc && debit.doc && credit.doc === debit.doc);
}

/**
 * Pares atuais: os que já existem continuam enquanto as duas pontas existem com o mesmo valor (N-17: marcar uma
 * ponta como transferência, oculta ou "Fora do Resumo" à mão não desfaz o par). Depois, os créditos ainda sem par
 * procuram um débito. Lançamentos de um par que a pessoa desfez ("Não é reembolso") não casam sozinhos de novo, com
 * nenhum outro lançamento (N-18).
 */
export function matchRefunds(txs: RefundCandidate[], existing: RefundPair[], blocked: Set<string>): RefundPair[] {
  const byId = new Map(txs.map((t) => [t.id, t]));
  const used = new Set<string>();
  const out: RefundPair[] = [];
  for (const p of existing) {
    const c = byId.get(p.creditId); const d = byId.get(p.debitId);
    if (!c || !d || c.amount <= 0 || d.amount >= 0 || cents(c.amount) !== cents(d.amount)) continue;
    if (used.has(c.id) || used.has(d.id)) continue;
    used.add(c.id); used.add(d.id); out.push(p);
  }
  const debits = txs.filter((t) => t.amount < 0 && t.eligible && !blocked.has(t.id));
  const credits = txs.filter((t) => t.amount > 0 && t.eligible && !blocked.has(t.id) && !used.has(t.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const c of credits) {
    const tc = new Date(c.date).getTime();
    let best: RefundCandidate | null = null;
    for (const d of debits) {
      if (used.has(d.id) || d.accountId !== c.accountId || cents(d.amount) !== cents(c.amount)) continue;
      const td = new Date(d.date).getTime();
      if (!(td < tc) || tc - td > REFUND_WINDOW_DAYS * DAY) continue;
      if (!sameRecipient(c, d)) continue;
      if (!best || d.date > best.date || (d.date === best.date && d.id > best.id)) best = d;
    }
    if (best) { used.add(c.id); used.add(best.id); out.push({ creditId: c.id, debitId: best.id }); }
  }
  return out;
}


// PM-8 [P]: transferência entre contas próprias = saída e entrada de mesmo valor,
// em contas diferentes da pessoa, com até 2 dias de diferença.

export type TransferCandidate = { id: string; accountId: string; date: string; amount: number };

const MAX_DAYS = 2;
const DAY_MS = 86400000;

function dayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/**
 * Devolve os ids das transações que formam pares de transferência.
 * Cada transação entra em no máximo um par; para cada saída escolhe a entrada mais próxima em data.
 */
export function detectTransfers(txs: readonly TransferCandidate[]): Set<string> {
  const paired = new Set<string>();
  const credits = txs
    .filter((t) => Math.round(t.amount * 100) > 0)
    .map((t) => ({ ...t, cents: Math.round(t.amount * 100), day: dayIndex(t.date) }));
  const debits = txs
    .filter((t) => Math.round(t.amount * 100) < 0)
    .map((t) => ({ ...t, cents: -Math.round(t.amount * 100), day: dayIndex(t.date) }))
    .sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));

  const byCents = new Map<number, typeof credits>();
  for (const c of credits) {
    const list = byCents.get(c.cents) ?? [];
    list.push(c);
    byCents.set(c.cents, list);
  }

  for (const d of debits) {
    const options = byCents.get(d.cents);
    if (!options) continue;
    let best: (typeof credits)[number] | null = null;
    for (const c of options) {
      if (paired.has(c.id) || c.accountId === d.accountId) continue;
      const gap = Math.abs(c.day - d.day);
      if (gap > MAX_DAYS) continue;
      if (!best || gap < Math.abs(best.day - d.day) || (gap === Math.abs(best.day - d.day) && c.id < best.id)) best = c;
    }
    if (best) {
      paired.add(d.id);
      paired.add(best.id);
    }
  }
  return paired;
}

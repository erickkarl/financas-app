// T-17: retrato do formulário do lançamento manual, para saber se há alteração a descartar.
import { parseMoneyInput } from './format';

/** Compara pelo valor em centavos: o campo vazio e "R$ 0,00" são a mesma coisa (não pedem "Descartar as alterações?"). */
export function manualFormSnapshot(kind: string, value: string, description: string, date: string, category: string | null): string {
  return JSON.stringify([kind, parseMoneyInput(value), description, date, category]);
}

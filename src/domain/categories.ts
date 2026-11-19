// Categorias da UX v0.3 §7.3 (requisitos v1.2). Lista fechada; a pessoa não cria nem edita na v1.
// Mapeamento das categorias do Pluggy (GET /categories, lido em 18/11/2026, 130 itens) — DEV-10.

export type CategoryId =
  | 'moradia' | 'mercado' | 'restaurantes' | 'transporte' | 'saude' | 'lazer'
  | 'compras' | 'assinaturas' | 'impostos' | 'receitas' | 'outros' | 'rendimentos' | 'investimentos';

export type Category = { id: CategoryId; name: string; icon: string };

/** Ícones: Material Community Icons (conjunto do react-native-paper), escolhidos para corresponder aos Material Symbols sugeridos. */
export const CATEGORIES: readonly Category[] = [
  { id: 'moradia', name: 'Moradia e contas', icon: 'home' },
  { id: 'mercado', name: 'Mercado', icon: 'cart' },
  { id: 'restaurantes', name: 'Restaurantes e delivery', icon: 'silverware-fork-knife' },
  { id: 'transporte', name: 'Transporte', icon: 'car' },
  { id: 'saude', name: 'Saúde', icon: 'medical-bag' },
  { id: 'lazer', name: 'Lazer e viagem', icon: 'party-popper' },
  { id: 'compras', name: 'Compras', icon: 'shopping' },
  { id: 'assinaturas', name: 'Assinaturas', icon: 'autorenew' },
  { id: 'impostos', name: 'Impostos e taxas', icon: 'receipt' },
  { id: 'receitas', name: 'Receitas', icon: 'cash-multiple' },
  { id: 'outros', name: 'Outros', icon: 'dots-horizontal' },
  // UX 0.7 §7.3 (RF-008.3): o que o Pluggy identifica como rendimento; conta como receita.
  { id: 'rendimentos', name: 'Rendimentos', icon: 'piggy-bank-outline' },
  { id: 'investimentos', name: 'Investimentos', icon: 'trending-up' },
];

export const NO_CATEGORY = { id: null, name: 'Sem categoria', icon: 'tag-off-outline' } as const;

export function categoryById(id: string | null | undefined): Category | typeof NO_CATEGORY {
  return CATEGORIES.find((c) => c.id === id) ?? NO_CATEGORY;
}

/** Exceções por id exato do Pluggy (têm prioridade sobre a raiz). */
const EXACT: Record<string, CategoryId | null> = {
  // Empréstimos e financiamento
  '02010000': 'impostos', // atraso e cheque especial
  '02020000': 'impostos', // juros cobrados
  '02030001': 'moradia', // financiamento imobiliário
  '02030002': 'transporte', // financiamento de veículos
  // Investimentos: rendimentos e dividendos são receita (UX: "Receitas" inclui rendimentos)
  '03060000': 'rendimentos', // juros e dividendos (UX 0.7, RF-008.3): receita, separada como "Rendimentos"
  // Transferências: mesma titularidade e pagamento de fatura ficam "Sem categoria";
  // são sinais para a regra de transferência (DEV-11), não categoria.
  '04000000': null, '04010000': null, '04020000': null, '04030000': null,
  '05100000': null,
  // Serviços
  '07010000': 'moradia', '07010001': 'moradia', '07010002': 'moradia', '07010003': 'moradia',
  '07030001': 'assinaturas', // academia
  '07030002': 'lazer', // esportes
  '07040000': 'lazer', '07040001': 'lazer', '07040002': 'lazer', '07040003': 'lazer',
  // Compras
  '08030000': 'outros', // pets
  '08090000': 'receitas', // cashback
  // Serviços digitais
  '09010000': 'lazer', // jogos
  // Moradia
  '17030000': 'compras', // utensílios para casa
  // Transporte
  '19050004': 'impostos', // taxas e impostos de veículo
  '19050006': 'impostos', // multas
  // Seguros
  '200200000': 'moradia', '200300000': 'saude', '200400000': 'transporte',
};

/** Categoria pela raiz (2 primeiros dígitos). */
const ROOT: Record<string, CategoryId | null> = {
  '01': 'receitas',
  '02': 'outros',
  '03': 'investimentos',
  '04': null,
  '05': 'outros',
  '06': 'outros',
  '07': 'outros',
  '08': 'compras',
  '09': 'assinaturas',
  '10': 'mercado',
  '11': 'restaurantes',
  '12': 'lazer',
  '13': 'outros',
  '14': 'lazer',
  '15': 'impostos',
  '16': 'impostos',
  '17': 'moradia',
  '18': 'saude',
  '19': 'transporte',
  '20': 'outros',
  '21': 'lazer',
  '99': 'outros',
};

/** RF-006.1: categoria sugerida a partir do Pluggy, ou null ("Sem categoria"). */
export function mapPluggyCategory(pluggyCategoryId: string | null | undefined): CategoryId | null {
  if (!pluggyCategoryId) return null;
  if (pluggyCategoryId in EXACT) return EXACT[pluggyCategoryId];
  const root = pluggyCategoryId.slice(0, 2);
  return ROOT[root] ?? null;
}

/** Sinais do Pluggy de transferência própria ou pagamento de fatura (para DEV-11/R-2; não aplicados sozinhos). */
export function isPluggyTransferSignal(pluggyCategoryId: string | null | undefined): boolean {
  if (!pluggyCategoryId) return false;
  return pluggyCategoryId.startsWith('04') || pluggyCategoryId === '05100000';
}

/**
 * requisitos v1.21 (11.16, mapa ajustado pelo PM): no cartão, a categoria do comerciante (payeeMCC) sugere a categoria
 * só onde o código tem significado claro, conferido no Visa Merchant Data Standards Manual (outubro de 2026):
 * 5968 "Direct Marketing – Continuity/Subscription Merchant" (p. 79) → "Assinaturas";
 * 5499 "Miscellaneous Food Stores – Convenience Stores and Specialty Markets" (p. 64) → "Mercado".
 * Só substitui "Outros" ou "Sem categoria": não muda uma categoria mais específica que o Pluggy já deu.
 */
const MCC_CATEGORY: Record<string, CategoryId> = { '5968': 'assinaturas', '5499': 'mercado' };
export function categoryFromMcc(current: CategoryId | null, accountType: string | null | undefined, mcc: string | number | null | undefined): CategoryId | null {
  if (accountType !== 'CREDIT' || mcc == null) return current;
  const byMcc = MCC_CATEGORY[String(mcc).trim()];
  return byMcc && (current === null || current === 'outros') ? byMcc : current;
}

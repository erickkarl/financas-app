// Requisitos v1.18 §11.13 (R-8): regras de reconhecimento do Resumo, a partir do que o Pluggy entrega.

/** Documento só com dígitos, com o tipo; nunca nome (RNF-007). */
export function docOf(p: { documentNumber?: { type?: string | null; value?: string | null } | null } | null | undefined): { type: string | null; number: string | null } {
  const v = p?.documentNumber?.value ? String(p.documentNumber.value).replace(/\D/g, '') : '';
  return { type: v ? (p?.documentNumber?.type ?? (v.length === 14 ? 'CNPJ' : v.length === 11 ? 'CPF' : null)) : null, number: v || null };
}

/**
 * R-8.5 (RF-008.9): órgão público estadual ou municipal, em MAIÚSCULAS (como os bancos escrevem), para só SUGERIR
 * "Impostos e taxas". Sem /i de propósito: "das", "sefaz" minúsculos em nomes de pessoas não casam.
 * Receita Federal (DAS, DARF) fica de fora: R-8.4 não reconhece sozinho nesta versão.
 */
const PUBLIC_BODY = /\b(SEFAZ|SECRETARIA (DA|DE) FAZENDA|PREFEITURA|PREF MUN|PREF\. MUN|MUNICIPIO|MUNICÍPIO|DETRAN|DARE|GARE)\b/;
export function isPublicBodyText(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => Boolean(t) && PUBLIC_BODY.test(String(t)));
}

/** R-8.5: sugere "impostos" quando é convênio de arrecadação com órgão na descrição, ou recebedor com nome de órgão. */
export function suggestTaxCategory(t: { operationType?: string | null; description?: string | null; descriptionRaw?: string | null; receiverName?: string | null }): boolean {
  if (isPublicBodyText(t.receiverName)) return true;
  return t.operationType === 'CONVENIO_ARRECADACAO' && isPublicBodyText(t.description, t.descriptionRaw);
}

/** R-8.2 (a) e (b), e a exceção do CNPJ. (c), o par, é feito à parte (detectTransfers). */
export function ownTransferSignal(t: { pluggyCategoryId: string | null; payerType: string | null; payer: string | null; receiverType: string | null; receiver: string | null }): 'yes' | 'never' | 'maybe' {
  if (t.payerType === 'CNPJ') return 'never';
  if (t.pluggyCategoryId && t.pluggyCategoryId.startsWith('04')) return 'yes';
  if (t.payerType === 'CPF' && t.receiverType === 'CPF' && t.payer && t.payer === t.receiver) return 'yes';
  return 'maybe';
}

/**
 * R-8.1 (RF-008.5): entrada (CREDIT) que o Pluggy classifica como transferência (raiz 05, como "Transfers" e
 * "Transfer - PIX") é receita na categoria "Receitas" — o salário vindo da PJ chega assim. Se for um par de
 * transferência própria, a chave de transferência a tira das somas (R-8.2); a categoria não muda isso.
 */
/** R-2.1: pagamento de fatura (saída PAGAMENTO_FATURA na conta; crédito 05100000 ou PAGAMENTO_FATURA no cartão). */
export function isBillPayment(t: { accountType: string | null; amount: number; operationType: string | null; pluggyCategoryId: string | null }): boolean {
  if (t.accountType === 'CREDIT') return t.amount > 0 && (t.operationType === 'PAGAMENTO_FATURA' || t.pluggyCategoryId === '05100000');
  if (t.accountType === 'BANK') return t.amount < 0 && t.operationType === 'PAGAMENTO_FATURA';
  return false;
}

export function incomeFromTransferCategory(amount: number, pluggyCategoryId: string | null | undefined): boolean {
  return amount > 0 && Boolean(pluggyCategoryId) && pluggyCategoryId!.startsWith('05') && pluggyCategoryId !== '05100000';
}

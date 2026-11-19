// RF-006.3 (categoria lembrada por destinatário) e RF-008.10 (estorno no cartão) — requisitos v1.21 a v1.23, UX 0.17.

export type RecipientKey = { type: 'CPF' | 'CNPJ'; doc: string };

/**
 * RF-006.3: o destinatário de um lançamento, para lembrar a categoria. Só PIX ou boleto em conta (o cartão não traz
 * destinatário), com documento CPF ou CNPJ: o recebedor numa saída, o pagador numa entrada.
 */
export function recipientKey(t: {
  accountType: string | null | undefined;
  operationType: string | null | undefined;
  amount: number;
  payerType: string | null | undefined;
  payer: string | null | undefined;
  receiverType: string | null | undefined;
  receiver: string | null | undefined;
}): RecipientKey | null {
  if (t.accountType !== 'BANK') return null;
  if (t.operationType !== 'PIX' && t.operationType !== 'BOLETO') return null;
  const type = t.amount < 0 ? t.receiverType : t.payerType;
  const doc = t.amount < 0 ? t.receiver : t.payer;
  if ((type !== 'CPF' && type !== 'CNPJ') || !doc) return null;
  return { type, doc };
}

/** SQL equivalente a recipientKey (t = transactions, a = accounts). */
export const RECIPIENT_TYPE_SQL = `CASE WHEN a.type = 'BANK' AND t.operation_type IN ('PIX', 'BOLETO')
  THEN CASE WHEN t.amount < 0 THEN t.receiver_doc_type ELSE t.payer_doc_type END END`;
export const RECIPIENT_DOC_SQL = `CASE WHEN a.type = 'BANK' AND t.operation_type IN ('PIX', 'BOLETO')
  THEN CASE WHEN t.amount < 0 THEN t.receiver_doc ELSE t.payer_doc END END`;

/**
 * N-6 (provisória, UX 0.17): CPF com os seis dígitos do meio ("CPF •••.456.789-••"); CNPJ com os oito do meio e a
 * filial ("CNPJ ••.345.678/0001-••"). O número completo não aparece em nenhuma tela (RNF-007).
 */
export function maskDoc(type: string, doc: string): string {
  const d = doc.replace(/\D/g, '');
  if (type === 'CPF' && d.length === 11) return `CPF •••.${d.slice(3, 6)}.${d.slice(6, 9)}-••`;
  if (type === 'CNPJ' && d.length === 14) return `CNPJ ••.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-••`;
  return type === 'CNPJ' ? 'CNPJ ••.•••.•••/••••-••' : 'CPF •••.•••.•••-••';
}

/**
 * RF-008.10 (requisitos v1.22): estorno = crédito no cartão que não é pagamento de fatura (R-2.1) e cuja categoria do
 * Pluggy não é Cashback (08090000). operationType ESTORNO sozinho não basta (só 45 de 106 nos dados reais).
 * Na conta, nada é estorno (não se reconhece pela descrição).
 */
export function isCardRefund(t: { accountType: string | null | undefined; amount: number; isBill: boolean; pluggyCategoryId: string | null | undefined }): boolean {
  return t.accountType === 'CREDIT' && t.amount > 0 && !t.isBill && t.pluggyCategoryId !== '08090000';
}

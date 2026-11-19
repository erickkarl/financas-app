// Subconjunto dos tipos da API do Pluggy usado pelo app (conferido com pluggy-sdk 0.94.3, 18/11/2026).
// Datas chegam como string ISO no JSON.

export type PluggyPage<T> = { results: T[]; page?: number; total?: number; totalPages?: number };

export type PluggyItem = {
  id: string;
  connector: { id: number; name: string; imageUrl?: string | null; primaryColor?: string | null; type?: string };
  status: string;
  executionStatus: string | null;
  error: { code: string; message?: string } | null;
  createdAt: string;
  updatedAt?: string;
  lastUpdatedAt: string | null;
  consentExpiresAt?: string | null;
};

export type PluggyAccount = {
  id: string;
  itemId: string;
  type: 'BANK' | 'CREDIT' | string;
  subtype: string | null;
  number: string | null;
  balance: number;
  name: string;
  marketingName?: string | null;
  currencyCode: string;
  creditData?: { balanceDueDate?: string | null; brand?: string | null } | null;
  /** RF-004.4 (verificado em duas instituições reais): valor que rende automaticamente, já dentro do saldo. */
  bankData?: { automaticallyInvestedBalance?: number | null; closingBalance?: number | null } | null;
};

export type PluggyTransaction = {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: number;
  type: 'DEBIT' | 'CREDIT' | string;
  category: string | null;
  categoryId: string | null;
  status?: string;
  /** RF-008.5 a .9 (v1.18): tipo da operação e partes do pagamento. Do documento, o app guarda só tipo e número (RNF-007). */
  operationType?: string | null;
  descriptionRaw?: string | null;
  paymentData?: {
    payer?: PluggyParty | null;
    receiver?: PluggyParty | null;
  } | null;
  /** requisitos v1.21: categoria do comerciante no cartão (lida na sincronização, não guardada). */
  creditCardMetadata?: { payeeMCC?: string | number | null } | null;
};

export type PluggyConsent = {
  id: string;
  itemId: string;
  products: string[];
  openFinancePermissionsGranted?: string[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

/** GET /investments (lido em 19/11/2026: FIXED_INCOME/CDB, LCA; EQUITY/STOCK, REAL_ESTATE_FUND). */
export type PluggyInvestment = {
  id: string;
  itemId: string;
  type: string;
  subtype?: string | null;
  name?: string | null;
  balance?: number | null;
  amount?: number | null;
  status?: string | null;
  updatedAt?: string | null;
};

export type PluggyParty = { name?: string | null; documentNumber?: { type?: string | null; value?: string | null } | null };

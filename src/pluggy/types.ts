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

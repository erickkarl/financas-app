// Cliente mínimo da API do Pluggy (https://api.pluggy.ai), direto do aparelho (D8, RF-000.3).
// Regras: nunca registrar nem incluir em erro o Client ID, o Client Secret, a apiKey ou o connect token.
import type { PluggyAccount, PluggyConsent, PluggyItem, PluggyPage, PluggyTransaction } from './types';

export const PLUGGY_BASE_URL = 'https://api.pluggy.ai';
export const MEU_PLUGGY_CONNECTOR_ID = 200; // confirmado em GET /connectors/200 (18/11/2026)

export type Credentials = { clientId: string; clientSecret: string };

export type PluggyErrorKind =
  | 'invalid_credentials' // 401 CLIENT_KEYS_UNAUTHORIZED (DEV-7)
  | 'network' // sem resposta HTTP (sem internet, DNS, tempo esgotado)
  | 'server' // 5xx
  | 'rate_limited' // 429
  | 'not_found' // 404
  | 'forbidden' // 403
  | 'unexpected';

export class PluggyError extends Error {
  readonly kind: PluggyErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  constructor(kind: PluggyErrorKind, status: number | null, code: string | null) {
    // A mensagem é só o tipo e o código: nunca carrega dados da requisição.
    super(`Pluggy ${kind}${status ? ` HTTP ${status}` : ''}${code ? ` ${code}` : ''}`);
    this.name = 'PluggyError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  status: number;
  json: () => Promise<unknown>;
}>;

export type PluggyClientOptions = {
  getCredentials: () => Promise<Credentials | null>;
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

const API_KEY_TTL_MS = 110 * 60 * 1000; // a apiKey vale 2 h; renova antes

function kindForStatus(status: number): PluggyErrorKind {
  if (status === 401) return 'invalid_credentials';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unexpected';
}

export function createPluggyClient(opts: PluggyClientOptions) {
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? 20000;
  let cache: { key: string; forId: string; at: number } | null = null;

  async function raw(method: string, path: string, apiKey: string | null, body?: unknown) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await doFetch(PLUGGY_BASE_URL + path, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(apiKey ? { 'X-API-KEY': apiKey } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch {
      throw new PluggyError('network', null, null);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function errorFrom(status: number, json: unknown): PluggyError {
    const code = (json && typeof json === 'object' && 'codeDescription' in json ? String((json as { codeDescription: unknown }).codeDescription) : null) || null;
    return new PluggyError(kindForStatus(status), status, code);
  }

  /** POST /auth. Credencial errada → PluggyError('invalid_credentials'). */
  async function authenticate(creds: Credentials): Promise<string> {
    const r = await raw('POST', '/auth', null, { clientId: creds.clientId, clientSecret: creds.clientSecret });
    const apiKey = r.json && typeof r.json === 'object' ? (r.json as { apiKey?: unknown }).apiKey : undefined;
    if (r.status === 200 && typeof apiKey === 'string') return apiKey;
    // /auth só devolve 401 para chaves inválidas; 400 também indica par malformado
    if (r.status === 400 || r.status === 401 || r.status === 403) return Promise.reject(new PluggyError('invalid_credentials', r.status, 'CLIENT_KEYS_UNAUTHORIZED'));
    throw errorFrom(r.status, r.json);
  }

  async function apiKeyFor(force = false): Promise<string> {
    const creds = await opts.getCredentials();
    if (!creds) throw new PluggyError('invalid_credentials', null, 'NO_CREDENTIALS');
    if (!force && cache && cache.forId === creds.clientId && now() - cache.at < API_KEY_TTL_MS) return cache.key;
    const key = await authenticate(creds);
    cache = { key, forId: creds.clientId, at: now() };
    return key;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let key = await apiKeyFor();
    let r = await raw(method, path, key, body);
    if (r.status === 401 || r.status === 403) {
      // apiKey pode ter expirado: renova uma vez. Se o /auth recusar, vira invalid_credentials.
      key = await apiKeyFor(true);
      r = await raw(method, path, key, body);
    }
    if (r.status >= 200 && r.status < 300) return r.json as T;
    throw errorFrom(r.status, r.json);
  }

  return {
    /** RF-000.2: testa um par antes de salvar (não usa o cache nem as credenciais salvas). */
    async testCredentials(creds: Credentials): Promise<void> {
      await authenticate(creds);
    },
    clearCache() {
      cache = null;
    },
    async createConnectToken(itemId?: string): Promise<string> {
      const res = await request<{ accessToken: string }>('POST', '/connect_token', itemId ? { itemId } : {});
      return res.accessToken;
    },
    getItem(itemId: string) {
      return request<PluggyItem>('GET', `/items/${encodeURIComponent(itemId)}`);
    },
    async deleteItem(itemId: string): Promise<void> {
      try {
        await request<unknown>('DELETE', `/items/${encodeURIComponent(itemId)}`);
      } catch (e) {
        // Já não existe no Pluggy: para o app, a revogação está concluída.
        if (e instanceof PluggyError && e.kind === 'not_found') return;
        throw e;
      }
    },
    async getAccounts(itemId: string): Promise<PluggyAccount[]> {
      const res = await request<PluggyPage<PluggyAccount>>('GET', `/accounts?itemId=${encodeURIComponent(itemId)}`);
      return res.results ?? [];
    },
    /**
     * GET /v2/transactions com cursor. O GET /transactions antigo devolve 410 ENDPOINT_DEPRECATED
     * (visto com conexão real em 18/11/2026). `next` vem como "?accountId=…&after=<cursor>" ou null.
     */
    async getTransactions(accountId: string, onPage?: (loaded: number) => void): Promise<PluggyTransaction[]> {
      const all: PluggyTransaction[] = [];
      let path: string | null = `/v2/transactions?accountId=${encodeURIComponent(accountId)}`;
      for (let guard = 0; path && guard < 200; guard++) {
        const res: { results?: PluggyTransaction[]; next?: string | null } = await request('GET', path);
        all.push(...(res.results ?? []));
        onPage?.(all.length);
        const next = res.next ?? null;
        path = !next ? null : next.startsWith('?') ? `/v2/transactions${next}` : next.startsWith('/') ? next : next.replace(PLUGGY_BASE_URL, '');
      }
      return all;
    },
    /** DEV-2: consentimentos do item. Lista vazia ou erro 4xx → o app usa o texto do PM-2. */
    async getConsents(itemId: string): Promise<PluggyConsent[]> {
      try {
        const res = await request<PluggyPage<PluggyConsent>>('GET', `/consents?itemId=${encodeURIComponent(itemId)}`);
        return res.results ?? [];
      } catch (e) {
        if (e instanceof PluggyError && (e.kind === 'not_found' || e.kind === 'forbidden' || e.kind === 'unexpected')) return [];
        throw e;
      }
    },
  };
}

export type PluggyClient = ReturnType<typeof createPluggyClient>;

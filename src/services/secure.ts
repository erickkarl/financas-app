// Armazenamento protegido do aparelho (Keychain no iOS, Keystore no Android) — RF-000.3, PM-10, RNF-002.
// Nada daqui é registrado em log.
import * as SecureStore from 'expo-secure-store';
import type { Credentials } from '../pluggy/client';

const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

const K = {
  clientId: 'pluggy_client_id',
  clientSecret: 'pluggy_client_secret',
  verifiedAt: 'pluggy_verified_at',
  rejected: 'pluggy_rejected',
  sessionProvider: 'session_provider',
  sessionUser: 'session_user',
  bioEnabled: 'bio_enabled',
} as const;

const get = (k: string) => SecureStore.getItemAsync(k, OPTS);
const set = (k: string, v: string) => SecureStore.setItemAsync(k, v, OPTS);
const del = (k: string) => SecureStore.deleteItemAsync(k, OPTS);

export const secure = {
  async getCredentials(): Promise<Credentials | null> {
    const [clientId, clientSecret] = await Promise.all([get(K.clientId), get(K.clientSecret)]);
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  },
  /** Grava o par já testado com sucesso (troca só depois do teste — T-07). */
  async saveCredentials(c: Credentials, verifiedAtIso: string): Promise<void> {
    await set(K.clientId, c.clientId);
    await set(K.clientSecret, c.clientSecret);
    await set(K.verifiedAt, verifiedAtIso);
    await del(K.rejected);
  },
  async removeCredentials(): Promise<void> {
    await Promise.all([del(K.clientId), del(K.clientSecret), del(K.verifiedAt), del(K.rejected)]);
  },
  async credentialsMeta(): Promise<{ clientIdTail: string | null; verifiedAt: string | null; rejected: boolean }> {
    const [id, at, rej] = await Promise.all([get(K.clientId), get(K.verifiedAt), get(K.rejected)]);
    return { clientIdTail: id ? id.slice(-4) : null, verifiedAt: at, rejected: rej === '1' };
  },
  async markRejected(): Promise<void> {
    await set(K.rejected, '1');
  },

  async getSession(): Promise<{ provider: string; userId: string } | null> {
    const [provider, userId] = await Promise.all([get(K.sessionProvider), get(K.sessionUser)]);
    return provider && userId ? { provider, userId } : null;
  },
  async setSession(provider: string, userId: string): Promise<void> {
    await set(K.sessionProvider, provider);
    await set(K.sessionUser, userId);
  },
  async clearSession(): Promise<void> {
    await Promise.all([del(K.sessionProvider), del(K.sessionUser), del(K.bioEnabled)]);
  },

  async getBioEnabled(): Promise<boolean> {
    return (await get(K.bioEnabled)) === '1';
  },
  async setBioEnabled(v: boolean): Promise<void> {
    if (v) await set(K.bioEnabled, '1');
    else await del(K.bioEnabled);
  },

  /** Excluir conta / instalação nova: apaga tudo que o app guardou no armazenamento protegido. */
  async wipeAll(): Promise<void> {
    await Promise.all(Object.values(K).map((k) => del(k)));
  },
};

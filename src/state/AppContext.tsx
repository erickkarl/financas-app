// Estado central: desbloqueio do aparelho (RF-001.5 a .12, sem login nem conta), credenciais (RF-000), atualização (RF-003.3/3.4).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createRepo, type Repo } from '../data/repo';
import { wipeAll as wipeDb, type Db } from '../data/db';
import { syncConnection } from '../data/sync';
import { createPluggyClient, PluggyError, type PluggyClient } from '../pluggy/client';
import { secure } from '../services/secure';
import { deviceHasScreenLock, LOCK_AFTER_BACKGROUND_MS, unlockDevice, type UnlockResult } from '../services/biometric';

export type CredStatus = 'none' | 'ok' | 'rejected';
export type RefreshOutcome = 'ok' | 'nochange' | 'failed' | 'offline' | 'throttled' | 'rejected' | 'none';

const MANUAL_REFRESH_MIN_MS = 5 * 60 * 1000;

type Ctx = {
  ready: boolean;
  db: Db;
  repo: Repo;
  client: PluggyClient;
  /** T-03 por cima de tudo: abrir do zero sempre; voltar depois de mais de 60 s (RF-001.6). */
  locked: boolean;
  /** O aparelho tem bloqueio de tela. Sem bloqueio, o app abre direto com aviso fixo (RF-001.8). */
  screenLock: boolean;
  online: boolean;
  credStatus: CredStatus;
  refreshing: boolean;
  /** Muda sempre que os dados locais mudam; telas recarregam ao ver a mudança. */
  dataVersion: number;
  bump: () => void;
  unlock: () => Promise<UnlockResult>;
  reloadCredStatus: () => Promise<void>;
  refreshAll: (manual: boolean) => Promise<RefreshOutcome>;
  refreshOne: (itemId: string, manual: boolean) => Promise<RefreshOutcome>;
  deleteEverything: () => Promise<void>;
  /** true enquanto a tela não deve mostrar dados (bloqueio ou app fora de foco) — UX-004. */
  privacyCover: boolean;
};

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp fora do AppProvider');
  return c;
}

export function AppProvider({ db: sqlite, children }: { db: SQLiteDatabase; children: React.ReactNode }) {
  const db = sqlite as unknown as Db;
  const repo = useMemo(() => createRepo(db), [db]);
  const client = useMemo(() => createPluggyClient({ getCredentials: () => secure.getCredentials() }), []);

  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [screenLock, setScreenLock] = useState(false);
  const [online, setOnline] = useState(true);
  const [credStatus, setCredStatus] = useState<CredStatus>('none');
  const [refreshing, setRefreshing] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [appState, setAppState] = useState<AppStateStatus>((AppState.currentState as AppStateStatus) ?? 'active');
  const backgroundAt = useRef<number | null>(null);
  const refreshInFlight = useRef<Promise<RefreshOutcome> | null>(null);

  const bump = useCallback(() => setDataVersion((v) => v + 1), []);

  const reloadCredStatus = useCallback(async () => {
    const [creds, meta] = await Promise.all([secure.getCredentials(), secure.credentialsMeta()]);
    setCredStatus(!creds ? 'none' : meta.rejected ? 'rejected' : 'ok');
  }, []);

  // Inicialização
  useEffect(() => {
    (async () => {
      // iOS mantém o Keychain após desinstalar; instalação nova começa sem sessão nem credenciais.
      if (!(await repo.getState('installed'))) {
        await secure.wipeAll();
        await repo.setState('installed', '1');
      }
      // RF-001.6: abrir do zero sempre pede o desbloqueio, se o aparelho tem bloqueio de tela.
      const hasLock = await deviceHasScreenLock();
      setScreenLock(hasLock);
      setLocked(hasLock);
      await reloadCredStatus();
      try {
        const n = await Network.getNetworkStateAsync();
        setOnline(n.isConnected !== false && n.isInternetReachable !== false);
      } catch {
        // mantém online
      }
      setReady(true);
    })();
    const sub = Network.addNetworkStateListener((n) => setOnline(n.isConnected !== false && n.isInternetReachable !== false));
    return () => sub.remove();
  }, [repo, reloadCredStatus]);

  // Bloqueio após 60 s em segundo plano (T-03) e capa de privacidade (UX-004)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setAppState(next);
      if (next === 'background') backgroundAt.current = Date.now();
      if (next === 'active') {
        const since = backgroundAt.current;
        backgroundAt.current = null;
        // O bloqueio do aparelho pode ter sido criado ou removido enquanto o app estava fora (RF-001.8).
        deviceHasScreenLock().then((hasLock) => {
          setScreenLock(hasLock);
          if (!hasLock) setLocked(false);
          else if (since && Date.now() - since > LOCK_AFTER_BACKGROUND_MS) setLocked(true);
        });
      }
    });
    return () => sub.remove();
  }, []);

  const runRefresh = useCallback(
    async (itemIds: string[], manual: boolean): Promise<RefreshOutcome> => {
      if (!itemIds.length) return 'none';
      const creds = await secure.getCredentials();
      if (!creds) return 'none';
      if (manual) {
        const last = Number((await repo.getState('last_manual_refresh')) ?? 0);
        if (Date.now() - last < MANUAL_REFRESH_MIN_MS) return 'throttled';
        await repo.setState('last_manual_refresh', String(Date.now()));
      }
      const net = await Network.getNetworkStateAsync().catch(() => null);
      if (net && (net.isConnected === false || net.isInternetReachable === false)) return 'offline';
      setRefreshing(true);
      let changed = false;
      let failed = false;
      let rejected = false;
      try {
        for (const id of itemIds) {
          const r = await syncConnection(db, repo, client, id);
          if (r.ok) changed = changed || r.originChanged;
          else {
            failed = true;
            if (r.error.kind === 'invalid_credentials') rejected = true;
          }
        }
      } finally {
        setRefreshing(false);
        bump();
      }
      if (rejected) {
        await secure.markRejected();
        await reloadCredStatus();
        return 'rejected';
      }
      if (failed) return 'failed';
      return changed ? 'ok' : 'nochange';
    },
    [db, repo, client, bump, reloadCredStatus],
  );

  const refreshAll = useCallback(
    async (manual: boolean) => {
      if (refreshInFlight.current) return refreshInFlight.current;
      // UX 0.11: conexão que aguarda nova autorização não existe mais no Pluggy; não é relida.
      const p = (async () => runRefresh((await repo.listConnections()).filter((c) => !c.replaced_at).map((c) => c.item_id), manual))();
      refreshInFlight.current = p;
      try {
        return await p;
      } finally {
        refreshInFlight.current = null;
      }
    },
    [repo, runRefresh],
  );

  const refreshOne = useCallback((itemId: string, manual: boolean) => runRefresh([itemId], manual), [runRefresh]);

  // RF-003.4: relê o Pluggy ao abrir (depois de entrar ou desbloquear), sem bloquear a tela.
  const openedOnce = useRef(false);
  useEffect(() => {
    if (ready && !locked && !openedOnce.current) {
      openedOnce.current = true;
      refreshAll(false).catch(() => undefined);
    }
  }, [ready, locked, refreshAll]);

  const unlock = useCallback(async () => {
    const r = await unlockDevice('Desbloquear o app');
    if (r.ok || r.reason === 'nolock') setLocked(false);
    return r;
  }, []);

  const deleteEverything = useCallback(async () => {
    await wipeDb(db);
    await repo.setState('installed', '1');
    await secure.wipeAll();
    client.clearCache();
    setLocked(false);
    setCredStatus('none');
    openedOnce.current = false;
    bump();
  }, [db, repo, client, bump]);

  const value: Ctx = {
    ready, db, repo, client, locked, screenLock, online, credStatus, refreshing, dataVersion,
    bump, unlock, reloadCredStatus, refreshAll, refreshOne, deleteEverything,
    // UX-004 / RF-001.9: a miniatura em apps recentes mostra só a capa, sempre.
    privacyCover: appState !== 'active',
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function isPluggyError(e: unknown): e is PluggyError {
  return e instanceof PluggyError;
}

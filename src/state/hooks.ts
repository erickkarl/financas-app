import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useApp } from './AppContext';

/** "Conectar instituição": sem credenciais abre o guia T-05 (RF-000.1, UX-005); com credenciais, T-08. */
export function useStartConnect() {
  const { credStatus } = useApp();
  return useCallback(() => {
    if (credStatus === 'none') router.push({ pathname: '/guia', params: { from: 'connect' } });
    else if (credStatus === 'rejected') router.push('/credenciais');
    else router.push('/conectar');
  }, [credStatus]);
}

/** Carrega dados e recarrega sempre que dataVersion muda. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const { dataVersion } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    loader()
      .then((d) => {
        if (alive) {
          setData(d);
          setError(false);
        }
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion, nonce, ...deps]);
  return { data, error, reload: () => setNonce((n) => n + 1) };
}

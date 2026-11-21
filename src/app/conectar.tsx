// T-08 Antes de conectar · T-09 Pluggy Connect · T-10 Resultado — RF-002.1, .2, .4, .5, .6, RF-003.1
import React, { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, useColorScheme, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { PluggyConnect } from 'react-native-pluggy-connect';
import { ActivityIndicator, HelperText, Icon, List, Text, TextInput } from 'react-native-paper';
import { Button, ListAccordion } from '../ui/touch';
import { useApp } from '../state/AppContext';
import { takeFlash } from '../state/flash';
import { useLoad } from '../state/hooks';
import { connectionLimitState, CONNECTION_LIMIT } from '../domain/credentials';
import { connectionStatusView } from '../domain/connectionStatus';
import { authValidity } from '../domain/authValidity';
import { formatCount, formatDate, formatWhen } from '../domain/format';
import { MEU_PLUGGY_CONNECTOR_ID, PluggyError } from '../pluggy/client';
import type { PluggyItem } from '../pluggy/types';
import { syncConnection } from '../data/sync';
import { secure } from '../services/secure';
import { announce, Banner, Screen, useAppTheme } from '../ui/components';

type Phase =
  | { kind: 'intro' }
  | { kind: 'preparing' }
  | { kind: 'connect'; token: string }
  | { kind: 'connected'; itemId: string; name: string; named: boolean; consentDate: string; validUntil?: string | null; importing: boolean; summary?: string; suggested?: boolean; note?: string }
  | { kind: 'replaced'; itemId: string; name: string; validUntil: string | null; unmatched: string[]; dataWhen: string | null }
  | { kind: 'expired' }
  | { kind: 'repeated'; itemId: string; oldId: string; oldName: string }
  | { kind: 'renewed'; name: string; validUntil: string | null; oldId?: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; reason: string }
  | { kind: 'pending'; itemId: string }
  | { kind: 'limit'; byPluggy?: boolean }
  | { kind: 'already'; itemId: string };

const POLL_MS = 10000;

/** Estados de T-10 com dados de exemplo; usados apenas quando __DEV__ (nunca num build de loja). */
const PREVIEWS: Record<string, Phase> = {
  conectado: { kind: 'connected', itemId: 'preview', name: 'Conexão feita', named: false, consentDate: '18/11/2026', importing: true },
  importado: { kind: 'connected', itemId: 'preview', name: 'Conexão feita', named: false, consentDate: '18/11/2026', validUntil: '18/11/2027', importing: false, summary: '3 contas e 10 transações importadas.' },
  cancelado: { kind: 'cancelled' },
  erro: { kind: 'error', reason: 'Instituição indisponível.' },
  pendente: { kind: 'pending', itemId: 'preview' },
  limite: { kind: 'limit' },
  'limite-pluggy': { kind: 'limit', byPluggy: true },
  ja: { kind: 'already', itemId: 'exemplo-1' },
  sugerido: { kind: 'connected', itemId: 'preview', name: 'BANCO AZUL conectada', named: false, suggested: true, consentDate: '18/11/2026', importing: false, summary: '2 contas e 30 transações importadas.' },
  renovada: { kind: 'renewed', name: 'BANCO AZUL', validUntil: '19/11/2027', oldId: 'exemplo-1' },
  'renovada-mesma': { kind: 'renewed', name: 'BANCO AZUL', validUntil: '19/11/2027' },
  repetida: { kind: 'repeated', itemId: 'exemplo-2', oldId: 'exemplo-1', oldName: 'Banco Aurora S.A. (Conta Pré-paga)' },
  substituida: { kind: 'replaced', itemId: 'exemplo-3', name: 'Banco Exemplo', validUntil: '19/11/2027', unmatched: [], dataWhen: null },
  'substituida-sem-par': { kind: 'replaced', itemId: 'exemplo-3', name: 'Banco Exemplo', validUntil: '19/11/2027', unmatched: ['Poupança Exemplo'], dataWhen: 'ontem às 09:24' },
  expirada: { kind: 'expired' },
};
const POLL_MAX_MS = 10 * 60 * 1000;
const BANNER_NOTE = "A janela do Pluggy mostra o nome da sua aplicação e uma faixa 'Aplicação demo. Proibido o uso comercial.' A faixa é do Pluggy, não deste app. O Pluggy informa que o uso gratuito é só para as suas próprias contas.";

function institutionName(item: Pick<PluggyItem, 'connector'>): string | null {
  const n = item.connector?.name;
  return n && n !== 'MeuPluggy' ? n : null;
}

export default function Conectar() {
  const theme = useAppTheme();
  const scheme = useColorScheme();
  const { update, preview, renovar, item: externalItem, abrir } = useLocalSearchParams<{ update?: string; preview?: string; renovar?: string; item?: string; abrir?: string }>();
  // RF-002.3.2 (UX 0.9): "Autorizar de novo". V-D (2026-11-18): o Pluggy recusa atualizar conexão do Meu Pluggy
  // (PATCH /items → 400 MEU_PLUGGY_ITEM_UPDATE_NOT_ALLOWED). Por isso a renovação abre uma conexão nova e cai no
  // fluxo de conexão repetida (UX 0.9, T-12: "vale o fluxo de conexão repetida, com a antiga revogada").
  const renewing = Boolean(update && renovar);
  const updateTarget = renewing ? undefined : update || undefined;
  const { data: updConn } = useLoad(() => (update ? repo.getConnection(update) : Promise.resolve(null)), [update]);
  const { repo, client, db, bump, reloadCredStatus } = useApp();
  const { data: count } = useLoad(() => repo.countConnections());
  // UX 0.11: conexões que aguardam nova autorização (já excluídas no Pluggy, dados no aparelho).
  const { data: awaitingList } = useLoad(async () => (await repo.listConnections()).filter((c) => c.replaced_at));
  const awaiting = Boolean(updConn?.replaced_at) || (__DEV__ && preview?.startsWith('aguardando'));
  const tokenAt = useRef(0);
  // Só no build de desenvolvimento: força um resultado de T-10 para captura (financasapp://conectar?preview=...).
  const [phase, setPhase] = useState<Phase>(() => (__DEV__ && preview && PREVIEWS[preview]) || { kind: 'intro' });
  useEffect(() => {
    if (__DEV__ && preview && PREVIEWS[preview]) setPhase(PREVIEWS[preview]);
  }, [preview]);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [flash] = useState(() => takeFlash('conectar'));
  const resolved = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
  }, []);

  // Só no build de desenvolvimento: recebe a conexão concluída na janela oficial do Pluggy na web (o login do
  // Meu Pluggy é feito pela pessoa no navegador) e segue exatamente o mesmo caminho do onSuccess da janela no app.
  const externalDone = useRef(false);
  useEffect(() => {
    if (!__DEV__ || !externalItem || externalDone.current || !repo) return;
    externalDone.current = true;
    resolved.current = true;
    client.getItem(externalItem).then((it) => importItem(it)).catch(() => setPhase({ kind: 'error', reason: 'Tente de novo em alguns minutos.' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalItem, repo, updConn]);

  // Só no build de desenvolvimento: ?preview=renovar-limite força 5 de 5 na renovação (REV-33).
  const limit = connectionLimitState(__DEV__ && (preview === 'renovar-limite' || preview === 'aguardando-limite') ? CONNECTION_LIMIT : count ?? 0);
  // UX 0.11: "Substituir a autorização" abre a janela em seguida (?abrir=1), sem passar pela tela de explicação.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (abrir && updConn && !autoOpened.current) {
      autoOpened.current = true;
      prepare();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrir, updConn]);
  const first = (count ?? 0) === 0 || (__DEV__ && preview === 'primeira');

  async function prepare() {
    // A renovação também ocupa uma conexão nova até a antiga ser revogada (com 5 de 5: "Substituir", UX 0.11).
    if (renewing && limit === 'full') return;
    if (!update && limit === 'full') return setPhase({ kind: 'limit' });
    setPrepError(null);
    setPhase({ kind: 'preparing' });
    announce('Abrindo o Pluggy…');
    try {
      const token = await client.createConnectToken(updateTarget);
      tokenAt.current = Date.now();
      resolved.current = false;
      setPhase({ kind: 'connect', token });
    } catch (e) {
      if (e instanceof PluggyError && e.kind === 'invalid_credentials') {
        await secure.markRejected();
        await reloadCredStatus();
        router.replace('/credenciais');
        return;
      }
      setPhase({ kind: 'intro' });
      setPrepError('Não foi possível abrir a janela do Pluggy. Tente de novo.');
    }
  }

  async function importItem(item: PluggyItem) {
    const exists = await repo.getConnection(item.id);
    if (exists && !update) {
      setPhase({ kind: 'already', itemId: item.id });
      return;
    }
    await repo.addConnection(item.id, new Date().toISOString());
    bump();
    const name = institutionName(item);
    const itemValidity = authValidity(item.consentExpiresAt);
    setPhase({ kind: 'connected', itemId: item.id, name: name ? `${name} conectada` : 'Conexão feita', named: Boolean(name), consentDate: formatDate(new Date(item.createdAt)), validUntil: itemValidity.state === 'unknown' ? null : itemValidity.date, importing: true });
    announce(name ? `${name} conectada` : 'Conexão feita');
    const r = await syncConnection(db, repo, client, item.id);
    bump();
    const summary = r.ok
      ? `${r.accounts} ${r.accounts === 1 ? 'conta' : 'contas'} e ${formatCount(r.transactions)} ${r.transactions === 1 ? 'transação importada' : 'transações importadas'}.`
      : 'Parte dos dados não veio. Vamos tentar de novo na próxima atualização.';
    // UX 0.11 / R-14.2 (3): a conexão aguardava nova autorização e a nova traz contas dela → renovada, sem passo de
    // revogar (a antiga já foi excluída). Contas sem par ficam "Sem autorização" e saem do saldo (R-17).
    if (r.ok && awaiting && update && r.repeatedOf.includes(update)) {
      const oldName = updConn?.name ?? 'esta conexão';
      const done = await repo.finishReplacement(update, item.id);
      bump();
      const fresh = await repo.getConnection(item.id);
      const v = authValidity(fresh?.auth_expires_at);
      setPhase({ kind: 'replaced', itemId: item.id, name: oldName, validUntil: v.state === 'unknown' ? null : v.date, unmatched: done.unmatched, dataWhen: done.dataDate ? formatWhen(new Date(done.dataDate)) : null });
      announce(`Autorização de ${oldName} renovada`);
      return;
    }
    // UX 0.8: contas que já estavam noutra conexão → "Esta instituição já estava conectada".
    // [0.10] REV-32: renovando, a conexão nova traz as contas da que estava sendo renovada → "Autorização renovada",
    // com o passo de revogar a antiga (E-7 a: a pessoa revoga, com a confirmação).
    if (r.ok && renewing && !awaiting && update && r.repeatedOf.includes(update)) {
      const fresh = await repo.getConnection(item.id);
      const old = await repo.getConnection(update);
      const v = authValidity(fresh?.auth_expires_at);
      const oldName = old?.name ?? 'esta conexão';
      setPhase({ kind: 'renewed', name: oldName, validUntil: v.state === 'unknown' ? null : v.date, oldId: update });
      announce(`Autorização de ${oldName} renovada`);
      return;
    }
    if (r.ok && r.repeatedOf.length) {
      const oldId = r.repeatedOf[0];
      const old = await repo.getConnection(oldId);
      setPhase({ kind: 'repeated', itemId: item.id, oldId, oldName: old?.name ?? 'a outra conexão' });
      announce('Esta instituição já estava conectada');
      return;
    }
    // RF-002.3.2: se o Pluggy devolver a mesma conexão → "Autorização de {nome} renovada", com a validade nova.
    if (renewing && item.id === update) {
      const fresh = await repo.getConnection(item.id);
      const v = authValidity(fresh?.auth_expires_at);
      setPhase({ kind: 'renewed', name: fresh?.name ?? 'esta conexão', validUntil: v.state === 'unknown' ? null : v.date });
      announce(`Autorização de ${fresh?.name ?? 'esta conexão'} renovada`);
      return;
    }
    // 7.4: com as contas importadas, o título usa o nome sugerido pela conta.
    const fresh = await repo.getConnection(item.id);
    const suggested = Boolean(fresh?.suggested_name && !fresh.user_name);
    // [0.10] Renovando, mas a pessoa autorizou outro banco na janela: resultado normal + a antiga continua.
    const nowCount = await repo.countConnections();
    const note = awaiting && update
      ? `${updConn?.name ?? 'A conexão'} continua aguardando nova autorização.${nowCount >= CONNECTION_LIMIT ? ' Você voltou a usar as 5 conexões.' : ''}`
      : renewing && update ? `A autorização de ${updConn?.name ?? 'esta conexão'} continua como estava.` : undefined;
    setPhase((p) => (p.kind === 'connected' ? { ...p, importing: false, summary, note, ...(suggested && fresh ? { name: `${fresh.name} conectada`, suggested: true } : {}) } : p));
    announce(summary);
  }

  function startPolling(itemId: string) {
    const startedAt = Date.now();
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      if (Date.now() - startedAt > POLL_MAX_MS) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        return;
      }
      try {
        const item = await client.getItem(itemId);
        const code = item.error?.code ?? item.executionStatus;
        if (code === 'USER_AUTHORIZATION_PENDING' || item.status === 'UPDATING' || item.status === 'WAITING_USER_ACTION') return;
        if (pollTimer.current) clearInterval(pollTimer.current);
        if (code === 'USER_AUTHORIZATION_NOT_GRANTED') {
          await repo.deleteConnectionData(itemId);
          bump();
          setPhase({ kind: 'cancelled' });
        } else if (item.status === 'UPDATED') {
          await importItem(item);
        }
      } catch {
        // tenta de novo no próximo intervalo
      }
    }, POLL_MS);
  }

  // ---------- T-09: janela do Pluggy ----------
  if (phase.kind === 'connect') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <PluggyConnect
          connectToken={phase.token}
          selectedConnectorId={MEU_PLUGGY_CONNECTOR_ID}
          updateItem={updateTarget}
          language="pt"
          theme={scheme === 'dark' ? 'dark' : 'light'}
          onSuccess={async ({ item }) => {
            resolved.current = true;
            await importItem(item as unknown as PluggyItem);
          }}
          onError={async (error) => {
            resolved.current = true;
            const item = error.data?.item as unknown as PluggyItem | undefined;
            const code = item?.error?.code ?? item?.executionStatus ?? null;
            if (item && code === 'USER_AUTHORIZATION_PENDING') {
              // onSuccess nem sempre é chamado (F7): pendente chega como erro.
              await repo.addConnection(item.id, new Date().toISOString());
              await repo.getConnection(item.id);
              bump();
              setPhase({ kind: 'pending', itemId: item.id });
              startPolling(item.id);
              return;
            }
            if (code === 'USER_AUTHORIZATION_NOT_GRANTED') return setPhase({ kind: 'cancelled' });
            // UX 0.12 / V-J: código de acesso da janela vencido. No teste real (19/11), o Pluggy recusou a criação com
            // 403 e a janela devolveu API_KEY_MISSING_OR_INVALID ("sua sessão expirou"). Também vale passar de 30 min.
            const expiredText = `${error.message ?? ''} ${item?.error?.code ?? ''}`;
            if (/API_KEY_MISSING_OR_INVALID|expir/i.test(expiredText) || (tokenAt.current && Date.now() - tokenAt.current > 30 * 60 * 1000 && !item)) {
              return setPhase({ kind: 'expired' });
            }
            const view = item
              ? connectionStatusView({ status: item.status, executionStatus: item.executionStatus, errorCode: item.error?.code ?? null, originUpdatedAt: null })
              : null;
            // DEV-9: recusa por limite com o contador do app abaixo de 5. O código exato do Pluggy não foi visto
            // em teste real [NV]; reconhecido pelo texto "limit" na mensagem ou no código.
            const limitText = `${error.message ?? ''} ${item?.error?.code ?? ''} ${item?.error?.message ?? ''}`;
            if (/limit/i.test(limitText)) return setPhase({ kind: 'limit', byPluggy: (count ?? 0) < CONNECTION_LIMIT });
            setPhase({ kind: 'error', reason: view ? view.label : 'Tente de novo em alguns minutos.' });
          }}
          onClose={() => {
            // Fechar pelo botão ou pelo gesto de voltar conta como "cancelado".
            if (!resolved.current) setPhase({ kind: 'cancelled' });
          }}
        />
      </View>
    );
  }

  const goHome = () => router.dismissTo('/(tabs)');
  const awaitingText = `Os dados de ${updConn?.name ?? 'esta conexão'} continuam neste aparelho, aguardando nova autorização. Você pode tentar de novo quando quiser.`;
  const again = () => setPhase({ kind: 'intro' });

  return (
    <Screen style={{ gap: 12, paddingTop: 16 }}>
      {flash && <Banner tone="info" icon="check-circle-outline" text={flash} />}

      {(phase.kind === 'intro' || phase.kind === 'preparing') && (
        <>
          <Text variant="headlineSmall" accessibilityRole="header">{awaiting ? `Autorizar ${updConn?.name ?? 'esta conexão'} de novo` : renewing ? 'Autorizar de novo' : update ? 'Reconectar' : 'Trazer um banco para o app'}</Text>
          <Text variant="bodyLarge">
            {awaiting
              ? `Vamos abrir a janela do Pluggy para você autorizar ${updConn?.name ?? 'esta conexão'} de novo. Seus dados e categorias continuam aqui.`
              : renewing
              ? `Vamos abrir a janela do Pluggy para você autorizar ${updConn?.name ?? 'esta conexão'} de novo. O Pluggy cria uma autorização nova no lugar da atual; no fim, você revoga a antiga. Seus dados e categorias continuam aqui.`
              : first
              ? "Vamos abrir a janela do Pluggy. Entre com sua conta do Meu Pluggy e autorize. Faça isso uma vez para cada banco."
              : 'Autorize mais um banco na janela do Pluggy.'}
          </Text>
          {first && <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>Você pode revogar essa autorização quando quiser em Ajustes → Conexões.</Text>}
          <Text variant="bodyMedium">{`${__DEV__ && preview === 'renovar-limite' ? CONNECTION_LIMIT : count ?? 0} de ${CONNECTION_LIMIT} conexões do plano gratuito do Pluggy.`}</Text>
          {limit === 'last' && (!update || renewing) && <Banner icon="alert-outline" text="Esta é a sua última conexão disponível." />}
          {/* UX 0.11: proteger a vaga de quem aguarda nova autorização. */}
          {!update && limit === 'last' && (awaitingList?.length ?? 0) > 0 && (
            <Banner icon="alert-outline" text={`${awaitingList![0].name} está aguardando nova autorização. Se você usar esta vaga com outro banco, não vai conseguir autorizar ${awaitingList![0].name} de novo sem revogar uma conexão.`} />
          )}
          {prepError && <Banner tone="error" icon="alert-circle-outline" text={prepError} />}
          {/* [0.13] RF-000.6 / R-15.2: aviso da faixa do Pluggy; aberto na primeira conexão, recolhido nas outras. Sem confirmação. */}
          {first && !update ? (
            <View style={s.bannerNote}>
              <Icon source="information-outline" size={20} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodyMedium" style={{ flex: 1 }}>{BANNER_NOTE}</Text>
            </View>
          ) : (
            <ListAccordion title="Sobre a faixa que aparece na janela do Pluggy" expanded={noteOpen} onPress={() => setNoteOpen(!noteOpen)} style={{ paddingHorizontal: 0 }}>
              <Text variant="bodyMedium" style={{ paddingBottom: 8 }}>{BANNER_NOTE}</Text>
            </ListAccordion>
          )}
          {limit === 'full' && awaiting ? (
            <>
              <Banner icon="alert-outline" text={`Você usa as 5 conexões. Para autorizar ${updConn?.name ?? 'esta conexão'} de novo, revogue uma conexão ou apague os dados que estão aguardando.`} />
              <Button mode="contained" onPress={() => router.replace('/conexoes')} contentStyle={s.btn}>Ver conexões</Button>
            </>
          ) : limit === 'full' && renewing && update ? (
            // UX 0.11 (Q21 a): com 5 de 5, renovar é "Substituir a autorização".
            <Button mode="contained" onPress={() => router.replace({ pathname: '/substituir/[id]', params: { id: update } })} contentStyle={s.btn}>Substituir a autorização</Button>
          ) : limit === 'full' && !update ? (
            <LimitReached />
          ) : (
            <Button mode="contained" onPress={prepare} loading={phase.kind === 'preparing'} disabled={phase.kind === 'preparing'} contentStyle={s.btn}>
              {phase.kind === 'preparing' ? 'Abrindo o Pluggy…' : 'Continuar'}
            </Button>
          )}
        </>
      )}

      {phase.kind === 'connected' && (
        <>
          <Icon source="check-circle" size={48} color={theme.colors.primary} />
          <Text variant="headlineSmall" accessibilityRole="header">{phase.name}</Text>
          <Text variant="bodyLarge">{`Autorizada em ${phase.consentDate}.${phase.validUntil ? ` Válida até ${phase.validUntil}.` : ''}`}</Text>
          {!phase.named && <NameField itemId={phase.itemId} suggested={phase.suggested} />}
          {phase.importing ? (
            <View style={s.row} accessibilityLiveRegion="polite">
              <ActivityIndicator size={16} />
              <Text variant="bodyMedium" style={{ marginLeft: 8 }}>Importando contas e transações…</Text>
            </View>
          ) : (
            <Text variant="bodyMedium" accessibilityLiveRegion="polite">{phase.summary}</Text>
          )}
          {phase.note && <Text variant="bodyMedium">{phase.note}</Text>}
          <Button mode="contained" onPress={goHome} contentStyle={s.btn}>Ver minhas contas</Button>
          <Button onPress={again} contentStyle={s.btn}>Conectar outro banco</Button>
        </>
      )}

      {phase.kind === 'cancelled' && (
        <>
          <Icon source="information-outline" size={48} color={theme.colors.onSurfaceVariant} />
          <Text variant="headlineSmall" accessibilityRole="header">{awaiting ? 'A nova autorização não foi feita' : 'A conexão não foi feita'}</Text>
          <Text variant="bodyLarge">{awaiting ? awaitingText : update ? 'Você cancelou ou não autorizou. A autorização anterior continua como estava.' : 'Você cancelou ou não autorizou. Nenhum dado foi importado.'}</Text>
          <Button mode="contained" onPress={prepare} contentStyle={s.btn}>Tentar de novo</Button>
          <Button onPress={goHome} contentStyle={s.btn}>Agora não</Button>
        </>
      )}

      {phase.kind === 'error' && (
        <>
          <Icon source="alert-circle-outline" size={48} color={theme.colors.error} />
          <Text variant="headlineSmall" accessibilityRole="header">{awaiting ? 'A nova autorização não foi feita' : 'Não foi possível conectar'}</Text>
          <Text variant="bodyLarge">{phase.reason}</Text>
          <Text variant="bodyMedium">{awaiting ? awaitingText : update ? 'A autorização anterior continua como estava.' : 'Nenhum dado foi importado.'}</Text>
          <Button mode="contained" onPress={prepare} contentStyle={s.btn}>Tentar de novo</Button>
          <Button onPress={goHome} contentStyle={s.btn}>Agora não</Button>
        </>
      )}

      {phase.kind === 'pending' && (
        <>
          <ActivityIndicator size={32} />
          <Text variant="headlineSmall" accessibilityRole="header">Falta autorizar no seu banco</Text>
          <Text variant="bodyLarge">Abra o app do seu banco e confirme. Esta tela atualiza sozinha.</Text>
          <Button onPress={goHome} contentStyle={s.btn}>Fechar e continuar depois</Button>
        </>
      )}

      {phase.kind === 'limit' && <LimitReached byPluggy={phase.byPluggy} />}

      {phase.kind === 'expired' && (
        <>
          <Icon source="timer-off-outline" size={48} color={theme.colors.onSurfaceVariant} />
          <Text variant="headlineSmall" accessibilityRole="header">A janela do Pluggy expirou</Text>
          <Text variant="bodyLarge">Passou do tempo que o Pluggy dá para concluir. Nada foi criado nem importado.</Text>
          {awaiting ? <Text variant="bodyMedium">{`Os dados de ${updConn?.name ?? 'esta conexão'} continuam neste aparelho, aguardando nova autorização.`}</Text>
            : renewing ? <Text variant="bodyMedium">A autorização anterior continua como estava.</Text> : null}
          <Button mode="contained" onPress={prepare} contentStyle={s.btn}>Tentar de novo</Button>
          <Button onPress={goHome} contentStyle={s.btn}>Agora não</Button>
        </>
      )}

      {phase.kind === 'replaced' && (
        <>
          <Icon source="check-circle" size={48} color={theme.colors.primary} />
          <Text variant="headlineSmall" accessibilityRole="header">{`Autorização de ${phase.name} renovada`}</Text>
          {phase.validUntil && <Text variant="bodyLarge">{`Válida até ${phase.validUntil}.`}</Text>}
          <Text variant="bodyMedium">Suas contas, transações e categorias continuam.</Text>
          {phase.unmatched.length > 0 && (
            <Banner
              icon="alert-outline"
              text={`${phase.unmatched.length} ${phase.unmatched.length === 1 ? 'conta da autorização antiga não veio' : 'contas da autorização antiga não vieram'} na nova: ${phase.unmatched.join(', ')}. ${phase.unmatched.length === 1 ? 'Ela continua visível' : 'Elas continuam visíveis'} com os dados de ${phase.dataWhen ?? '—'}, mas não ${phase.unmatched.length === 1 ? 'entra' : 'entram'} mais nos seus saldos.`}
              actionLabel="Rever essas contas"
              onAction={() => router.replace({ pathname: '/conexoes/[id]', params: { id: phase.itemId } })}
            />
          )}
          <Button mode="contained" onPress={goHome} contentStyle={s.btn}>Ver minhas contas</Button>
        </>
      )}

      {phase.kind === 'renewed' && (
        <>
          <Icon source="check-circle" size={48} color={theme.colors.primary} />
          <Text variant="headlineSmall" accessibilityRole="header">{`Autorização de ${phase.name} renovada`}</Text>
          {phase.validUntil && <Text variant="bodyLarge">{`Válida até ${phase.validUntil}.`}</Text>}
          {phase.oldId ? (
            <>
              <Text variant="bodyMedium">Falta um passo: revogar a autorização antiga. Ela não recebe mais dados e ocupa uma das 5 conexões do plano gratuito do Pluggy. Suas contas, transações e categorias continuam.</Text>
              <Button mode="contained" onPress={() => router.replace({ pathname: '/conexoes/[id]', params: { id: phase.oldId!, revogar: '1', renovacao: '1' } })} contentStyle={s.btn}>Revogar a autorização antiga</Button>
              <Button onPress={goHome} contentStyle={s.btn}>Depois</Button>
            </>
          ) : (
            <Button mode="contained" onPress={goHome} contentStyle={s.btn}>Ver minhas contas</Button>
          )}
        </>
      )}

      {phase.kind === 'repeated' && (
        <>
          <Icon source="information-outline" size={48} color={theme.colors.onSurfaceVariant} />
          <Text variant="headlineSmall" accessibilityRole="header">Esta instituição já estava conectada</Text>
          <Text variant="bodyLarge">{`As contas desta conexão são as mesmas de ${phase.oldName}. Seus saldos e transações não foram contados duas vezes.`}</Text>
          <Text variant="bodyMedium">A conexão antiga não recebe mais dados e ocupa uma das 5 conexões do plano gratuito do Pluggy.</Text>
          <Button mode="contained" onPress={() => router.replace({ pathname: '/conexoes/[id]', params: { id: phase.oldId, revogar: '1' } })} contentStyle={s.btn}>Revogar a conexão antiga</Button>
          <Button onPress={goHome} contentStyle={s.btn}>Manter as duas por enquanto</Button>
        </>
      )}

      {phase.kind === 'already' && (
        <>
          <Icon source="information-outline" size={48} color={theme.colors.onSurfaceVariant} />
          <Text variant="headlineSmall" accessibilityRole="header">Este banco já está conectado.</Text>
          <Button mode="contained" onPress={() => router.replace(`/conexoes/${phase.itemId}`)} contentStyle={s.btn}>Ver conexão</Button>
        </>
      )}
    </Screen>
  );
}

function LimitReached({ byPluggy }: { byPluggy?: boolean }) {
  if (byPluggy) {
    return (
      <>
        <Text variant="titleLarge" accessibilityRole="header">Limite de conexões atingido</Text>
        <Text variant="bodyLarge">O Pluggy recusou por limite de conexões. Podem existir conexões feitas antes, em outro aparelho ou em outra instalação, que este app não enxerga nem consegue apagar. Veja suas conexões no painel do Pluggy.</Text>
        <Button mode="contained" onPress={() => Linking.openURL('https://dashboard.pluggy.ai')} contentStyle={s.btn}>Abrir o painel do Pluggy</Button>
      </>
    );
  }
  return (
    <>
      <Text variant="titleLarge" accessibilityRole="header">Limite de conexões atingido</Text>
      <Text variant="bodyLarge">O plano gratuito do Pluggy aceita até 5 conexões ativas, todas de contas suas. Revogue uma conexão para adicionar outra.</Text>
      <Button mode="contained" onPress={() => router.replace('/conexoes')} contentStyle={s.btn}>Ver conexões</Button>
    </>
  );
}

/** T-10: nome opcional quando o Pluggy não informa o banco (7.4); não impede seguir. Grava ao sair do campo. */
function NameField({ itemId, suggested }: { itemId: string; suggested?: boolean }) {
  const { repo, bump } = useApp();
  const [value, setValue] = useState('');
  return (
    <View>
      <TextInput
        mode="outlined"
        label={suggested ? 'Nome desta conexão' : 'Dê um nome a esta conexão'}
        accessibilityLabel={suggested ? 'Nome desta conexão. Sugerido pelo nome da conta. Você pode mudar.' : 'Dê um nome a esta conexão. Por exemplo, o nome do banco.'}
        value={value}
        onChangeText={setValue}
        maxLength={30}
        onBlur={async () => { await repo.renameConnection(itemId, value); bump(); }}
        onSubmitEditing={async () => { await repo.renameConnection(itemId, value); bump(); }}
      />
      <HelperText type="info">{suggested ? 'Sugerido pelo nome da conta. Você pode mudar.' : 'Por exemplo, o nome do banco.'}</HelperText>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { minHeight: 48 },
  row: { flexDirection: 'row', alignItems: 'center' },
  bannerNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});

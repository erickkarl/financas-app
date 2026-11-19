// T-12 Detalhe da conexão — RF-002.3, RF-003.2, RF-003.3, RF-009.1, RNF-003
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { ActivityIndicator, Dialog, Divider, HelperText, List, Portal, Text, TextInput } from 'react-native-paper';
import { Button, IconButton } from '../../ui/touch';
import { useApp } from '../../state/AppContext';
import { setFlash, takeFlash } from '../../state/flash';
import { secure } from '../../services/secure';
import { PluggyError } from '../../pluggy/client';
import { useLoad } from '../../state/hooks';
import { connectionStatusView } from '../../domain/connectionStatus';
import { revokedMessage } from '../../domain/revokeText';
import { useKeyboardHeight } from '../../ui/useKeyboardHeight';
import { authMessage, authValidity, setPreviewValidity } from '../../domain/authValidity';
import { balanceA11y, formatBalance, formatDate, formatDateTime, formatUpdated, formatWhen, isMaskingValues, setMaskValues } from '../../domain/format';
import type { PluggyConsent } from '../../pluggy/types';
import { announce, Banner, EmptyState, FieldError, NoCredentialsHelp, SectionTitle, Screen, Skeleton, StatusLabel, styles as ui, useAppTheme } from '../../ui/components';

const PRODUCT_LABEL: Record<string, string> = {
  ACCOUNTS: 'Contas e saldos',
  TRANSACTIONS: 'Transações',
  CREDIT_CARDS: 'Cartões de crédito',
  INVESTMENTS: 'Investimentos',
  INVESTMENTS_TRANSACTIONS: 'Movimentações de investimentos',
  IDENTITY: 'Dados cadastrais',
  PAYMENT_DATA: 'Dados de pagamentos',
  LOANS: 'Empréstimos',
};

/** "a, b, c, d e mais {k}" — listas com mais de 4 contas (UX 0.9). */
function shortList(names: string[]): string {
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} e mais ${names.length - 4}` : names.join(', ');
}

export default function ConexaoDetalhe() {
  const theme = useAppTheme();
  const navigation = useNavigation();
  const { id, revogar: autoRevoke, autorizar: autoAuthorize, renovacao, mascarar, validade, credenciais, preview } = useLocalSearchParams<{ id: string; revogar?: string; autorizar?: string; renovacao?: string; mascarar?: string; validade?: string; credenciais?: string; preview?: string }>();
  // Capturas de evidência (só em desenvolvimento): esconde valores e finais de conta; força validade e estado das credenciais.
  if (__DEV__ && mascarar === '1' && !isMaskingValues()) setMaskValues(true);
  if (__DEV__ && validade) setPreviewValidity(validade);
  const { repo, client, refreshOne, bump, credStatus: realCredStatus, reloadCredStatus } = useApp();
  const credStatus = __DEV__ && (credenciais === 'none' || credenciais === 'rejected') ? credenciais : realCredStatus;
  const { data, error, reload } = useLoad(async () => {
    const c = await repo.getConnection(id);
    const accounts = (await repo.listAccounts()).filter((a) => a.item_id === id);
    const other = c?.duplicate_of ? await repo.getConnection(c.duplicate_of) : null;
    const sharing = c ? await repo.accountSharing(id) : { shared: [], exclusive: [] };
    return { c, accounts, other, sharing };
  }, [id]);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [tech, setTech] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const kbHeight = useKeyboardHeight();
  // RF-009.1.1 (UX 0.8): sem credenciais ou com credenciais recusadas, abre este diálogo no lugar da confirmação.
  const [credGate, setCredGate] = useState<null | 'none' | 'rejected'>(null);
  // Para que o diálogo de credenciais foi aberto: revogar ou autorizar de novo (UX 0.9).
  const [gateFor, setGateFor] = useState<'revogar' | 'autorizar'>('revogar');
  const [notice, setNotice] = useState<string | null>(null);
  const autoOpened = useRef(false);

  function startRevoke() {
    setRevokeError(null);
    setGateFor('revogar');
    if (credStatus === 'none') return setCredGate('none');
    if (credStatus === 'rejected') return setCredGate('rejected');
    setConfirm(true);
  }
  // RF-002.3.2: "Autorizar de novo" exige credenciais válidas, com o mesmo diálogo de revogar.
  async function startAuthorize() {
    setGateFor('autorizar');
    if (credStatus === 'none') return setCredGate('none');
    if (credStatus === 'rejected') return setCredGate('rejected');
    // UX 0.11 / R-14.2: com 5 de 5 (e a conexão ainda no Pluggy), "Substituir a autorização".
    if (!data?.c?.replaced_at && (await repo.countConnections()) >= 5) {
      router.push({ pathname: '/substituir/[id]', params: { id } });
      return;
    }
    router.push({ pathname: '/conectar', params: { update: id, renovar: '1' } });
  }
  // R-16: apagar só os dados desta conexão, que aguarda nova autorização (sem credenciais; já saiu do Pluggy).
  // Só no build de desenvolvimento: ?preview=apagar-dados abre a confirmação de R-16 para captura (nada é apagado sem tocar em "Apagar").
  const [wipeConfirm, setWipeConfirm] = useState(__DEV__ && preview === 'apagar-dados');
  const [deleteAccount, setDeleteAccount] = useState<{ id: string; name: string } | null>(null);
  // Vindo de T-10 ("Revogar a conexão antiga") ou de T-11 ("Revogar") numa conexão repetida.
  useEffect(() => {
    if ((autoRevoke || autoAuthorize) && data?.c && !autoOpened.current) {
      autoOpened.current = true;
      if (autoRevoke) startRevoke();
      else startAuthorize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRevoke, autoAuthorize, data?.c]);
  // Voltando de T-06 com "Códigos salvos.": a pessoa toca em "Revogar conexão" de novo.
  // Lê o aviso quando a tela ganha o foco (a pessoa voltou para cá), não quando o estado muda.
  useFocusEffect(
    useCallback(() => {
      const m = takeFlash(`voltar:/conexoes/${id}`);
      if (m) setNotice(m);
    }, [id]),
  );

  const c = data?.c;
  // Regra 7.4; o título da barra é "Conexão" para o nome aparecer uma vez só (REV-10).
  const name = c?.name ?? 'Conexão';
  const realName = c?.has_real_name ? c.name : null;
  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Conexão' });
  }, [navigation]);

  if (error) return <EmptyState icon="alert-circle-outline" title="Não foi possível carregar a conexão." actionLabel="Tentar de novo" onAction={reload} />;
  if (!data) return <Screen><Skeleton lines={4} /></Screen>;
  if (!c) return <EmptyState icon="bank-off-outline" title="Esta conexão não existe mais." actionLabel="Ver conexões" onAction={() => router.replace('/conexoes')} />;

  const origin = c.origin_updated_at ? new Date(c.origin_updated_at) : null;
  const view = connectionStatusView({ status: c.status, executionStatus: c.execution_status, errorCode: c.error_code, originUpdatedAt: origin });
  let consent: PluggyConsent | null = null;
  try {
    consent = c.consent_json ? (JSON.parse(c.consent_json) as PluggyConsent) : null;
  } catch {
    consent = null;
  }
  const authorized = consent ? consent.products.map((p) => PRODUCT_LABEL[p]).filter(Boolean) : [];

  const awaiting = Boolean(c.replaced_at);
  const dataWhen = origin ? formatWhen(origin) : null;
  const validity = awaiting ? ({ state: 'unknown' } as const) : authValidity(c.auth_expires_at);
  const authMsg = authMessage(validity);
  const validityBlock = awaiting ? (
    <Text variant="bodyMedium">{`Autorização excluída em ${formatDate(new Date(c.replaced_at!))}. Aguardando nova autorização.`}</Text>
  ) : (
    <>
      <View style={[ui.row, { flexWrap: 'wrap', justifyContent: 'space-between' }]}>
        <Text variant="bodyMedium">{validity.state === 'unknown' ? 'Válida até: Sem validade informada' : `Válida até: ${validity.date}`}</Text>
        {validity.state !== 'unknown' && <Button onPress={startAuthorize}>Autorizar de novo</Button>}
      </View>
      {validity.state !== 'unknown' && (
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>O Pluggy informa que esta autorização vale um ano. A data é calculada com os dados da conexão e pode não ser exata.</Text>
      )}
    </>
  );

  async function atualizar() {
    setUpdating(true);
    setRefreshMsg(null);
    const r = await refreshOne(id, true);
    setUpdating(false);
    const fresh = await repo.getConnection(id);
    const freshOrigin = fresh?.origin_updated_at ? new Date(fresh.origin_updated_at) : null;
    const msg =
      r === 'ok' ? 'Dados atualizados'
      : r === 'nochange' ? `Não há dados novos. Última atualização do banco: ${freshOrigin ? formatUpdated(freshOrigin).replace('Atualizado ', '') : '—'}.`
      : r === 'throttled' ? 'Você já atualizou há pouco. Tente de novo em alguns minutos.'
      : r === 'rejected' ? 'O Pluggy recusou suas credenciais. Troque-as em Ajustes → Credenciais do Pluggy.'
      : `Não foi possível atualizar. Mantivemos os dados de ${freshOrigin ? formatWhen(freshOrigin) : '—'}.`;
    setRefreshMsg(msg);
    announce(msg);
  }

  async function revogar() {
    setRevoking(true);
    setRevokeError(null);
    try {
      // Só confirma depois da resposta do Pluggy (RF-009.1, UX-030); o aparelho só depois do Pluggy (RF-009.1.1).
      await client.deleteItem(id);
      // Repetida: o nome da antiga passa para a nova, se a nova usa o nome sugerido [UX 0.8; UX-072].
      if (c?.duplicate_of) await repo.passNameOnRevoke(id, c.duplicate_of);
      const res = await repo.deleteConnectionData(id);
      const label = name.startsWith('Conexão ') ? name : `Conexão ${name}`;
      // [0.10] REV-32: revogar a antiga ao fim de "Autorizar de novo".
      const renewedInto = renovacao && c?.duplicate_of ? await repo.getConnection(c.duplicate_of) : null;
      const left = await repo.countConnections();
      if (renewedInto) setFlash('conexoes', `Autorização antiga revogada. ${renewedInto.name} continua no app, com ${left} de 5 conexões.`);
      else setFlash('conexoes', revokedMessage(label, res.kept, res.keptWith));
      setConfirm(false);
      bump();
      router.replace('/conexoes');
    } catch (e) {
      if (e instanceof PluggyError && e.kind === 'invalid_credentials') {
        // Recusadas no momento de revogar: troca para o diálogo de credenciais recusadas; nada é apagado.
        await secure.markRejected();
        await reloadCredStatus();
        setConfirm(false);
        setCredGate('rejected');
        return;
      }
      setRevokeError('Não foi possível revogar agora. A conexão continua ativa e nenhum dado foi apagado. Tente de novo.');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <>
      <Screen style={{ paddingTop: 8, gap: 4 }}>
        {authMsg && (
          <Banner tone={validity.state === 'expired' ? 'error' : 'warning'} icon={validity.state === 'expired' ? 'alert-circle-outline' : 'alert-outline'} text={authMsg} actionLabel="Autorizar de novo" onAction={startAuthorize} />
        )}
        {awaiting && (
          <Banner icon="alert-outline" text={`Aguardando nova autorização.${dataWhen ? ` Dados de ${dataWhen}.` : ''}`} actionLabel="Autorizar agora" onAction={startAuthorize} />
        )}
        {notice && <Banner tone="info" icon="check-circle-outline" text={notice} secondaryLabel="Fechar" onSecondary={() => setNotice(null)} />}
        {credStatus === 'none' && (
          <Banner text="Sem credenciais do Pluggy, seus dados não são atualizados." actionLabel="Configurar" onAction={() => router.push('/guia')} />
        )}
        <View style={[ui.row, { gap: 4 }]}>
          <Text variant="titleLarge" accessibilityRole="header" style={{ flexShrink: 1 }}>{name}</Text>
          <IconButton icon="pencil-outline" accessibilityLabel="Renomear" onPress={() => { setDraftName(c.user_name ?? ''); setRenaming(true); }} />
        </View>
        {/* UX-072: autorização vencida mostra o estado de erro. */}
        <StatusLabel view={awaiting ? { ...view, label: 'Aguardando nova autorização', tone: 'warning' } : validity.state === 'expired' ? { ...view, label: `Autorização vencida em ${validity.date}`, tone: 'error' } : view} />
        {!awaiting && (view.action === 'reconnect' || view.action === 'continue') ? (
          <Button mode="outlined" onPress={() => router.push({ pathname: '/conectar', params: { update: id } })} style={{ alignSelf: 'flex-start' }}>
            {view.action === 'continue' ? 'Continuar' : 'Reconectar'}
          </Button>
        ) : null}

        <SectionTitle>Atualização</SectionTitle>
        <Text variant="bodyLarge">{origin ? formatUpdated(origin) : 'Ainda sem dados do banco'}</Text>
        <Button mode="contained-tonal" onPress={atualizar} disabled={updating || validity.state === 'expired' || awaiting} icon={updating ? undefined : 'refresh'} style={{ alignSelf: 'flex-start' }} contentStyle={{ minHeight: 48 }}>
          {updating ? 'Atualizando…' : 'Atualizar agora'}
        </Button>
        {updating && <ActivityIndicator size={16} style={{ alignSelf: 'flex-start' }} />}
        {(validity.state === 'expired' || awaiting) && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Autorize de novo para voltar a atualizar.</Text>}
        {refreshMsg && <Text variant="bodyMedium" accessibilityLiveRegion="polite">{refreshMsg}</Text>}
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Os dados do banco chegam ao Pluggy a cada 24 horas. Atualizar busca o que já chegou.</Text>

        <SectionTitle>Consentimento</SectionTitle>
        {consent && authorized.length > 0 ? (
          <>
            <Text variant="labelLarge">Dados autorizados</Text>
            {authorized.map((a) => <Text key={a} variant="bodyMedium">{`• ${a}`}</Text>)}
            {/* UX 0.8 / UX-069: as duas datas, cada uma com seu rótulo. */}
            {/* RF-002.3.1 (UX 0.9): autorização do app com a validade; consentimento do banco separado. */}
            <Text variant="bodyMedium">{`Autorizada neste app em: ${formatDate(new Date(c.item_created_at ?? c.created_at))}`}</Text>
            {validityBlock}
            <Text variant="bodyMedium" style={{ marginTop: 8 }}>{`Consentimento dado em: ${formatDate(new Date(consent.createdAt))}`}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Este é o consentimento que você deu ao seu banco no Meu Pluggy. Ele é separado da autorização deste app, e o app não recebe a validade dele.</Text>
            <Button onPress={() => Linking.openURL('https://meu.pluggy.ai')} style={{ alignSelf: 'flex-start' }}>Abrir o Meu Pluggy</Button>
          </>
        ) : (
          // PM-2 [P]: a API não trouxe o consentimento desta conexão.
          <>
            <Text variant="bodyMedium">{`Autorizada neste app em: ${formatDate(new Date(c.item_created_at ?? c.created_at))}`}</Text>
            {validityBlock}
            <Text variant="bodyMedium">Este consentimento foi dado no Meu Pluggy. Veja lá os dados autorizados e a validade.</Text>
            <Button onPress={() => Linking.openURL('https://meu.pluggy.ai')} style={{ alignSelf: 'flex-start' }}>Abrir o Meu Pluggy</Button>
          </>
        )}

        <SectionTitle>Contas desta conexão</SectionTitle>
        {data.accounts.length === 0 && (
          <Text variant="bodyMedium">{data.other ? `Repetida: as contas estão em ${data.other.name}.` : 'Nenhuma conta importada ainda.'}</Text>
        )}
        {data.accounts.map((a) => a.unauthorized_at ? (
          // R-17 (UX 0.11): conta que não veio na nova autorização; não soma no saldo.
          <View key={a.id} style={{ gap: 4, paddingVertical: 8 }}>
            <List.Item
              titleNumberOfLines={3}
              descriptionNumberOfLines={3}
              title={a.name}
              description={`Sem autorização · dados de ${formatWhen(new Date(a.unauthorized_at))}\nNão entra no saldo`}
              left={(p) => <List.Icon {...p} icon="link-off" />}
              right={() => <Text variant="titleMedium" style={[ui.tabular, { alignSelf: 'center', color: theme.colors.onSurfaceVariant }]} accessibilityLabel={`${balanceA11y(a.balance)}, não entra no saldo`}>{formatBalance(a.balance)}</Text>}
              onPress={() => router.push({ pathname: '/extrato', params: { account: a.id } })}
              accessibilityLabel={`${a.name}, sem autorização, dados de ${formatWhen(new Date(a.unauthorized_at))}, ${balanceA11y(a.balance)}, não entra no saldo`}
              style={{ minHeight: 56 }}
            />
            <Button textColor={theme.colors.error} onPress={() => setDeleteAccount({ id: a.id, name: a.name })} style={{ alignSelf: 'flex-start' }}>Apagar esta conta</Button>
          </View>
        ) : (
          <List.Item
            titleNumberOfLines={3}
            descriptionNumberOfLines={3}
            key={a.id}
            title={a.name}
            description={a.type === 'CREDIT' ? `Fatura atual${a.due_date ? ` · vence em ${formatDate(new Date(a.due_date))}` : ''}` : a.number ? `final ${isMaskingValues() ? '••••' : a.number.slice(-4)}` : undefined}
            right={() => <Text variant="titleMedium" style={[ui.tabular, { alignSelf: 'center' }]} accessibilityLabel={a.type === 'CREDIT' ? `Fatura atual ${balanceA11y(a.balance)}` : balanceA11y(a.balance)}>{formatBalance(a.balance)}</Text>}
            onPress={() => router.push({ pathname: '/extrato', params: { account: a.id } })}
            style={{ minHeight: 56 }}
          />
        ))}

        <List.Accordion title="Detalhes técnicos" expanded={tech} onPress={() => setTech(!tech)}>
          <Text variant="bodySmall" selectable style={{ paddingHorizontal: 16 }}>
            {`Conexão: ${c.item_id}\nEstado: ${c.status ?? '—'}\nExecução: ${c.execution_status ?? '—'}\nCódigo: ${c.error_code ?? '—'}\nÚltima falha do app: ${c.last_sync_error ?? '—'}`}
          </Text>
        </List.Accordion>

        <Divider style={{ marginVertical: 16 }} />
        {awaiting ? (
          <Button textColor={theme.colors.error} onPress={() => setWipeConfirm(true)} style={{ alignSelf: 'flex-start' }} contentStyle={{ minHeight: 48 }}>Apagar os dados desta conexão</Button>
        ) : (
          <Button textColor={theme.colors.error} onPress={startRevoke} style={{ alignSelf: 'flex-start' }} contentStyle={{ minHeight: 48 }}>Revogar conexão</Button>
        )}
        {revokeError && !confirm && <Banner tone="error" icon="alert-circle-outline" text={revokeError} />}
      </Screen>

      <Portal>
        {/* R-16: texto da confirmação é do Dev [a confirmar pelo Designer]; a spec pede "com confirmação". */}
        <Dialog visible={wipeConfirm} onDismiss={() => setWipeConfirm(false)}>
          <Dialog.Title>{`Apagar os dados de ${name}?`}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">As contas, as transações e as categorias que você mudou nesta conexão são apagadas deste aparelho. Isso não pode ser desfeito.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setWipeConfirm(false)}>Cancelar</Button>
            <Button textColor={theme.colors.error} onPress={async () => {
              await repo.deleteConnectionData(id);
              setWipeConfirm(false);
              setFlash('conexoes', `Os dados de ${name} foram apagados deste aparelho.`);
              bump();
              router.replace('/conexoes');
            }}>Apagar</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={deleteAccount !== null} onDismiss={() => setDeleteAccount(null)}>
          <Dialog.Title>{`Apagar ${deleteAccount?.name ?? 'esta conta'}?`}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">As transações dela e as categorias que você mudou são apagadas deste aparelho.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteAccount(null)}>Cancelar</Button>
            <Button textColor={theme.colors.error} onPress={async () => {
              if (deleteAccount) await repo.deleteAccountLocal(deleteAccount.id);
              setDeleteAccount(null);
              bump();
              reload();
            }}>Apagar</Button>
          </Dialog.Actions>
        </Dialog>
        {/* REV-39: com o teclado aberto, o diálogo sobe para os botões ficarem visíveis. */}
        <Dialog visible={renaming} onDismiss={() => setRenaming(false)} style={kbHeight ? { marginBottom: kbHeight } : undefined}>
          <Dialog.Title>Renomear</Dialog.Title>
          <Dialog.Content>
            {/* UX 0.8 §7.4: com o nome sugerido, o campo abre vazio e o nome aparece acima. */}
            {!c.user_name && <Text variant="bodyMedium" style={{ marginBottom: 8 }}>{`Nome atual: ${name}`}</Text>}
            <TextInput mode="outlined" label="Nome da conexão" value={draftName} onChangeText={setDraftName} maxLength={30} autoFocus />
            <HelperText type="info">{`${draftName.length}/30`}</HelperText>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRenaming(false)}>Cancelar</Button>
            <Button onPress={async () => { await repo.renameConnection(id, draftName); setRenaming(false); bump(); }}>Salvar</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={confirm} onDismiss={() => !revoking && setConfirm(false)} dismissable={!revoking}>
          <Dialog.Title>{data.other && data.accounts.length === 0 ? 'Revogar a conexão repetida?' : realName ? `Revogar a conexão com ${realName}?` : 'Revogar esta conexão?'}</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            {revoking ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ActivityIndicator size={16} />
                <Text style={{ marginLeft: 8 }}>Revogando…</Text>
              </View>
            ) : (
              data.other && data.accounts.length === 0 ? (
                <>
                  <Text variant="bodyMedium">{`As contas dela agora estão em ${data.other.name}. Revogar esta não apaga seus saldos nem suas transações.`}</Text>
                  <Text variant="bodyMedium">Ela deixa de ocupar uma das 5 conexões do plano gratuito do Pluggy.</Text>
                  <FieldError text={revokeError} />
                </>
              ) : data.sharing.shared.length > 0 ? (
                // RF-009.1.2 (UX 0.9): lista o que fica e o que sai.
                <>
                  <Text variant="bodyMedium">O app para de importar dados por esta conexão.</Text>
                  <Text variant="bodyMedium">{`Continuam no app, porque também vêm de ${data.sharing.shared[0].otherName}: ${shortList(data.sharing.shared.map((x) => x.name))}. As transações delas e as categorias que você mudou ficam como estão.`}</Text>
                  <Text variant="bodyMedium">
                    {data.sharing.exclusive.length
                      ? `São apagadas deste aparelho, com as transações delas: ${shortList(data.sharing.exclusive.map((x) => x.name))}.`
                      : 'Nenhuma conta vem só desta conexão. Nada é apagado deste aparelho.'}
                  </Text>
                  <Text variant="bodyMedium">O consentimento que você deu no Meu Pluggy continua ativo. Ele só se encerra lá.</Text>
                  <FieldError text={revokeError} />
                </>
              ) : (
                <>
                  <Text variant="bodyMedium">O app para de importar dados desta instituição.</Text>
                  <Text variant="bodyMedium">As contas e transações dela são apagadas deste aparelho, com as categorias que você mudou nelas.</Text>
                  <Text variant="bodyMedium">O consentimento que você deu no Meu Pluggy continua ativo. Ele só se encerra lá.</Text>
                  <FieldError text={revokeError} />
                </>
              )
            )}
          </Dialog.Content>
          {!revoking && (
            <Dialog.Actions>
              {/* Foco inicial em "Cancelar": vem primeiro na ordem de leitura. */}
              <Button onPress={() => setConfirm(false)}>Cancelar</Button>
              <Button textColor={theme.colors.error} onPress={revogar}>Revogar</Button>
            </Dialog.Actions>
          )}
        </Dialog>
        <Dialog visible={credGate !== null} onDismiss={() => setCredGate(null)}>
          <Dialog.Icon icon="information-outline" />
          <Dialog.Title>{`${credGate === 'rejected' ? 'Troque suas credenciais' : 'Configure suas credenciais'} para ${gateFor === 'autorizar' ? 'autorizar de novo' : 'revogar'}`}</Dialog.Title>
          <Dialog.ScrollArea style={{ maxHeight: 420, paddingHorizontal: 24 }}>
            <ScrollView contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
              <Text variant="bodyMedium">
                {credGate === 'rejected'
                  ? 'O Pluggy recusou suas credenciais. Sem credenciais válidas, nada é apagado: a conexão e os dados dela continuam como estão.'
                  : gateFor === 'autorizar'
                    ? 'O app usa suas credenciais do Pluggy para renovar esta autorização. Sem elas, a conexão e os dados dela continuam como estão.'
                    : 'O app usa suas credenciais do Pluggy para excluir esta conexão lá. Sem elas, nada é apagado: a conexão e os dados dela continuam como estão.'}
              </Text>
              <NoCredentialsHelp action="revogar" onFindCredentials={async () => { setCredGate(null); await repo.setState('guide_step', '2'); router.push({ pathname: '/guia', params: { voltar: `/conexoes/${id}` } }); }} />
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setCredGate(null)}>Cancelar</Button>
            {credGate === 'rejected' ? (
              <Button onPress={() => { setCredGate(null); router.push({ pathname: '/credenciais/informar', params: { voltar: `/conexoes/${id}` } }); }}>Trocar credenciais</Button>
            ) : (
              <Button onPress={() => { setCredGate(null); router.push({ pathname: '/guia', params: { voltar: `/conexoes/${id}` } }); }}>Configurar credenciais</Button>
            )}
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

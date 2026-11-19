// T-04 Início — RF-004, RF-003.2, RF-003.3, RF-003.4, RF-001.1
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { openExtrato } from '../../state/nav';
import { ActivityIndicator, Card, Dialog, Divider, Icon, List, Portal, Snackbar, Text, TouchableRipple } from 'react-native-paper';
import { Button, IconButton } from '../../ui/touch';
import { useApp } from '../../state/AppContext';
import { useLoad, useStartConnect } from '../../state/hooks';
import { connectionStatusView } from '../../domain/connectionStatus';
import { authMessage, authValidity, setPreviewValidity } from '../../domain/authValidity';
import { accountTypeLabel, balanceA11y, formatBalance, formatDate, formatDateTime, formatUpdated, formatWhen, isMaskingValues, setMaskValues } from '../../domain/format';
import { announce, Banner, EmptyState, SectionTitle, Skeleton, styles as ui, useAppTheme, useIconSize } from '../../ui/components';
import type { AccountRow, ConnectionRow } from '../../data/repo';

type Group = { conn: ConnectionRow; accounts: AccountRow[] };

export default function Inicio() {
  // Captura de evidência com dados reais: financasapp://?mascarar=1 (só em desenvolvimento).
  const { mascarar, validade } = useLocalSearchParams<{ mascarar?: string; validade?: string }>();
  if (__DEV__ && mascarar === '1' && !isMaskingValues()) setMaskValues(true);
  if (__DEV__ && validade) setPreviewValidity(validade);
  const theme = useAppTheme();
  const navigation = useNavigation();
  const { repo, refreshing, refreshAll, online, credStatus, locked, ready, screenLock } = useApp();
  const startConnect = useStartConnect();
  const [snack, setSnack] = useState<string | null>(null);
  const [explain, setExplain] = useState(false);
  // R-17 (UX 0.11): apagar uma conta "Sem autorização".
  const [deleteAccount, setDeleteAccount] = useState<{ id: string; name: string } | null>(null);
  const [slowFirstLoad, setSlowFirstLoad] = useState(false);
  const smallIcon = useIconSize(14);

  const { data, error, reload } = useLoad(async () => {
    const [connections, accounts, totals, wealth] = await Promise.all([repo.listConnections(), repo.listAccounts(), repo.totalBalance(), repo.wealthNow()]);
    const groups: Group[] = connections.map((c) => ({ conn: c, accounts: accounts.filter((a) => a.item_id === c.item_id) }));
    return { connections, accounts, totals, groups, wealth };
  });
  // Recarrega ao voltar para o Início (dados podem ter mudado em outra tela).
  useFocusEffect(useCallback(() => { reload(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  // RF-001.13 (UX 0.12): primeira abertura, depois do desbloqueio e sem credenciais, cai no guia uma vez só.
  useEffect(() => {
    if (locked || !ready) return;
    (async () => {
      if (credStatus === 'none' && !(await repo.getState('first_guide_shown'))) {
        await repo.setState('first_guide_shown', '1');
        router.push({ pathname: '/guia', params: { primeira: '1' } });
      }
    })();
  }, [locked, ready, credStatus, repo]);

  const onRefresh = useCallback(async () => {
    // UX-046: sem credenciais, "Atualizar" mostra o aviso em vez de tentar.
    if (credStatus === 'none') {
      setSnack('Sem credenciais do Pluggy, seus dados não são atualizados.');
      return;
    }
    const r = await refreshAll(true);
    if (r === 'ok') announce('Dados atualizados');
    if (r === 'nochange') {
      setSnack('Sem dados novos');
      announce('Sem dados novos');
    }
    if (r === 'throttled') setSnack('Você já atualizou há pouco. Tente de novo em alguns minutos.');
  }, [refreshAll, credStatus]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton icon="refresh" accessibilityLabel="Atualizar" onPress={onRefresh} disabled={refreshing} size={24} />
      ),
    });
  }, [navigation, onRefresh, refreshing]);

  const noAccountsYet = data && data.connections.length > 0 && data.accounts.length === 0;
  useEffect(() => {
    if (!noAccountsYet) return setSlowFirstLoad(false);
    const t = setTimeout(() => setSlowFirstLoad(true), 10000);
    return () => clearTimeout(t);
  }, [noAccountsYet]);

  if (error && !data) {
    return <EmptyState icon="alert-circle-outline" title="Não foi possível carregar seus dados." actionLabel="Tentar de novo" onAction={reload} />;
  }
  if (!data) return <View style={{ padding: 16 }}><Skeleton lines={4} /></View>;

  const { connections, groups, totals, wealth } = data;
  const hasInvestments = wealth.byConnection.some((c) => c.investments > 0);

  // Vazio (RF-004.2): sem conexões e sem lançamentos; sem cartão de saldo zerado.
  if (connections.length === 0 && !totals.hasManual) {
    return (
      <ScrollView contentContainerStyle={[ui.scroll]} style={{ backgroundColor: theme.colors.background }}>
        <View style={ui.inner}>
          <EmptyState
            icon="bank-outline"
            title="Você ainda não conectou nenhuma instituição."
            text="Conecte seus bancos para ver saldos e gastos em um só lugar."
            actionLabel="Conectar instituição"
            onAction={startConnect}
          />
        </View>
      </ScrollView>
    );
  }

  const views = groups.map((g) => ({
    ...g,
    view: connectionStatusView({
      status: g.conn.status,
      executionStatus: g.conn.execution_status,
      errorCode: g.conn.error_code,
      originUpdatedAt: g.conn.origin_updated_at ? new Date(g.conn.origin_updated_at) : null,
    }),
  }));
  const anyStale = views.some((v) => v.view.stale || Boolean(v.conn.last_sync_error));
  // RF-002.3.2 (UX 0.9): autorização vencida → o cartão diz de quando é a parte mais antiga dos dados.
  // UX 0.11 / R-18: os dados que aguardam nova autorização também são dado antigo, com a data.
  const expiredOrigins = views.filter((v) => (v.conn.replaced_at || authValidity(v.conn.auth_expires_at).state === 'expired') && v.conn.origin_updated_at).map((v) => v.conn.origin_updated_at as string).sort();
  const origins = connections.map((c) => c.origin_updated_at).filter(Boolean).sort() as string[];
  const latestOrigin = origins.length ? new Date(origins[origins.length - 1]) : null;
  const oldestOrigin = origins.length ? new Date(origins[0]) : null;
  // UX 0.15 (E-10 a): cada valor com "Dados de {parte mais antiga}"; topo com o intervalo quando as horas diferem.
  const oldestOf = (list: (string | null)[]) => { const v = list.filter(Boolean).sort() as string[]; return v.length ? new Date(v[0]) : null; };
  const bankOrigin = oldestOf(views.filter((v) => !v.conn.duplicate_of && v.accounts.some((a) => a.type === 'BANK')).map((v) => v.conn.origin_updated_at));
  const invOrigin = oldestOf(wealth.byConnection.filter((c) => c.investments > 0).map((c) => c.origin));
  const allOrigin = oldestOf([bankOrigin?.toISOString() ?? null, invOrigin?.toISOString() ?? null]);
  const dataLine = (d: Date | null) => (d ? <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{`Dados de ${formatWhen(d)}`}</Text> : null);
  const rangeLine = latestOrigin && oldestOrigin && formatWhen(oldestOrigin) !== formatWhen(latestOrigin)
    ? `Atualizado entre ${formatWhen(oldestOrigin)} e ${formatWhen(latestOrigin)}`
    : latestOrigin ? formatUpdated(latestOrigin) : null;
  const bank = views.flatMap((v) => v.accounts.filter((a) => a.type === 'BANK').map((a) => ({ a, conn: v.conn })));
  const cards = views.flatMap((v) => v.accounts.filter((a) => a.type === 'CREDIT').map((a) => ({ a, conn: v.conn })));
  const unauthorizedCount = bank.filter(({ a }) => a.unauthorized_at).length;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentContainerStyle={ui.scroll}
        refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}
      >
        <View style={ui.inner}>
          {/* RF-001.8 (Q29 b): aviso fixo, sem fechar; some quando o aparelho passa a ter bloqueio. */}
          {!screenLock && <NoScreenLockBanner />}
          {!online && (
            <Banner icon="wifi-off" text={`Sem internet. Mostrando os dados salvos${latestOrigin ? ` de ${formatWhen(latestOrigin)}` : ''}.`} />
          )}
          {credStatus === 'none' && connections.length > 0 && (
            <Banner text="Sem credenciais do Pluggy, seus dados não são atualizados." actionLabel="Configurar" onAction={() => router.push('/guia')} />
          )}
          {credStatus === 'rejected' && (
            <Banner tone="error" text="Suas credenciais do Pluggy não funcionam mais." actionLabel="Corrigir" onAction={() => router.push('/credenciais')} />
          )}

          {/* Linha de estado: hora do dado na origem (PM-1); espaço reservado para não saltar. */}
          <TouchableRipple onPress={() => setExplain(true)} accessibilityRole="button" accessibilityHint="Explica de quando são os dados" style={s.statusLine}>
            <View style={ui.row} accessibilityLiveRegion="polite">
              {refreshing ? <ActivityIndicator size={14} /> : <Icon source="clock-outline" size={smallIcon} color={theme.colors.onSurfaceVariant} />}
              <Text variant="bodySmall" style={{ marginLeft: 6, color: theme.colors.onSurfaceVariant }}>
                {refreshing ? 'Atualizando…' : rangeLine ?? 'Ainda sem dados do banco'}
              </Text>
            </View>
          </TouchableRipple>

          {noAccountsYet ? (
            <View>
              <Skeleton lines={1} height={96} />
              <Skeleton lines={3} />
              <Text variant="bodyMedium" accessibilityLiveRegion="polite">Buscando seus dados…</Text>
              {slowFirstLoad && <Text variant="bodyMedium">Isso pode levar alguns minutos na primeira vez. Você pode sair e voltar depois.</Text>}
            </View>
          ) : (
            <Card mode="contained" style={s.total}>
              <Card.Content>
                {/* UX 0.7 (RF-004.1, RF-004.3): "Saldo em contas"; com investimentos, três linhas e "Patrimônio total". */}
                {hasInvestments ? (
                  <View style={{ gap: 2 }}>
                    <View accessible accessibilityLabel={`Saldo em contas, ${balanceA11y(totals.total)}${bankOrigin ? `, dados de ${formatWhen(bankOrigin)}` : ''}`}>
                      <View style={s.cardLine}>
                        <Text variant="bodyLarge">Saldo em contas</Text>
                        <Text variant="titleMedium" style={ui.tabular}>{formatBalance(totals.total)}</Text>
                      </View>
                      {dataLine(bankOrigin)}
                    </View>
                    <View accessible accessibilityLabel={`Investimentos, ${balanceA11y(wealth.investments)}${invOrigin ? `, dados de ${formatWhen(invOrigin)}` : ''}`}>
                      <View style={s.cardLine}>
                        <Text variant="bodyLarge">Investimentos</Text>
                        <Text variant="titleMedium" style={ui.tabular}>{formatBalance(wealth.investments)}</Text>
                      </View>
                      {dataLine(invOrigin)}
                    </View>
                    <Divider style={{ marginVertical: 4 }} />
                    <Text variant="labelLarge">Patrimônio total</Text>
                    <Text variant="displaySmall" style={ui.tabular} accessibilityLabel={`Patrimônio total, ${balanceA11y(wealth.total)}${allOrigin ? `, dados de ${formatWhen(allOrigin)}` : ''}`}>{formatBalance(wealth.total)}</Text>
                    {dataLine(allOrigin)}
                  </View>
                ) : (
                  <>
                    <Text variant="labelLarge">Saldo em contas</Text>
                    <Text variant="displaySmall" style={ui.tabular} accessibilityLabel={`Saldo em contas, ${balanceA11y(totals.total)}${bankOrigin ? `, dados de ${formatWhen(bankOrigin)}` : ''}`}>{formatBalance(totals.total)}</Text>
                    {dataLine(bankOrigin)}
                  </>
                )}
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {`Saldo em contas soma suas contas. Cartões de crédito não entram.${hasInvestments ? ' Faturas de cartão não são descontadas do patrimônio.' : ''}${unauthorizedCount > 0 ? ` Não inclui ${unauthorizedCount} ${unauthorizedCount === 1 ? 'conta sem autorização' : 'contas sem autorização'}.` : ''}`}
                </Text>
                {expiredOrigins.length > 0 && (
                  <View style={[ui.row, { marginTop: 4 }]}>
                    <Icon source="alert-outline" size={smallIcon} color={theme.colors.atencao} />
                    <Text variant="bodySmall" style={{ color: theme.colors.atencao, marginLeft: 4, flexShrink: 1 }}>{`Parte dos dados é de ${formatWhen(new Date(expiredOrigins[0]))}`}</Text>
                  </View>
                )}
                {anyStale && expiredOrigins.length === 0 && (
                  <View style={[ui.row, { marginTop: 4 }]}>
                    <Icon source="alert-outline" size={smallIcon} color={theme.colors.atencao} />
                    <Text variant="bodySmall" style={{ color: theme.colors.atencao, marginLeft: 4, flexShrink: 1 }}>Inclui dados que não foram atualizados.</Text>
                  </View>
                )}
                {connections.length > 0 && (
                  <Button compact onPress={() => router.push('/patrimonio')} style={{ alignSelf: 'flex-start', marginTop: 4 }}>Ver evolução do patrimônio</Button>
                )}
              </Card.Content>
            </Card>
          )}

          {bank.length > 0 && <SectionTitle>Contas</SectionTitle>}
          {views.map(({ conn, accounts, view }) => {
            const bankAccounts = accounts.filter((a) => a.type === 'BANK');
            // UX 0.8: a conexão repetida não tem contas e não aparece como grupo.
            if (conn.duplicate_of) return null;
            if (!bankAccounts.length && !view.stale && !view.needsAttention) return null;
            const name = conn.name;
            const accountNames = accounts.filter((a) => a.id !== conn.suggested_account_id).map((a) => a.name).join(', ');
            const failedRefresh = Boolean(conn.last_sync_error);
            return (
              <View key={conn.item_id} style={s.group}>
                <List.Item
                  titleNumberOfLines={3}
                  descriptionNumberOfLines={3}
                  title={name}
                  titleStyle={{ fontWeight: '600' }}
                  description={[accountNames, view.needsAttention ? 'Esta conexão precisa da sua atenção.' : null].filter(Boolean).join('\n') || undefined}
                  right={(p) => <List.Icon {...p} icon="chevron-right" />}
                  onPress={() => router.push(`/conexoes/${conn.item_id}`)}
                  accessibilityHint="Abre consentimento e opções da conexão"
                  style={s.minTouch}
                />
                {view.needsAttention && (
                  <Button compact onPress={() => router.push(`/conexoes/${conn.item_id}`)} style={s.inlineAction}>Resolver</Button>
                )}
                {conn.replaced_at && (
                  <Banner icon="alert-outline" text={`Aguardando nova autorização.${conn.origin_updated_at ? ` Dados de ${formatWhen(new Date(conn.origin_updated_at))}.` : ''}`}
                    actionLabel="Autorizar agora" onAction={() => router.push({ pathname: '/conexoes/[id]', params: { id: conn.item_id, autorizar: '1' } })} />
                )}
                {!conn.replaced_at && (() => {
                  const v = authValidity(conn.auth_expires_at);
                  const msg = authMessage(v);
                  return msg ? (
                    <Banner tone={v.state === 'expired' ? 'error' : 'warning'} icon={v.state === 'expired' ? 'alert-circle-outline' : 'alert-outline'} text={msg}
                      actionLabel="Autorizar de novo" onAction={() => router.push({ pathname: '/conexoes/[id]', params: { id: conn.item_id, autorizar: '1' } })} />
                  ) : null;
                })()}
                {(view.stale || failedRefresh) && !view.needsAttention && !conn.replaced_at && (
                  <Banner
                    text={`Não foi possível atualizar.${conn.origin_updated_at ? ` Dados de ${formatWhen(new Date(conn.origin_updated_at))}.` : ''}`}
                    actionLabel="Tentar de novo"
                    onAction={onRefresh}
                  />
                )}
                {bankAccounts.map((a) => a.unauthorized_at ? (
                  <View key={a.id}>
                    <List.Item
                      titleNumberOfLines={3}
                      descriptionNumberOfLines={3}
                      title={a.name === name ? accountTypeLabel(a.subtype) : a.name}
                      description={`Sem autorização · dados de ${formatWhen(new Date(a.unauthorized_at))}\nNão entra no saldo`}
                      left={(p) => <List.Icon {...p} icon="link-off" />}
                      right={() => <Text variant="titleMedium" style={[ui.tabular, s.value, { color: theme.colors.onSurfaceVariant }]}>{formatBalance(a.balance)}</Text>}
                      onPress={() => openExtrato({ account: a.id })}
                      accessibilityLabel={`${a.name}, sem autorização, dados de ${formatWhen(new Date(a.unauthorized_at))}, ${balanceA11y(a.balance)}, não entra no saldo`}
                      style={s.minTouch}
                    />
                    <Button compact textColor={theme.colors.error} onPress={() => setDeleteAccount({ id: a.id, name: a.name })} style={s.inlineAction}>Apagar esta conta</Button>
                  </View>
                ) : (
                  <List.Item
                    titleNumberOfLines={3}
                    descriptionNumberOfLines={3}
                    key={a.id}
                    title={a.name === name ? accountTypeLabel(a.subtype) : a.name}
                    description={[a.number ? `final ${isMaskingValues() ? '••••' : a.number.slice(-4)}` : null, autoInvestLine(a)].filter(Boolean).join('\n') || undefined}
                    right={() => <Text variant="titleMedium" style={[ui.tabular, s.value]} accessibilityLabel={balanceA11y(a.balance)}>{formatBalance(a.balance)}</Text>}
                    onPress={() => openExtrato({ account: a.id })}
                    accessibilityLabel={`${a.name === name ? accountTypeLabel(a.subtype) : a.name}${a.number ? `, final ${isMaskingValues() ? '••••' : a.number.slice(-4)}` : ''}, saldo ${balanceA11y(a.balance)}`}
                    style={s.minTouch}
                  />
                ))}
                <Divider />
              </View>
            );
          })}

          {/* UX 0.7: seção Investimentos, uma linha por conexão (sem ativos, sem rentabilidade). Toque abre T-21. */}
          {hasInvestments && <SectionTitle>Investimentos</SectionTitle>}
          {hasInvestments && wealth.byConnection.map((c) => (
            <View key={c.item_id}>
              {c.investments > 0 && (
                <List.Item
                  titleNumberOfLines={3}
                  title={c.name}
                  description="Investimentos"
                  right={() => <Text variant="titleMedium" style={[ui.tabular, s.value]}>{formatBalance(c.investments)}</Text>}
                  onPress={() => router.push('/patrimonio')}
                  accessibilityLabel={`${c.name}, investimentos, ${balanceA11y(c.investments)}`}
                  style={s.minTouch}
                />
              )}
              {/* UX 0.8 (E-5 a): só informação, fora da soma. */}
              {c.autoInvested > 0 && (
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 16, paddingBottom: 8 }}>{`Rendendo na conta: ${formatBalance(c.autoInvested)}. Já contado em Saldo em contas.`}</Text>
              )}
            </View>
          ))}

          {cards.length > 0 && <SectionTitle>Cartões de crédito</SectionTitle>}
          {cards.map(({ a }) => (
            <List.Item
              titleNumberOfLines={3}
              descriptionNumberOfLines={3}
              key={a.id}
              title={a.name}
              description={`Fatura atual${a.due_date ? ` · vence em ${formatDate(new Date(a.due_date))}` : ''}`}
              right={() => <Text variant="titleMedium" style={[ui.tabular, s.value]}>{formatBalance(a.balance)}</Text>}
              onPress={() => openExtrato({ account: a.id })}
              accessibilityLabel={`${a.name}, fatura atual ${balanceA11y(a.balance)}`}
              style={s.minTouch}
            />
          ))}

          {totals.hasManual && (
            <>
              <SectionTitle>Dinheiro</SectionTitle>
              <List.Item
                titleNumberOfLines={3}
                descriptionNumberOfLines={3}
                title="Dinheiro"
                right={() => <Text variant="titleMedium" style={[ui.tabular, s.value]}>{formatBalance(totals.manual)}</Text>}
                onPress={() => openExtrato({ account: 'manual' })}
                style={s.minTouch}
              />
            </>
          )}

          <Button mode="contained" onPress={startConnect} style={{ marginTop: 24 }} contentStyle={{ minHeight: 48 }}>Conectar instituição</Button>
          <Button onPress={() => router.push('/conexoes')} contentStyle={{ minHeight: 48 }}>Gerenciar conexões</Button>
        </View>
      </ScrollView>

      <Portal>
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
              reload();
            }}>Apagar</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={explain} onDismiss={() => setExplain(false)}>
          <Dialog.Title>De quando são os dados</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">Os dados dos seus bancos chegam ao Pluggy a cada 24 horas. O app busca o que já chegou sempre que você abre ou toca em Atualizar.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setExplain(false)}>Fechar</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <Snackbar visible={Boolean(snack)} onDismiss={() => setSnack(null)} duration={5000}>{snack}</Snackbar>
    </View>
  );
}

/** UX 0.8/0.9 (RF-004.4): "Inclui R$ X rendendo na conta" ou "Todo o saldo rende na conta". */
function autoInvestLine(a: { balance: number; auto_invested: number | null }): string | null {
  const v = a.auto_invested ?? 0;
  if (v <= 0) return null;
  return Math.round(v * 100) >= Math.round(a.balance * 100) ? 'Todo o saldo rende na conta' : `Inclui ${formatBalance(v)} rendendo na conta`;
}

const s = StyleSheet.create({
  cardLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  statusLine: { minHeight: 48, justifyContent: 'center' },
  total: { marginVertical: 8 },
  group: { marginBottom: 4 },
  value: { alignSelf: 'center' },
  minTouch: { minHeight: 56 },
  inlineAction: { alignSelf: 'flex-start' },
});

/** RF-001.8: aparelho sem bloqueio de tela. V-I: abre a tela de segurança do sistema; se não der, a ação some. */
export function NoScreenLockBanner() {
  const [canOpen, setCanOpen] = useState(true);
  return (
    <Banner
      icon="alert-outline"
      text="Este aparelho não tem bloqueio de tela. Quem pegar o aparelho consegue abrir este app e ver suas finanças."
      actionLabel={canOpen ? 'Abrir as configurações do aparelho' : undefined}
      onAction={canOpen ? () => { Linking.sendIntent('android.settings.SECURITY_SETTINGS').catch(() => setCanOpen(false)); } : undefined}
    />
  );
}

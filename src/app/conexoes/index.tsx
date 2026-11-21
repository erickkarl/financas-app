// T-11 Conexões — RF-002.4, RF-009, RNF-003. Contador "{n} de 5" (PM-4 [P]).
import React, { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { revokedMessage } from '../../domain/revokeText';
import { Divider, Icon, List, Text } from 'react-native-paper';
import { Button, ListItem } from '../../ui/touch';
import { useApp } from '../../state/AppContext';
import { takeFlash } from '../../state/flash';
import { useLoad, useStartConnect } from '../../state/hooks';
import { connectionStatusView } from '../../domain/connectionStatus';
import { authStatusShort, authValidity } from '../../domain/authValidity';
import { connectionLimitState, CONNECTION_LIMIT } from '../../domain/credentials';
import { formatDate, formatUpdated, formatWhen } from '../../domain/format';
import { Banner, EmptyState, Screen, Skeleton, useAppTheme } from '../../ui/components';

export default function Conexoes() {
  const theme = useAppTheme();
  const { repo, dataVersion } = useApp();
  const startConnect = useStartConnect();
  const { data, error, reload } = useLoad(async () => {
    const conns = await repo.listConnections();
    const accounts = await repo.listAccounts();
    return conns.map((c) => ({ c, accounts: accounts.filter((a) => a.item_id === c.item_id) }));
  });
  // Só no build de desenvolvimento: ?preview=revogada-compartilhada mostra o aviso de sucesso de RF-009.1.2 (texto do app).
  const { preview } = useLocalSearchParams<{ preview?: string }>();
  const [notice, setNotice] = useState<string | null>(
    __DEV__ && preview === 'revogada-compartilhada'
      ? revokedMessage('Conexão BANCO AZUL (2)', 2, 'BANCO AZUL')
      : __DEV__ && preview === 'revogada-patrimonio'
      ? `${revokedMessage('Conexão Banco Exemplo', 0, null)} O histórico do patrimônio agora não inclui Banco Exemplo.`
      : null,
  );

  useEffect(() => {
    const m = takeFlash('conexoes');
    if (m) setNotice(m);
  }, [dataVersion]);

  if (error) return <EmptyState icon="alert-circle-outline" title="Não foi possível carregar suas conexões." actionLabel="Tentar de novo" onAction={reload} />;
  if (!data) return <Screen><Skeleton lines={2} /></Screen>;

  // UX 0.11: a conexão que aguarda nova autorização não ocupa vaga no Pluggy (já foi excluída lá).
  const n = data.filter(({ c }) => !c.replaced_at).length;
  const awaitingN = data.length - n;
  const limit = connectionLimitState(n);

  return (
    <Screen style={{ paddingTop: 8 }}>
      {notice && (
        // Faixa que fica até a pessoa fechar (UX T-12, revogação).
        <Banner
          tone="info"
          icon="check-circle-outline"
          text={notice}
          actionLabel="Abrir o Meu Pluggy"
          onAction={() => Linking.openURL('https://meu.pluggy.ai')}
          secondaryLabel="Fechar"
          onSecondary={() => setNotice(null)}
        />
      )}
      <Text variant="titleMedium" accessibilityLiveRegion="polite">{`${n} de ${CONNECTION_LIMIT} conexões do plano gratuito do Pluggy`}</Text>
      {awaitingN > 0 && <Text variant="bodyMedium">{`${awaitingN} aguardando nova autorização.`}</Text>}
      {limit === 'last' && <Banner icon="alert-outline" text="Você está usando 4 de 5 conexões. Resta 1." />}

      {data.length === 0 ? (
        <EmptyState icon="bank-outline" title="Nenhuma instituição conectada." actionLabel="Conectar instituição" onAction={startConnect} />
      ) : (
        data.map(({ c, accounts }) => {
          const view = connectionStatusView({
            status: c.status, executionStatus: c.execution_status, errorCode: c.error_code,
            originUpdatedAt: c.origin_updated_at ? new Date(c.origin_updated_at) : null,
          });
          const name = c.name;
          // UX 0.8: conexão repetida mostra onde estão as contas e a ação "Revogar".
          const other = c.duplicate_of ? data.find((d) => d.c.item_id === c.duplicate_of)?.c : undefined;
          // 7.4: a conta que deu o nome não se repete na linha de contas.
          const others = accounts.filter((a) => a.id !== c.suggested_account_id);
          const auth = authValidity(c.auth_expires_at);
          const authShort = authStatusShort(auth);
          const consentDate = c.item_created_at ?? c.created_at;
          const iconFor = { ok: 'check-circle-outline', progress: 'sync', warning: 'alert-outline', error: 'alert-circle-outline', pending: 'timer-sand' }[view.tone];
          return (
            <View key={c.item_id}>
              <ListItem
                title={name}
                description={() => (
                  <View>
                    {c.replaced_at ? (
                      // Tabela 7.1 (UX 0.11).
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon source="alert-outline" size={14} color={theme.colors.atencao} />
                        <Text variant="bodySmall" style={{ marginLeft: 4, flexShrink: 1 }}>{`Aguardando nova autorização.${c.origin_updated_at ? ` Dados de ${formatWhen(new Date(c.origin_updated_at))}.` : ''}`}</Text>
                      </View>
                    ) : other ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon source="information-outline" size={14} color={theme.colors.onSurfaceVariant} />
                        <Text variant="bodySmall" style={{ marginLeft: 4, flexShrink: 1 }}>{`Repetida: as contas estão em ${other.name}`}</Text>
                      </View>
                    ) : authShort ? (
                      // Tabela 7.1 (UX 0.9): validade a 30 dias ou menos, ou vencida.
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon source={auth.state === 'expired' ? 'alert-circle-outline' : 'alert-outline'} size={14} color={auth.state === 'expired' ? theme.colors.error : theme.colors.atencao} />
                        <Text variant="bodySmall" style={{ marginLeft: 4, flexShrink: 1 }}>{authShort}</Text>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon source={iconFor} size={14} color={view.tone === 'ok' ? theme.colors.primary : view.tone === 'error' ? theme.colors.error : theme.colors.atencao} />
                        <Text variant="bodySmall" style={{ marginLeft: 4 }}>{view.label}</Text>
                      </View>
                    )}
                    {!c.replaced_at && <Text variant="bodySmall">{`Autorizada em ${formatDate(new Date(consentDate))}${auth.state !== 'unknown' ? ` · válida até ${auth.date}` : ''}`}</Text>}
                    {c.origin_updated_at && <Text variant="bodySmall">{formatUpdated(new Date(c.origin_updated_at))}</Text>}
                    {others.length > 0 && (
                      <Text variant="bodySmall">{others.map((a) => a.name).join(', ')}</Text>
                    )}
                  </View>
                )}
                right={(p) => <List.Icon {...p} icon="chevron-right" />}
                onPress={() => router.push(`/conexoes/${c.item_id}`)}
                style={{ minHeight: 56 }}
              />
              {c.replaced_at && (
                <Button onPress={() => router.push({ pathname: '/conexoes/[id]', params: { id: c.item_id, autorizar: '1' } })} style={{ alignSelf: 'flex-start', marginLeft: 8 }}>Autorizar agora</Button>
              )}
              {!c.replaced_at && !other && authShort && (
                <Button onPress={() => router.push({ pathname: '/conexoes/[id]', params: { id: c.item_id, autorizar: '1' } })} style={{ alignSelf: 'flex-start', marginLeft: 8 }}>Autorizar de novo</Button>
              )}
              {other && (
                <Button textColor={theme.colors.error} onPress={() => router.push({ pathname: '/conexoes/[id]', params: { id: c.item_id, revogar: '1' } })} style={{ alignSelf: 'flex-start', marginLeft: 8 }}>Revogar</Button>
              )}
              <Divider />
            </View>
          );
        })
      )}

      {data.length > 0 && (
        <>
          <Button mode="contained" onPress={startConnect} disabled={limit === 'full'} style={{ marginTop: 16 }} contentStyle={{ minHeight: 48 }}>Conectar instituição</Button>
          {limit === 'full' && <Text variant="bodyMedium" style={{ marginTop: 4 }}>Limite atingido. Revogue uma conexão para adicionar outra.</Text>}
        </>
      )}
    </Screen>
  );
}

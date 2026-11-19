// T-19 Ajustes (UX 0.12): sem "Sair", sem conta e sem chave de biometria (RF-001.10, RF-001.12).
import React from 'react';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { Divider, List, Text } from 'react-native-paper';
import { useApp } from '../../state/AppContext';
import { useLoad } from '../../state/hooks';
import { CONNECTION_LIMIT } from '../../domain/credentials';
import { Screen, useAppTheme } from '../../ui/components';

export default function Ajustes() {
  const theme = useAppTheme();
  const { repo, credStatus, screenLock, dataVersion } = useApp();
  const { data: count } = useLoad(() => repo.countConnections(), [dataVersion]);

  return (
    <Screen>
      <List.Section>
        <List.Item
          title="Conexões"
          description={`${count ?? 0} de ${CONNECTION_LIMIT}`}
          left={(p) => <List.Icon {...p} icon="bank-outline" />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={() => router.push('/conexoes')}
          style={{ minHeight: 56 }}
        />
        <List.Item
          title="Credenciais do Pluggy"
          description={credStatus === 'none' ? 'Não configuradas' : credStatus === 'rejected' ? 'Recusadas pelo Pluggy' : 'Configuradas'}
          left={(p) => <List.Icon {...p} icon="key-outline" />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={() => router.push('/credenciais')}
          style={{ minHeight: 56 }}
        />
        {/* Só informação, sem chave (RF-001.12); sem bloqueio de tela, o aviso de RF-001.8. */}
        <List.Item
          title="Bloqueio ao abrir"
          description={screenLock ? 'Sempre ligado. Usa a biometria ou o bloqueio do aparelho.' : 'Este aparelho não tem bloqueio de tela.'}
          descriptionNumberOfLines={3}
          left={(p) => <List.Icon {...p} icon={screenLock ? 'lock-outline' : 'alert-outline'} color={screenLock ? p.color : theme.colors.atencao} />}
          style={{ minHeight: 56 }}
        />
        <List.Item
          title="Privacidade e dados"
          left={(p) => <List.Icon {...p} icon="shield-account-outline" />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={() => router.push('/privacidade')}
          style={{ minHeight: 56 }}
        />
        <Divider />
        {/* A-3: sem destino até os textos existirem. */}
        <List.Item title="Termos de uso" description="(em preparação)" left={(p) => <List.Icon {...p} icon="file-document-outline" />} style={{ minHeight: 56 }} />
        <List.Item title="Política de privacidade" description="(em preparação)" left={(p) => <List.Icon {...p} icon="file-document-outline" />} style={{ minHeight: 56 }} />
      </List.Section>
      <Text variant="labelMedium" style={{ textAlign: 'center', opacity: 0.8 }}>Versão {Constants.expoConfig?.version ?? '—'}</Text>
    </Screen>
  );
}

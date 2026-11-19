// T-07 Credenciais do Pluggy (gerenciar) — RF-000.4. Client Secret nunca aparece; Client ID só os 4 últimos.
import React, { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Dialog, Portal, Snackbar, Text } from 'react-native-paper';
import { Button } from '../../ui/touch';
import { useApp } from '../../state/AppContext';
import { takeFlash } from '../../state/flash';
import { useLoad } from '../../state/hooks';
import { secure } from '../../services/secure';
import { formatDateTime } from '../../domain/format';
import { Banner, Screen } from '../../ui/components';

export default function Credenciais() {
  const app = useApp();
  const { reloadCredStatus, client, dataVersion } = app;
  // Só no build de desenvolvimento: força o estado para captura (financasapp://credenciais?preview=configuradas|recusadas).
  const { preview } = useLocalSearchParams<{ preview?: string }>();
  const forced = __DEV__ && (preview === 'configuradas' || preview === 'recusadas') ? preview : null;
  const credStatus = forced === 'configuradas' ? 'ok' : forced === 'recusadas' ? 'rejected' : app.credStatus;
  const { data: realMeta, reload } = useLoad(() => secure.credentialsMeta(), [credStatus]);
  const meta = forced ? { clientIdTail: 'a3f9', verifiedAt: '2026-11-18T17:32:00Z', rejected: forced === 'recusadas' } : realMeta;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);

  useEffect(() => {
    const m = takeFlash('credenciais');
    if (m) setSnack(m);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  async function remove() {
    setConfirmRemove(false);
    await secure.removeCredentials();
    client.clearCache();
    await reloadCredStatus();
  }

  return (
    <>
      <Screen style={{ gap: 12, paddingTop: 16 }}>
        {credStatus === 'none' && (
          <>
            <Text variant="bodyLarge">Você ainda não informou suas credenciais do Pluggy.</Text>
            <Button mode="contained" onPress={() => router.push('/guia')} contentStyle={{ minHeight: 48 }}>Configurar</Button>
          </>
        )}
        {credStatus !== 'none' && meta && (
          <>
            {credStatus === 'rejected' ? (
              <Banner tone="error" icon="alert-circle-outline" text="O Pluggy recusou suas credenciais. Troque-as para voltar a atualizar seus dados." />
            ) : (
              <Text variant="titleMedium">Credenciais configuradas</Text>
            )}
            <Text variant="bodyLarge" accessibilityLabel={`Client ID termina em ${meta.clientIdTail?.split('').join(' ')}`}>{`Client ID: termina em ${meta.clientIdTail}`}</Text>
            {meta.verifiedAt && <Text variant="bodyMedium">{credStatus === 'rejected' ? `Funcionaram pela última vez em ${formatDateTime(new Date(meta.verifiedAt))}` : `Verificadas em ${formatDateTime(new Date(meta.verifiedAt))}`}</Text>}
            <Button mode="contained" onPress={() => router.push('/credenciais/informar')} contentStyle={{ minHeight: 48 }}>Trocar credenciais</Button>
            <Button onPress={() => setConfirmRemove(true)} contentStyle={{ minHeight: 48 }}>Remover credenciais</Button>
          </>
        )}
      </Screen>
      <Portal>
        <Dialog visible={confirmRemove} onDismiss={() => setConfirmRemove(false)}>
          <Dialog.Title>Remover credenciais?</Dialog.Title>
          <Dialog.Content>
            {/* R-1 [P]: os dados importados ficam; o app só para de atualizar. */}
            <Text variant="bodyMedium">O app para de atualizar suas contas. Seus dados já importados continuam neste aparelho. Para revogar uma conexão ou excluir sua conta, você vai precisar configurar as credenciais de novo.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmRemove(false)}>Cancelar</Button>
            <Button onPress={remove}>Remover</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <Snackbar visible={!!snack} onDismiss={() => setSnack(null)}>{snack}</Snackbar>
    </>
  );
}

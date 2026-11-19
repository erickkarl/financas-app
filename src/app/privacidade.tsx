// T-20 Privacidade e dados / Apagar todos os dados do app — RF-009.2, RF-009.2.1 a .5 (UX 0.8, 0.12).
// Ordem: tela "Apagar todos os dados do app" → conferir credenciais → desbloqueio do aparelho → diálogo final →
// exclusão em duas fases (Pluggy, depois o aparelho) → guia, como numa primeira abertura.
// Nunca diz que excluiu o que continua no Pluggy ou no aparelho.
import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, Linking, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Dialog, Portal, Text } from 'react-native-paper';
import { Button } from '../ui/touch';
import { useApp } from '../state/AppContext';
import { setFlash, takeFlash } from '../state/flash';
import { useLoad } from '../state/hooks';
import { unlockDevice } from '../services/biometric';
import { secure } from '../services/secure';
import { PluggyError } from '../pluggy/client';
import { deleteAccountData, deletionMessage } from '../data/accountDeletion';
import { Banner, NoCredentialsHelp, SectionTitle, Screen, useAppTheme } from '../ui/components';

/** O que o app guarda de fato (tabela 2.1 do plano técnico) — DEV-8. */
const STORED = [
  'Seus códigos do Pluggy (Client ID e Client Secret), em armazenamento protegido do aparelho.',
  'Contas, saldos, cartões e transações trazidos das suas conexões.',
  'As categorias que você mudou, as transações que ocultou e as transferências que marcou.',
  'Os identificadores das conexões que este app criou no Pluggy.',
  'Os nomes que você deu às conexões.',
  'Suas preferências, como a etapa do guia do Pluggy.',
];

type Step = 'info' | 'explain' | 'confirm' | 'deleting';
type Progress = { phase: 'remote'; done: number; total: number } | { phase: 'local' };

export default function Privacidade() {
  const theme = useAppTheme();
  const { repo, client, screenLock, credStatus, reloadCredStatus, deleteEverything, bump } = useApp();
  const { preview, etapa } = useLocalSearchParams<{ preview?: string; etapa?: string }>();
  // Estados forçados só no build de desenvolvimento (a exclusão real apagaria as conexões reais da pessoa).
  const pv = __DEV__ ? preview : undefined;
  const [step, setStep] = useState<Step>(pv === 'excluindo' || pv === 'apagando' ? 'deleting' : pv || etapa === 'excluir' ? 'explain' : 'info');
  const [message, setMessage] = useState<string | null>(
    pv === 'falha-parcial' ? deletionMessage({ kind: 'partial', deleted: ['Banco Aurora S.A. (Conta Pré-paga)'], failed: ['BANCO AZUL'] }) : null,
  );
  const [checking, setChecking] = useState(pv === 'conferindo');
  const [progress, setProgress] = useState<Progress>(pv === 'excluindo' ? { phase: 'remote', done: 1, total: 2 } : pv === 'apagando' ? { phase: 'local' } : { phase: 'remote', done: 0, total: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const { data: conns } = useLoad(() => repo.listConnections());
  const n = pv === 'sem-credenciais' || pv === 'recusadas' || pv === 'conferindo' ? 2 : pv === 'sem-conexoes' ? 0 : conns?.filter((c) => !c.replaced_at).length ?? 0; // UX 0.11: as que aguardam não têm nada a excluir no Pluggy
  const gate: null | 'none' | 'rejected' =
    pv === 'sem-credenciais' ? 'none' : pv === 'recusadas' ? 'rejected' : n === 0 ? null : credStatus === 'none' ? 'none' : credStatus === 'rejected' ? 'rejected' : null;

  const voltarParams = { voltar: '/privacidade' };
  // Voltando de T-06 com "Códigos salvos.": a tela "Excluir sua conta" agora tem "Continuar".
  // Lê o aviso quando a tela ganha o foco (a pessoa voltou para cá), não quando o estado muda.
  useFocusEffect(
    useCallback(() => {
      const m = takeFlash(`voltar:${voltarParams.voltar}`);
      if (m) setNotice(m);
    }, [voltarParams.voltar]),
  );

  async function continuar() {
    setMessage(null);
    // RF-009.2.4: sem conexões criadas pelo app, não há conferência de credenciais.
    if (n > 0) {
      const creds = await secure.getCredentials();
      if (!creds) return reloadCredStatus();
      setChecking(true);
      try {
        await client.testCredentials(creds);
      } catch (e) {
        setChecking(false);
        if (e instanceof PluggyError && e.kind === 'invalid_credentials') {
          await secure.markRejected();
          await reloadCredStatus();
          return;
        }
        return setMessage('Não foi possível falar com o Pluggy agora. Nada foi apagado. Tente de novo.');
      }
      setChecking(false);
    }
    // UX 0.12: o desbloqueio do aparelho substitui a confirmação de identidade; sem bloqueio de tela, o passo não existe.
    if (screenLock) {
      const r = await unlockDevice('Desbloqueie para apagar os dados');
      if (!r.ok && r.reason !== 'nolock') return setMessage('O desbloqueio não foi concluído. Nada foi apagado.');
    }
    setStep('confirm');
  }

  async function excluir() {
    setStep('deleting');
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    try {
      const list = await repo.listConnections();
      const r = await deleteAccountData({
        conns: list.filter((c) => !c.replaced_at).map((c) => ({ item_id: c.item_id, name: c.name })),
        deleteRemote: (id) => client.deleteItem(id),
        deleteLocal: async (id) => { await repo.deleteConnectionData(id); },
        wipeAll: deleteEverything,
        onProgress: setProgress,
      });
      if (r.kind === 'done') {
        // UX 0.12: no fim, abre o guia, como numa primeira abertura.
        setFlash('guia', 'Todos os dados do app foram apagados.');
        router.replace({ pathname: '/guia', params: { primeira: '1' } });
        return;
      }
      if (r.kind === 'rejected') {
        await secure.markRejected();
        await reloadCredStatus();
      }
      bump();
      setStep('explain');
      setMessage(deletionMessage(r));
    } finally {
      sub.remove();
    }
  }

  if (step === 'deleting') {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 48 }}>
        {/* REV-37: tela de progresso sem ação de voltar (nem a seta da barra, nem o gesto). */}
        <Stack.Screen options={{ headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }} />
        <ActivityIndicator size={32} />
        <Text variant="titleMedium" accessibilityLiveRegion="polite" style={{ textAlign: 'center' }}>
          {progress.phase === 'local' ? 'Apagando os dados deste aparelho…' : `Excluindo suas conexões no Pluggy… (${progress.done} de ${progress.total})`}
        </Text>
      </Screen>
    );
  }

  return (
    <>
      <Screen style={{ paddingTop: 8, gap: 8 }}>
        {/* Depois de uma falha no meio, a seta volta (as opções da tela persistem entre renderizações). */}
        <Stack.Screen options={{ headerBackVisible: true, headerLeft: undefined, gestureEnabled: true }} />
        {step === 'info' && (
          <>
            <SectionTitle>O que este app guarda</SectionTitle>
            {STORED.map((s) => <Text key={s} variant="bodyMedium">{`• ${s}`}</Text>)}
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>Política de privacidade (em preparação)</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>Termos de uso (em preparação)</Text>
            <Button mode="outlined" textColor={theme.colors.error} onPress={() => setStep('explain')} style={{ marginTop: 24 }}>
              Apagar todos os dados do app
            </Button>
          </>
        )}
        {(step === 'explain' || step === 'confirm') && (
          <>
            <Text variant="headlineSmall" accessibilityRole="header">Apagar todos os dados do app</Text>
            {notice && <Banner tone="info" icon="check-circle-outline" text={notice} secondaryLabel="Fechar" onSecondary={() => setNotice(null)} />}
            {message && <Banner tone="error" icon="alert-circle-outline" text={message} />}
            <SectionTitle>O que é apagado</SectionTitle>
            {[
              'Os dados importados e os lançamentos guardados neste aparelho.',
              'As credenciais do Pluggy guardadas neste aparelho.',
              ...(n > 0 ? ['As conexões que este app criou no Pluggy.'] : []),
              'Os nomes das conexões e as preferências.',
            ].map((t) => <Text key={t} variant="bodyMedium">{`• ${t}`}</Text>)}
            <SectionTitle>O que não é apagado</SectionTitle>
            <Text variant="bodyMedium">Suas contas no Pluggy e no Meu Pluggy não são apagadas, nem os consentimentos que você deu no Meu Pluggy. Para encerrá-los, entre no Meu Pluggy.</Text>
            <Button onPress={() => Linking.openURL('https://meu.pluggy.ai')} style={{ alignSelf: 'flex-start' }}>Abrir o Meu Pluggy</Button>

            {gate ? (
              // RF-009.2.1: sem credenciais válidas, nada é apagado; caminho ao guia.
              <View style={{ gap: 8, marginTop: 8 }}>
                <Banner
                  tone="info"
                  icon="information-outline"
                  text={gate === 'rejected'
                    ? 'O Pluggy recusou suas credenciais. Troque-as para poder apagar os dados.'
                    : `Para apagar os dados, o app precisa das suas credenciais do Pluggy.\nEle usa as credenciais para excluir no Pluggy as ${n} ${n === 1 ? 'conexão' : 'conexões'} que criou. Sem isso, nada é apagado: seus dados continuam como estão.`}
                />
                <NoCredentialsHelp action="excluir" onFindCredentials={async () => { await repo.setState('guide_step', '2'); router.push({ pathname: '/guia', params: voltarParams }); }} />
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Button onPress={() => router.back()}>Cancelar</Button>
                  {gate === 'rejected' ? (
                    <Button mode="contained" onPress={() => router.push({ pathname: '/credenciais/informar', params: voltarParams })}>Trocar credenciais</Button>
                  ) : (
                    <Button mode="contained" onPress={() => router.push({ pathname: '/guia', params: voltarParams })}>Configurar credenciais</Button>
                  )}
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                <Button onPress={() => router.back()} disabled={checking}>Cancelar</Button>
                <Button mode="contained" buttonColor={theme.colors.error} textColor={theme.colors.onError} onPress={continuar} loading={checking} disabled={checking}>
                  {checking ? 'Conferindo suas credenciais…' : 'Continuar'}
                </Button>
              </View>
            )}
          </>
        )}
      </Screen>
      <Portal>
        <Dialog visible={step === 'confirm'} onDismiss={() => setStep('explain')}>
          <Dialog.Title>Apagar todos os dados?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">Esta ação não pode ser desfeita.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setStep('explain')}>Cancelar</Button>
            <Button textColor={theme.colors.error} onPress={excluir}>Apagar tudo</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

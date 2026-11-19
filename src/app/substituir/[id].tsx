// UX 0.11 — "Substituir a autorização" (RF-002.3.2, RF-002.3.3, R-14.2; Q21 a). Com 5 de 5 conexões, a antiga
// é excluída no Pluggy antes de abrir a nova; os dados ficam no aparelho, aguardando nova autorização.
// Esta tela é a confirmação pedida pela regra (não há um segundo diálogo).
import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native-paper';
import { Button } from '../../ui/touch';
import { useApp } from '../../state/AppContext';
import { useLoad } from '../../state/hooks';
import { secure } from '../../services/secure';
import { PluggyError } from '../../pluggy/client';
import { authValidity } from '../../domain/authValidity';
import { announce, Banner, Screen, Skeleton } from '../../ui/components';

/** Simulação (só no build de desenvolvimento): conexões de exemplo "exemplo-…" não existem no Pluggy. */
const isSimulated = (itemId: string) => __DEV__ && itemId.startsWith('exemplo-');

export default function Substituir() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { repo, client, bump, reloadCredStatus } = useApp();
  const { data: c } = useLoad(() => repo.getConnection(id), [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!c) return <Screen><Skeleton lines={4} /></Screen>;
  const name = c.name;
  const expired = authValidity(c.auth_expires_at).state === 'expired';

  async function substituir() {
    setBusy(true);
    setError(null);
    announce('Excluindo a autorização atual no Pluggy…');
    try {
      if (!isSimulated(id)) await client.deleteItem(id);
    } catch (e) {
      setBusy(false);
      if (e instanceof PluggyError && e.kind === 'invalid_credentials') {
        // Credenciais recusadas: diálogo de recusadas de T-12; nada mudou.
        await secure.markRejected();
        await reloadCredStatus();
        router.replace({ pathname: '/conexoes/[id]', params: { id, autorizar: '1' } });
        return;
      }
      setError('Não foi possível excluir a autorização atual. Nada mudou. Tente de novo.');
      return;
    }
    // Excluída: a conexão passa a "Aguardando nova autorização" e a janela do Pluggy abre em seguida.
    await repo.markReplaced(id, new Date().toISOString());
    bump();
    router.replace({ pathname: '/conectar', params: { update: id, renovar: '1', abrir: '1' } });
  }

  return (
    <Screen style={{ gap: 12, paddingTop: 16 }}>
      <Text variant="headlineSmall" accessibilityRole="header">Substituir a autorização</Text>
      <Text variant="bodyLarge">
        {`Você já usa as 5 conexões do plano gratuito do Pluggy. Para autorizar ${name} de novo, o app precisa excluir a autorização atual antes de abrir a nova.${expired ? ' A autorização atual já venceu.' : ''}`}
      </Text>
      <Text variant="titleSmall" accessibilityRole="header">O que acontece</Text>
      {[
        `A autorização atual de ${name} é excluída no Pluggy. Isso não pode ser desfeito.`,
        `Suas contas, transações e categorias de ${name} continuam neste aparelho. Elas ficam aguardando a nova autorização e não são atualizadas até lá.`,
        'A janela do Pluggy abre para você autorizar de novo.',
      ].map((t, i) => <Text key={i} variant="bodyMedium">{`${i + 1}. ${t}`}</Text>)}
      <Text variant="bodyMedium">Se você cancelar ou algo der errado, seus dados continuam aqui e você pode tentar de novo quando quiser. Seu banco continua conectado no Meu Pluggy.</Text>
      {isSimulated(id) && <Text variant="bodySmall">[Simulação de desenvolvimento: conexão de exemplo, nada é excluído no Pluggy.]</Text>}
      {error && <Banner tone="error" icon="alert-circle-outline" text={error} />}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <Button onPress={() => router.back()} disabled={busy}>Cancelar</Button>
        <Button mode="contained" onPress={substituir} loading={busy} disabled={busy}>
          {busy ? 'Excluindo a autorização atual no Pluggy…' : 'Substituir a autorização'}
        </Button>
      </View>
    </Screen>
  );
}

// T-03 Desbloqueio (UX 0.12; RF-001.5 a RF-001.12). Única porta do app. Fica por cima da navegação, então,
// depois de desbloquear, a pessoa volta para a tela em que estava, com o que estava em andamento.
// Nada além do nome do app, do cadeado, da frase e de "Desbloquear": sem valores, sem nome de banco (RF-001.9).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './touch';
import { useApp } from '../state/AppContext';
import { announce, useAppTheme } from './components';
import { APP_NAME } from './constants';

const MESSAGES = {
  cancel: 'O desbloqueio não foi concluído. Toque em Desbloquear para tentar de novo.',
  // O sistema não informa o tempo pelo expo-local-authentication (V-G): vale o texto geral.
  lockout: 'Muitas tentativas. Tente de novo mais tarde ou use o PIN, o padrão ou a senha do aparelho.',
  unavailable: 'Não foi possível abrir o desbloqueio do aparelho. Tente de novo.',
} as const;

export function UnlockScreen() {
  const theme = useAppTheme();
  const { unlock } = useApp();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const tryUnlock = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const r = await unlock();
    setBusy(false);
    if (!r.ok && r.reason !== 'nolock') {
      const m = MESSAGES[r.reason];
      setMessage(m);
      announce(m);
    }
  }, [unlock]);

  // Ao entrar na tela, o pedido do sistema abre sozinho; o botão abre de novo.
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      tryUnlock();
    }
  }, [tryUnlock]);

  // REV-36: num Modal nativo (janela própria do Android), T-03 fica acima de tudo, inclusive de diálogos e folhas
  // do app que estavam abertos ao sair. Voltar não fecha o desbloqueio.
  return (
    <Modal visible transparent={false} animationType="none" statusBarTranslucent onRequestClose={() => undefined}>
    <SafeAreaView style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]}>
      <View style={s.inner}>
        <Text variant="headlineMedium" accessibilityRole="header">{APP_NAME}</Text>
        <Icon source="lock-outline" size={48} color={theme.colors.onSurfaceVariant} />
        <Text variant="bodyLarge" style={{ textAlign: 'center' }}>Desbloqueie para ver suas finanças.</Text>
        <Button mode="contained" icon="lock-open-outline" onPress={tryUnlock} disabled={busy} contentStyle={{ minHeight: 48 }}>Desbloquear</Button>
        {message && (
          <View style={s.msg} accessibilityLiveRegion="polite">
            <Icon source="information-outline" size={20} color={theme.colors.onSurfaceVariant} />
            <Text variant="bodyMedium" style={{ flexShrink: 1 }}>{message}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  msg: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', maxWidth: 480 },
});

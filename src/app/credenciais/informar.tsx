// T-06 Informar credenciais — RF-000.1, RF-000.2, RF-000.3. Troca só substitui depois de teste com sucesso (T-07).
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { HelperText, Icon, Text, TextInput } from 'react-native-paper';
import { Button, IconButton } from '../../ui/touch';
import { useApp } from '../../state/AppContext';
import { setFlash } from '../../state/flash';
import { cleanPasted, clientIdHint } from '../../domain/credentials';
import { PluggyError } from '../../pluggy/client';
import { secure } from '../../services/secure';
import { announce, Screen, useAppTheme } from '../../ui/components';

export default function InformarCredenciais() {
  const theme = useAppTheme();
  const { client, reloadCredStatus, repo } = useApp();
  const { from, voltar } = useLocalSearchParams<{ from?: string; voltar?: string }>();
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [errId, setErrId] = useState<string | null>(null);
  const [errSecret, setErrSecret] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Só credencial recusada marca os campos; falha de rede mostra só a mensagem (REV-03).
  const [formInvalid, setFormInvalid] = useState(false);
  const [testing, setTesting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const secretRef = useRef<any>(null);

  async function paste(set: (v: string) => void) {
    const v = await Clipboard.getStringAsync();
    set(cleanPasted(v));
  }

  async function testAndSave() {
    const id = cleanPasted(clientId);
    const sec = cleanPasted(secret);
    setClientId(id);
    setSecret(sec);
    setFormError(null);
    setFormInvalid(false);
    setErrId(id ? null : 'Informe o Client ID.');
    setErrSecret(sec ? null : 'Informe o Client Secret.');
    if (!id) return idRef.current?.focus();
    if (!sec) return secretRef.current?.focus();
    setTesting(true);
    announce('Testando seus códigos');
    try {
      await client.testCredentials({ clientId: id, clientSecret: sec });
      await secure.saveCredentials({ clientId: id, clientSecret: sec }, new Date().toISOString());
      client.clearCache();
      // Grava o aviso antes de atualizar o estado: T-12 e T-20 leem o aviso quando o estado muda.
      if (voltar) setFlash(`voltar:${voltar}`, 'Códigos salvos.');
      await reloadCredStatus();
      await repo.setState('guide_step', null);
      announce('Códigos salvos.');
      if (voltar) {
        // UX 0.8: depois de "Códigos salvos.", volta para revogar (T-12) ou excluir a conta (T-20).
        router.dismissTo(voltar as never);
      } else if (from === 'connect') {
        setFlash('conectar', 'Códigos salvos.');
        router.dismissTo('/(tabs)');
        router.push('/conectar');
      } else {
        setFlash('credenciais', 'Códigos salvos.');
        router.back();
      }
    } catch (e) {
      // Nada é salvo; o texto nunca inclui os códigos (RF-000.3).
      const kind = e instanceof PluggyError ? e.kind : 'unexpected';
      const msg = kind === 'invalid_credentials'
        ? 'O Pluggy não reconheceu esses códigos. Confira se copiou os dois da mesma aplicação e tente de novo.'
        : 'Não foi possível falar com o Pluggy agora. Seus códigos não foram salvos. Tente de novo.';
      setFormError(msg);
      setFormInvalid(kind === 'invalid_credentials');
      announce(msg);
    } finally {
      setTesting(false);
    }
  }

  const hint = clientIdHint(clientId);
  const fieldProps = { autoCorrect: false, autoCapitalize: 'none' as const, spellCheck: false, disabled: testing, mode: 'outlined' as const };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen style={{ gap: 8, paddingTop: 16 }}>
        <Text variant="labelLarge">Etapa 3 de 3</Text>
        <Text variant="headlineSmall" accessibilityRole="header">Cole seus códigos do Pluggy</Text>

        <Text variant="labelLarge" nativeID="lbl-id" style={s.label}>Client ID</Text>
        <View style={s.fieldRow}>
          <TextInput
            ref={idRef}
            {...fieldProps}
            style={s.flex}
            value={clientId}
            onChangeText={setClientId}
            onBlur={() => setClientId(cleanPasted(clientId))}
            accessibilityLabel="Client ID"
            accessibilityLabelledBy="lbl-id"
            autoComplete="username"
            textContentType="username"
            importantForAutofill="yes"
            error={!!errId || formInvalid}
          />
          <Button onPress={() => paste(setClientId)} disabled={testing} style={s.side} contentStyle={s.minTouch}>Colar</Button>
        </View>
        <HelperText type={errId ? 'error' : 'info'} visible={!!errId || !!hint}>{errId ?? hint}</HelperText>

        <Text variant="labelLarge" nativeID="lbl-secret" style={s.label}>Client Secret</Text>
        <View style={s.fieldRow}>
          <TextInput
            ref={secretRef}
            {...fieldProps}
            style={s.flex}
            value={secret}
            onChangeText={setSecret}
            onBlur={() => setSecret(cleanPasted(secret))}
            secureTextEntry={!showSecret}
            accessibilityLabel="Client Secret"
            accessibilityLabelledBy="lbl-secret"
            autoComplete="password"
            textContentType="password"
            importantForAutofill="yes"
            error={!!errSecret || formInvalid}
          />
          <IconButton icon={showSecret ? 'eye-off' : 'eye'} onPress={() => setShowSecret(!showSecret)} accessibilityLabel={showSecret ? 'Ocultar Client Secret' : 'Mostrar Client Secret'} />
          <Button onPress={() => paste(setSecret)} disabled={testing} style={s.side} contentStyle={s.minTouch}>Colar</Button>
        </View>
        <HelperText type="error" visible={!!errSecret}>{errSecret}</HelperText>

        {formError && (
          <View style={[s.error, { backgroundColor: theme.colors.errorContainer }]} accessibilityLiveRegion="assertive">
            <Icon source="alert-circle-outline" size={20} color={theme.colors.onErrorContainer} />
            <Text style={{ color: theme.colors.onErrorContainer, flex: 1 }}>{formError}</Text>
          </View>
        )}

        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>Seus códigos ficam guardados só neste aparelho.</Text>
        <Button mode="contained" onPress={testAndSave} loading={testing} disabled={testing} contentStyle={s.minTouch}>Testar e salvar</Button>
        <Button onPress={async () => { await repo.setState('guide_step', '2'); router.push({ pathname: '/guia', params: { from: from ?? '', voltar: voltar ?? '' } }); }} disabled={testing}>Onde encontro esses códigos?</Button>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  label: { marginTop: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex: { flex: 1 },
  side: { alignSelf: 'center' },
  minTouch: { minHeight: 48 },
  error: { padding: 12, borderRadius: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});

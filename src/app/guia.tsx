// T-05 Guia "Preparar o Pluggy" — RF-000.1, RF-000.5. Uma etapa por tela, retomável (UX-006), sites no navegador do sistema (UX-007).
import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Icon, List, Modal, Portal, Text } from 'react-native-paper';
import { Button } from '../ui/touch';
import { useApp } from '../state/AppContext';
import { announce, Banner, Screen, useAppTheme } from '../ui/components';
import { takeFlash } from '../state/flash';
import { APP_NAME } from '../ui/constants';

type Step = 'intro' | '1' | '2';
const URLS = { '1': 'https://meu.pluggy.ai', '2': 'https://dashboard.pluggy.ai' } as const;
const HOSTS = { '1': 'meu.pluggy.ai', '2': 'dashboard.pluggy.ai' } as const;

/** Textos da UX v0.4 (T-05). Sobre o site do Pluggy: NV até DEV-4. */
const HELP: [string, string][] = [
  ['O que é o Pluggy e por que preciso dele?', 'É o serviço que busca os dados dos seus bancos pelo Open Finance. Este app não fala direto com os bancos: ele lê o que o Pluggy traz.'],
  ['Por que duas contas?', 'No Meu Pluggy (meu.pluggy.ai) você conecta seus bancos. No painel do Pluggy (dashboard.pluggy.ai) você cria a aplicação que gera os dois códigos. As duas são gratuitas para uso pessoal.'],
  ['Não encontro o Client Secret', "Ele aparece quando você cria a aplicação. Se não copiou, abra a aba 'Aplicação' no painel. Se ainda assim não aparecer, crie uma aplicação nova e copie os dois códigos dela."],
  ["O 'MeuPluggy' não aparece", "Ele precisa ser ativado uma vez: no painel, abra as configurações de conectores da sua aplicação e ative o 'MeuPluggy'."],
  ['Meus códigos foram recusados', "Confira se os dois são da mesma aplicação e se copiou cada um inteiro, sem espaços. Cole de novo e toque em 'Testar e salvar'."],
  ['O app vê minha senha do banco?', 'Não. Você digita a senha só no site ou no app do seu banco. Este app nunca pede a senha do banco nem a do Pluggy, e seus códigos ficam guardados só neste aparelho.'],
  // [0.13] R-15.2, R-15.3
  ["A janela do Pluggy mostra 'Proibido o uso comercial'", 'Essa faixa é do Pluggy, não deste app, e aparece junto do nome da sua aplicação. O Pluggy informa que o uso gratuito é só para as suas próprias contas. Este app não sabe dizer por que a faixa aparece.'],
];
/** [0.13] R-15.1: nome sugerido para a aplicação no painel do Pluggy (A-2: enquanto o app não tiver nome). */
const SUGGESTED_APP_NAME = `${APP_NAME} uso pessoal`;

export default function Guia() {
  const theme = useAppTheme();
  const { repo } = useApp();
  // voltar: tela que pediu as credenciais (T-12 para revogar, T-20 para excluir) — UX 0.8.
  const { from, voltar, primeira } = useLocalSearchParams<{ from?: string; voltar?: string; primeira?: string }>();
  const [flash] = useState(() => takeFlash('guia'));
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [opened, setOpened] = useState<{ '1': boolean; '2': boolean }>({ '1': false, '2': false });
  const [openFailed, setOpenFailed] = useState<null | '1' | '2'>(null);
  const [help, setHelp] = useState(false);
  const [pcTip, setPcTip] = useState(false);
  const [openQ, setOpenQ] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [s, o1, o2] = await Promise.all([repo.getState('guide_step'), repo.getState('guide_opened_1'), repo.getState('guide_opened_2')]);
      setStep((s as Step) ?? 'intro');
      setOpened({ '1': o1 === '1', '2': o2 === '1' });
    })();
  }, [repo]);

  async function go(next: Step | 'codes') {
    if (next === 'codes') {
      await repo.setState('guide_step', '2');
      router.push({ pathname: '/credenciais/informar', params: { from: from ?? '', voltar: voltar ?? '' } });
      return;
    }
    await repo.setState('guide_step', next);
    setStep(next);
  }

  async function openSite(which: '1' | '2') {
    setOpenFailed(null);
    try {
      await Linking.openURL(URLS[which]);
      await repo.setState(`guide_opened_${which}`, '1');
      setOpened((o) => ({ ...o, [which]: true }));
    } catch {
      setOpenFailed(which);
    }
  }

  if (!step) return <Screen><View /></Screen>;

  const footer = (
    <View style={s.footer}>
      <Button onPress={() => setHelp(true)}>Preciso de ajuda</Button>
    </View>
  );

  const failBox = openFailed && (
    <View style={[s.fail, { backgroundColor: theme.colors.errorContainer }]} accessibilityRole="alert">
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Icon source="alert-circle-outline" size={20} color={theme.colors.onErrorContainer} />
        <Text style={{ color: theme.colors.onErrorContainer, flex: 1 }}>{`Não foi possível abrir o site. Copie o endereço: ${HOSTS[openFailed]}`}</Text>
      </View>
      <Button onPress={() => Clipboard.setStringAsync(URLS[openFailed])} textColor={theme.colors.onErrorContainer}>Copiar endereço</Button>
    </View>
  );

  return (
    <Screen style={{ gap: 12, paddingTop: 16 }}>
      {step === 'intro' && (
        <>
          {flash && <Banner tone="info" icon="check-circle-outline" text={flash} />}
          <Text variant="headlineSmall" accessibilityRole="header">Antes de conectar, prepare o Pluggy</Text>
          <Text variant="bodyLarge">O Pluggy é o serviço que busca os dados dos seus bancos pelo Open Finance. Você cria uma conta gratuita lá e traz dois códigos para este app. Só precisa fazer isso uma vez.</Text>
          {[
            ['1', 'Conectar seus bancos no Meu Pluggy', opened['1']],
            ['2', 'Criar sua aplicação no painel do Pluggy', opened['2']],
            ['3', 'Colar seus códigos aqui', false],
          ].map(([n, label, done]) => (
            <List.Item
              key={n as string}
              title={label as string}
              description={done ? 'Feita' : 'A fazer'}
              left={(p) => <List.Icon {...p} icon={done ? 'check-circle' : `numeric-${n}-circle-outline`} />}
              accessibilityLabel={`Etapa ${n}: ${label}. ${done ? 'Feita' : 'A fazer'}`}
            />
          ))}
          <Button mode="contained" onPress={() => go('1')} contentStyle={s.btn}>Começar</Button>
          <Button onPress={() => go('codes')} contentStyle={s.btn}>Já tenho meus códigos</Button>
          {/* RF-001.13 (UX 0.12): na primeira abertura, "Agora não" leva ao Início vazio. */}
          {primeira ? <Button onPress={() => router.dismissTo('/(tabs)')} contentStyle={s.btn}>Agora não</Button> : null}
          <View style={s.note}>
            <Icon source="lock-outline" size={16} color={theme.colors.onSurfaceVariant} />
            <Text variant="bodyMedium" style={{ marginLeft: 6, color: theme.colors.onSurfaceVariant }}>Sua senha do banco nunca é digitada neste app.</Text>
          </View>
        </>
      )}

      {step === '1' && (
        <>
          <Text variant="labelLarge">Etapa 1 de 3</Text>
          <Text variant="headlineSmall" accessibilityRole="header">Conectar seus bancos no Meu Pluggy</Text>
          {[
            'Crie sua conta no Meu Pluggy com e-mail e senha.',
            "Toque em 'Conectar Minha Conta' e escolha seu banco.",
            'Autorize no seu banco e espere voltar para o Meu Pluggy.',
            'Repita para cada banco. O plano gratuito aceita até 5 conexões, todas de contas suas.',
          ].map((t, i) => <Text key={i} variant="bodyLarge">{`${i + 1}. ${t}`}</Text>)}
          {failBox}
          {opened['1'] ? (
            <>
              <Button mode="contained" onPress={() => go('2')} contentStyle={s.btn}>Já conectei meus bancos</Button>
              <Button onPress={() => openSite('1')} contentStyle={s.btn}>Abrir o Meu Pluggy de novo</Button>
            </>
          ) : (
            <Button mode="contained" onPress={() => openSite('1')} contentStyle={s.btn}>Abrir o Meu Pluggy</Button>
          )}
          {footer}
        </>
      )}

      {step === '2' && (
        <>
          <Text variant="labelLarge">Etapa 2 de 3</Text>
          <Text variant="headlineSmall" accessibilityRole="header">Criar sua aplicação no painel do Pluggy</Text>
          {[
            'Crie sua conta no painel do Pluggy, de preferência com o mesmo e-mail. Pode ignorar o aviso de teste de 15 dias.',
            `Crie uma aplicação. Uma só basta. Dê a ela um nome que você reconheça, por exemplo '${SUGGESTED_APP_NAME}'. Esse nome aparece na janela do Pluggy quando você conecta um banco.`,
            "Nas configurações de conectores da aplicação, ative o 'MeuPluggy'.",
            "Copie o Client ID e o Client Secret. Copie o Client Secret logo ao criar a aplicação; se não aparecer, abra a aba 'Aplicação'.",
          ].map((t, i) => (
            <View key={i}>
              <Text variant="bodyLarge">{`${i + 1}. ${t}`}</Text>
              {/* [0.13] R-15.1: o app não confere nem exige o nome. */}
              {i === 1 && (
                <Button icon={copied ? 'check' : 'content-copy'} onPress={async () => { await Clipboard.setStringAsync(SUGGESTED_APP_NAME); setCopied(true); announce('Nome copiado'); }} style={{ alignSelf: 'flex-start' }}>
                  {copied ? 'Nome copiado' : 'Copiar nome'}
                </Button>
              )}
            </View>
          ))}
          <List.Accordion title="Estou fazendo isso no computador" expanded={pcTip} onPress={() => setPcTip(!pcTip)}>
            <Text variant="bodyMedium" style={{ paddingHorizontal: 16 }}>Você vai precisar trazer os dois códigos para o celular. Use um gerenciador de senhas ou abra o painel do Pluggy no navegador do celular para copiar e colar.</Text>
          </List.Accordion>
          {failBox}
          {opened['2'] ? (
            <>
              <Button mode="contained" onPress={() => go('codes')} contentStyle={s.btn}>Já tenho meus códigos</Button>
              <Button onPress={() => openSite('2')} contentStyle={s.btn}>Abrir o painel do Pluggy de novo</Button>
            </>
          ) : (
            <Button mode="contained" onPress={() => openSite('2')} contentStyle={s.btn}>Abrir o painel do Pluggy</Button>
          )}
          {footer}
        </>
      )}

      <Portal>
        {/* Folha "Preciso de ajuda" (UX v0.4, T-05): perguntas que abrem a resposta no lugar. */}
        <Modal visible={help} onDismiss={() => setHelp(false)} contentContainerStyle={[s.sheet, { backgroundColor: theme.colors.surface }]}>
          <Text variant="titleLarge" accessibilityRole="header">Ajuda</Text>
          <ScrollView style={{ maxHeight: 460 }}>
            {HELP.map(([q, a]) => (
              <List.Accordion key={q} title={q} titleNumberOfLines={3} expanded={openQ === q} onPress={() => setOpenQ(openQ === q ? null : q)}>
                <Text variant="bodyMedium" style={{ paddingHorizontal: 16, paddingBottom: 12 }}>{a}</Text>
              </List.Accordion>
            ))}
          </ScrollView>
          <Button onPress={() => setHelp(false)} style={{ alignSelf: 'flex-end' }}>Fechar</Button>
        </Modal>
      </Portal>
    </Screen>
  );
}

const s = StyleSheet.create({
  btn: { minHeight: 48 },
  note: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  footer: { marginTop: 'auto', paddingTop: 16, alignItems: 'center' },
  fail: { padding: 12, borderRadius: 12 },
  sheet: { marginTop: 'auto', padding: 16, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxWidth: 640, width: '100%', alignSelf: 'center' },
});

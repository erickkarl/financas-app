import React from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { PaperProvider, Text } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DB_NAME, migrate, type Db } from '../data/db';
import { AppProvider, useApp } from '../state/AppContext';
import { darkTheme, lightTheme } from '../ui/theme';
import { APP_NAME } from '../ui/constants';
import { UnlockScreen } from '../ui/UnlockScreen';


function Navigator() {
  const { ready, locked, privacyCover } = useApp();
  const theme = useColorScheme() === 'dark' ? darkTheme : lightTheme;
  // RF-001.5: ao abrir do zero, nenhum dado é montado antes do primeiro desbloqueio. Depois, a navegação fica
  // montada por baixo de T-03 (escondida e fora da árvore do leitor de tela) para a pessoa voltar para onde estava.
  const [unlockedOnce, setUnlockedOnce] = React.useState(false);
  React.useEffect(() => { if (ready && !locked) setUnlockedOnce(true); }, [ready, locked]);
  return (
    <View style={{ flex: 1 }}>
      {/* UX 0.12: sem login. A navegação fica montada por baixo de T-03 para a pessoa voltar para onde estava. */}
      {(unlockedOnce || (ready && !locked)) && (
      <View style={{ flex: 1 }} importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={locked}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTintColor: theme.colors.onSurface,
          contentStyle: { backgroundColor: theme.colors.background },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="guia" options={{ title: 'Preparar o Pluggy' }} />
          <Stack.Screen name="credenciais/index" options={{ title: 'Credenciais do Pluggy' }} />
          <Stack.Screen name="credenciais/informar" options={{ title: 'Seus códigos do Pluggy' }} />
          <Stack.Screen name="conectar" options={{ title: 'Conectar instituição' }} />
          <Stack.Screen name="conexoes/index" options={{ title: 'Conexões' }} />
          <Stack.Screen name="conexoes/[id]" options={{ title: 'Conexão' }} />
          <Stack.Screen name="substituir/[id]" options={{ title: 'Autorizar de novo' }} />
          <Stack.Screen name="transacao/[id]" options={{ title: 'Transação' }} />
          <Stack.Screen name="lancamento" options={{ title: 'Novo lançamento' }} />
          <Stack.Screen name="patrimonio" options={{ title: 'Patrimônio' }} />
          <Stack.Screen name="privacidade" options={{ title: 'Privacidade e dados' }} />
          <Stack.Screen name="categorias-lembradas" options={{ title: 'Categorias lembradas' }} />
      </Stack>
      </View>
      )}
      {ready && locked && <UnlockScreen />}
      {!ready && <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]} />}
      {privacyCover && (
        // UX-004: nada de valores na miniatura da lista de apps recentes nem atrás do bloqueio.
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text variant="headlineSmall">{APP_NAME}</Text>
        </View>
      )}
    </View>
  );
}

function Providers() {
  const db = useSQLiteContext();
  const scheme = useColorScheme();
  return (
    <AppProvider db={db}>
      <PaperProvider theme={scheme === 'dark' ? darkTheme : lightTheme}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Navigator />
      </PaperProvider>
    </AppProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName={DB_NAME} onInit={(db) => migrate(db as unknown as Db)}>
        <Providers />
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}

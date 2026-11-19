import type { ExpoConfig } from 'expo/config';

// RF-001 (requisitos v1.16): sem login e sem conta; o app abre com o desbloqueio do aparelho. Só Android.
const plugins: ExpoConfig['plugins'] = [
  'expo-router',
  'expo-secure-store',
  'expo-sqlite',
  'expo-web-browser',
  'expo-local-authentication',
  // REV-35 / RF-001.9: a miniatura em "apps recentes" não mostra dados.
  './plugins/withRecentsPrivacy',
];

const config: ExpoConfig = {
  name: 'Finanças',
  slug: 'financas-app',
  version: '0.1.0',
  scheme: 'financasapp',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'dev.financas.app',
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: 'dev.financas.app',
    // Dados financeiros não vão para o backup em nuvem do Android (RNF-002).
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins,
};

export default config;

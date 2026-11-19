// Barra de navegação inferior. Ciclo 1: Início, Extrato e Ajustes. "Resumo" (RF-008, Should) entra no ciclo 2 (UX §4).
import React from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';
import { Icon } from 'react-native-paper';
import { useAppTheme } from '../../ui/components';

/** Indicador do destino ativo em pílula atrás do ícone (Material 3, REV-12). */
function TabIcon({ icon, color, size, focused }: { icon: string; color: string; size: number; focused: boolean }) {
  const theme = useAppTheme();
  return (
    <View style={{ width: 64, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? theme.colors.secondaryContainer : 'transparent' }}>
      <Icon source={icon} color={color} size={size} />
    </View>
  );
}

export default function TabsLayout() {
  const theme = useAppTheme();
  const { fontScale, width } = useWindowDimensions();
  // REV-19: título alinhado à coluna de conteúdo (máx. 640 dp centralizada).
  const columnInset = Math.max(0, (width - 640) / 2);
  const insets = useSafeAreaInsets();
  // Altura cresce com a fonte do sistema (UX-033): ícone + rótulo nunca cortados.
  const tabHeight = 40 + Math.ceil(18 * Math.max(1, fontScale)) + insets.bottom;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.onSecondaryContainer,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: { backgroundColor: theme.colors.surface, height: tabHeight, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 12 },
        // REV-27: rótulo abaixo do ícone também deitado; a pílula fica só atrás do ícone, como em pé.
        tabBarLabelPosition: 'below-icon',
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.onSurface,
        headerTitleContainerStyle: { marginLeft: 16 + Math.max(0, columnInset - insets.left) },
        headerRightContainerStyle: { marginRight: Math.max(0, columnInset - insets.right) },
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: ({ color, size, focused }) => <TabIcon icon="home-outline" color={String(color)} size={size} focused={focused} /> }} />
      <Tabs.Screen name="extrato" options={{ title: 'Extrato', tabBarIcon: ({ color, size, focused }) => <TabIcon icon="format-list-bulleted" color={String(color)} size={size} focused={focused} /> }} />
      <Tabs.Screen name="ajustes" options={{ title: 'Ajustes', tabBarIcon: ({ color, size, focused }) => <TabIcon icon="cog-outline" color={String(color)} size={size} focused={focused} /> }} />
    </Tabs>
  );
}

// Barra de navegação inferior. Ciclo 1: Início, Extrato e Ajustes. "Resumo" (RF-008, Should) entra no ciclo 2 (UX §4).
import React, { useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
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

const LABELS = ['Início', 'Extrato', 'Resumo', 'Ajustes'];
const LABEL_SIZE = 12;
/** O mesmo estilo no texto medido e no rótulo desenhado (sem isso, a medida não vale para o rótulo). */
const LABEL_STYLE = { fontWeight: '500' as const, letterSpacing: 0, includeFontPadding: false };
/** Folga lateral do rótulo dentro do destino (dp). */
const LABEL_PAD = 2;

/**
 * ux.md 0.23 (C4-09, UX-122): os quatro rótulos aparecem inteiros, numa linha, sem reticências, e seguem a fonte do
 * sistema. Só quando algum não cabe, os quatro encolhem juntos, só o necessário para o mais largo caber, nunca abaixo
 * do tamanho de 100%. A largura de cada rótulo é medida em textos invisíveis, no tamanho cheio.
 */
function useTabLabelScale(fontScale: number) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  // Espaço real do rótulo em cada destino, medido na própria barra (a menor das quatro).
  const [slots, setSlots] = useState<Record<string, number>>({});
  const measured = LABELS.every((l) => widths[l] !== undefined);
  const widest = measured ? Math.max(...LABELS.map((l) => widths[l])) : 0;
  const slotVals = Object.values(slots);
  const avail = slotVals.length ? Math.min(...slotVals) - 2 * LABEL_PAD : Infinity;
  const fit = widest > avail && widest > 0 ? avail / widest : 1;
  // Nunca abaixo do tamanho de 100%: o fator mínimo é 1 / fontScale (quando a fonte do sistema é maior que 100%).
  const scale = Math.max(fit, Math.min(1, 1 / Math.max(fontScale, 1)));
  const probe = (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ position: 'absolute', opacity: 0, left: 0, top: 0 }}>
      {LABELS.map((l) => (
        <Text key={l} style={[LABEL_STYLE, { fontSize: LABEL_SIZE, alignSelf: 'flex-start' }]}
          onLayout={(e) => { const w = e.nativeEvent.layout.width; setWidths((p) => (Math.abs((p[l] ?? -1) - w) < 0.5 ? p : { ...p, [l]: w })); }}>{l}</Text>
      ))}
    </View>
  );
  const reportSlot = (name: string, w: number) => setSlots((p) => (Math.abs((p[name] ?? -1) - w) < 0.5 ? p : { ...p, [name]: w }));
  return { fontSize: LABEL_SIZE * scale, scale, probe, widest, avail, reportSlot };
}

export default function TabsLayout() {
  const theme = useAppTheme();
  const { fontScale, width } = useWindowDimensions();
  // REV-19: título alinhado à coluna de conteúdo (máx. 640 dp centralizada).
  const insets = useSafeAreaInsets();
  const columnInset = Math.max(0, (width - insets.left - insets.right - 640) / 2);
  // Altura cresce com a fonte do sistema (UX-033): ícone + rótulo nunca cortados.
  const tabHeight = 40 + Math.ceil(18 * Math.max(1, fontScale)) + insets.bottom;
  const label = useTabLabelScale(fontScale);
  return (
    <>
    {label.probe}
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.onSecondaryContainer,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: { backgroundColor: theme.colors.surface, height: tabHeight, paddingTop: 6 },
        // O rótulo é desenhado aqui, com o estilo medido; o leitor de tela continua lendo o nome do destino.
        tabBarLabel: ({ color, children }) => (
          <View style={{ alignSelf: 'stretch' }} onLayout={(e) => label.reportSlot(String(children), e.nativeEvent.layout.width)}>
            <Text numberOfLines={1} style={[LABEL_STYLE, { color, fontSize: label.fontSize, textAlign: 'center' }]}>{children}</Text>
          </View>
        ),
        // REV-27: rótulo abaixo do ícone também deitado; a pílula fica só atrás do ícone, como em pé.
        tabBarLabelPosition: 'below-icon',
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.onSurface,
        // C3-09: a barra já recua a área segura; o título completa até a coluna das telas, que é centrada na área
        // útil (largura menos as duas áreas seguras), e não na tela inteira. Com o recorte da câmera de um lado só,
        // a conta antiga deixava o título 68 px antes da coluna.
        headerTitleContainerStyle: { marginLeft: 16 + columnInset },
        headerRightContainerStyle: { marginRight: columnInset },
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: ({ color, size, focused }) => <TabIcon icon="home-outline" color={String(color)} size={size} focused={focused} /> }} />
      <Tabs.Screen name="extrato" options={{ title: 'Extrato', tabBarIcon: ({ color, size, focused }) => <TabIcon icon="format-list-bulleted" color={String(color)} size={size} focused={focused} /> }} />
      <Tabs.Screen name="resumo" options={{ title: 'Resumo', headerShown: false, tabBarIcon: ({ color, size, focused }) => <TabIcon icon="chart-box-outline" color={String(color)} size={size} focused={focused} /> }} />
      <Tabs.Screen name="ajustes" options={{ title: 'Ajustes', tabBarIcon: ({ color, size, focused }) => <TabIcon icon="cog-outline" color={String(color)} size={size} focused={focused} /> }} />
    </Tabs>
    </>
  );
}

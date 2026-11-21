// Aba "Resumo" (UX 0.19, E-15 a): abre em T-23 "Resumo por mês"; T-18 vira a página do mês, com voltar e o título
// "Resumo do mês". A T-23 continua montada embaixo, então voltar mantém critério, período e posição da lista.
import React from 'react';
import { Stack } from 'expo-router';
import { useAppTheme, HeaderTitle } from '../../../ui/components';

export default function ResumoLayout() {
  const theme = useAppTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.onSurface,
        contentStyle: { backgroundColor: theme.colors.background },
        headerTitle: ({ children }) => <HeaderTitle>{children}</HeaderTitle>,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Resumo' }} />
      <Stack.Screen name="mes" options={{ title: 'Resumo do mês' }} />
    </Stack>
  );
}

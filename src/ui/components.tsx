// Componentes compartilhados (UX §7). Todos sobre Material 3 do react-native-paper.
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Linking, Platform, ScrollView, StyleSheet, TextInput, useWindowDimensions, View, type ScrollViewProps, type ViewStyle } from 'react-native';
import { Icon, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { Button, IconButton } from './touch';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppTheme } from './theme';
import { amountA11y, balanceA11y, displayDescription, formatSignedAmount, spDateKey, spokenDate } from '../domain/format';
import { categoryById } from '../domain/categories';
import type { TransactionRow } from '../data/repo';
import type { ConnectionStatusView } from '../domain/connectionStatus';

/** Ícones que carregam significado crescem com a fonte do sistema (UX-033, REV-13). */
export function useIconSize(base: number): number {
  const { fontScale } = useWindowDimensions();
  return Math.round(base * Math.min(Math.max(fontScale, 1), 2));
}

export const useAppTheme = () => useTheme<AppTheme>();

export function announce(message: string) {
  AccessibilityInfo.announceForAccessibility(message);
}

/** Conteúdo com margem de 16 dp e largura máxima de 640 dp centralizada (UX §8). */
export function Screen({ children, scroll = true, style, edges = ['left', 'right'], ...rest }: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
} & ScrollViewProps) {
  const theme = useAppTheme();
  const inner = <View style={[styles.inner, style]}>{children}</View>;
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" {...rest}>
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

/** Valor com sinal, ícone e nome lido (UX §3.1): nunca depende só de cor. */
export function Amount({ value, variant = 'titleMedium', neutral = false }: { value: number; variant?: 'titleMedium' | 'bodyLarge' | 'displaySmall' | 'headlineSmall'; neutral?: boolean }) {
  const theme = useAppTheme();
  const isIn = value > 0;
  const isZero = Math.round(value * 100) === 0;
  // Futura (UX 0.8): mantém sinal e seta, em cor neutra.
  const color = isIn && !isZero && !neutral ? theme.colors.entrada : theme.colors.saida;
  const iconSize = useIconSize(16);
  return (
    <View style={styles.row} accessible accessibilityLabel={amountA11y(value)}>
      {!isZero && <Icon source={isIn ? 'arrow-down' : 'arrow-up'} size={iconSize} color={color} />}
      <Text variant={variant} style={[{ color }, styles.tabular]}>{formatSignedAmount(value)}</Text>
    </View>
  );
}

/** Faixa de aviso no topo do conteúdo (ícone + texto + ação). */
export function Banner({ icon = 'alert-outline', text, actionLabel, onAction, tone = 'warning', secondaryLabel, onSecondary }: {
  icon?: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'warning' | 'error' | 'info';
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const theme = useAppTheme();
  const bg = tone === 'error' ? theme.colors.errorContainer : tone === 'info' ? theme.colors.secondaryContainer : theme.colors.atencaoContainer;
  const fg = tone === 'error' ? theme.colors.onErrorContainer : tone === 'info' ? theme.colors.onSecondaryContainer : theme.colors.atencao;
  const iconSize = useIconSize(20);
  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityRole="alert">
      <View style={styles.row}>
        <Icon source={icon} size={iconSize} color={fg} />
        <Text variant="bodyMedium" style={[styles.flex, { color: fg, marginLeft: 8 }]}>{text}</Text>
      </View>
      {(actionLabel || secondaryLabel) && (
        <View style={styles.bannerActions}>
          {secondaryLabel && onSecondary && <Button compact align="right" onPress={onSecondary} textColor={fg}>{secondaryLabel}</Button>}
          {actionLabel && onAction && <Button compact align="right" onPress={onAction} textColor={fg}>{actionLabel}</Button>}
        </View>
      )}
    </View>
  );
}

/** Padrão único de estado vazio: título, uma frase, uma ação principal. */
export function EmptyState({ icon, title, text, actionLabel, onAction, secondaryLabel, onSecondary }: {
  icon: string;
  title: string;
  text?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const theme = useAppTheme();
  return (
    <View style={styles.empty}>
      <Icon source={icon} size={56} color={theme.colors.onSurfaceVariant} />
      <Text variant="titleMedium" style={styles.center} accessibilityRole="header">{title}</Text>
      {text && <Text variant="bodyMedium" style={[styles.center, { color: theme.colors.onSurfaceVariant }]}>{text}</Text>}
      {actionLabel && onAction && <Button mode="contained" onPress={onAction} style={styles.mt}>{actionLabel}</Button>}
      {secondaryLabel && onSecondary && <Button onPress={onSecondary}>{secondaryLabel}</Button>}
    </View>
  );
}

/** Esqueleto de carregamento; sem animação (respeita "reduzir movimento"). */
export function Skeleton({ lines = 3, height = 56 }: { lines?: number; height?: number }) {
  const theme = useAppTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]));
      loop.start();
    });
    return () => loop?.stop();
  }, [opacity]);
  return (
    <View accessibilityLabel="Carregando" accessible>
      {Array.from({ length: lines }).map((_, i) => (
        <Animated.View key={i} style={{ height, borderRadius: 12, marginVertical: 4, backgroundColor: theme.colors.surfaceVariant, opacity }} />
      ))}
    </View>
  );
}

export function Chip({ label, icon }: { label: string; icon?: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.badge, { borderColor: theme.colors.outline }]}>
      {icon && <Icon source={icon} size={12} color={theme.colors.onSurfaceVariant} />}
      <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginLeft: icon ? 4 : 0 }}>{label}</Text>
    </View>
  );
}

/** Linha de transação lida como uma unidade (UX §9). */
/** RF-005.3 (UX 0.9): futura enquanto a data for depois de hoje (São Paulo); no próprio dia já conta. */
export function isFutureTx(dateKey: string, today: string = spDateKey(new Date())): boolean {
  return dateKey > today;
}

export function TransactionItem({ tx, onPress, showConnection = false }: { tx: TransactionRow; onPress: () => void; showConnection?: boolean }) {
  const theme = useAppTheme();
  const { fontScale } = useWindowDimensions();
  // Com fonte grande, a linha empilha: descrição em cima, valor embaixo (UX §8).
  const stacked = fontScale >= 1.5;
  const catIcon = useIconSize(14);
  const cat = categoryById(tx.category);
  // UX v0.4: conta com nome repetido mostra o nome da conexão ("Conta corrente · Conexão 1").
  const accountLabel = showConnection && tx.connection_name ? `${tx.account_name} · ${tx.connection_name}` : tx.account_name;
  const future = isFutureTx(tx.date_key);
  // UX 0.14: selo "Fora do Resumo" (ícone + texto); o valor fica em cor neutra.
  const out = Boolean(tx.out_of_summary);
  // UX 0.17 (RF-008.10): estorno de compra no cartão, com selo e valor em cor neutra (não é receita).
  const refund = Boolean(tx.refund);
  const badges = [future ? 'Futura' : null, refund ? 'Estorno' : null, tx.manual ? 'Manual' : null, tx.hidden ? 'Oculta' : null, tx.transfer ? 'Transferência' : null, out ? 'Fora do Resumo' : null].filter(Boolean) as string[];
  const rest = badges.filter((b) => b !== 'Fora do Resumo' && b !== 'Estorno');
  const label = future
    ? `Futura, ${amountA11y(tx.amount).toLowerCase()}, ${tx.description}, categoria ${cat.name}, ${accountLabel}, prevista para ${spokenDate(tx.date_key)} de ${tx.date_key.slice(0, 4)}`
    : refund
      ? `${out ? 'Fora do Resumo, ' : ''}Estorno de ${balanceA11y(tx.amount)}, ${tx.description}, categoria ${cat.name}, ${accountLabel}, ${spokenDate(tx.date_key)}${rest.length ? `, ${rest.join(', ')}` : ''}`
      : `${out ? 'Fora do Resumo, ' : ''}${out ? amountA11y(tx.amount).toLowerCase() : amountA11y(tx.amount)}, ${tx.description}, categoria ${cat.name}, ${accountLabel}, ${spokenDate(tx.date_key)}${rest.length ? `, ${rest.join(', ')}` : ''}`;
  return (
    <TouchableRipple onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.txRow}>
      <View style={[styles.txWrap, stacked && { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <View style={[styles.txMain, stacked && { flexBasis: 'auto', width: '100%' }]}>
          <Text variant="bodyLarge" numberOfLines={2}>{displayDescription(tx.description)}</Text>
          <View style={[styles.row, { alignItems: 'flex-start' }]}>
            <Icon source={cat.icon} size={catIcon} color={theme.colors.onSurfaceVariant} />
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginLeft: 4, flexShrink: 1 }}>{cat.name} · {accountLabel}</Text>
          </View>
          {badges.length > 0 && <View style={[styles.row, { gap: 4, marginTop: 4 }]}>{badges.map((b) => <Chip key={b} label={b} icon={b === 'Futura' ? 'calendar-clock' : b === 'Fora do Resumo' ? 'calculator-variant-outline' : b === 'Estorno' ? 'cash-refund' : undefined} />)}</View>}
        </View>
        <Amount value={tx.amount} neutral={future || out || refund} />
      </View>
    </TouchableRipple>
  );
}

/** Estado da conexão sempre com ícone e texto (tabela 7.1, REV-09). */
export function StatusLabel({ view }: { view: ConnectionStatusView }) {
  const theme = useAppTheme();
  const size = useIconSize(16);
  const icon = { ok: 'check-circle-outline', progress: 'sync', warning: 'alert-outline', error: 'alert-circle-outline', pending: 'timer-sand' }[view.tone];
  const color = view.tone === 'ok' ? theme.colors.primary : view.tone === 'error' ? theme.colors.error : view.tone === 'warning' ? theme.colors.atencao : theme.colors.onSurfaceVariant;
  return (
    <View style={[styles.row, { gap: 6 }]}>
      <Icon source={icon} size={size} color={color} />
      <Text variant="bodyMedium" style={{ flexShrink: 1 }}>{view.label}</Text>
    </View>
  );
}

/** Mensagem de erro de campo: ícone + texto inteiro, logo abaixo do campo (REV-14, REV-17). */
export function FieldError({ text }: { text: string | null }) {
  const theme = useAppTheme();
  const size = useIconSize(16);
  if (!text) return null;
  return (
    <View style={[styles.row, { gap: 6, alignItems: 'flex-start' }]} accessibilityLiveRegion="polite">
      <Icon source="alert-circle-outline" size={size} color={theme.colors.error} />
      <Text variant="bodySmall" style={{ color: theme.colors.error, flex: 1 }}>{text}</Text>
    </View>
  );
}

/** Linha inteira tocável com rádio, caixa ou chave (UX-032): o controle pequeno não é um alvo à parte. */
export function OptionRow({ label, description, kind, checked, onPress, disabled = false }: {
  label: string; description?: string; kind: 'radio' | 'checkbox' | 'switch'; checked: boolean; onPress: () => void; disabled?: boolean;
}) {
  const theme = useAppTheme();
  const icon = kind === 'radio' ? (checked ? 'radiobox-marked' : 'radiobox-blank') : (checked ? 'checkbox-marked' : 'checkbox-blank-outline');
  return (
    <TouchableRipple
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={kind}
      accessibilityState={kind === 'radio' ? { selected: checked, disabled } : { checked, disabled }}
      accessibilityLabel={description ? `${label}. ${description}` : label}
      style={{ minHeight: 56, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 8 }}
    >
      <View style={[styles.row, { gap: 12, opacity: disabled ? 0.5 : 1 }]} importantForAccessibility="no-hide-descendants">
        <View style={{ flex: 1 }}>
          <Text variant="bodyLarge">{label}</Text>
          {description ? <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{description}</Text> : null}
        </View>
        <Icon
          source={kind === 'switch' ? (checked ? 'toggle-switch' : 'toggle-switch-off-outline') : icon}
          size={kind === 'switch' ? 40 : 24}
          color={checked ? theme.colors.primary : theme.colors.onSurfaceVariant}
        />
      </View>
    </TouchableRipple>
  );
}

/** Barra de busca: lupa decorativa (fora da árvore de acessibilidade) e "Limpar busca" com 48 dp (REV-24). */
export function SearchField({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.row, { backgroundColor: theme.colors.elevation.level3, borderRadius: 28, minHeight: 56, paddingLeft: 16 }]}>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Icon source="magnify" size={24} color={theme.colors.onSurfaceVariant} />
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.onSurfaceVariant}
        accessibilityLabel={placeholder}
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, minHeight: 48, marginLeft: 12, color: theme.colors.onSurface, fontSize: 16 }}
      />
      {value ? <IconButton icon="close" accessibilityLabel="Limpar busca" onPress={() => onChangeText('')} /> : <View style={{ width: 16 }} />}
    </View>
  );
}

/** R-7 (premissa do PM): item recolhido "Não tenho mais minhas credenciais"; nada sobre os dados do aparelho. */
export function NoCredentialsHelp({ action, onFindCredentials }: { action: 'excluir' | 'revogar'; onFindCredentials: () => void }) {
  const [open, setOpen] = React.useState(false);
  const first = action === 'excluir'
    ? 'Sem credenciais válidas, este app não consegue excluir suas conexões no Pluggy nem apagar os dados do app.'
    : 'Sem credenciais válidas, este app não consegue excluir esta conexão no Pluggy nem revogá-la.';
  return (
    <View>
      <TouchableRipple onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ minHeight: 48, justifyContent: 'center' }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text variant="labelLarge">Não tenho mais minhas credenciais</Text>
          <Icon source={open ? 'chevron-up' : 'chevron-down'} size={24} />
        </View>
      </TouchableRipple>
      {open && (
        <View style={{ gap: 6 }}>
          <Text variant="bodyMedium">{first}</Text>
          <Text variant="bodyMedium">Suas credenciais ficam no painel do Pluggy.</Text>
          <Button onPress={onFindCredentials} style={{ alignSelf: 'flex-start' }}>Como encontrar minhas credenciais</Button>
          <Text variant="bodyMedium">Suas conexões continuam no Pluggy. Você pode excluí-las lá, no painel do Pluggy.</Text>
          <Button onPress={() => Linking.openURL('https://dashboard.pluggy.ai')} style={{ alignSelf: 'flex-start' }}>Abrir o painel do Pluggy</Button>
          {/* RF-009.2.5 (UX 0.9): só no Android, onde a desinstalação foi verificada; no iOS o ponto não aparece. */}
          {Platform.OS === 'android' && (
            <Text variant="bodyMedium">Se você desinstalar este app, os dados guardados neste aparelho são apagados. Suas conexões continuam no Pluggy até você excluí-las lá.</Text>
          )}
        </View>
      )}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text variant="titleSmall" accessibilityRole="header" style={styles.section}>{children}</Text>;
}

export const styles = StyleSheet.create({
  scroll: { flexGrow: 1, alignItems: 'center' },
  inner: { width: '100%', maxWidth: 640, paddingHorizontal: 16, paddingBottom: 24, alignSelf: 'center', flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  banner: { borderRadius: 12, padding: 12, marginVertical: 8 },
  bannerActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap' },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  center: { textAlign: 'center' },
  mt: { marginTop: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  txRow: { minHeight: 56, paddingVertical: 8 },
  txWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  txMain: { flexShrink: 1, flexGrow: 1, flexBasis: 180 },
  section: { marginTop: 16, marginBottom: 4 },
});

/**
 * C3-07 (revisão do ciclo 3): o título nativo da barra superior das telas em pilha não acompanha a fonte do sistema,
 * enquanto o das abas acompanha. Este título é texto do app, cresce com a fonte e quebra em até 2 linhas.
 */
export function HeaderTitle({ children }: { children: string }) {
  // C3-09 / REV-19: o título começa na coluna de conteúdo (máx. 640 dp centralizada, com 16 dp de margem), também
  // deitado. Mede onde a barra o colocou e completa a diferença com margem (nunca negativa).
  const { width } = useWindowDimensions();
  const ref = useRef<{ measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null>(null);
  const [margin, setMargin] = React.useState(0);
  // Coluna das telas, que respeitam a área segura dos lados (Screen): margem esquerda + metade da sobra + 16 dp.
  const insets = useSafeAreaInsets();
  const target = insets.left + Math.max(0, (width - insets.left - insets.right - 640) / 2) + 16;
  const measure = () => ref.current?.measureInWindow((x: number) => {
    const base = x - margin;
    const next = Math.max(0, Math.round(target - base));
    if (Math.abs(next - margin) > 1) setMargin(next);
  });
  // C3-09 (Ajustes deitado): ao girar, o título pode não mudar de tamanho e o onLayout não volta; mede de novo quando
  // a largura ou a área segura mudam (e depois de a barra se acomodar).
  // Só depois de montado: medir durante a montagem da barra quebrava a montagem nativa ("View already has a parent").
  const dims = useRef(`${width}|${insets.left}|${insets.right}`);
  useEffect(() => {
    const key = `${width}|${insets.left}|${insets.right}`;
    if (key === dims.current) return;
    dims.current = key;
    const t = setTimeout(measure, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, insets.left, insets.right]);
  return (
    // C3-16: título em duas linhas com respiro em cima e embaixo, sem encostar na borda da barra.
    <View ref={ref as never} onLayout={measure} style={{ marginLeft: margin, flexShrink: 1, paddingVertical: 6 }}>
      <Text variant="titleLarge" numberOfLines={2} accessibilityRole="header">{children}</Text>
    </View>
  );
}

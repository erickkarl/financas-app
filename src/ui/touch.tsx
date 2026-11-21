// Botões com alvo mínimo de 48 dp (UX-032). Substituem Button e IconButton do Paper no app.
// C3-02 (revisão do ciclo 3, decisão do Designer): o rótulo de botão nunca é cortado com reticências; quebra em até
// 3 linhas, com o botão crescendo em altura. O Button do Paper fixa o rótulo em uma linha (numberOfLines={1}) sem
// opção para mudar, então o app desenha o botão aqui, com as cores e as formas do Material 3 que o Paper usa.
import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View, type AccessibilityRole, type AccessibilityState, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Dialog, Icon, IconButton as PaperIconButton, List, Text, TouchableRipple, useTheme, type MD3Theme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Mode = 'text' | 'outlined' | 'contained' | 'contained-tonal' | 'elevated';
type BtnProps = {
  mode?: Mode;
  children: React.ReactNode;
  onPress?: () => void;
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  textColor?: string;
  buttonColor?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  /** Aceito por compatibilidade: o alvo é sempre de 48 dp. */
  compact?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  testID?: string;
  /** C3-12: alinhamento do rótulo quando ele quebra. Padrão: o da posição do botão (alignSelf), senão centro. */
  align?: 'left' | 'center' | 'right';
};

function colors(theme: MD3Theme, mode: Mode, disabled: boolean, textColor?: string, buttonColor?: string) {
  const c = theme.colors;
  if (disabled) {
    return {
      bg: mode === 'contained' || mode === 'contained-tonal' || mode === 'elevated' ? c.surfaceDisabled : 'transparent',
      fg: c.onSurfaceDisabled,
      border: mode === 'outlined' ? c.surfaceDisabled : 'transparent',
    };
  }
  const bg = buttonColor ?? (mode === 'contained' ? c.primary : mode === 'contained-tonal' ? c.secondaryContainer : mode === 'elevated' ? c.elevation.level1 : 'transparent');
  const fg = textColor ?? (mode === 'contained' ? c.onPrimary : mode === 'contained-tonal' ? c.onSecondaryContainer : c.primary);
  return { bg, fg, border: mode === 'outlined' ? c.outline : 'transparent' };
}

// Só em desenvolvimento, para a evidência (revisão 3 do ciclo 3): financasapp://<tela>?carregando=1 mostra no estado
// carregando os botões que têm esse estado. Nunca ligado no app instalado.
let forceLoading = false;
export function setForceLoading(v: boolean) { if (__DEV__) forceLoading = v; }
export function isForceLoading() { return __DEV__ && forceLoading; }

export function Button({ mode = 'text', children, onPress, icon, disabled: disabledProp = false, loading: loadingProp, textColor, buttonColor, style, contentStyle, labelStyle, accessibilityLabel, accessibilityHint, accessibilityRole, accessibilityState, testID, align }: BtnProps) {
  const theme = useTheme<MD3Theme>();
  const forced = __DEV__ && forceLoading && loadingProp !== undefined;
  const loading = Boolean(loadingProp) || forced;
  const disabled = disabledProp || forced;
  const { bg, fg, border } = colors(theme, mode, disabled, textColor, buttonColor);
  const radius = 5 * theme.roundness;
  const textMode = mode === 'text';
  // Nome acessível sempre presente, mesmo quando o texto está fora da área visível.
  const label = accessibilityLabel ?? (typeof children === 'string' ? children : undefined);
  // Foco por teclado visível (WCAG 2.4.7): anel de 2 dp na cor do texto da superfície, fora do botão.
  const [focused, setFocused] = React.useState(false);
  // C3-12: com o rótulo em 2 ou 3 linhas, o botão mantém o alinhamento que tem com 1 linha (à esquerda, à direita ou
  // centralizado), em vez de virar um bloco centralizado na largura toda.
  const self = (StyleSheet.flatten(style) ?? {}).alignSelf;
  const textAlign = align ?? (self === 'flex-start' ? 'left' : self === 'flex-end' ? 'right' : 'center');
  const justify = textAlign === 'left' ? 'flex-start' : textAlign === 'right' ? 'flex-end' : 'center';
  // Revisão 3 do ciclo 3: numa linha com texto ao lado, o botão encolhia e partia a palavra ("Ocul / tar"). A largura
  // mínima é a da maior palavra do rótulo (labelLarge, com a fonte do sistema) mais o recuo; o rótulo só quebra entre
  // palavras. Nunca passa da largura da tela.
  const { fontScale, width: winW } = useWindowDimensions();
  const longest = typeof children === 'string' ? Math.max(0, ...children.split(/\s+/).map((w) => w.length)) : 0;
  const wordMin = Math.min(winW - 32, Math.ceil(longest * 8.5 * fontScale) + (textMode ? 24 : 48) + (icon || loading ? 26 : 0));
  return (
    <View style={[s.outer, { minWidth: Math.max(64, wordMin) }, { borderRadius: radius, backgroundColor: bg, borderColor: border, borderWidth: mode === 'outlined' ? 1 : 0 }, focused && { outlineWidth: 2, outlineColor: theme.colors.onSurface, outlineStyle: 'solid', outlineOffset: 2 }, style]}>
      <TouchableRipple
        onPress={onPress}
        disabled={disabled || loading}
        borderless
        style={{ borderRadius: radius }}
        accessibilityRole={accessibilityRole ?? 'button'}
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: disabled || loading, busy: loading, ...accessibilityState }}
        testID={testID}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <View style={[s.content, { paddingHorizontal: textMode ? 12 : 24, justifyContent: justify }, contentStyle, { minHeight: 48 }]}>
          {loading ? <ActivityIndicator size={18} color={fg} style={s.icon} />
            : icon ? <View style={s.icon}><Icon source={icon} size={18} color={fg} /></View> : null}
          <Text variant="labelLarge" numberOfLines={3} style={[s.label, { color: fg, textAlign }, labelStyle]}>{children}</Text>
        </View>
      </TouchableRipple>
    </View>
  );
}

const s = StyleSheet.create({
  outer: { minWidth: 64, maxWidth: '100%', flexShrink: 1 },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  icon: { marginRight: 8 },
  label: { flexShrink: 1 },
});

type IconBtnProps = React.ComponentProps<typeof PaperIconButton>;
export function IconButton({ style, size = 24, ...rest }: IconBtnProps) {
  // Contêiner do Paper = size + 16; com size 24 fica 40 dp. Fixamos 48 × 48.
  return <PaperIconButton {...rest} size={size} style={[{ width: 48, height: 48, margin: 0 }, style]} />;
}

/**
 * Revisão 2 do ciclo 3 (regressão do botão novo): a linha de ações dos diálogos quebra. Quando os dois botões não
 * cabem lado a lado (fonte grande), eles empilham, alinhados à direita, em vez de encolher e cortar a palavra.
 */
export function DialogActions({ children }: { children: React.ReactNode }) {
  return <Dialog.Actions style={{ flexWrap: 'wrap', rowGap: 4 }}>{children}</Dialog.Actions>;
}

/**
 * C3-13 (ux.md seção 8, esclarecimento da 0.20): o diálogo fica dentro da área segura, sem passar por baixo da barra de
 * status nem da de gestos. Quando o conteúdo não cabe, o título e o texto rolam dentro dele e os botões (DialogActions)
 * ficam fixos embaixo, sempre à vista. Substitui o Dialog do Paper nos 13 diálogos do app.
 */
export function AppDialog({ children, style, ...rest }: React.ComponentProps<typeof Dialog>) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const flat = StyleSheet.flatten(style) ?? {};
  const kb = typeof flat.marginBottom === 'number' ? flat.marginBottom : 0;
  // 24 dp de folga em cima e embaixo, além das barras do sistema (e do teclado, quando o diálogo sobe com ele).
  const maxHeight = Math.max(160, height - insets.top - insets.bottom - kb - 48);
  const items = React.Children.toArray(children);
  const isActions = (c: unknown) => React.isValidElement(c) && c.type === DialogActions;
  return (
    <Dialog {...rest} style={[style, { maxHeight }]}>
      <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} keyboardShouldPersistTaps="handled">
        {items.filter((c) => !isActions(c))}
      </ScrollView>
      {items.filter(isActions)}
    </Dialog>
  );
}

/**
 * C3-14 (ux.md seção 8, esclarecimento da 0.20): título e texto de apoio de linha de lista sem limite de linhas nem
 * reticências; a linha cresce em altura. Exceções aprovadas (descrição na linha do Extrato e em T-22) não usam este
 * componente.
 */
export function ListItem(props: React.ComponentProps<typeof List.Item>) {
  return <List.Item titleNumberOfLines={0} descriptionNumberOfLines={0} {...props} />;
}
export function ListAccordion(props: React.ComponentProps<typeof List.Accordion>) {
  return <List.Accordion titleNumberOfLines={0} descriptionNumberOfLines={0} {...props} />;
}

// Botões com alvo mínimo de 48 dp (UX-032). Substituem Button e IconButton do Paper no app.
import React from 'react';
import { Button as PaperButton, IconButton as PaperIconButton } from 'react-native-paper';

type BtnProps = React.ComponentProps<typeof PaperButton>;
export function Button({ contentStyle, compact: _compact, accessibilityLabel, ...rest }: BtnProps) {
  // Nome acessível sempre presente, mesmo quando o texto está fora da área visível.
  const label = accessibilityLabel ?? (typeof rest.children === 'string' ? rest.children : undefined);
  return <PaperButton {...rest} accessibilityLabel={label} contentStyle={[{ minHeight: 48 }, contentStyle]} />;
}

type IconBtnProps = React.ComponentProps<typeof PaperIconButton>;
export function IconButton({ style, size = 24, ...rest }: IconBtnProps) {
  // Contêiner do Paper = size + 16; com size 24 fica 40 dp. Fixamos 48 × 48.
  return <PaperIconButton {...rest} size={size} style={[{ width: 48, height: 48, margin: 0 }, style]} />;
}

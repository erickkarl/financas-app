// Paletas e contraste — sem dependências de interface, para testar em Node (UX-031).

export const lightColors = {
  primary: '#006C4F',
  onPrimary: '#FFFFFF',
  primaryContainer: '#89F8C7',
  onPrimaryContainer: '#002115',
  secondary: '#4C6359',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#CEE9DB',
  onSecondaryContainer: '#082017',
  tertiary: '#3E6374',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#C2E8FC',
  onTertiaryContainer: '#001F2A',
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  background: '#FBFDF9',
  onBackground: '#191C1A',
  surface: '#FBFDF9',
  onSurface: '#191C1A',
  surfaceVariant: '#DBE5DE',
  onSurfaceVariant: '#404944',
  outline: '#707973',
  outlineVariant: '#BFC9C2',
  inverseSurface: '#2E312F',
  inverseOnSurface: '#EFF1EE',
  inversePrimary: '#6CDBAC',
  surfaceContainerHighest: '#E1E3DF',
  entrada: '#0F5C2E',
  saida: '#191C1A',
  atencao: '#6B4A00',
  atencaoContainer: '#FFDEA6',
};

export const darkColors = {
  primary: '#6CDBAC',
  onPrimary: '#003827',
  primaryContainer: '#005139',
  onPrimaryContainer: '#89F8C7',
  secondary: '#B3CCBF',
  onSecondary: '#1F352C',
  secondaryContainer: '#354B42',
  onSecondaryContainer: '#CEE9DB',
  tertiary: '#A6CCDF',
  onTertiary: '#083544',
  tertiaryContainer: '#254B5B',
  onTertiaryContainer: '#C2E8FC',
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
  background: '#191C1A',
  onBackground: '#E1E3DF',
  surface: '#191C1A',
  onSurface: '#E1E3DF',
  surfaceVariant: '#404944',
  onSurfaceVariant: '#BFC9C2',
  outline: '#89938D',
  outlineVariant: '#404944',
  inverseSurface: '#E1E3DF',
  inverseOnSurface: '#2E312F',
  inversePrimary: '#006C4F',
  surfaceContainerHighest: '#323533',
  entrada: '#7FDA9A',
  saida: '#E1E3DF',
  atencao: '#F2BF4A',
  atencaoContainer: '#3D2C00',
};

/** Contraste WCAG entre duas cores #RRGGBB. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

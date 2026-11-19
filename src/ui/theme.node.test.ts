// UX-031: pares texto/fundo ≥ 4,5:1 (texto) e ≥ 3:1 (componentes), nos dois temas,
// contra o fundo mais desfavorável (surfaceContainerHighest) quando se aplica.
import { contrastRatio, darkColors, lightColors } from './palette';

const schemes = { claro: lightColors, escuro: darkColors };

describe.each(Object.entries(schemes))('tema %s', (_name, c) => {
  const text: [string, string, string][] = [
    ['onSurface', c.onSurface, c.surfaceContainerHighest],
    ['onSurfaceVariant', c.onSurfaceVariant, c.surfaceContainerHighest],
    ['primary (links/botões de texto)', c.primary, c.surfaceContainerHighest],
    ['onPrimary sobre primary', c.onPrimary, c.primary],
    ['onPrimaryContainer', c.onPrimaryContainer, c.primaryContainer],
    ['onSecondaryContainer', c.onSecondaryContainer, c.secondaryContainer],
    ['financas.entrada', c.entrada, c.surfaceContainerHighest],
    ['financas.saida', c.saida, c.surfaceContainerHighest],
    ['financas.atencao', c.atencao, c.surfaceContainerHighest],
    ['atenção na faixa', c.atencao, c.atencaoContainer],
    ['error', c.error, c.surfaceContainerHighest],
    ['onErrorContainer', c.onErrorContainer, c.errorContainer],
    ['inverseOnSurface (snackbar)', c.inverseOnSurface, c.inverseSurface],
    ['inversePrimary (ação do snackbar)', c.inversePrimary, c.inverseSurface],
  ];
  test.each(text)('%s ≥ 4,5:1', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  test('contorno de componentes (outline) ≥ 3:1', () => {
    expect(contrastRatio(c.outline, c.surface)).toBeGreaterThanOrEqual(3);
  });
});

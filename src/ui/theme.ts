// Material 3 (react-native-paper) com esquema verde perto da cor-semente #00694B (UX §3) e tokens próprios.
// O esquema foi definido à mão (sem gerador); o contraste é conferido em theme.node.test.ts (UX-031).
import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';
import { darkColors, lightColors } from './palette';

export { contrastRatio, darkColors, lightColors } from './palette';

export type AppTheme = MD3Theme & {
  colors: MD3Theme['colors'] & {
    surfaceContainerHighest: string;
    entrada: string;
    saida: string;
    atencao: string;
    atencaoContainer: string;
  };
};

export const lightTheme: AppTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    ...lightColors,
    // Elevação tingida de verde (o padrão do Paper é lilás).
    elevation: { level0: 'transparent', level1: '#EEF6F1', level2: '#E7F2EC', level3: '#E0EEE7', level4: '#DEEDE5', level5: '#D9EAE2' },
  },
} as AppTheme;

export const darkTheme: AppTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    ...darkColors,
    elevation: { level0: 'transparent', level1: '#1E2622', level2: '#212B26', level3: '#24302A', level4: '#25322B', level5: '#27352E' },
  },
} as AppTheme;


import { manualFormSnapshot } from './manualForm';

describe('T-17: alteração a descartar (UX 0.15, revisão do ciclo 2)', () => {
  const novo = manualFormSnapshot('saida', '', '', '19/11/2026', null);
  test('campo vazio e "R$ 0,00" contam como sem alteração', () => {
    expect(manualFormSnapshot('saida', 'R$ 0,00', '', '19/11/2026', null)).toBe(novo);
  });
  test('valor, tipo, descrição, data ou categoria diferentes contam como alteração', () => {
    expect(manualFormSnapshot('saida', 'R$ 0,01', '', '19/11/2026', null)).not.toBe(novo);
    expect(manualFormSnapshot('entrada', '', '', '19/11/2026', null)).not.toBe(novo);
    expect(manualFormSnapshot('saida', '', 'x', '19/11/2026', null)).not.toBe(novo);
    expect(manualFormSnapshot('saida', '', '', '18/11/2026', null)).not.toBe(novo);
    expect(manualFormSnapshot('saida', '', '', '19/11/2026', 'mercado')).not.toBe(novo);
  });
});

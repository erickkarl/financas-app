// REV-39: diálogos com campo de texto sobem com o teclado (Paper Dialog não faz isso sozinho).
import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return h;
}

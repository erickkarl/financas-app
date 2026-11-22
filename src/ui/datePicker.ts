// UX 0.22 (UX-119): seletor de data do sistema (Android), com @react-native-community/datetimepicker 9.2.1 (MIT), aprovado.
// Abre na data do campo, ou em hoje; "OK" devolve AAAA-MM-DD; "Cancelar" devolve null.
import { Platform } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { spDateKey } from '../domain/format';

function open(initial: string | null): Promise<string | null> {
  const start = initial ? new Date(`${initial}T15:00:00Z`) : new Date();
  return new Promise((resolve) => {
    DateTimePickerAndroid.open({
      value: start,
      mode: 'date',
      // C4 (revisão 2): a biblioteca marca "onChange" como obsoleto; "OK" chama onValueChange e "Cancelar", onDismiss.
      onValueChange: (_event, date) => resolve(date ? spDateKey(date) : null),
      onDismiss: () => resolve(null),
    });
  });
}

export const openSystemDatePicker: null | ((initial: string | null) => Promise<string | null>) = Platform.OS === 'android' ? open : null;

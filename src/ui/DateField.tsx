// UX 0.22 (T-14 "Período" e T-17): campo de data com digitação (dd/mm/aaaa, barras sozinhas) e, quando disponível,
// o botão de calendário que abre o seletor de data do sistema. Erro logo abaixo do campo, ao sair dele e ao aplicar.
import React from 'react';
import { View } from 'react-native';
import { TextInput } from 'react-native-paper';
import { maskDateInput } from '../domain/format';
import { FieldError } from './components';
import { openSystemDatePicker } from './datePicker';

export function DateField({ label, value, onChange, error, onBlur, calendarLabel, inRow = false }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  onBlur?: () => void;
  /** Nome do botão de calendário para o leitor de tela ("Abrir o calendário da data inicial"). */
  calendarLabel: string;
  /** Lado a lado com outro campo (folha "Período"): divide a largura. Na coluna, não cresce (C4-07). */
  inRow?: boolean;
}) {
  const toKey = (v: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  const pick = async () => {
    const chosen = await openSystemDatePicker!(toKey(value));
    if (chosen) { onChange(chosen.split('-').reverse().join('/')); onBlur?.(); }
  };
  return (
    <View style={inRow ? { gap: 4, flex: 1, minWidth: 0 } : { gap: 4 }}>
      <TextInput
        mode="outlined"
        label={label}
        value={value}
        onChangeText={(v) => onChange(maskDateInput(v))}
        onBlur={onBlur}
        placeholder="dd/mm/aaaa"
        keyboardType="number-pad"
        maxLength={10}
        accessibilityLabel={`${label}, dd/mm/aaaa`}
        error={!!error}
        right={openSystemDatePicker ? <TextInput.Icon icon="calendar-month-outline" onPress={pick} accessibilityLabel={calendarLabel} forceTextInputFocus={false} /> : undefined}
      />
      <FieldError text={error} />
    </View>
  );
}

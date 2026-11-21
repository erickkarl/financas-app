// T-17 Lançamento manual (criar e editar) — RF-007.1 (UX §T-17). Entra na conta única "Dinheiro"; não pede conta.
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation, usePreventRemove } from 'expo-router';
import { HelperText, List, Modal, Portal, SegmentedButtons, Text, TextInput, Dialog } from 'react-native-paper';
import { Button, DialogActions, AppDialog, ListItem } from '../ui/touch';
import { useApp } from '../state/AppContext';
import { setFlash } from '../state/flash';
import { CATEGORIES, categoryById, NO_CATEGORY } from '../domain/categories';
import { formatDate, maskDateInput, maskMoneyInput, parseDateBR, parseMoneyInput } from '../domain/format';
import { announce, Banner, Screen, useAppTheme } from '../ui/components';
import { manualFormSnapshot } from '../domain/manualForm';

const snapshot = manualFormSnapshot;

export default function Lancamento() {
  const theme = useAppTheme();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { repo, bump } = useApp();
  const editing = Boolean(id);
  const [kind, setKind] = useState<'saida' | 'entrada'>('saida');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(formatDate(new Date()));
  const [category, setCategory] = useState<string | null>(null);
  const [valueError, setValueError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [picker, setPicker] = useState(false);
  const [discardAsk, setDiscardAsk] = useState(false);
  // Base da comparação já no primeiro render: preenchida depois, num efeito, o formulário intocado pedia "Descartar".
  const initial = useRef<string>(snapshot('saida', '', '', formatDate(new Date()), null));
  const valueRef = useRef<{ focus: () => void } | null>(null);
  // Saída liberada (salvou ou escolheu descartar): navega depois do render que desliga a confirmação.
  const [leaving, setLeaving] = useState<null | (() => void)>(null);

  useEffect(() => {
    navigation.setOptions({ title: editing ? 'Editar lançamento' : 'Novo lançamento' });
    (async () => {
      if (id) {
        const t = await repo.getTransaction(id);
        if (t?.manual) {
          setKind(t.amount < 0 ? 'saida' : 'entrada');
          setValue(maskMoneyInput(String(Math.round(Math.abs(t.amount) * 100))));
          setDescription(t.description === 'Lançamento manual' ? '' : t.description);
          setDate(formatDate(new Date(`${t.date_key}T15:00:00Z`)));
          setCategory(t.category);
          initial.current = snapshot(t.amount < 0 ? 'saida' : 'entrada', maskMoneyInput(String(Math.round(Math.abs(t.amount) * 100))), t.description === 'Lançamento manual' ? '' : t.description, formatDate(new Date(`${t.date_key}T15:00:00Z`)), t.category);
          return;
        }
      }
      initial.current = snapshot('saida', '', '', formatDate(new Date()), null);
    })();
  }, [id, editing, navigation, repo]);

  const dirty = () => snapshot(kind, value, description, date, category) !== initial.current;

  // "Descartar as alterações?" ao sair com alterações não salvas (voltar da barra, gesto ou botão do sistema).
  const [pendingAction, setPendingAction] = useState<null | (() => void)>(null);
  usePreventRemove(dirty() && !leaving, ({ data }) => {
    setPendingAction(() => () => navigation.dispatch(data.action));
    setDiscardAsk(true);
  });
  useEffect(() => { if (leaving) leaving(); }, [leaving]);

  async function salvar() {
    const amount = parseMoneyInput(value);
    if (amount <= 0) {
      setValueError('Informe um valor maior que zero.');
      announce('Informe um valor maior que zero.');
      valueRef.current?.focus();
      return;
    }
    setValueError(null);
    const dateKey = parseDateBR(date);
    if (!dateKey) {
      setDateError('Data inválida. Use dd/mm/aaaa.');
      return;
    }
    setDateError(null);
    setSaving(true);
    setSaveError(false);
    try {
      const m = { amount: kind === 'saida' ? -amount : amount, description, dateKey, category };
      if (id) await repo.updateManual(id, m, new Date().toISOString());
      else await repo.addManual(m, new Date().toISOString());
      bump();
      // T-17 novo volta ao Extrato com "Lançamento salvo". UX 0.18: a edição volta ao detalhe com "Alterações salvas";
      // se nada mudou, volta sem aviso.
      if (!id) setFlash('extrato', 'Lançamento salvo');
      else if (dirty()) setFlash('transacao', 'Alterações salvas');
      setLeaving(() => () => router.back());
    } catch {
      setSaving(false);
      setSaveError(true);
      announce('Não foi possível salvar. Tente de novo.');
    }
  }

  const cat = categoryById(category);
  return (
    <>
      <Screen style={{ gap: 12, paddingTop: 16 }}>
        {saveError && <Banner tone="error" icon="alert-circle-outline" text="Não foi possível salvar. Tente de novo." />}
        <Text variant="labelLarge">Tipo</Text>
        {/* A área de toque do Paper é o miolo do botão (padding 9 + rótulo): a altura de linha 30 leva o miolo a 48 dp. */}
        <SegmentedButtons
          value={kind}
          onValueChange={(v) => setKind(v as 'saida' | 'entrada')}
          buttons={[
            { value: 'saida', label: 'Saída', icon: 'arrow-up', style: { minHeight: 48 }, labelStyle: { lineHeight: 30 } },
            { value: 'entrada', label: 'Entrada', icon: 'arrow-down', style: { minHeight: 48 }, labelStyle: { lineHeight: 30 } },
          ]}
        />
        <View>
          <TextInput
            ref={valueRef as never}
            mode="outlined"
            label="Valor"
            accessibilityLabel="Valor"
            value={value}
            placeholder={maskMoneyInput('')}
            keyboardType="number-pad"
            autoFocus={!editing}
            onChangeText={(t) => setValue(maskMoneyInput(t))}
            error={Boolean(valueError)}
          />
          {valueError && <HelperText type="error" visible accessibilityLiveRegion="polite">{valueError}</HelperText>}
        </View>
        <View>
          <TextInput mode="outlined" label="Descrição (opcional)" accessibilityLabel="Descrição (opcional)" value={description} onChangeText={setDescription} maxLength={80} />
          <HelperText type="info">Vazia, vira "Lançamento manual".</HelperText>
        </View>
        <View>
          <TextInput mode="outlined" label="Data" accessibilityLabel="Data" value={date} keyboardType="number-pad" placeholder="dd/mm/aaaa" onChangeText={(t) => setDate(maskDateInput(t))} error={Boolean(dateError)} />
          {dateError && <HelperText type="error" visible>{dateError}</HelperText>}
        </View>
        <ListItem
          title="Categoria"
          description={cat.name}
          left={(p) => <List.Icon {...p} icon={cat.icon} />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={() => setPicker(true)}
          accessibilityLabel={`Categoria, ${cat.name}. Toque para mudar`}
          style={{ minHeight: 56 }}
        />
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Entra na conta "Dinheiro", somada ao Saldo em contas.</Text>
        <Button mode="contained" onPress={salvar} loading={saving} disabled={saving} contentStyle={{ minHeight: 48 }}>Salvar</Button>
      </Screen>

      <Portal>
        <Modal visible={picker} onDismiss={() => setPicker(false)} contentContainerStyle={{ marginTop: 'auto', backgroundColor: theme.colors.surface, padding: 16, borderTopLeftRadius: 28, borderTopRightRadius: 28 }}>
          <Text variant="titleLarge" accessibilityRole="header">Categoria</Text>
          <ScrollView style={{ maxHeight: 480 }}>
            {[...CATEGORIES, NO_CATEGORY].map((c) => (
              <ListItem
                key={c.id ?? 'none'}
                title={c.name}
                left={(p) => <List.Icon {...p} icon={c.icon} />}
                right={(p) => (c.id === category ? <List.Icon {...p} icon="check" /> : null)}
                onPress={() => { setCategory(c.id); setPicker(false); }}
                accessibilityState={{ selected: c.id === category }}
                style={{ minHeight: 48 }}
              />
            ))}
          </ScrollView>
        </Modal>
        <AppDialog visible={discardAsk} onDismiss={() => setDiscardAsk(false)}>
          <Dialog.Title>Descartar as alterações?</Dialog.Title>
          <DialogActions>
            <Button onPress={() => setDiscardAsk(false)}>Continuar editando</Button>
            <Button onPress={() => { setDiscardAsk(false); setLeaving(() => pendingAction ?? (() => router.back())); }}>Descartar</Button>
          </DialogActions>
        </AppDialog>
      </Portal>
    </>
  );
}

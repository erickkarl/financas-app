// T-15 Detalhe da transação + T-16 Escolher categoria — RF-006, RF-007.2, PM-7, PM-8
import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Divider, Icon, List, Modal, Portal, Snackbar, Switch, Text } from 'react-native-paper';
import { Button } from '../../ui/touch';
import { useApp } from '../../state/AppContext';
import { CATEGORIES, categoryById, NO_CATEGORY } from '../../domain/categories';
import { displayDescription, formatDate, setMaskValues, isMaskingValues } from '../../domain/format';
import type { TransactionRow } from '../../data/repo';
import { Amount, announce, EmptyState, OptionRow, Screen, Skeleton, useAppTheme, Chip, isFutureTx } from '../../ui/components';

type Undo = { message: string; undo: () => Promise<void> };

export default function TransacaoDetalhe() {
  const theme = useAppTheme();
  const { id, mascarar } = useLocalSearchParams<{ id: string; mascarar?: string }>();
  if (__DEV__ && mascarar === '1' && !isMaskingValues()) setMaskValues(true);
  const { repo, bump } = useApp();
  const [tx, setTx] = useState<TransactionRow | null | undefined>(undefined);
  const [picker, setPicker] = useState(false);
  const [snack, setSnack] = useState<Undo | { message: string; undo?: undefined } | null>(null);

  useEffect(() => {
    repo.getTransaction(id).then(setTx).catch(() => setTx(null));
  }, [repo, id]);

  if (tx === undefined) return <Screen><Skeleton lines={4} /></Screen>;
  if (tx === null) return <EmptyState icon="alert-circle-outline" title="Transação não encontrada." />;
  const current = tx;

  /** Responde na hora; se a gravação falhar, desfaz e avisa (UX §10). */
  async function optimistic(next: Partial<TransactionRow>, write: () => Promise<void>, undoWrite: () => Promise<void>, message: string) {
    const prev = current;
    setTx({ ...current, ...next });
    try {
      await write();
      bump();
      announce(message);
      setSnack({
        message,
        undo: async () => {
          setTx(prev);
          try {
            await undoWrite();
            bump();
          } catch {
            setTx({ ...prev, ...next });
            setSnack({ message: 'Não foi possível salvar a mudança.' });
          }
        },
      });
    } catch {
      setTx(prev);
      setSnack({ message: 'Não foi possível salvar a mudança.' });
      announce('Não foi possível salvar a mudança.');
    }
  }

  function chooseCategory(cat: string | null) {
    setPicker(false);
    const prevCat = current.category;
    optimistic(
      { category: cat },
      () => repo.setCategory(current.id, cat),
      () => repo.setCategory(current.id, prevCat),
      `Categoria alterada para ${categoryById(cat).name}`,
    );
  }

  function toggleHidden() {
    const hide = !current.hidden;
    optimistic(
      { hidden: hide ? 1 : 0 },
      () => repo.setHidden(current.id, hide),
      () => repo.setHidden(current.id, !hide),
      hide ? 'Transação ocultada' : 'Transação reexibida',
    );
  }

  function toggleTransfer(v: boolean) {
    const prevOverride: boolean | null = current.transfer === current.transfer_auto ? null : Boolean(current.transfer);
    optimistic(
      { transfer: v ? 1 : 0 },
      () => repo.setTransferOverride(current.id, v === Boolean(current.transfer_auto) ? null : v),
      () => repo.setTransferOverride(current.id, prevOverride),
      v ? 'Marcada como transferência entre suas contas' : 'Desmarcada como transferência',
    );
  }

  const cat = categoryById(tx.category);
  return (
    <>
      <Screen style={{ paddingTop: 16, gap: 8 }}>
        <Amount value={tx.amount} variant="headlineSmall" neutral={isFutureTx(tx.date_key)} />
        {isFutureTx(tx.date_key) && <View style={{ alignSelf: 'flex-start' }}><Chip label="Futura" icon="calendar-clock" /></View>}
        <Text variant="titleMedium">{displayDescription(tx.description)}</Text>
        {isFutureTx(tx.date_key) ? (
          <>
            {/* UX 0.9 (Q18 a): no cartão, a data é o dia em que a parcela entra na fatura, não o vencimento. */}
            <Text variant="bodyMedium">{`${tx.account_type === 'CREDIT' ? 'Entra na fatura em' : 'Prevista para'} ${formatDate(new Date(`${tx.date_key}T15:00:00Z`))}`}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Esta transação ainda não aconteceu. Ela entra nas somas e no Resumo quando a data chegar.</Text>
          </>
        ) : (
          <Text variant="bodyMedium">{formatDate(new Date(`${tx.date_key}T15:00:00Z`))}</Text>
        )}
        <Text variant="bodyMedium">{tx.connection_name ? `${tx.account_name} · ${tx.connection_name}` : tx.account_name}</Text>
        <Divider style={{ marginVertical: 8 }} />
        <List.Item
          title="Categoria"
          description={cat.name}
          left={(p) => <List.Icon {...p} icon={cat.icon} />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={() => setPicker(true)}
          accessibilityLabel={`Categoria, ${cat.name}. Toque para mudar`}
          style={{ minHeight: 56 }}
        />
        <List.Item title="Origem" description={tx.manual ? 'Manual' : `Importada de ${tx.connection_name ?? 'Meu Pluggy'}`} style={{ minHeight: 56 }} />
        <OptionRow
          kind="switch"
          label="Transferência entre minhas contas"
          description={`Não conta como receita nem despesa.${tx.transfer_auto === 1 && tx.transfer === 1 ? ' Reconhecida automaticamente' : ''}`}
          checked={tx.transfer === 1}
          onPress={() => toggleTransfer(tx.transfer !== 1)}
        />
        <Divider style={{ marginVertical: 8 }} />
        {!tx.manual && (
          <>
            <Button mode="outlined" icon={tx.hidden ? 'eye' : 'eye-off'} onPress={toggleHidden} contentStyle={{ minHeight: 48 }}>
              {tx.hidden ? 'Reexibir transação' : 'Ocultar transação'}
            </Button>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Icon source="information-outline" size={16} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.onSurfaceVariant }}>Ocultas não entram no Resumo nem nas somas do Extrato. O saldo da conta não muda.</Text>
            </View>
          </>
        )}
      </Screen>

      <Portal>
        <Modal visible={picker} onDismiss={() => setPicker(false)} contentContainerStyle={{ backgroundColor: theme.colors.surface, marginTop: 'auto', padding: 16, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '80%', maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <Text variant="titleLarge" accessibilityRole="header" style={{ marginBottom: 8 }}>Escolher categoria</Text>
          <ScrollView>
            {[...CATEGORIES.map((c) => ({ id: c.id as string, name: c.name, icon: c.icon })), { id: 'none', name: NO_CATEGORY.name, icon: NO_CATEGORY.icon }].map((c) => {
              const selected = (tx.category ?? 'none') === c.id;
              return (
                <List.Item
                  key={c.id}
                  title={c.name}
                  titleNumberOfLines={2}
                  left={(p) => <List.Icon {...p} icon={c.icon} />}
                  right={(p) => (selected ? <List.Icon {...p} icon="check" color={theme.colors.primary} /> : null)}
                  onPress={() => chooseCategory(c.id === 'none' ? null : c.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={{ minHeight: 48 }}
                />
              );
            })}
          </ScrollView>
        </Modal>
      </Portal>
      <Snackbar
        visible={!!snack}
        onDismiss={() => setSnack(null)}
        duration={5000}
        action={snack?.undo ? { label: 'Desfazer', onPress: () => snack.undo?.() } : undefined}
      >
        {snack?.message}
      </Snackbar>
    </>
  );
}

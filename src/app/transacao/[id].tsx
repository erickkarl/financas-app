// T-15 Detalhe da transação + T-16 Escolher categoria — RF-006, RF-007.2, PM-7, PM-8
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Dialog, Divider, Icon, List, Modal, Portal, Snackbar, Switch, Text } from 'react-native-paper';
import { setFlash, takeFlash } from '../../state/flash';
import { Button, DialogActions, AppDialog, ListAccordion, ListItem } from '../../ui/touch';
import { useApp } from '../../state/AppContext';
import { CATEGORIES, categoryById, NO_CATEGORY } from '../../domain/categories';
import { accountConnectionLine, displayDescription, formatCount, formatDate, formatMonth, setMaskValues, isMaskingValues } from '../../domain/format';
import type { CategoryChange, TransactionRow } from '../../data/repo';
import { Amount, announce, Banner, EmptyState, OptionRow, Screen, Skeleton, useAppTheme, Chip, isFutureTx } from '../../ui/components';

type Undo = { message: string; undo: () => Promise<void> };

export default function TransacaoDetalhe() {
  const theme = useAppTheme();
  const { id, mascarar, dialogo } = useLocalSearchParams<{ id: string; mascarar?: string; dialogo?: string }>();
  if (__DEV__ && mascarar === '1' && !isMaskingValues()) setMaskValues(true);
  const { repo, bump } = useApp();
  const [tx, setTx] = useState<TransactionRow | null | undefined>(undefined);
  const [picker, setPicker] = useState(false);
  const [snack, setSnack] = useState<Undo | { message: string; undo?: undefined } | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  // UX 0.17 (RF-006.3, E-12 a): aviso dos lançamentos anteriores do mesmo destinatário, até ser usado ou fechado.
  const [previous, setPrevious] = useState<null | { n: number; change: CategoryChange; category: string }>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  // Evidência (só em desenvolvimento): ?dialogo=mudar abre "Mudar N lançamentos anteriores…" com 3 de exemplo.
  // A captura fecha com Voltar, sem tocar em nenhuma ação.
  useEffect(() => {
    if (!__DEV__ || dialogo !== 'mudar') return;
    setPrevious({ n: 3, change: { remembered: true, others: 3 } as never, category: 'mercado' });
    setConfirmApply(true);
  }, [dialogo]);
  const [helpOpen, setHelpOpen] = useState(false);
  // Recarrega ao voltar de T-17 (edição de lançamento manual).
  useFocusEffect(useCallback(() => {
    repo.getTransaction(id).then(setTx).catch(() => setTx(null));
    // UX 0.18: "Alterações salvas" ao voltar da edição de um lançamento manual.
    const m = takeFlash('transacao');
    if (m) { setSnack({ message: m }); announce(m); }
  }, [repo, id]));

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

  /**
   * T-16 (UX 0.17, RF-006.3): em PIX ou boleto com documento, o app lembra a categoria para o destinatário e o aviso
   * diz isso; "Desfazer" desfaz a troca e a lembrança. Havendo anteriores em outra categoria, aparece o aviso em T-15.
   */
  async function chooseCategory(cat: string | null) {
    setPicker(false);
    const prev = current;
    setTx({ ...current, category: cat, remembered: 0 });
    setPrevious(null);
    try {
      const change = await repo.changeCategory(current.id, cat);
      bump();
      const name = categoryById(cat).name;
      const message = change.remembered
        ? `Categoria alterada para ${name}. O app vai sugerir ${name} nos próximos lançamentos deste destinatário.`
        : `Categoria alterada para ${name}`;
      announce(message);
      if (change.remembered && change.others > 0 && cat) setPrevious({ n: change.others, change, category: cat });
      setSnack({
        message,
        undo: async () => {
          setTx(prev);
          setPrevious(null);
          try {
            await repo.undoCategoryChange(current.id, change);
            bump();
          } catch {
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

  async function applyPrevious() {
    if (!previous?.change.key) return;
    const { change, category } = previous;
    setConfirmApply(false);
    setPrevious(null);
    try {
      const list = await repo.applyToOthers(current.id, change.key!, category);
      bump();
      const message = `${formatCount(list.length)} ${list.length === 1 ? 'lançamento mudou' : 'lançamentos mudaram'} para ${categoryById(category).name}`;
      announce(message);
      setSnack({
        message,
        undo: async () => {
          try {
            await repo.undoApplyToOthers(list);
            bump();
          } catch {
            setSnack({ message: 'Não foi possível salvar a mudança.' });
          }
        },
      });
    } catch {
      setSnack({ message: 'Não foi possível salvar a mudança.' });
    }
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

  // RF-008.8 (UX 0.14): marca "Fora do Resumo", com aviso e "Desfazer".
  function toggleOut(v: boolean) {
    optimistic(
      { out_of_summary: v ? 1 : 0 },
      () => repo.setOutOfSummary(current.id, v),
      () => repo.setOutOfSummary(current.id, !v),
      v ? 'Marcada como fora do Resumo' : 'Voltou a contar no Resumo',
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
        <Amount value={tx.amount} variant="headlineSmall" neutral={isFutureTx(tx.date_key) || Boolean(tx.refund)} />
        {isFutureTx(tx.date_key) && <View style={{ alignSelf: 'flex-start' }}><Chip label="Futura" icon="calendar-clock" /></View>}
        {/* UX 0.17 (RF-008.10): estorno de compra no cartão; não há chave para marcar ou desmarcar (N-9). */}
        {Boolean(tx.refund) && (
          <>
            <View style={{ alignSelf: 'flex-start' }}><Chip label="Estorno" icon="cash-refund" /></View>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {`Estorno de compra no cartão. Reduz as despesas de ${cat.name} em ${formatMonth(Number(tx.date_key.slice(0, 4)), Number(tx.date_key.slice(5, 7)))}, em vez de contar como receita.`}
            </Text>
          </>
        )}
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
        <Text variant="bodyMedium">{accountConnectionLine(tx.account_name, tx.account_subtype, tx.connection_name)}</Text>
        <Divider style={{ marginVertical: 8 }} />
        <ListItem
          title="Categoria"
          // UX 0.17 (RF-006.3): categoria que veio da lembrança do destinatário.
          description={tx.remembered ? `${cat.name}\nLembrada para este destinatário.` : cat.name}
          left={(p) => <List.Icon {...p} icon={cat.icon} />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={() => setPicker(true)}
          accessibilityLabel={`Categoria, ${cat.name}.${tx.remembered ? ' Lembrada para este destinatário.' : ''} Toque para mudar`}
          style={{ minHeight: 56 }}
        />
        {previous && (
          <Banner
            tone="info"
            icon="history"
            text={`${formatCount(previous.n)} ${previous.n === 1 ? 'lançamento anterior deste destinatário está' : 'lançamentos anteriores deste destinatário estão'} em outra categoria.`}
            actionLabel="Aplicar a eles"
            onAction={() => setConfirmApply(true)}
            secondaryLabel="Fechar"
            onSecondary={() => setPrevious(null)}
          />
        )}
        <ListItem title="Origem" description={tx.manual ? 'Manual' : `Importada de ${tx.connection_name ?? 'Meu Pluggy'}`} style={{ minHeight: 56 }} />
        <OptionRow
          kind="switch"
          label="Transferência entre minhas contas"
          description={`Não conta como receita nem despesa.${tx.transfer_auto === 1 && tx.transfer === 1 ? ' Reconhecida automaticamente' : ''}`}
          checked={tx.transfer === 1}
          onPress={() => toggleTransfer(tx.transfer !== 1)}
        />
        <OptionRow
          kind="switch"
          label="Fora do Resumo"
          description={tx.transfer === 1 ? 'Transferências entre suas contas já ficam fora do Resumo.' : 'Não conta como receita nem despesa no Resumo. Continua no Extrato, e o saldo da conta não muda.'}
          checked={tx.out_of_summary === 1}
          disabled={tx.transfer === 1}
          onPress={() => toggleOut(tx.out_of_summary !== 1)}
        />
        <ListAccordion title="Quando usar" expanded={helpOpen} onPress={() => setHelpOpen(!helpOpen)} style={{ minHeight: 48 }}>
          <Text variant="bodyMedium" style={{ paddingHorizontal: 16, paddingBottom: 8 }}>Use para o que passa pela sua conta mas não é gasto nem ganho seu, como um imposto da sua empresa (DAS, DARF) pago pela conta pessoal.</Text>
        </ListAccordion>
        <Divider style={{ marginVertical: 8 }} />
        {tx.manual ? (
          // RF-007 (T-15): lançamento manual pode ser editado e excluído.
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button mode="outlined" icon="pencil-outline" onPress={() => router.push({ pathname: '/lancamento', params: { id: tx.id } })} contentStyle={{ minHeight: 48 }}>Editar</Button>
            <Button mode="outlined" icon="delete-outline" textColor={theme.colors.error} onPress={() => setConfirmDelete(true)} contentStyle={{ minHeight: 48 }}>Excluir</Button>
          </View>
        ) : null}
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
        <AppDialog visible={confirmApply} onDismiss={() => setConfirmApply(false)}>
          <Dialog.Title>{previous ? `Mudar ${formatCount(previous.n)} ${previous.n === 1 ? 'lançamento anterior' : 'lançamentos anteriores'} para ${categoryById(previous.category).name}?` : ''}</Dialog.Title>
          <Dialog.Content><Text variant="bodyMedium">Os que você já categorizou à mão não mudam.</Text></Dialog.Content>
          <DialogActions>
            <Button onPress={() => setConfirmApply(false)}>Cancelar</Button>
            <Button onPress={applyPrevious}>Mudar</Button>
          </DialogActions>
        </AppDialog>
        <AppDialog visible={confirmDelete} onDismiss={() => setConfirmDelete(false)}>
          <Dialog.Title>Excluir este lançamento?</Dialog.Title>
          <Dialog.Content><Text variant="bodyMedium">Esta ação não pode ser desfeita.</Text></Dialog.Content>
          <DialogActions>
            <Button onPress={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button textColor={theme.colors.error} onPress={async () => {
              await repo.deleteManual(current.id);
              setConfirmDelete(false);
              bump();
              setFlash('extrato', 'Lançamento excluído');
              router.back();
            }}>Excluir</Button>
          </DialogActions>
        </AppDialog>
        <Modal visible={picker} onDismiss={() => setPicker(false)} contentContainerStyle={{ backgroundColor: theme.colors.surface, marginTop: 'auto', padding: 16, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '80%', maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <Text variant="titleLarge" accessibilityRole="header" style={{ marginBottom: 8 }}>Escolher categoria</Text>
          <ScrollView>
            {[...CATEGORIES.map((c) => ({ id: c.id as string, name: c.name, icon: c.icon })), { id: 'none', name: NO_CATEGORY.name, icon: NO_CATEGORY.icon }].map((c) => {
              const selected = (tx.category ?? 'none') === c.id;
              return (
                <ListItem
                  key={c.id}
                  title={c.name}
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

// T-22 Categorias lembradas — RF-006.3 (UX 0.17 aprovada, E-14 b; requisitos v1.23, seção 11.17), RNF-007.
// A lembrança guarda só documento, categoria, contagem e data do último lançamento. A descrição, a data e o valor
// mostrados vêm do último lançamento que ainda está no aparelho; sem ele, "Sem lançamento no aparelho" e nenhum nome.
import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Dialog, Divider, Icon, Portal, Snackbar, Text } from 'react-native-paper';
import { useApp } from '../state/AppContext';
import { openExtrato } from '../state/nav';
import { categoryById } from '../domain/categories';
import { displayDescription, formatCount, formatDate, formatSignedAmount, isMaskingValues, setMaskValues } from '../domain/format';
import { maskDoc, type RecipientKey } from '../domain/recipient';
import type { RememberedListRow, RememberedRow } from '../data/repo';
import { announce, EmptyState, Screen, Skeleton, useAppTheme } from '../ui/components';
import { Button, IconButton, DialogActions, AppDialog } from '../ui/touch';

export default function CategoriasLembradas() {
  const theme = useAppTheme();
  const { mascarar, preview } = useLocalSearchParams<{ mascarar?: string; preview?: string }>();
  if (__DEV__ && mascarar === '1' && !isMaskingValues()) setMaskValues(true);
  const { repo, bump, dataVersion } = useApp();
  const [rows, setRows] = useState<RememberedListRow[] | null>(null);
  const [error, setError] = useState(false);
  const [snack, setSnack] = useState<{ message: string; undo?: () => Promise<void> } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const list = await repo.listRemembered();
      // Captura de evidência (só em desenvolvimento): ?preview=sem-lancamento mostra a linha como depois de revogar,
      // sem revogar a conexão real.
      // ?preview=exemplo mostra uma lembrança de exemplo (dados inventados, nada gravado) para capturar "Esquecer
      // todas" sem trocar a categoria de uma transação real. Só a captura usa; nenhuma ação é tocada.
      const example: RememberedListRow = { doc_type: 'CPF', doc: '00000000000', category: 'mercado', tx_count: 1, last_tx_date: '2026-11-21', created_at: '2026-11-21T12:00:00Z', used_at: '2026-11-21T12:00:00Z', last_tx_id: null, last: { description: 'PIX ENVIADO EXEMPLO', date_key: '2026-11-21', amount: -10 } };
      setRows(__DEV__ && preview === 'sem-lancamento' ? list.map((r) => ({ ...r, last: null, last_tx_id: null })) : __DEV__ && preview === 'exemplo' ? [...list, example] : list);
    } catch {
      setError(true);
    }
  }, [repo, preview]);
  useFocusEffect(useCallback(() => { load(); }, [load, dataVersion]));

  async function forget(r: RememberedListRow) {
    const key: RecipientKey = { type: r.doc_type as RecipientKey['type'], doc: r.doc };
    const saved = await repo.forgetRemembered(key);
    bump();
    await load();
    const message = 'Categoria esquecida para este destinatário.';
    announce(message);
    setSnack({
      message,
      undo: saved ? async () => { await repo.restoreRemembered(saved as RememberedRow); bump(); await load(); } : undefined,
    });
  }

  async function forgetAll() {
    setConfirmAll(false);
    await repo.forgetAllRemembered();
    bump();
    await load();
    announce('Categorias esquecidas.');
    setSnack({ message: 'Categorias esquecidas.' });
  }

  let body: React.ReactNode;
  if (error) body = <EmptyState icon="alert-circle-outline" title="Não foi possível carregar as categorias lembradas." actionLabel="Tentar de novo" onAction={load} />;
  else if (rows === null) body = <Skeleton lines={3} />;
  else if (rows.length === 0) {
    body = (
      <EmptyState
        icon="tag-heart-outline"
        title="O app ainda não lembra nenhuma categoria."
        text="Quando você mudar a categoria de um PIX ou de um boleto, o app passa a sugerir a mesma categoria para aquele destinatário."
      />
    );
  } else {
    body = (
      <>
        <Text variant="bodyMedium">
          {`O app lembra a categoria que você escolheu para ${formatCount(rows.length)} ${rows.length === 1 ? 'destinatário' : 'destinatários'} de PIX e boleto e a sugere nos próximos lançamentos. Fica só neste aparelho.`}
        </Text>
        {rows.map((r) => {
          const cat = categoryById(r.category);
          // Captura de evidência com dados reais (só em desenvolvimento, ?mascarar=1): os dígitos à mostra viram "#".
          const masked = isMaskingValues() ? maskDoc(r.doc_type, r.doc).replace(/\d/g, '#') : maskDoc(r.doc_type, r.doc);
          const desc = r.last ? displayDescription(r.last.description) : null;
          return (
            <View key={`${r.doc_type}:${r.doc}`}>
              <Divider />
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, gap: 8 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="titleSmall">{masked}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon source={cat.icon} size={18} color={theme.colors.onSurfaceVariant} />
                    <Text variant="bodyMedium">{cat.name}</Text>
                  </View>
                  {r.last ? (
                    <>
                      <Text variant="bodyMedium" numberOfLines={2}>{desc}</Text>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {`Último lançamento: ${formatDate(new Date(`${r.last.date_key}T15:00:00Z`))}, ${formatSignedAmount(r.last.amount)}`}
                      </Text>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{`${formatCount(r.tx_count)} ${r.tx_count === 1 ? 'lançamento' : 'lançamentos'}`}</Text>
                      <Button compact style={{ alignSelf: 'flex-start' }} onPress={() => openExtrato({ recipient: { type: r.doc_type as RecipientKey['type'], doc: r.doc } })}>Ver lançamentos</Button>
                    </>
                  ) : (
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>Sem lançamento no aparelho</Text>
                  )}
                </View>
                <IconButton
                  icon="delete-outline"
                  accessibilityLabel={`Esquecer a categoria de ${desc ?? masked}`}
                  onPress={() => forget(r)}
                />
              </View>
            </View>
          );
        })}
        <Divider />
        <Button textColor={theme.colors.error} style={{ alignSelf: 'flex-start', marginTop: 8 }} onPress={() => setConfirmAll(true)}>Esquecer todas</Button>
      </>
    );
  }

  return (
    <>
      <Screen style={{ paddingTop: 16, gap: 8 }}>{body}</Screen>
      <Portal>
        <AppDialog visible={confirmAll} onDismiss={() => setConfirmAll(false)}>
          <Dialog.Title>{(rows?.length ?? 0) === 1 ? 'Esquecer a categoria lembrada?' : `Esquecer as ${formatCount(rows?.length ?? 0)} categorias lembradas?`}</Dialog.Title>
          <Dialog.Content><Text variant="bodyMedium">{`Os lançamentos já categorizados continuam como estão. O app deixa de sugerir ${(rows?.length ?? 0) === 1 ? 'essa categoria' : 'essas categorias'}.`}</Text></Dialog.Content>
          <DialogActions>
            {/* Foco inicial em "Cancelar": vem primeiro na ordem de leitura. */}
            <Button onPress={() => setConfirmAll(false)}>Cancelar</Button>
            <Button textColor={theme.colors.error} onPress={forgetAll}>Esquecer todas</Button>
          </DialogActions>
        </AppDialog>
      </Portal>
      <Snackbar visible={!!snack} onDismiss={() => setSnack(null)} duration={5000} action={snack?.undo ? { label: 'Desfazer', onPress: () => snack.undo?.() } : undefined}>
        {snack?.message}
      </Snackbar>
    </>
  );
}

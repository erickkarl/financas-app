// T-13 Extrato + T-14 Filtros — RF-005, RF-006.1, RF-007.2
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Chip, Divider, List, Modal, Portal, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { Button } from '../../ui/touch';
import { useApp } from '../../state/AppContext';
import { useStartConnect } from '../../state/hooks';
import { CATEGORIES, NO_CATEGORY } from '../../domain/categories';
import { formatCount, maskDateInput, parseDateBR, formatDayHeader, formatMonth, formatSignedAmount, spDateKey } from '../../domain/format';
import { announce, Banner, EmptyState, FieldError, OptionRow, SearchField, Skeleton, TransactionItem, styles as ui, useAppTheme } from '../../ui/components';
import type { AccountRow, TransactionRow, TxFilter } from '../../data/repo';

const PAGE = 50;

type Period = { kind: 'none' } | { kind: 'this' | 'last' | '7' | '30' } | { kind: 'custom'; from: string; to: string };

function periodRange(p: Period, now = new Date()): { from?: string; to?: string; label?: string } {
  const today = spDateKey(now);
  const [y, m] = today.split('-').map(Number);
  const back = (days: number) => spDateKey(new Date(now.getTime() - days * 86400000));
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  switch (p.kind) {
    case 'this':
      return { from: `${y}-${pad(m)}-01`, to: today, label: formatMonth(y, m) };
    case 'last': {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(lastDay(ly, lm))}`, label: formatMonth(ly, lm) };
    }
    case '7':
      return { from: back(6), to: today, label: 'Últimos 7 dias' };
    case '30':
      return { from: back(29), to: today, label: 'Últimos 30 dias' };
    case 'custom': {
      const f = (k: string) => k.split('-').reverse().join('/');
      return { from: p.from, to: p.to, label: `${f(p.from)} a ${f(p.to)}` };
    }
    default:
      return {};
  }
}


export default function Extrato() {
  const theme = useAppTheme();
  const params = useLocalSearchParams<{ account?: string; from?: string; to?: string; category?: string }>();
  const { repo, dataVersion, online, credStatus } = useApp();
  const startConnect = useStartConnect();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [period, setPeriod] = useState<Period>({ kind: 'none' });
  const [categories, setCategories] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [sheet, setSheet] = useState<null | 'conta' | 'periodo' | 'categoria'>(null);

  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [sums, setSums] = useState<{ count: number; entradas: number; saidas: number; excluded: number } | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [accounts, setAccounts] = useState<(AccountRow & { institution_name: string | null; connection_name: string })[]>([]);
  const loadingMore = useRef(false);

  // Filtros vindos de Início (conta) ou do Resumo (mês e categoria)
  useEffect(() => {
    if (params.account) setAccountIds([params.account]);
    if (params.from && params.to) setPeriod({ kind: 'custom', from: params.from, to: params.to });
    if (params.category) setCategories([params.category]);
  }, [params.account, params.from, params.to, params.category]);

  // Busca começa 300 ms depois da última tecla.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const range = periodRange(period);
  const filter: TxFilter = useMemo(
    () => ({ accountIds, from: range.from, to: range.to, categories, search: debounced, showHidden }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountIds, range.from, range.to, categories, debounced, showHidden],
  );
  // RF-005.3: futuras (data depois de hoje) num grupo próprio, fora das somas e da lista principal.
  const today = spDateKey(new Date());
  const [futures, setFutures] = useState<TransactionRow[]>([]);
  const [futuresOpen, setFuturesOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [first, s, all, accs, fut] = await Promise.all([
        repo.listTransactions({ ...filter, future: 'exclude', today }, PAGE, 0),
        repo.sums({ ...filter, today }),
        repo.countAllTransactions(),
        repo.listAccounts(),
        repo.listTransactions({ ...filter, future: 'only', today }, 500, 0),
      ]);
      setRows(first);
      setFutures([...fut].reverse()); // da mais próxima para a mais distante
      // Resultado só com futuras: o grupo abre sozinho.
      if (fut.length > 0 && first.length === 0) setFuturesOpen(true);
      setSums(s);
      setTotal(all);
      setAccounts(accs);
      setHasMore(first.length === PAGE);
      setError(false);
      announce(`${formatCount(s.count)} ${s.count === 1 ? 'transação' : 'transações'}`);
    } catch {
      setError(true);
    }
  }, [repo, filter, today]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  async function loadMore() {
    if (!rows || !hasMore || loadingMore.current) return;
    loadingMore.current = true;
    const next = await repo.listTransactions({ ...filter, future: 'exclude', today }, PAGE, rows.length);
    setRows([...rows, ...next]);
    setHasMore(next.length === PAGE);
    loadingMore.current = false;
  }

  const sections = useMemo(() => {
    const map = new Map<string, TransactionRow[]>();
    for (const r of rows ?? []) {
      const list = map.get(r.date_key) ?? [];
      list.push(r);
      map.set(r.date_key, list);
    }
    return [...map.entries()].map(([key, data]) => ({ title: formatDayHeader(key), data }));
  }, [rows]);

  const duplicateNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const a of accounts) seen.set(a.name, (seen.get(a.name) ?? 0) + 1);
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [accounts]);

  const anyFilter = accountIds.length > 0 || period.kind !== 'none' || categories.length > 0 || debounced.trim() !== '';
  const clearAll = () => {
    setAccountIds([]);
    setPeriod({ kind: 'none' });
    setCategories([]);
    setSearch('');
    setDebounced('');
    setShowHidden(false);
  };

  const accountLabel = accountIds.length === 1 ? accounts.find((a) => a.id === accountIds[0])?.name ?? 'Conta' : accountIds.length > 1 ? `${accountIds.length} contas` : null;
  const categoryLabel = categories.length === 1
    ? categories[0] === 'none' ? NO_CATEGORY.name : CATEGORIES.find((c) => c.id === categories[0])?.name ?? 'Categoria'
    : categories.length > 1 ? `${categories.length} categorias` : null;

  const header = (
    <View style={s.header}>
      {!online && <Banner icon="wifi-off" text="Sem internet. Mostrando os dados salvos." />}
      {credStatus === 'rejected' && <Banner tone="error" text="Suas credenciais do Pluggy não funcionam mais." actionLabel="Corrigir" onAction={() => router.push('/credenciais')} />}
      <SearchField placeholder="Buscar por descrição" value={search} onChangeText={setSearch} />
      <View style={s.chips}>
        <TouchableRipple onPress={() => setSheet('conta')} accessibilityRole="button" accessibilityLabel={`Filtro ${accountLabel ?? 'Conta'}`} style={s.chipHit}><Chip importantForAccessibility="no" accessible={false} pointerEvents="box-none" mode="outlined" selected={!!accountLabel} onClose={accountLabel ? () => setAccountIds([]) : undefined} closeIconAccessibilityLabel="Limpar filtro de conta" style={s.chip}>{accountLabel ?? 'Conta'}</Chip></TouchableRipple>
        <TouchableRipple onPress={() => setSheet('periodo')} accessibilityRole="button" accessibilityLabel={`Filtro ${range.label ?? 'Período'}`} style={s.chipHit}><Chip importantForAccessibility="no" accessible={false} pointerEvents="box-none" mode="outlined" selected={period.kind !== 'none'} onClose={period.kind !== 'none' ? () => setPeriod({ kind: 'none' }) : undefined} closeIconAccessibilityLabel="Limpar filtro de período" style={s.chip}>{range.label ?? 'Período'}</Chip></TouchableRipple>
        <TouchableRipple onPress={() => setSheet('categoria')} accessibilityRole="button" accessibilityLabel={`Filtro ${categoryLabel ?? 'Categoria'}`} style={s.chipHit}><Chip importantForAccessibility="no" accessible={false} pointerEvents="box-none" mode="outlined" selected={!!categoryLabel} onClose={categoryLabel ? () => setCategories([]) : undefined} closeIconAccessibilityLabel="Limpar filtro de categoria" style={s.chip}>{categoryLabel ?? 'Categoria'}</Chip></TouchableRipple>
        {anyFilter && <Button compact onPress={clearAll}>Limpar filtros</Button>}
      </View>
      {sums && (
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} accessibilityLiveRegion="polite">
          {`${formatCount(sums.count)} ${sums.count === 1 ? 'transação' : 'transações'} · Entradas ${formatSignedAmount(sums.entradas)} · Saídas ${formatSignedAmount(sums.saidas)}`}
          {sums.excluded > 0 ? `\nNão inclui ${sums.excluded} ${futures.length ? 'ocultas, transferências, investimentos ou futuras' : 'ocultas, transferências ou investimentos'}.` : ''}
        </Text>
      )}
      {futures.length > 0 && (
        <View>
          <View style={[ui.row, { justifyContent: 'space-between', minHeight: 48 }]}>
            <Text variant="labelLarge" accessibilityRole="header" style={{ flexShrink: 1, color: theme.colors.onSurfaceVariant }}>
              {`Futuras · ${formatCount(futures.length)} ${futures.length === 1 ? 'transação' : 'transações'} · fora das somas`}
            </Text>
            <Button onPress={() => setFuturesOpen(!futuresOpen)} accessibilityState={{ expanded: futuresOpen }}>{futuresOpen ? 'Ocultar' : 'Mostrar'}</Button>
          </View>
          {futuresOpen && futures.map((t, i) => (
            <View key={t.id}>
              {(i === 0 || futures[i - 1].date_key !== t.date_key) && (
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, paddingTop: 4 }}>{formatDayHeader(t.date_key)}</Text>
              )}
              <TransactionItem tx={t} showConnection={duplicateNames.has(t.account_name)} onPress={() => router.push(`/transacao/${t.id}`)} />
              <Divider />
            </View>
          ))}
        </View>
      )}
    </View>
  );

  let body: React.ReactNode;
  if (error) body = <EmptyState icon="alert-circle-outline" title="Não foi possível carregar o extrato." actionLabel="Tentar de novo" onAction={load} />;
  else if (rows === null) body = <Skeleton lines={6} />;
  else if (total === 0) body = <EmptyState icon="receipt" title="Ainda não há transações." text="Conecte uma instituição ou lance um valor à mão." actionLabel="Conectar instituição" onAction={startConnect} />;
  else if (rows.length === 0 && futures.length === 0) body = <EmptyState icon="magnify" title="Nenhuma transação encontrada." text="Tente mudar a busca ou os filtros." actionLabel="Limpar filtros" onAction={clearAll} />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SectionList
        sections={body ? [] : sections}
        keyExtractor={(t) => t.id}
        contentContainerStyle={s.list}
        ListHeaderComponent={<>{header}{body}</>}
        renderSectionHeader={({ section }) => (
          <Text variant="labelLarge" accessibilityRole="header" style={[s.day, { backgroundColor: theme.colors.background, color: theme.colors.onSurfaceVariant }]}>{section.title}</Text>
        )}
        renderItem={({ item }) => <TransactionItem tx={item} showConnection={duplicateNames.has(item.account_name)} onPress={() => router.push(`/transacao/${item.id}`)} />}
        ItemSeparatorComponent={Divider}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={!body && rows && !hasMore ? <Text variant="bodySmall" style={[ui.center, { padding: 16, color: theme.colors.onSurfaceVariant }]}>Fim das transações disponíveis.</Text> : undefined}
        stickySectionHeadersEnabled
        initialNumToRender={20}
        windowSize={10}
      />

      <FilterSheets
        sheet={sheet}
        onClose={() => setSheet(null)}
        accounts={accounts}
        accountIds={accountIds}
        onAccounts={setAccountIds}
        period={period}
        onPeriod={setPeriod}
        categories={categories}
        onCategories={setCategories}
        showHidden={showHidden}
        onShowHidden={setShowHidden}
      />
    </View>
  );
}

function FilterSheets(props: {
  sheet: null | 'conta' | 'periodo' | 'categoria';
  onClose: () => void;
  accounts: (AccountRow & { institution_name: string | null; connection_name: string })[];
  accountIds: string[];
  onAccounts: (v: string[]) => void;
  period: Period;
  onPeriod: (p: Period) => void;
  categories: string[];
  onCategories: (v: string[]) => void;
  showHidden: boolean;
  onShowHidden: (v: boolean) => void;
}) {
  const theme = useAppTheme();
  const { sheet, onClose } = props;
  // Rascunho local: fechar sem aplicar não muda nada.
  const [acc, setAcc] = useState<string[]>([]);
  const [per, setPer] = useState<string>('none');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fromError, setFromError] = useState<string | null>(null);
  const [toError, setToError] = useState<string | null>(null);
  const [cats, setCats] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!sheet) return;
    setAcc(props.accountIds);
    setPer(props.period.kind);
    setFrom(props.period.kind === 'custom' ? props.period.from.split('-').reverse().join('/') : '');
    setTo(props.period.kind === 'custom' ? props.period.to.split('-').reverse().join('/') : '');
    setFromError(null);
    setToError(null);
    setCats(props.categories);
    setHidden(props.showHidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function apply() {
    if (sheet === 'conta') props.onAccounts(acc);
    if (sheet === 'categoria') {
      props.onCategories(cats);
      props.onShowHidden(hidden);
    }
    if (sheet === 'periodo') {
      if (per === 'custom') {
        const f = parseDateBR(from);
        const t = parseDateBR(to);
        const invalid = 'Data inválida. Use dia/mês/ano, como 17/11/2026.';
        // UX v0.6 (REV-22): campo vazio tem mensagem própria; "Data inválida" só para data que não existe.
        setFromError(!from.trim() ? 'Informe a data inicial.' : f ? null : invalid);
        setToError(!to.trim() ? 'Informe a data final.' : t ? null : invalid);
        if (!f || !t) return;
        if (t < f) return setToError('A data final precisa ser igual ou posterior à inicial.');
        props.onPeriod({ kind: 'custom', from: f, to: t });
      } else props.onPeriod(per === 'none' ? { kind: 'none' } : ({ kind: per } as Period));
    }
    onClose();
  }
  function clear() {
    if (sheet === 'conta') setAcc([]);
    if (sheet === 'periodo') setPer('none');
    if (sheet === 'categoria') {
      setCats([]);
      setHidden(false);
    }
  }

  const byInstitution = new Map<string, typeof props.accounts>();
  for (const a of props.accounts) {
    const k = a.connection_name;
    byInstitution.set(k, [...(byInstitution.get(k) ?? []), a]);
  }
  const title = sheet === 'conta' ? 'Conta' : sheet === 'periodo' ? 'Período' : 'Categoria';

  return (
    <Portal>
      <Modal visible={sheet !== null} onDismiss={onClose} contentContainerStyle={[s.sheet, { backgroundColor: theme.colors.surface }]}>
        <Text variant="titleLarge" accessibilityRole="header" style={{ marginBottom: 8 }}>{title}</Text>
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
          <List.Section style={{ margin: 0 }}>
            {sheet === 'conta' && [...byInstitution.entries()].map(([inst, list]) => (
              <View key={inst}>
                <List.Subheader>{inst}</List.Subheader>
                {list.map((a) => (
                  <OptionRow key={a.id} kind="checkbox" label={`${a.name}${a.type === 'CREDIT' ? ' (cartão)' : ''}`} checked={acc.includes(a.id)} onPress={() => setAcc(toggle(acc, a.id))} />
                ))}
              </View>
            ))}
            {sheet === 'periodo' && (
              <>
                {([['this', 'Este mês'], ['last', 'Mês passado'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['custom', 'Escolher datas']] as const).map(([v, l]) => (
                  <OptionRow key={v} kind="radio" label={l} checked={per === v} onPress={() => setPer(v)} />
                ))}
                {per === 'custom' && (
                  <View style={{ gap: 8, paddingHorizontal: 16 }}>
                    <Text variant="labelLarge">De</Text>
                    <TextInput mode="outlined" value={from} onChangeText={(v) => setFrom(maskDateInput(v))} placeholder="dd/mm/aaaa" keyboardType="number-pad" maxLength={10} accessibilityLabel="Data inicial, dd/mm/aaaa" error={!!fromError} />
                    <FieldError text={fromError} />
                    <Text variant="labelLarge">Até</Text>
                    <TextInput mode="outlined" value={to} onChangeText={(v) => setTo(maskDateInput(v))} placeholder="dd/mm/aaaa" keyboardType="number-pad" maxLength={10} accessibilityLabel="Data final, dd/mm/aaaa" error={!!toError} />
                    <FieldError text={toError} />
                  </View>
                )}
              </>
            )}
            {sheet === 'categoria' && (
              <>
                {[...CATEGORIES.map((c) => ({ id: c.id as string, name: c.name })), { id: 'none', name: NO_CATEGORY.name }].map((c) => (
                  <OptionRow key={c.id} kind="checkbox" label={c.name} checked={cats.includes(c.id)} onPress={() => setCats(toggle(cats, c.id))} />
                ))}
                <Divider />
                <OptionRow kind="switch" label="Mostrar ocultas" checked={hidden} onPress={() => setHidden(!hidden)} />
              </>
            )}
          </List.Section>
        </ScrollView>
        <View style={[ui.row, { justifyContent: 'flex-end', gap: 8, marginTop: 8 }]}>
          <Button onPress={clear}>Limpar</Button>
          <Button mode="contained" onPress={apply}>Aplicar</Button>
        </View>
      </Modal>
    </Portal>
  );
}

const s = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 24, maxWidth: 640, width: '100%', alignSelf: 'center' },
  header: { gap: 8, paddingTop: 8 },
  search: { marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { },
  chipHit: { minHeight: 48, justifyContent: 'center', borderRadius: 8 },
  day: { paddingVertical: 8 },
  sheet: { margin: 0, marginTop: 'auto', padding: 16, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxWidth: 640, width: '100%', alignSelf: 'center' },
});


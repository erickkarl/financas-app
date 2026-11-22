// T-13 Extrato + T-14 Filtros — RF-005, RF-006.1, RF-007.2. ux.md 0.22: o mês primeiro (RF-005.4), uma folha de
// filtros com "Tipo" (RF-005.5, RF-005.6), a folha "Período" e a busca no período (E-21 a).
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, SectionList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { recipientFromToken } from '../../state/nav';
import type { RecipientKey } from '../../domain/recipient';
import { takeFlash } from '../../state/flash';
import { Badge, Divider, FAB, Icon, List, Modal, Portal, SegmentedButtons, Snackbar, Text, TouchableRipple } from 'react-native-paper';
import { AppChip, Button, IconButton, ListItem } from '../../ui/touch';
import { useApp } from '../../state/AppContext';
import { useStartConnect } from '../../state/hooks';
import { CATEGORIES, NO_CATEGORY } from '../../domain/categories';
import { formatBalance, formatCount, parseDateBR, formatDayHeader, formatMonth, spDateKey } from '../../domain/format';
import { shiftMonth } from '../../domain/monthly';
import { Amount, announce, Banner, EmptyState, OptionRow, SearchField, Skeleton, TransactionItem, styles as ui, useAppTheme } from '../../ui/components';
import { DateField } from '../../ui/DateField';
import { openSystemDatePicker } from '../../ui/datePicker';
import type { AccountRow, TransactionRow, TxFilter } from '../../data/repo';

const PAGE = 50;

/** UX 0.22: o Extrato mostra sempre um período; abre no mês atual. */
type Period = { kind: 'month'; month: string } | { kind: '7' | '30' | 'all' } | { kind: 'custom'; from: string; to: string };
type TypeFilter = 'all' | 'in' | 'out';
type Only = undefined | 'out' | 'transfer' | 'bill' | 'reimb' | 'manualOut';

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const br = (k: string) => k.split('-').reverse().join('/');

function periodRange(p: Period, now = new Date()): { from?: string; to?: string; label: string } {
  const today = spDateKey(now);
  const back = (days: number) => spDateKey(new Date(now.getTime() - days * 86400000));
  switch (p.kind) {
    case 'month': {
      const [y, m] = p.month.split('-').map(Number);
      return { from: `${p.month}-01`, to: `${p.month}-${pad(lastDay(p.month))}`, label: formatMonth(y, m) };
    }
    case '7': return { from: back(6), to: today, label: 'Últimos 7 dias' };
    case '30': return { from: back(29), to: today, label: 'Últimos 30 dias' };
    case 'custom': return { from: p.from, to: p.to, label: `${br(p.from)} a ${br(p.to)}` };
    default: return { label: 'Todo o período' };
  }
}

/** Período vindo de outra tela: um mês inteiro vira "mês" (o navegador anda); o resto é um intervalo. */
function periodFromParams(from?: string, to?: string): Period | null {
  if (!from || !to) return null;
  const ym = from.slice(0, 7);
  if (from === `${ym}-01` && to.slice(0, 7) === ym && Number(to.slice(8, 10)) >= lastDay(ym)) return { kind: 'month', month: ym };
  return { kind: 'custom', from, to };
}

export default function Extrato() {
  const theme = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const big = fontScale >= 1.5;
  const params = useLocalSearchParams<{ account?: string; from?: string; to?: string; category?: string; only?: string; futuras?: string; k?: string; rk?: string }>();
  const { repo, dataVersion, online, credStatus } = useApp();
  // "Lançamento salvo" ao voltar de T-17.
  const [saved, setSaved] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { const m = takeFlash('extrato'); if (m) { setSaved(m); announce(m); } }, []));
  const startConnect = useStartConnect();
  const today = spDateKey(new Date());
  const currentMonth = today.slice(0, 7);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [period, setPeriod] = useState<Period>({ kind: 'month', month: currentMonth });
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [type, setType] = useState<TypeFilter>('all');
  const [showHidden, setShowHidden] = useState(false);
  // UX 0.14: "Só fora do Resumo"; UX 0.21: "Reembolsos" e "Marcados por você"; e os motivos de "Ver quais".
  const [only, setOnly] = useState<Only>(undefined);
  const outLike = only === 'out' || only === 'reimb' || only === 'manualOut';
  // UX 0.17 (T-22, "Ver lançamentos"): filtro por destinatário, com o chip "Destinatário".
  const [recipient, setRecipient] = useState<RecipientKey | null>(null);
  const [reasons, setReasons] = useState(false);
  const [sheet, setSheet] = useState<null | 'filtros' | 'periodo'>(null);

  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [sums, setSums] = useState<Awaited<ReturnType<typeof repo.sums>> | null>(null);
  const [other, setOther] = useState(0);
  const [firstMonth, setFirstMonth] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [accounts, setAccounts] = useState<(AccountRow & { institution_name: string | null; connection_name: string })[]>([]);
  const loadingMore = useRef(false);

  // Cada ida vinda de outra tela traz um marcador novo (k): os filtros e a busca anteriores saem e entram só os pedidos.
  // O navegador mostra o período pedido; sem período, "Todo o período" (como "Ver quais" de T-23 e T-22).
  useEffect(() => {
    if (params.k) {
      setAccountIds([]); setCategories([]); setType('all'); setOnly(undefined); setSearch(''); setShowHidden(false); setFuturesOpen(false);
      setRecipient(recipientFromToken(params.rk));
      setPeriod(periodFromParams(params.from, params.to) ?? { kind: 'all' });
    } else {
      const p = periodFromParams(params.from, params.to);
      if (p) setPeriod(p);
    }
    if (params.account) setAccountIds([params.account]);
    if (params.category) setCategories([params.category]);
    if (params.only === 'out' || params.only === 'bill' || params.only === 'reimb') setOnly(params.only);
    if (params.futuras === '1') setFuturesOpen(true);
  }, [params.k, params.rk, params.account, params.from, params.to, params.category, params.only, params.futuras]);

  // Busca começa 300 ms depois da última tecla.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const range = periodRange(period);
  const filter: TxFilter = useMemo(
    () => ({ accountIds, from: range.from, to: range.to, categories, search: debounced, showHidden, only, recipient: recipient ?? undefined, type: type === 'all' ? undefined : type }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountIds, range.from, range.to, categories, debounced, showHidden, only, recipient, type],
  );
  // RF-005.3: futuras (data depois de hoje) num grupo próprio, fora das somas e da lista principal.
  const [futures, setFutures] = useState<TransactionRow[]>([]);
  const [futuresOpen, setFuturesOpen] = useState(false);

  // C2-12: só a carga mais recente vale.
  const loadSeq = useRef(0);
  const lastLabel = useRef<string | null>(null);
  const load = useCallback(async () => {
    const mine = ++loadSeq.current;
    try {
      const [first, s, all, accs, fut, out, fm] = await Promise.all([
        repo.listTransactions({ ...filter, future: 'exclude', today }, PAGE, 0),
        repo.sums({ ...filter, today }),
        repo.countAllTransactions(),
        repo.listAccounts(),
        repo.listTransactions({ ...filter, future: 'only', today }, 500, 0),
        repo.countOtherPeriods(filter),
        repo.firstMonth(),
      ]);
      if (mine !== loadSeq.current) return;
      setRows(first);
      setFutures([...fut].reverse()); // da mais próxima para a mais distante
      if (fut.length > 0 && first.length === 0) setFuturesOpen(true);
      setSums(s);
      setOther(out);
      setFirstMonth(fm);
      setTotal(all);
      setAccounts(accs);
      setHasMore(first.length === PAGE);
      setError(false);
      // UX 0.22: a troca de período é anunciada com o nome e a contagem ("outubro de 2026, 38 transações").
      const count = `${formatCount(s.count)} ${s.count === 1 ? 'transação' : 'transações'}`;
      announce(lastLabel.current !== range.label ? `${range.label}, ${count}` : count);
      lastLabel.current = range.label;
    } catch {
      if (mine === loadSeq.current) setError(true);
    }
  }, [repo, filter, today, range.label]);

  useEffect(() => { load(); }, [load, dataVersion]);

  async function loadMore() {
    if (!rows || !hasMore || loadingMore.current) return;
    loadingMore.current = true;
    const mine = loadSeq.current;
    const next = await repo.listTransactions({ ...filter, future: 'exclude', today }, PAGE, rows.length);
    if (mine !== loadSeq.current) { loadingMore.current = false; return; }
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

  // Grupos ligados na folha (o número do botão "Filtros · {n}").
  const sheetGroups = (accountIds.length > 0 ? 1 : 0) + (categories.length > 0 ? 1 : 0) + (type !== 'all' ? 1 : 0) + (showHidden ? 1 : 0) + (only === 'out' ? 1 : 0);
  const anyFilter = sheetGroups > 0 || Boolean(only) || Boolean(recipient);
  // "Limpar filtros" desliga os chips; o período e a busca ficam (0.22).
  const clearFilters = () => { setAccountIds([]); setCategories([]); setType('all'); setShowHidden(false); setOnly(undefined); setRecipient(null); };

  const isMonth = period.kind === 'month';
  const canPrev = isMonth && (!firstMonth || period.month > firstMonth);
  const canNext = isMonth && period.month < currentMonth;
  const goMonth = (delta: number) => { if (period.kind === 'month') setPeriod({ kind: 'month', month: shiftMonth(period.month, delta) }); };

  // Chips do que está ativo, cada um com "×".
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Conta';
  const catName = (id: string) => (id === 'none' ? NO_CATEGORY.name : CATEGORIES.find((c) => c.id === id)?.name ?? 'Categoria');
  const chips: { key: string; label: string; clear: () => void }[] = [
    ...(accountIds.length ? [{ key: 'acc', label: accountIds.length === 1 ? accountName(accountIds[0]) : `${accountIds.length} contas`, clear: () => setAccountIds([]) }] : []),
    ...(categories.length ? [{ key: 'cat', label: categories.length === 1 ? catName(categories[0]) : `${categories.length} categorias`, clear: () => setCategories([]) }] : []),
    ...(type !== 'all' ? [{ key: 'type', label: type === 'in' ? 'Só entradas' : 'Só saídas', clear: () => setType('all') }] : []),
    ...(showHidden ? [{ key: 'hidden', label: 'Ocultas', clear: () => setShowHidden(false) }] : []),
    ...(only ? [{ key: 'only', label: { out: 'Fora do Resumo', transfer: 'Transferências', bill: 'Pagamentos de fatura', reimb: 'Reembolsos', manualOut: 'Marcados por você' }[only], clear: () => setOnly(undefined) }] : []),
    ...(recipient ? [{ key: 'rec', label: 'Destinatário', clear: () => setRecipient(null) }] : []),
  ];

  const searching = debounced.trim() !== '';
  const nothingInPeriod = rows !== null && rows.length === 0 && futures.length === 0;
  const otherLine = other > 0 && period.kind !== 'all' ? (
    <View style={[ui.row, { flexWrap: 'wrap', justifyContent: 'space-between', paddingVertical: 8 }]}>
      <Text variant="bodyMedium" style={{ flexShrink: 1 }}>{`${formatCount(other)} ${other === 1 ? 'resultado' : 'resultados'} em outros períodos.`}</Text>
      <Button onPress={() => setPeriod({ kind: 'all' })}>Buscar em todo o período</Button>
    </View>
  ) : null;

  // Cartão de somas (0.22): Entradas e Saídas lado a lado (empilham com fonte grande); contagem e "Ver quais".
  const card = sums && !(nothingInPeriod && !searching && !anyFilter) ? (() => {
    const showIn = type !== 'out';
    const showOut = type !== 'in';
    const outCount = sums.excluded + (sums.byReason.future > 0 ? 0 : futures.length);
    const val = (label: string, v: number) => (
      <View style={{ flex: big ? undefined : 1, gap: 2 }}>
        <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>{label}</Text>
        {outLike
          ? <Text variant="titleLarge" style={ui.tabular}>{formatBalance(Math.abs(v))}</Text>
          : <Amount value={v} variant="headlineSmall" />}
      </View>
    );
    const inV = outLike ? sums.out.entradas : sums.entradas;
    const outV = outLike ? sums.out.saidas : sums.saidas;
    const countText = outLike
      ? `${formatCount(sums.out.count)} ${sums.out.count === 1 ? 'lançamento' : 'lançamentos'} fora do Resumo`
      : `${formatCount(sums.count)} ${sums.count === 1 ? 'transação' : 'transações'}${outCount > 0 ? ` · ${formatCount(outCount)} fora das somas` : ''}`;
    const notes = [
      !outLike && type === 'all' && sums.refunds > 0 ? `Saídas já descontam ${formatCount(sums.refunds)} ${sums.refunds === 1 ? 'estorno' : 'estornos'}.` : null,
      !outLike && type === 'out' && sums.refundsNotIncluded > 0 ? `Não inclui ${formatCount(sums.refundsNotIncluded)} ${sums.refundsNotIncluded === 1 ? 'estorno que abate despesas' : 'estornos que abatem despesas'}.` : null,
    ].filter(Boolean) as string[];
    const spoken = `${showIn ? `Entradas, ${outLike ? '' : 'mais '}${formatBalance(Math.abs(inV))}. ` : ''}${showOut ? `Saídas, ${outLike ? '' : 'menos '}${formatBalance(Math.abs(outV))}. ` : ''}${countText}.${notes.length ? ` ${notes.join(' ')}` : ''}`;
    return (
      <View style={[s.card, { backgroundColor: theme.colors.elevation.level2 }]}>
        <View accessible accessibilityLabel={spoken} style={{ gap: 8 }}>
          <View style={{ flexDirection: big ? 'column' : 'row', gap: big ? 8 : 16 }}>
            {showIn && val('Entradas', inV)}
            {showOut && val('Saídas', -Math.abs(outV))}
          </View>
          {notes.map((n) => <Text key={n} variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{n}</Text>)}
          <Divider />
        </View>
        <View style={[ui.row, { flexWrap: 'wrap', justifyContent: 'space-between', gap: 4 }]}>
          <Text variant="bodyMedium" style={{ flexShrink: 1 }} importantForAccessibility="no">{countText}</Text>
          {!outLike && outCount > 0 && <Button compact onPress={() => setReasons(true)} accessibilityLabel={`Ver quais: ${formatCount(outCount)} fora das somas`}>Ver quais</Button>}
        </View>
      </View>
    );
  })() : null;

  const header = (
    <View style={s.header}>
      {!online && <Banner icon="wifi-off" text="Sem internet. Mostrando os dados salvos." />}
      {credStatus === 'rejected' && <Banner tone="error" text="Suas credenciais do Pluggy não funcionam mais." actionLabel="Corrigir" onAction={() => router.push('/credenciais')} />}
      {/* 1. Busca com o botão "Filtros" dentro (0.22). Com fonte grande, o botão vira ícone com o número. */}
      <SearchField
        placeholder={big ? 'Buscar' : 'Buscar por descrição'}
        value={search}
        onChangeText={setSearch}
        right={big ? (
          <View>
            <IconButton icon="tune-variant" onPress={() => setSheet('filtros')} accessibilityLabel={sheetGroups ? `Filtros, ${sheetGroups} ${sheetGroups === 1 ? 'ativo' : 'ativos'}` : 'Filtros'} accessibilityHint="Abre os filtros" />
            {sheetGroups > 0 && <Badge size={18} style={{ position: 'absolute', top: 2, right: 2 }}>{sheetGroups}</Badge>}
          </View>
        ) : (
          <Button icon="tune-variant" onPress={() => setSheet('filtros')} accessibilityLabel={sheetGroups ? `Filtros, ${sheetGroups} ${sheetGroups === 1 ? 'ativo' : 'ativos'}` : 'Filtros'} accessibilityHint="Abre os filtros" style={{ marginRight: 4 }}>
            {sheetGroups ? `Filtros · ${sheetGroups}` : 'Filtros'}
          </Button>
        )}
      />
      {/* 2. Navegador de período, como em T-18. */}
      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <IconButton icon="chevron-left" disabled={!canPrev} onPress={() => goMonth(-1)} accessibilityLabel="Mês anterior" />
        <TouchableRipple onPress={() => setSheet('periodo')} accessibilityRole="button" accessibilityLabel={`Período: ${range.label}`} accessibilityHint="Abre as opções de período" style={{ flex: 1, minHeight: 48, justifyContent: 'center', borderRadius: 8 }}>
          {/* C4-08: o texto ocupa a largura entre as setas e quebra só se não couber; sem "gap" nem centralizar na linha,
              que no Android mediam o texto mais estreito do que ele é e jogavam o ano para uma segunda linha escondida. */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="titleMedium" style={{ flex: 1, textAlign: 'center' }}>{range.label}</Text>
            <View style={{ marginLeft: 4 }}><Icon source="menu-down" size={24} color={theme.colors.onSurfaceVariant} /></View>
          </View>
        </TouchableRipple>
        <IconButton icon="chevron-right" disabled={!canNext} onPress={() => goMonth(1)} accessibilityLabel="Próximo mês" />
      </View>
      {/* 3. Cartão de somas. */}
      {card}
      {/* 4. Chips do que está ativo, com "Limpar filtros". */}
      {chips.length > 0 && (
        <View style={s.chips}>
          {chips.map((c) => (
            <AppChip key={c.key} label={c.label} selected onClose={c.clear} closeLabel={`Limpar filtro ${c.label}`} />
          ))}
          <Button compact onPress={clearFilters}>Limpar filtros</Button>
        </View>
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
  else if (nothingInPeriod && !searching && !anyFilter) body = <EmptyState icon="calendar-blank-outline" title={`Nenhuma transação em ${range.label}.`} />;
  else if (nothingInPeriod) body = (
    <>
      <EmptyState icon="magnify" title="Nenhuma transação encontrada." text="Tente mudar a busca, o período ou os filtros." actionLabel={anyFilter ? 'Limpar filtros' : undefined} onAction={anyFilter ? clearFilters : undefined} />
      {otherLine}
    </>
  );

  return (
    <SafeAreaView edges={['left', 'right']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
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
        ListFooterComponent={!body && rows ? (
          <>
            {otherLine}
            {!hasMore && <Text variant="bodySmall" style={[ui.center, { padding: 16, color: theme.colors.onSurfaceVariant }]}>{period.kind === 'all' ? 'Fim das transações disponíveis.' : `Fim de ${range.label}.`}</Text>}
          </>
        ) : undefined}
        stickySectionHeadersEnabled
        initialNumToRender={20}
        windowSize={10}
      />

      {/* RF-007: botão flutuante "+" (T-13, item 6). */}
      <FAB icon="plus" accessibilityLabel="Novo lançamento manual" onPress={() => router.push('/lancamento')} style={s.fab} />
      <Snackbar visible={Boolean(saved)} onDismiss={() => setSaved(null)} duration={4000}>{saved}</Snackbar>

      <Portal>
        <Modal visible={reasons} onDismiss={() => setReasons(false)} contentContainerStyle={[s.reasonSheet, { backgroundColor: theme.colors.surface }]}>
          <Text variant="titleLarge" accessibilityRole="header">Fora das somas</Text>
          {sums && ([
            ['hidden', 'Ocultas', sums.byReason.hidden],
            ['future', 'Futuras', sums.byReason.future || futures.length],
            ['transfer', 'Transferências entre suas contas', sums.byReason.transfer],
            ['investments', 'Investimentos', sums.byReason.investments],
            ['out', 'Fora do Resumo', sums.byReason.out],
            // UX 0.21: com reembolso no resultado, as duas linhas recuadas sob "Fora do Resumo" (r + m = total).
            ...(sums.byReason.reimb > 0 ? [
              ['reimb', 'Reembolsos', sums.byReason.reimb],
              ['manualOut', 'Marcados por você', sums.byReason.manualOut],
            ] : []),
          ] as [string, string, number][]).filter(([, , n]) => n > 0).map(([k, label, n]) => (
            <ListItem
              key={k}
              title={label}
              style={{ minHeight: 56, paddingLeft: k === 'reimb' || k === 'manualOut' ? 24 : undefined }}
              right={() => <Text variant="titleMedium" style={ui.tabular}>{formatCount(n)}</Text>}
              accessibilityLabel={`${label}, ${n}. Toque para filtrar`}
              onPress={() => {
                setReasons(false);
                if (k === 'hidden') { setShowHidden(true); setOnly(undefined); }
                if (k === 'future') setFuturesOpen(true);
                if (k === 'transfer') setOnly('transfer');
                if (k === 'investments') { setCategories(['investimentos']); setOnly(undefined); }
                if (k === 'out') setOnly('out');
                if (k === 'reimb' || k === 'manualOut') { setOnly(k); setShowHidden(false); }
              }}
            />
          ))}
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Cada lançamento conta em um motivo só, nesta ordem.</Text>
          <Button onPress={() => setReasons(false)} style={{ alignSelf: 'flex-end' }}>Fechar</Button>
        </Modal>
      </Portal>

      <FiltersSheet
        visible={sheet === 'filtros'}
        onClose={() => setSheet(null)}
        accounts={accounts}
        base={filter}
        today={today}
        current={{ accountIds, categories, type, showHidden, onlyOut: only === 'out' }}
        onApply={(v) => {
          setAccountIds(v.accountIds); setCategories(v.categories); setType(v.type); setShowHidden(v.showHidden);
          if (v.onlyOut) setOnly('out'); else if (only === 'out') setOnly(undefined);
        }}
      />
      <PeriodSheet visible={sheet === 'periodo'} onClose={() => setSheet(null)} period={period} currentMonth={currentMonth} onApply={setPeriod} />
    </SafeAreaView>
  );
}

type SheetValues = { accountIds: string[]; categories: string[]; type: TypeFilter; showHidden: boolean; onlyOut: boolean };

/** T-14 (0.22): uma folha "Filtros" com Conta, Categoria, Tipo e Outros filtros; o botão mostra quantas vão aparecer. */
function FiltersSheet({ visible, onClose, accounts, base, today, current, onApply }: {
  visible: boolean;
  onClose: () => void;
  accounts: (AccountRow & { institution_name: string | null; connection_name: string })[];
  base: TxFilter;
  today: string;
  current: SheetValues;
  onApply: (v: SheetValues) => void;
}) {
  const theme = useAppTheme();
  const { repo } = useApp();
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const big = fontScale >= 1.5;
  // Rascunho local: fechar sem aplicar não muda nada.
  const [d, setD] = useState<SheetValues>(current);
  const [allCats, setAllCats] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { if (visible) { setD(current); setAllCats(false); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    setCount(null);
    const only = d.onlyOut ? 'out' : base.only === 'out' ? undefined : base.only;
    repo.sums({ ...base, accountIds: d.accountIds, categories: d.categories, type: d.type === 'all' ? undefined : d.type, showHidden: d.showHidden, only, today })
      .then((s) => { if (live) { setCount(s.count); announce(`${formatCount(s.count)} ${s.count === 1 ? 'transação' : 'transações'}`); } })
      .catch(() => undefined);
    return () => { live = false; };
  }, [visible, d, base, repo, today]);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const byInstitution = new Map<string, typeof accounts>();
  for (const a of accounts) byInstitution.set(a.connection_name, [...(byInstitution.get(a.connection_name) ?? []), a]);
  const cats = [...CATEGORIES.map((c) => ({ id: c.id as string, name: c.name })), { id: 'none', name: NO_CATEGORY.name }];
  const COLLAPSED = 6;
  const shownCats = allCats ? cats : cats.filter((c, i) => i < COLLAPSED || d.categories.includes(c.id));
  const section = (t: string) => <Text variant="titleSmall" accessibilityRole="header" style={{ marginTop: 12, marginBottom: 4 }}>{t}</Text>;

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onClose} contentContainerStyle={[s.sheet, { backgroundColor: theme.colors.surface, maxHeight: height - insets.top - insets.bottom - 24 }]}>
        <Text variant="titleLarge" accessibilityRole="header">Filtros</Text>
        <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          {accounts.length > 0 && section('Conta')}
          {[...byInstitution.entries()].map(([inst, list]) => (
            <View key={inst}>
              {/* C4-04: o nome da instituição inteiro, em quantas linhas precisar (como C3-10 e C3-14). */}
              <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, paddingTop: 12, paddingBottom: 4 }}>{inst}</Text>
              {list.map((a) => (
                <OptionRow key={a.id} kind="checkbox" label={`${a.name}${a.type === 'CREDIT' ? ' (cartão)' : ''}`} checked={d.accountIds.includes(a.id)} onPress={() => setD({ ...d, accountIds: toggle(d.accountIds, a.id) })} />
              ))}
            </View>
          ))}
          {section('Categoria')}
          <View style={s.chips}>
            {shownCats.map((c) => (
              <AppChip key={c.id} label={c.name} selected={d.categories.includes(c.id)} role="checkbox" onPress={() => setD({ ...d, categories: toggle(d.categories, c.id) })} />
            ))}
          </View>
          {!allCats && cats.length > shownCats.length && <Button onPress={() => setAllCats(true)} style={{ alignSelf: 'flex-start' }}>{`Ver todas (${cats.length})`}</Button>}
          {section('Tipo')}
          {big ? (
            (['all', 'in', 'out'] as const).map((v) => <OptionRow key={v} kind="radio" label={{ all: 'Todas', in: 'Entradas', out: 'Saídas' }[v]} checked={d.type === v} onPress={() => setD({ ...d, type: v })} />)
          ) : (
            <SegmentedButtons
              value={d.type}
              onValueChange={(v) => setD({ ...d, type: v as TypeFilter })}
              // C4-05: a opção escolhida tem a marca de seleção, além do fundo.
              buttons={[{ value: 'all', label: 'Todas', showSelectedCheck: true }, { value: 'in', label: 'Entradas', showSelectedCheck: true }, { value: 'out', label: 'Saídas', showSelectedCheck: true }]}
            />
          )}
          {section('Outros filtros')}
          <OptionRow kind="switch" label="Mostrar ocultas" checked={d.showHidden} onPress={() => setD({ ...d, showHidden: !d.showHidden })} />
          <OptionRow kind="switch" label="Só fora do Resumo" checked={d.onlyOut} onPress={() => setD({ ...d, onlyOut: !d.onlyOut })} />
        </ScrollView>
        {/* Rodapé fixo; com fonte grande, empilha à direita com "Limpar" em cima (seção 8). */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button onPress={() => setD({ accountIds: [], categories: [], type: 'all', showHidden: false, onlyOut: false })}>Limpar</Button>
          <Button mode="contained" onPress={() => { onApply(d); onClose(); }}>
            {count === null ? 'Ver transações' : `Ver ${formatCount(count)} ${count === 1 ? 'transação' : 'transações'}`}
          </Button>
        </View>
      </Modal>
    </Portal>
  );
}

/** T-14 (0.22): folha "Período". Atalhos aplicam ao toque; "Aplicar" só para as datas. */
function PeriodSheet({ visible, onClose, period, currentMonth, onApply }: {
  visible: boolean; onClose: () => void; period: Period; currentMonth: string; onApply: (p: Period) => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const big = fontScale >= 1.5;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fromError, setFromError] = useState<string | null>(null);
  const [toError, setToError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setFrom(period.kind === 'custom' ? br(period.from) : '');
    setTo(period.kind === 'custom' ? br(period.to) : '');
    setFromError(null); setToError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const invalid = 'Data inválida. Use dia/mês/ano, como 17/11/2026.';
  // As mensagens aparecem ao sair do campo e ao aplicar; a ordem é conferida também com datas do calendário.
  const checkFrom = (v = from) => { const e = !v.trim() ? 'Informe a data inicial.' : parseDateBR(v) ? null : invalid; setFromError(e); return e; };
  const checkTo = (v = to, f = from) => {
    const t = parseDateBR(v); const fk = parseDateBR(f);
    const e = !v.trim() ? 'Informe a data final.' : !t ? invalid : fk && t < fk ? 'A data final precisa ser igual ou posterior à inicial.' : null;
    setToError(e); return e;
  };
  const prev = shiftMonth(currentMonth, -1);
  const shortcuts: [string, Period][] = [
    ['Este mês', { kind: 'month', month: currentMonth }],
    ['Mês passado', { kind: 'month', month: prev }],
    ['Últimos 7 dias', { kind: '7' }],
    ['Últimos 30 dias', { kind: '30' }],
    ['Todo o período', { kind: 'all' }],
  ];
  const typing = from.trim() !== '' || to.trim() !== '';
  const same = (a: Period, b: Period) => a.kind === b.kind && (a.kind !== 'month' || (b.kind === 'month' && a.month === b.month));
  return (
    <Portal>
      <Modal visible={visible} onDismiss={onClose} contentContainerStyle={[s.sheet, { backgroundColor: theme.colors.surface, maxHeight: height - insets.top - insets.bottom - 24 }]}>
        <Text variant="titleLarge" accessibilityRole="header">Período</Text>
        <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <View style={[s.chips, { marginTop: 8 }]}>
            {shortcuts.map(([label, p]) => (
              // 0.22 (esclarecimento): com "De" ou "Até" preenchido, nenhum atalho fica marcado.
              <AppChip key={label} label={label} selected={!typing && same(period, p)} role="radio" onPress={() => { onApply(p); onClose(); }} />
            ))}
          </View>
          <Text variant="titleSmall" accessibilityRole="header" style={{ marginTop: 16, marginBottom: 8 }}>Ou escolha as datas</Text>
          <View style={{ flexDirection: big ? 'column' : 'row', gap: 8 }}>
            <DateField inRow={!big} label="De" value={from} onChange={setFrom} onBlur={() => from && checkFrom()} error={fromError} calendarLabel="Abrir o calendário da data inicial" />
            <DateField inRow={!big} label="Até" value={to} onChange={setTo} onBlur={() => to && checkTo()} error={toError} calendarLabel="Abrir o calendário da data final" />
          </View>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
            {openSystemDatePicker ? 'Digite a data ou toque no calendário.' : 'Digite a data.'}
          </Text>
        </ScrollView>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
          <Button mode="contained" onPress={() => {
            const ef = checkFrom(); const et = checkTo();
            if (ef || et) return;
            onApply({ kind: 'custom', from: parseDateBR(from)!, to: parseDateBR(to)! });
            onClose();
          }}>Aplicar</Button>
        </View>
      </Modal>
    </Portal>
  );
}

const s = StyleSheet.create({
  reasonSheet: { marginTop: 'auto', padding: 16, borderTopLeftRadius: 28, borderTopRightRadius: 28, gap: 4 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
  list: { paddingHorizontal: 16, paddingBottom: 96, maxWidth: 640, width: '100%', alignSelf: 'center' },
  header: { gap: 8, paddingTop: 8 },
  card: { borderRadius: 16, padding: 16, gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  day: { paddingVertical: 8 },
  sheet: { margin: 0, marginTop: 'auto', padding: 16, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxWidth: 640, width: '100%', alignSelf: 'center' },
});

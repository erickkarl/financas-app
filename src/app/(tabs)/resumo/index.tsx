// T-23 Resumo por mês (UX 0.19 aprovada, E-15 a, N-10, N-11) — RF-017 (requisitos v1.25).
// Gasto, Receita e Economia de cada mês vêm de monthSummary, a mesma função de T-18 (RF-017.5).
// "Saldo em contas" (ux.md 0.20; requisitos v1.28): real desde a conexão, estimado antes (RF-017.7, .8, .8.1), com o
// rendimento do mês só como informação (RF-017.12).
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Divider, Icon, List, Text, TouchableRipple } from 'react-native-paper';
import { useApp } from '../../../state/AppContext';
import { useStartConnect } from '../../../state/hooks';
import { balanceA11y, formatBalance, formatMonth, formatSignedAmount, isMaskingValues, setMaskValues, spDateKey } from '../../../domain/format';
import { applyPeriod, CRITERIOS, monthsBetween, shiftMonth, partialFirstMonth, patrimonioByMonth, type Criterio, type Periodo } from '../../../domain/monthly';
import type { SaldoHistory } from '../../../domain/saldoHistory';
import { Amount, Banner, EmptyState, Skeleton, styles as ui, useAppTheme } from '../../../ui/components';
import { Button, ListAccordion } from '../../../ui/touch';
import { Hatch, MonthlyChart, type ChartPoint } from '../../../ui/MonthlyChart';
import { SafeAreaView } from 'react-native-safe-area-context';

type Row = ChartPoint & { since?: string; pointDate?: string; yieldReal?: number; yieldEst?: number };
type Data = {
  first: string | null;
  flows: { month: string; receitas: number; despesas: number; resultado: number }[];
  wealth: { month: string; value: number; date: string }[];
  wealthFirst: string | null;
  saldo: number;
  saldoH: SaldoHistory;
  empty: boolean;
};

const monthName = (m: string) => formatMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)));
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const br = (d: string) => d.split('-').reverse().join('/');
const SPOKEN: Record<Criterio, string> = { gasto: 'gasto', receita: 'receita', economia: 'economia', patrimonio: 'patrimônio', saldo: 'saldo em contas' };

export default function ResumoPorMes() {
  const theme = useAppTheme();
  const { mascarar, preview } = useLocalSearchParams<{ mascarar?: string; preview?: string }>();
  if (__DEV__ && mascarar === '1' && !isMaskingValues()) setMaskValues(true);
  const { repo, dataVersion, refreshAll } = useApp();
  const startConnect = useStartConnect();
  const today = spDateKey(new Date());
  const current = today.slice(0, 7);
  const [criterio, setCriterio] = useState<Criterio>('gasto');
  const [periodo, setPeriodo] = useState<Periodo>(12);
  const [sel, setSel] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [ov, series, total, conns, saldoH] = await Promise.all([repo.monthlyOverview(today), repo.wealthSeries(), repo.totalBalance(), repo.countConnections(), repo.saldoHistory(today)]);
      const wealth = patrimonioByMonth(series.map((p) => ({ date: p.date, total: p.total })));
      const real: Data = { first: ov.firstDate, flows: ov.rows, wealth, wealthFirst: series[0]?.date ?? null, saldo: total.total, saldoH, empty: conns === 0 && ov.rows.length === 0 && !total.hasManual };
      // Capturas de evidência (só em desenvolvimento) dos estados que os dados reais não produzem:
      // ?preview=vazio (sem conexão e sem lançamentos), sem-dados ("Sem dados neste período."), muitos-meses (dados de exemplo).
      if (__DEV__ && preview === 'vazio') setData({ ...real, empty: true });
      else if (__DEV__ && preview === 'sem-dados') setData({ ...real, flows: [], wealth: [], saldoH: { ...real.saldoH, months: [] } });
      else if (__DEV__ && preview === 'muitos-meses') {
        const months = monthsBetween(shiftMonth(current, -35), current);
        setData({ ...real, first: `${months[0]}-15`, flows: months.map((m, i) => { const d = 3000 + 1500 * Math.sin(i / 2); const r = 4000 + 800 * Math.cos(i / 3); return { month: m, receitas: Math.round(r), despesas: Math.round(d), resultado: Math.round(r - d) }; }) });
      } else if (__DEV__ && preview === 'rendimentos') {
        // Evidência: rendimento só real, só estimado e negativo nos três meses mais recentes (valores de exemplo; os
        // saldos continuam os reais e a captura os mascara).
        const ms = [...real.saldoH.months];
        const ex = [{ yieldReal: 12.34, yieldEst: 0 }, { yieldReal: 0, yieldEst: 45.67 }, { yieldReal: -8.9, yieldEst: 0 }];
        ex.forEach((y, k) => { const i = ms.length - 1 - k; if (i >= 0) ms[i] = { ...ms[i], ...y }; });
        setData({ ...real, saldoH: { ...real.saldoH, months: ms } });
      } else setData(real);
    } catch {
      setError(true);
    }
  }, [repo, today, current, preview]);
  // A tela continua montada quando T-18 abre por cima: voltar mantém critério, período e rolagem (UX-099).
  useFocusEffect(useCallback(() => { load(); }, [load, dataVersion]));

  const partial = partialFirstMonth(data?.first ?? null);
  const crit = CRITERIOS.find((c) => c.id === criterio)!;
  const flow = criterio === 'gasto' || criterio === 'receita' || criterio === 'economia';
  const saldoFirstState = false; // ux.md 0.20: os períodos ficam ativos também em "Saldo em contas"
  const saldoH = data?.saldoH;
  const estimatedBefore = saldoH?.realStart ? monthName(saldoH.realStart) : null;

  const allRows: Row[] = useMemo(() => {
    if (!data) return [];
    if (flow) {
      return data.flows.map((r) => ({
        month: r.month,
        value: criterio === 'gasto' ? r.despesas : criterio === 'receita' ? r.receitas : r.resultado,
        current: r.month === current,
        partial: partial?.month === r.month,
        estimated: false,
        since: partial?.month === r.month ? partial.since : undefined,
      }));
    }
    if (criterio === 'patrimonio') return data.wealth.map((w) => ({ month: w.month, value: w.value, current: w.month === current, partial: false, estimated: false, pointDate: w.date }));
    return data.saldoH.months.map((m) => ({ month: m.month, value: m.value, current: m.month === current, partial: partial?.month === m.month, estimated: m.estimated, since: partial?.month === m.month ? partial.since : undefined, yieldReal: m.yieldReal, yieldEst: m.yieldEst }));
  }, [data, criterio, flow, current, partial]);

  const rows = saldoFirstState ? allRows : applyPeriod(allRows, periodo, current);
  const selected = rows.find((r) => r.month === sel) ?? rows.find((r) => r.current) ?? rows[rows.length - 1];

  /** Valor como a lista mostra (tabela 3.1). */
  const valueText = (v: number) => (criterio === 'gasto' ? formatSignedAmount(-v) : criterio === 'receita' ? formatSignedAmount(v) : criterio === 'economia' ? formatSignedAmount(v) : formatBalance(v));
  const spokenValue = (v: number) => (criterio === 'economia' && v < 0 ? `menos ${balanceA11y(-v)}` : balanceA11y(Math.abs(v)));
  const untilToday = (r: Row) => (r.current && flow ? ' até hoje' : '');

  const alt = useMemo(() => {
    if (rows.length === 0) return '';
    const byVal = [...rows].sort((a, b) => a.value - b.value);
    const lo = byVal[0]; const hi = byVal[byVal.length - 1];
    const fmt = (v: number) => (criterio === 'economia' ? formatSignedAmount(v) : formatBalance(Math.abs(v)));
    const cur = rows.find((r) => r.current);
    if (rows.length === 1) return `${crit.titulo}, em ${monthName(rows[0].month)}${rows[0].current ? ', em andamento' : ''}: ${fmt(rows[0].value)}${untilToday(rows[0])}. Ainda não há variação para mostrar.`;
    return `${crit.titulo}, de ${monthName(rows[0].month)} a ${monthName(rows[rows.length - 1].month)}. Maior: ${fmt(hi.value)} em ${monthName(hi.month)}. Menor: ${fmt(lo.value)} em ${monthName(lo.month)}.`
      + (cur && flow ? ` ${capital(monthName(cur.month))} está em andamento: ${fmt(cur.value)} até hoje.` : '')
      + (criterio === 'saldo' && rows.some((r) => r.estimated) && estimatedBefore ? ` Os meses antes de ${estimatedBefore} são estimados.` : '');
  }, [rows, criterio, crit, flow, estimatedBefore]);

  const onRefresh = async () => { setRefreshing(true); await refreshAll(true); await load(); setRefreshing(false); };

  if (error) return <EmptyState icon="alert-circle-outline" title="Não foi possível carregar o resumo." actionLabel="Tentar de novo" onAction={load} />;
  if (data?.empty) {
    return <EmptyState icon="chart-box-outline" title="Ainda não há meses para mostrar." text="Conecte uma instituição ou lance um valor à mão." actionLabel="Conectar instituição" onAction={startConnect} />;
  }

  // C3-03: legenda só com o que aparece; o símbolo é o mesmo do gráfico (hachura na barra, anel no marcador).
  const legend = [
    rows.some((r) => r.current) ? (flow ? 'Mês em andamento (até hoje)' : 'Mês em andamento') : null,
    rows.some((r) => r.partial) ? 'Mês parcial' : null,
    // C3-18: em "Saldo em contas", "Real" sempre que houver mês real no período (mesmo só o mês atual).
    criterio === 'saldo' && rows.some((r) => !r.estimated) ? 'Real' : null,
    rows.some((r) => r.estimated) ? 'Estimado' : null,
  ].filter(Boolean) as string[];

  return (
    <SafeAreaView edges={['left', 'right']} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={ui.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={[ui.inner, { gap: 12 }]}>
        {/* 1. Critério (RF-017.1): escolha única, quebra linha, alvos de 48 dp. */}
        <View style={s.wrap} accessibilityRole="radiogroup" accessibilityLabel="Critério">
          {CRITERIOS.map((c) => (
            <Button key={c.id} mode={criterio === c.id ? 'contained-tonal' : 'outlined'} icon={criterio === c.id ? 'check' : undefined}
              onPress={() => { setCriterio(c.id); setSel(null); }} accessibilityRole="radio" accessibilityState={{ checked: criterio === c.id }} contentStyle={s.seg}>
              {c.label}
            </Button>
          ))}
        </View>
        {/* 2. Período (RF-017.2). Em "Saldo em contas" antes do portão, desabilitado com o motivo. */}
        <View style={s.wrap} accessibilityRole="radiogroup" accessibilityLabel="Período">
          {([[6, '6 meses'], [12, '12 meses'], ['tudo', 'Tudo']] as [Periodo, string][]).map(([v, label]) => (
            <Button key={String(v)} mode={periodo === v && !saldoFirstState ? 'contained-tonal' : 'outlined'} icon={periodo === v && !saldoFirstState ? 'check' : undefined}
              disabled={saldoFirstState}
              accessibilityHint={saldoFirstState ? 'Indisponível em Saldo em contas: por enquanto o app mostra só o saldo de hoje.' : undefined}
              onPress={() => { setPeriodo(v); setSel(null); }} accessibilityRole="radio" accessibilityState={{ checked: periodo === v, disabled: saldoFirstState }} contentStyle={s.seg}>
              {label}
            </Button>
          ))}
        </View>

        {data === null ? (
          <Skeleton lines={6} />
        ) : rows.length === 0 ? (
          <Text variant="bodyLarge">Sem dados neste período.</Text>
        ) : (
          <>
            {/* 3. Título e 4. leitura do mês selecionado */}
            <Text variant="titleMedium" accessibilityRole="header">
              {`${crit.titulo}, ${rows.length === 1 ? `em ${monthName(rows[0].month)}` : `de ${monthName(rows[0].month)} a ${monthName(rows[rows.length - 1].month)}`}`}
            </Text>
            {selected && (
              <Text variant="bodyLarge" style={ui.tabular} accessibilityLiveRegion="polite">
                {`${monthName(selected.month)}${selected.current ? ', em andamento' : ''}${selected.estimated ? ', estimado' : criterio === 'saldo' ? ', real' : ''}: ${valueText(selected.value)}${untilToday(selected)}`}
              </Text>
            )}
            {rows.length === 1 && !saldoFirstState && <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>Ainda não há variação para mostrar.</Text>}
            {/* 5. Gráfico */}
            <MonthlyChart kind={flow ? 'bar' : 'line'} points={rows} signed={criterio === 'economia'} alt={alt} onSelect={setSel} selected={sel} />
            {/* 6. Legenda, só com o que aparece */}
            {legend.length > 0 && (
              <View style={{ gap: 4 }}>
                {legend.map((l) => (
                  <View key={l} style={[ui.row, { gap: 8 }]}>
                    {l.startsWith('Mês em andamento') && flow ? (
                      <View style={[s.swatch, { borderColor: theme.colors.primary, borderRadius: 2, overflow: 'hidden' }]}>
                        <Hatch color={theme.colors.primary} width={14} height={14} gap={5} />
                      </View>
                    ) : l.startsWith('Mês em andamento') ? (
                      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary }} />
                      </View>
                    ) : !flow && (l === 'Real' || l === 'Estimado') ? (
                      // C3-18: o mesmo marcador do gráfico: cheio no real, vazado (contorno cheio) no estimado.
                      <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
                        <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: l === 'Real' ? theme.colors.primary : theme.colors.surface }} />
                      </View>
                    ) : (
                      <View style={[s.swatch, { borderColor: theme.colors.primary, borderStyle: l === 'Mês parcial' ? 'dotted' : 'dashed', borderRadius: flow ? 2 : 7 }]} />
                    )}
                    <Text variant="bodySmall">{l}</Text>
                  </View>
                ))}
              </View>
            )}
            {/* 7. Avisos do critério */}
            {criterio === 'patrimonio' && data.wealthFirst && (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{`Histórico a partir de ${br(data.wealthFirst)}. O app guarda o patrimônio desde que você conectou.`}</Text>
            )}
            {/* Saldo em contas (ux.md 0.20): aviso fixo, "Taxa ainda pouco medida" e "Como o app estima". Sem margem de erro. */}
            {criterio === 'saldo' && saldoH && (allRows.some((r) => r.estimated) ? (
              <Banner tone="info" icon="information-outline" text={`Os meses antes de ${estimatedBefore} são estimados. O valor pode ser diferente do que o banco mostrava.`} />
            ) : saldoH.connectedSince ? (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{`Histórico a partir de ${br(saldoH.connectedSince)}.`}</Text>
            ) : null)}
            {criterio === 'saldo' && saldoH?.fewDays.map((f) => (
              <Banner key={f.name} icon="alert-outline" text={`Taxa ainda pouco medida. O app tem ${f.days} ${f.days === 1 ? 'dia' : 'dias'} de saldo real de ${f.name}. Os valores estimados podem mudar enquanto a taxa é medida.`} />
            ))}
            {criterio === 'saldo' && saldoH && allRows.some((r) => r.estimated) && (
              <ListAccordion title="Como o app estima" style={{ minHeight: 48, paddingHorizontal: 0 }}>
                {[
                  ...saldoH.yieldOnlyInBalance.map((n) => `O rendimento automático de ${n} não aparece como lançamento no extrato.`),
                  `Para os meses antes de ${saldoH.connectedSince ? br(saldoH.connectedSince) : ''}, o app parte do primeiro saldo real, desfaz as transações das suas contas e desconta um rendimento estimado por uma taxa medida nos saldos reais.`,
                  ...saldoH.yieldAsTx.map((n) => `Em ${n}, o rendimento vem como lançamento do banco e é usado como está.`),
                  'Cartões de crédito e transações futuras não entram.',
                ].map((t) => <Text key={t} variant="bodyMedium" style={{ paddingVertical: 4 }}>{`• ${t}`}</Text>)}
              </ListAccordion>
            )}

            {/* 8. Lista por mês (RF-017.3), do mais recente para o mais antigo; toque abre T-18 (RF-017.4, N-10). */}
            <Text variant="titleMedium" accessibilityRole="header" style={{ marginTop: 8 }}>Por mês</Text>
            <View>
              {[...rows].reverse().map((r) => {
                const saldoSupport = criterio !== 'saldo' ? null
                  : r.current ? 'Em andamento · real'
                  : r.estimated && r.since ? `Estimado · Parcial, desde ${br(r.since)}`
                  : r.estimated ? 'Estimado' : 'Real';
                const support = saldoSupport ?? (r.current && flow ? 'Em andamento · até hoje'
                  : r.current && r.pointDate ? `Em andamento · último dado de ${br(r.pointDate)}`
                  : r.current ? 'Em andamento'
                  : r.estimated ? 'Estimado'
                  : r.since ? `Parcial · desde ${br(r.since)}`
                  : r.pointDate ? `Último dado de ${br(r.pointDate)}` : null);
                // RF-017.12 (E-16 a, N-13, N-14): rendimento do mês, com a origem; no mês atual, "até hoje".
                const yTotal = (r.yieldReal ?? 0) + (r.yieldEst ?? 0);
                const yOrigin = !r.yieldEst ? 'real' : !r.yieldReal ? 'estimado'
                  : `${formatBalance(r.yieldReal ?? 0)} real e ${formatBalance(r.yieldEst)} estimado${r.current && saldoH?.connectedSince ? ` (antes de ${br(saldoH.connectedSince)})` : ''}`;
                const yieldLine = criterio === 'saldo' ? `${r.current ? 'Rendimento até hoje' : 'Rendimento do mês'}: ${formatSignedAmount(yTotal)} · ${yOrigin}` : null;
                const label = `${monthName(r.month)}${r.current ? ', em andamento' : ''}${r.since ? `, parcial desde ${br(r.since)}` : ''}${r.estimated ? ', estimado' : criterio === 'saldo' ? ', real' : ''}, ${SPOKEN[criterio]} de ${spokenValue(r.value)}${untilToday(r)}.${yieldLine ? ` ${yieldLine}.` : ''} Abre o resumo do mês.`;
                return (
                  <View key={r.month}>
                    <TouchableRipple onPress={() => router.push({ pathname: '/resumo/mes', params: { mes: r.month } })} accessibilityRole="button" accessibilityLabel={label} style={s.row}>
                      <View style={[ui.row, { gap: 8 }]}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text variant="bodyLarge">{monthName(r.month)}</Text>
                          {support && (
                            <View style={[ui.row, { gap: 4 }]}>
                              {r.estimated && <Icon source="approximately-equal" size={16} color={theme.colors.onSurfaceVariant} />}
                              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1 }}>{support}</Text>
                            </View>
                          )}
                          {yieldLine && <Text variant="bodySmall" style={[ui.tabular, { color: theme.colors.onSurfaceVariant }]}>{yieldLine}</Text>}
                        </View>
                        {criterio === 'gasto' ? <Amount value={-r.value} variant="bodyLarge" neutral />
                          : criterio === 'receita' ? <Amount value={r.value} variant="bodyLarge" />
                          // C3-01: Economia sem seta, com sinal e em cor neutra, como o "Resultado" de T-18.
                          : criterio === 'economia' ? <Text variant="bodyLarge" style={ui.tabular}>{formatSignedAmount(r.value)}</Text>
                          : <Text variant="bodyLarge" style={ui.tabular}>{formatBalance(r.value)}</Text>}
                        <Icon source="chevron-right" size={24} color={theme.colors.onSurfaceVariant} />
                      </View>
                    </TouchableRipple>
                    <Divider />
                  </View>
                );
              })}
            </View>
            {criterio === 'saldo' && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>O rendimento mostrado aqui é só informação. Ele não entra nas receitas do Resumo.</Text>}
            {/* 9. Patrimônio: link para T-21 (RF-017.6, N-10). */}
            {criterio === 'patrimonio' && (
              <Button style={{ alignSelf: 'flex-start' }} onPress={() => router.push('/patrimonio')}>Ver detalhes do patrimônio</Button>
            )}
          </>
        )}
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  seg: { minHeight: 48 },
  row: { minHeight: 64, justifyContent: 'center', paddingVertical: 8 },
  swatch: { width: 14, height: 14, borderWidth: 2 },
});

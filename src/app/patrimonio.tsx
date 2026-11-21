// T-21 Patrimônio — RF-016.1 a .7 (UX 0.7, 0.8). Série a partir da data da conexão (RF-016.9 fora da v1).
import React, { useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Card, Divider, Icon, List, Text } from 'react-native-paper';
import { Button, ListItem } from '../ui/touch';
import { useApp } from '../state/AppContext';
import { useStartConnect } from '../state/hooks';
import { formatBalance, formatDate, formatSignedAmount, formatWhen, spDateKey } from '../domain/format';
import type { WealthPoint } from '../data/repo';
import { Banner, EmptyState, Skeleton, styles as ui, useAppTheme } from '../ui/components';
import { SafeAreaView } from 'react-native-safe-area-context';

type Period = '1' | '3' | '6' | '12' | 'all';
const DAY = 86400000;
const ms = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
const keyFrom = (t: number) => new Date(t).toISOString().slice(0, 10);
const br = (k: string) => formatDate(new Date(`${k}T15:00:00Z`));
const pctText = (a: number, b: number) => {
  if (a === 0) return '';
  const p = ((b - a) / Math.abs(a)) * 100;
  return ` (${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1).replace('.', ',')}%)`;
};

export default function Patrimonio() {
  const theme = useAppTheme();
  const { repo, dataVersion } = useApp();
  const startConnect = useStartConnect();
  const [data, setData] = useState<null | { now: Awaited<ReturnType<typeof repo.wealthNow>>; series: WealthPoint[]; connections: number; oldest: string | null }>(null);
  const [period, setPeriod] = useState<Period>('3');
  const [showList, setShowList] = useState(false);
  const [listLimit, setListLimit] = useState(30);
  const [sel, setSel] = useState<WealthPoint | null>(null);
  const [width, setWidth] = useState(0);

  // Só no build de desenvolvimento: ?preview=serie|sem-conexao|sem-investimentos com dados de exemplo (nada é gravado).
  const { preview } = useLocalSearchParams<{ preview?: string }>();
  useFocusEffect(useCallback(() => {
    (async () => {
      if (__DEV__ && preview) {
        const ex = (d: string, acc: number, inv: number, partial: { name: string; date: string }[] = []): WealthPoint => ({ date: d, accounts: acc, investments: inv, total: acc + inv, partial });
        const series = preview === 'serie' ? [
          ex('2026-10-20', 5000, 20000), ex('2026-10-21', 5100, 20020), ex('2026-10-22', 4900, 20040, [{ name: 'Banco Exemplo', date: '2026-10-21' }]),
          ex('2026-10-27', 4700, 20100), ex('2026-11-03', 6200, 20150), ex('2026-11-10', 5900, 20210), ex('2026-11-17', 5800, 20260), ex('2026-11-18', 5850, 20270),
        ] : [];
        const inv = preview === 'sem-investimentos' ? 0 : 20270;
        setData({
          now: { accounts: 5850, manual: 0, investments: inv, total: 5850 + inv, byConnection: preview === 'serie' ? [{ item_id: 'exemplo-1', name: 'Banco Exemplo', investments: 20270, autoInvested: 0, origin: '2026-11-18T20:00:00Z' }] : [] },
          series, connections: preview === 'sem-conexao' ? 0 : 1, oldest: '2026-11-18T20:00:00Z',
        });
        return;
      }
      const [now, series, conns] = await Promise.all([repo.wealthNow(), repo.wealthSeries(), repo.listConnections()]);
      const origins = conns.map((c) => c.origin_updated_at).filter(Boolean).sort() as string[];
      setData({ now, series, connections: conns.length, oldest: origins[0] ?? null });
    })();
  }, [repo, dataVersion, preview]));

  const today = spDateKey(new Date());
  const points = useMemo(() => {
    if (!data) return [];
    if (period === 'all') return data.series;
    const start = new Date(ms(today));
    start.setUTCMonth(start.getUTCMonth() - Number(period));
    const from = keyFrom(start.getTime());
    return data.series.filter((p) => p.date >= from);
  }, [data, period, today]);

  if (!data) return <ScrollView contentContainerStyle={ui.scroll}><View style={ui.inner}><Skeleton lines={5} /></View></ScrollView>;
  if (data.connections === 0) {
    return <EmptyState icon="chart-line" title="Conecte uma instituição para acompanhar seu patrimônio." actionLabel="Conectar instituição" onAction={startConnect} />;
  }
  const { now } = data;
  const first = points[0];
  const last = points[points.length - 1];
  const periodStartKey = period === 'all' ? null : (() => { const d = new Date(ms(today)); d.setUTCMonth(d.getUTCMonth() - Number(period)); return keyFrom(d.getTime()); })();
  const firstEver = data.series[0]?.date ?? null;
  const historyNote = firstEver && (period === 'all' || (periodStartKey && periodStartKey < firstEver));

  // Gráfico (barras e linhas desenhadas com View; sem biblioteca).
  const H = 200; const PAD = 8;
  const vals = points.map((p) => p.total);
  const min = Math.min(...vals); const max = Math.max(...vals);
  const t0 = first ? ms(first.date) : 0; const t1 = last ? ms(last.date) : 1;
  const xy = (p: WealthPoint) => ({
    x: PAD + (t1 === t0 ? (width - 2 * PAD) / 2 : ((ms(p.date) - t0) / (t1 - t0)) * (width - 2 * PAD)),
    y: PAD + (max === min ? (H - 2 * PAD) / 2 : (1 - (p.total - min) / (max - min)) * (H - 2 * PAD)),
  });
  const alt = first && last
    ? `Patrimônio total de ${br(first.date)} a ${br(last.date)}. Começou em ${formatBalance(first.total)} e terminou em ${formatBalance(last.total)}: variação de ${formatSignedAmount(last.total - first.total)}${pctText(first.total, last.total).replace(' (', ', ').replace(')', '')}. Menor valor, ${formatBalance(min)} em ${br(points[vals.indexOf(min)].date)}. Maior valor, ${formatBalance(max)} em ${br(points[vals.indexOf(max)].date)}. ${points.length} ${points.length === 1 ? 'dia' : 'dias'} com dado.`
    : '';
  const pickAt = (x: number) => {
    if (!points.length) return;
    let best = points[0]; let bd = Infinity;
    for (const p of points) { const d = Math.abs(xy(p).x - x); if (d < bd) { bd = d; best = p; } }
    setSel(best);
  };

  // Lista de valores com os trechos "Sem dados de … a …".
  const listRows: ({ kind: 'pt'; p: WealthPoint } | { kind: 'gap'; from: string; to: string })[] = [];
  const desc = [...points].reverse();
  desc.forEach((p, i) => {
    listRows.push({ kind: 'pt', p });
    const older = desc[i + 1];
    if (older && (ms(p.date) - ms(older.date)) / DAY > 1) listRows.push({ kind: 'gap', from: keyFrom(ms(older.date) + DAY), to: keyFrom(ms(p.date) - DAY) });
  });
  const hasInvestments = now.byConnection.some((c) => c.investments > 0);

  return (
    <SafeAreaView edges={['left', 'right']} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={ui.scroll}>
      <View style={[ui.inner, { gap: 12 }]}>
        {/* 1. Patrimônio atual (RF-016.1): igual ao do Início. */}
        <Card mode="contained">
          <Card.Content style={{ gap: 2 }}>
            <Text variant="labelLarge">Patrimônio total</Text>
            <Text variant="displaySmall" style={ui.tabular}>{formatBalance(now.total)}</Text>
            {data.oldest && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{`Dados de ${formatWhen(new Date(data.oldest))}`}</Text>}
            <Text variant="bodyMedium" style={ui.tabular}>{`Saldo em contas ${formatBalance(now.accounts)}`}</Text>
            {/* C2-11 (revisão 3): sem investimentos, a linha não aparece; o aviso abaixo explica. */}
            {hasInvestments && <Text variant="bodyMedium" style={ui.tabular}>{`Investimentos ${formatBalance(now.investments)}`}</Text>}
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Faturas de cartão não são descontadas.</Text>
          </Card.Content>
        </Card>
        {!hasInvestments && (
          // RF-016.6 [NV V-1]
          <Banner icon="information-outline" tone="info" text="Nenhuma das suas conexões trouxe investimentos. Se você tem investimentos em outra instituição, conecte-a." actionLabel="Conectar instituição" onAction={startConnect} />
        )}

        {/* 2. Período (RF-016.2) */}
        {/* Botões de escolha única que quebram linha (nunca cortam o texto nem viram rolagem escondida). */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Período">
          {([['1', '1 mês'], ['3', '3 meses'], ['6', '6 meses'], ['12', '1 ano'], ['all', 'Tudo']] as [Period, string][]).map(([v, label]) => (
            <Button
              key={v}
              mode={period === v ? 'contained-tonal' : 'outlined'}
              icon={period === v ? 'check' : undefined}
              onPress={() => { setPeriod(v); setSel(null); setListLimit(30); }}
              accessibilityRole="radio"
              accessibilityState={{ checked: period === v }}
              contentStyle={s.seg}
            >
              {label}
            </Button>
          ))}
        </View>

        {points.length === 0 ? (
          <Text variant="bodyLarge">Sem dados neste período.</Text>
        ) : (
          <>
            {/* 3. Variação (RF-016.3) */}
            {points.length < 2 ? (
              <Text variant="bodyLarge">Ainda não há variação para mostrar.</Text>
            ) : (
              <View>
                <Text variant="bodyMedium">{`Variação de ${br(first!.date)} a ${br(last!.date)}`}</Text>
                <View style={[ui.row, { gap: 4 }]}>
                  <Icon source={last!.total >= first!.total ? 'arrow-up' : 'arrow-down'} size={20} color={last!.total >= first!.total ? theme.colors.entrada : theme.colors.saida} />
                  <Text variant="titleLarge" style={[ui.tabular, { color: last!.total >= first!.total ? theme.colors.entrada : theme.colors.saida }]}>
                    {`${formatSignedAmount(last!.total - first!.total)}${pctText(first!.total, last!.total)}`}
                  </Text>
                </View>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>É a variação total: inclui o que você aplicou, resgatou e o que rendeu.</Text>
              </View>
            )}

            {/* 4. Gráfico */}
            <Text variant="bodySmall" style={{ minHeight: 18 }} accessibilityLiveRegion="polite">{sel ? `${br(sel.date)}: ${formatBalance(sel.total)}` : ' '}</Text>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text variant="labelSmall" style={ui.tabular}>{formatBalance(max)}</Text>
            </View>
            <View
              style={{ height: H, borderLeftWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.outlineVariant }}
              onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
              accessible
              accessibilityRole="image"
              accessibilityLabel={alt}
              onStartShouldSetResponder={() => true}
              onResponderGrant={(e) => pickAt(e.nativeEvent.locationX)}
              onResponderMove={(e) => pickAt(e.nativeEvent.locationX)}
            >
              {width > 0 && points.map((p, i) => {
                const a = xy(p);
                const prev = points[i - 1];
                const seg = prev ? (() => {
                  const b = xy(prev); const dx = a.x - b.x; const dy = a.y - b.y;
                  const len = Math.sqrt(dx * dx + dy * dy); const ang = Math.atan2(dy, dx);
                  const gap = (ms(p.date) - ms(prev.date)) / DAY > 1;
                  return <View key={`s${p.date}`} style={{ position: 'absolute', left: (a.x + b.x) / 2 - len / 2, top: (a.y + b.y) / 2 - 1, width: len, height: 0, borderTopWidth: 2, borderStyle: gap ? 'dashed' : 'solid', borderColor: theme.colors.primary, transform: [{ rotate: `${ang}rad` }] }} />;
                })() : null;
                return (
                  <React.Fragment key={p.date}>
                    {seg}
                    <View style={{ position: 'absolute', left: a.x - 4, top: a.y - 4, width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: p.partial.length ? theme.colors.surface : theme.colors.primary }} />
                  </React.Fragment>
                );
              })}
            </View>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text variant="labelSmall" style={ui.tabular}>{formatBalance(min)}</Text>
            </View>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text variant="labelSmall">{br(first!.date)}</Text>
              {points.length > 1 && <Text variant="labelSmall">{br(last!.date)}</Text>}
            </View>

            {/* 5. Aviso de histórico (RF-016.9 fora da v1) */}
            {historyNote && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{`Histórico a partir de ${br(firstEver!)}. O app guarda um valor por dia desde que você conectou.`}</Text>}

            {/* 6. Alternativa em texto */}
            <Button mode="outlined" onPress={() => { setShowList(!showList); AccessibilityInfo.announceForAccessibility?.(showList ? 'Lista fechada' : 'Lista de valores aberta'); }} style={{ alignSelf: 'flex-start' }}>
              {showList ? 'Ocultar valores por data' : `Ver valores por data (${points.length})`}
            </Button>
            {showList && (
              <View>
                {listRows.slice(0, listLimit).map((r) => r.kind === 'gap' ? (
                  <Text key={`g${r.from}`} variant="bodySmall" style={{ paddingVertical: 8, color: theme.colors.onSurfaceVariant }}>{`Sem dados de ${br(r.from)} a ${br(r.to)}`}</Text>
                ) : (
                  <View key={r.p.date} style={{ paddingVertical: 8 }}>
                    <Text variant="bodyLarge" style={ui.tabular}>{`${br(r.p.date)} · Patrimônio total ${formatBalance(r.p.total)}`}</Text>
                    <Text variant="bodySmall" style={[ui.tabular, { color: theme.colors.onSurfaceVariant }]}>{`Contas ${formatBalance(r.p.accounts)} · Investimentos ${formatBalance(r.p.investments)}`}</Text>
                    {r.p.partial.map((x) => <Text key={x.name} variant="bodySmall" style={{ color: theme.colors.atencao }}>{`Inclui dado de ${br(x.date)} de ${x.name}`}</Text>)}
                    <Divider style={{ marginTop: 8 }} />
                  </View>
                ))}
                {listRows.length > listLimit && <Button onPress={() => setListLimit(listLimit + 30)}>Carregar mais</Button>}
              </View>
            )}
          </>
        )}

        {/* 7. Por instituição */}
        {now.byConnection.length > 0 && <Text variant="titleMedium" accessibilityRole="header" style={{ marginTop: 8 }}>Por instituição</Text>}
        {now.byConnection.map((c) => (
          <View key={c.item_id}>
            <ListItem
              title={c.name}
              description={`Investimentos ${formatBalance(c.investments)}${c.origin ? ` · dados de ${formatWhen(new Date(c.origin))}` : ''}`}
              right={(p) => <List.Icon {...p} icon="chevron-right" />}
              onPress={() => router.push(`/conexoes/${c.item_id}`)}
              style={{ minHeight: 56 }}
            />
            {c.autoInvested > 0 && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 16 }}>{`Rendendo na conta: ${formatBalance(c.autoInvested)}. Já contado em Saldo em contas.`}</Text>}
          </View>
        ))}
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({ seg: { minHeight: 48 } });

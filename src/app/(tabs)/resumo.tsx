// T-18 Resumo mensal — RF-008.1 a RF-008.9 (UX 0.7 a 0.16) e o aviso da fatura de R-2.1 (requisitos v1.20).
import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { openExtrato as goExtrato } from '../../state/nav';
import { Card, Divider, Icon, ProgressBar, Text, TouchableRipple } from 'react-native-paper';
import { Button, IconButton } from '../../ui/touch';
import { useApp } from '../../state/AppContext';
import { categoryById } from '../../domain/categories';
import { balanceA11y, formatBalance, formatCount, formatMonth, formatSignedAmount, isMaskingValues, setMaskValues, spDateKey } from '../../domain/format';
import type { MonthSummary } from '../../data/repo';
import { Amount, Banner, EmptyState, Skeleton, styles as ui, useAppTheme } from '../../ui/components';

const shiftMonth = (ym: string, d: number) => {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
};
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);
/** UX 0.15 (C2-04): despesa maior que zero que arredonda para 0% vira "menos de 1%". */
const pctLabel = (part: number, total: number) => { const p = pct(part, total); return p === 0 && part > 0 ? 'menos de 1%' : `${p}%`; };

export default function Resumo() {
  const theme = useAppTheme();
  const { repo, dataVersion, refreshAll } = useApp();
  // Fonte grande: o valor e o percentual descem para baixo do nome, para o nome não quebrar no meio da palavra.
  const stacked = useWindowDimensions().fontScale >= 1.5;
  const { mascarar, mes, preview } = useLocalSearchParams<{ mascarar?: string; mes?: string; preview?: string }>();
  if (__DEV__ && mascarar === '1' && !isMaskingValues()) setMaskValues(true);
  const today = spDateKey(new Date());
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(mes && /^\d{4}-\d{2}$/.test(mes) ? mes : thisMonth);
  const [data, setData] = useState<MonthSummary | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const summary = await repo.monthSummary(month, today);
      // Captura de evidência (só em desenvolvimento): ?preview=fatura1 / fatura2 força o aviso da fatura (R-2.1),
      // porque nos dados reais todos os pagamentos de fatura têm par.
      if (__DEV__ && preview?.startsWith('fatura')) summary.unpairedBills = Number(preview.slice(6)) || 1;
      setData(summary);
    } catch {
      setError(true);
    }
  }, [repo, month, today, preview]);
  useFocusEffect(useCallback(() => { load(); }, [load, dataVersion]));

  const [y, m] = month.split('-').map(Number);
  const monthLabel = formatMonth(y, m);
  const from = `${month}-01`;
  const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const openExtrato = (category?: string) => goExtrato({ from, to, ...(category ? { category } : {}) });

  let body: React.ReactNode;
  if (error) body = <EmptyState icon="alert-circle-outline" title="Não foi possível carregar o resumo." actionLabel="Tentar de novo" onAction={load} />;
  else if (!data) body = <Skeleton lines={5} />;
  else if (data.movementCount === 0) body = <EmptyState icon="calendar-blank-outline" title={`Sem movimentações em ${monthLabel}.`} />;
  else {
    const d = data;
    const positives = d.byCategory.filter((c) => c.total > 0);
    const negatives = d.byCategory.filter((c) => c.total < 0).sort((a, b) => a.total - b.total);
    const positiveTotal = positives.reduce((acc, c) => acc + c.total, 0);
    body = (
      <>
        <Card mode="contained">
          <Card.Content style={{ gap: 6 }}>
            <View style={s.line}><Text variant="titleMedium">Receitas</Text><Amount value={d.receitas} variant="titleMedium" /></View>
            <View style={s.line}><Text variant="titleMedium">Despesas</Text><Amount value={-d.despesas} variant="titleMedium" /></View>
            <Divider />
            <View style={s.line}>
              <Text variant="titleMedium" style={{ fontWeight: '600' }}>Resultado</Text>
              <Text variant="titleMedium" style={[ui.tabular, { fontWeight: '600' }]} accessibilityLabel={`Resultado, ${d.resultado < 0 ? 'negativo ' : ''}${formatBalance(Math.abs(d.resultado)).replace('R$ ', '')} reais`}>{formatSignedAmount(d.resultado)}</Text>
            </View>
            {/* RF-008.3 (UX 0.7): rendimentos já estão dentro de "Receitas". */}
            {d.rendimentos > 0 && (
              // C2-14 (revisão 3): abre o Extrato do mês filtrado por "Rendimentos"; a seta indica o toque.
              <TouchableRipple onPress={() => openExtrato('rendimentos')} accessibilityRole="button" accessibilityHint="Abre o extrato do mês com os rendimentos" style={s.minTouch}>
                <View style={s.navRow}>
                  <Text variant="bodyMedium" style={{ flex: 1 }}>{`Das receitas, ${formatBalance(d.rendimentos)} são rendimentos.`}</Text>
                  <Icon source="chevron-right" size={24} color={theme.colors.onSurfaceVariant} />
                </View>
              </TouchableRipple>
            )}
          </Card.Content>
        </Card>
        {/* RF-008.1: conferível com o extrato do mesmo mês. */}
        <View style={[s.line, { flexWrap: 'wrap' }]}>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1 }}>Receitas − despesas = resultado</Text>
          <Button compact onPress={() => openExtrato()}>Ver no extrato</Button>
        </View>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          Transferências entre suas contas, aplicações e resgates de investimentos, transações ocultas e o que você marcou como fora do Resumo não entram.
          {/* UX 0.17 (RF-008.10) */}
          {d.refunds.count > 0 ? ' Estornos de compras no cartão reduzem as despesas, em vez de contar como receita.' : ''}
        </Text>
        {/* UX 0.8 / C2-05: frase das futuras com "Ver no extrato", que abre o mês com o grupo "Futuras" aberto. */}
        {d.futureCount > 0 && (
          <View style={[s.line, { flexWrap: 'wrap' }]}>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, flexShrink: 1 }}>{`${formatCount(d.futureCount)} ${d.futureCount === 1 ? 'transação futura deste mês entra' : 'transações futuras deste mês entram'} quando a data chegar.`}</Text>
            <Button compact onPress={() => goExtrato({ from, to, futuras: '1' })}>Ver no extrato</Button>
          </View>
        )}


        {/* R-3: investimentos à parte. */}
        {(d.aplicado > 0 || d.resgatado > 0) && (
          <TouchableRipple onPress={() => openExtrato('investimentos')} accessibilityRole="button" accessibilityHint="Abre o extrato do mês com os investimentos" style={s.minTouch}>
            {/* UX 0.16 (C2-10): seta de navegação no fim da linha que abre o Extrato. */}
            <View style={s.navRow}>
              <View style={{ gap: 2, flex: 1 }}>
                <Text variant="titleSmall">Investimentos no mês</Text>
                <Text variant="bodyMedium" style={ui.tabular}>{`Aplicado ${formatSignedAmount(-d.aplicado)} · Resgatado ${formatSignedAmount(d.resgatado)}`}</Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Não conta como receita nem despesa.</Text>
              </View>
              <Icon source="chevron-right" size={24} color={theme.colors.onSurfaceVariant} />
            </View>
          </TouchableRipple>
        )}
        {/* RF-008.8 (UX 0.14, E-9 a): só com lançamento marcado no mês; abre o Extrato do mês com "Só fora do Resumo". */}
        {d.outOfSummary.count > 0 && (
          <TouchableRipple onPress={() => goExtrato({ from, to, only: 'out' })} accessibilityRole="button" accessibilityHint="Abre o extrato do mês com os lançamentos fora do Resumo" style={s.minTouch}>
            <View style={s.navRow}>
              <View style={{ gap: 2, flex: 1 }}>
                <Text variant="titleSmall" style={ui.tabular}>
                  {`Fora do Resumo: ${formatBalance(d.outOfSummary.saidas)} (${formatCount(d.outOfSummary.count)} ${d.outOfSummary.count === 1 ? 'lançamento' : 'lançamentos'})${d.outOfSummary.entradas > 0 ? ` e ${formatBalance(d.outOfSummary.entradas)} em entradas` : ''}`}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>Não conta como receita nem despesa.</Text>
              </View>
              <Icon source="chevron-right" size={24} color={theme.colors.onSurfaceVariant} />
            </View>
          </TouchableRipple>
        )}
        <Button compact onPress={() => router.push('/patrimonio')} style={{ alignSelf: 'flex-start' }}>Ver evolução do patrimônio</Button>

        {/* R-2.1 (requisitos v1.20) e UX 0.16 (T-18 item 6, UX-044): só no mês com pagamento de fatura sem par; sem dispensar. */}
        {d.unpairedBills > 0 && (
          <Banner
            icon="credit-card-outline"
            text={d.unpairedBills === 1
              ? '1 pagamento de fatura deste mês não foi reconhecido como transferência. Marque para o gasto do cartão não contar duas vezes.'
              : `${formatCount(d.unpairedBills)} pagamentos de fatura deste mês não foram reconhecidos como transferência. Marque para o gasto do cartão não contar duas vezes.`}
            actionLabel="Ver no extrato"
            onAction={() => goExtrato({ from, to, only: 'bill' })}
          />
        )}

        <Text variant="titleMedium" accessibilityRole="header" style={{ marginTop: 8 }}>{`Gastos por categoria em ${monthLabel}`}</Text>
        {d.byCategory.length === 0 ? (
          <Text variant="bodyMedium">Sem despesas neste mês.</Text>
        ) : (
          // UX 0.17 (RF-008.10): cada categoria com o líquido (gastos − estornos). Percentuais sobre as categorias com
          // líquido positivo (somam 100%). Estornos maiores que os gastos: "+R$ X", sem barra nem percentual, no fim (E-13 a).
          [...positives, ...negatives].map((c) => {
            const cat = categoryById(c.category);
            const neg = c.total < 0;
            const p = neg ? 0 : pct(c.total, positiveTotal);
            const refundNote = neg
              ? 'Estornos maiores que os gastos neste mês.'
              : c.refunds.count > 0
                ? `Já com ${formatCount(c.refunds.count)} ${c.refunds.count === 1 ? 'estorno descontado' : 'estornos descontados'} (${formatBalance(c.refunds.total)}).`
                : null;
            const valueText = neg ? `+${formatBalance(-c.total)}` : `${formatBalance(c.total)} · ${pctLabel(c.total, positiveTotal)}`;
            const a11y = neg ? `${cat.name}, mais ${balanceA11y(-c.total)}. ${refundNote}` : `${cat.name}, ${formatBalance(c.total)}, ${pctLabel(c.total, positiveTotal)} das despesas${refundNote ? `. ${refundNote}` : ''}`;
            return (
              <TouchableRipple key={c.category ?? 'none'} onPress={() => openExtrato(c.category ?? 'none')} accessibilityRole="button" accessibilityLabel={a11y} style={s.catRow}>
                <View style={{ gap: 4 }}>
                  <View style={stacked ? { gap: 2 } : s.line}>
                    <View style={[ui.row, { gap: 8, flexShrink: 1 }]}>
                      <Icon source={cat.icon} size={20} color={theme.colors.onSurfaceVariant} />
                      <Text variant="bodyLarge" style={{ flexShrink: 1 }}>{cat.name}</Text>
                    </View>
                    <Text variant="bodyLarge" style={[ui.tabular, stacked && { paddingLeft: 28 }, neg && { color: theme.colors.onSurfaceVariant }]}>{valueText}</Text>
                  </View>
                  {refundNote && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, paddingLeft: 28 }}>{refundNote}</Text>}
                  {!neg && (
                    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                      <ProgressBar progress={p / 100} color={theme.colors.primary} style={{ height: 6, borderRadius: 3 }} />
                    </View>
                  )}
                </View>
              </TouchableRipple>
            );
          })
        )}

        {/* UX 0.15 (C2-03): o aviso de rendimentos fica no fim, depois de "Gastos por categoria". */}
        {/* R-5 (RF-008.3): aviso fixo, sem fechar. */}
        {d.yieldWarnings.length > 0 && (
          <View style={[s.notice, { backgroundColor: theme.colors.surfaceVariant }]} accessible accessibilityLabel={`${d.yieldWarnings.map((n) => `${n}: rendimentos desta instituição não identificados.`).join(' ')} Eles não entram nas receitas. O app não estima valores.`}>
            <Icon source="information-outline" size={20} color={theme.colors.onSurfaceVariant} />
            <View style={{ flex: 1, gap: 4 }}>
              {d.yieldWarnings.map((n) => <Text key={n} variant="bodyMedium">{`${n}: rendimentos desta instituição não identificados.`}</Text>)}
              <Text variant="bodyMedium">Eles não entram nas receitas. O app não estima valores.</Text>
            </View>
          </View>
        )}
      </>
    );
  }

  return (
    <ScrollView contentContainerStyle={ui.scroll} refreshControl={<RefreshControl refreshing={false} onRefresh={() => { refreshAll(true).finally(load); }} />}>
      <View style={[ui.inner, { gap: 12 }]}>
        <View style={s.line}>
          <IconButton icon="chevron-left" accessibilityLabel="Mês anterior" onPress={() => setMonth(shiftMonth(month, -1))} />
          <Text variant="titleLarge" accessibilityRole="header" accessibilityLiveRegion="polite">{monthLabel}</Text>
          <IconButton icon="chevron-right" accessibilityLabel="Próximo mês" disabled={month >= thisMonth} onPress={() => setMonth(shiftMonth(month, 1))} />
        </View>
        {body}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  minTouch: { minHeight: 48, justifyContent: 'center' },
  notice: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12 },
  catRow: { minHeight: 56, justifyContent: 'center', paddingVertical: 6 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

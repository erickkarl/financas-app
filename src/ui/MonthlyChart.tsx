// T-23 (UX 0.19): gráfico por mês. Barras para totais do mês (Gasto, Receita, Economia); linha com um marcador por mês
// para valores num momento (Patrimônio, Saldo em contas). Desenhado com Views (o app não usa SVG), como T-21.
// Mês em andamento: hachura diagonal e contorno (barra) ou anel (marcador). Mês parcial: pontilhado. Estimado: vazado e
// tracejado. A diferença é sempre de forma, não só de cor. O gráfico é um elemento só para o leitor de tela.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { Text } from 'react-native-paper';
import { formatBalance, formatSignedAmount } from '../domain/format';
import { axisTicks } from '../domain/monthly';
import { styles as ui, useAppTheme } from './components';

export type ChartPoint = { month: string; value: number; current: boolean; partial: boolean; estimated: boolean };

const H = 180;
const MIN_BAR = 12;

/**
 * Hachura diagonal: tiras finas a 45°, espaçadas ao longo da largura e da altura, recortadas pela caixa.
 * C3-06: cobre a caixa inteira, de qualquer altura (barra baixa ou alta, ou o símbolo da legenda).
 */
export function Hatch({ color, width, height, gap = 7 }: { color: string; width: number; height: number; gap?: number }) {
  const len = (width + height) * 1.5;
  const items: number[] = [];
  for (let c = -height; c <= width + height; c += gap) items.push(c);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden' }}>
      {items.map((c) => (
        <View key={c} style={{ position: 'absolute', left: c - len / 2, top: height / 2 - 1, width: len, height: 2, backgroundColor: color, transform: [{ rotate: '-45deg' }] }} />
      ))}
    </View>
  );
}

export function MonthlyChart({ kind, points, signed, alt, onSelect, selected = null }: {
  kind: 'bar' | 'line';
  points: ChartPoint[];
  /** Economia: barras para cima e para baixo do zero, com "R$ 0,00" marcado. */
  signed: boolean;
  alt: string;
  onSelect: (month: string) => void;
  /** ux.md 0.20: o mês tocado ganha contorno mais grosso. */
  selected?: string | null;
}) {
  const theme = useAppTheme();
  const { fontScale } = useWindowDimensions();
  // Largura da linha inteira; a do gráfico desconta a margem do "R$ 0,00" (a linha não muda de tamanho ao trocar
  // de critério, então a conta é feita aqui, e não no onLayout).
  const [rowW, setRowW] = useState(0);
  const scroll = useRef<{ scrollToEnd: (o?: { animated?: boolean }) => void } | null>(null);
  // Em Economia, a margem esquerda leva os três rótulos do eixo (maior, R$ 0,00 e menor), fora das barras (0.20).
  const gutter = 88 * Math.min(Math.max(fontScale, 1), 2);
  const width = Math.max(0, rowW - (signed ? gutter : 0));
  const n = points.length;
  const values = points.map((p) => p.value);
  const maxV = Math.max(...values, signed ? 0 : -Infinity);
  const minV = Math.min(...values, signed ? 0 : Infinity);
  const top = kind === 'bar' && !signed ? Math.max(maxV, 0) : maxV;
  const bottom = kind === 'bar' && !signed ? 0 : minV;
  const span = top - bottom || 1;
  const slot = width > 0 ? Math.max(MIN_BAR + 4, width / Math.max(n, 1)) : 0;
  const inner = Math.max(width, slot * n);
  // C3-04: com um ponto só (ou todos iguais), o marcador fica a meia altura, longe do eixo e dos rótulos.
  const flat = kind === 'line' && top === bottom;
  // Folga dentro da área do gráfico para o anel do mês tocado e o do mês em andamento não serem cortados (0.20).
  const padTop = kind === 'line' ? 14 : 6;
  const padBottom = kind === 'line' ? 14 : signed ? 6 : 0;
  const y = (v: number) => (flat ? H / 2 : padTop + (1 - (v - bottom) / span) * (H - padTop - padBottom));
  const zeroY = y(0);
  const fmt = (v: number) => (signed ? formatSignedAmount(v) : formatBalance(kind === 'bar' ? Math.abs(v) : v));
  const maxIdx = values.indexOf(Math.max(...values));
  const minIdx = values.indexOf(Math.min(...values));
  const ticks = useMemo(() => axisTicks(points.map((p) => p.month), slot, Math.max(fontScale, 1)), [points, slot, fontScale]);
  // C3-08: o gráfico rolável abre no mês mais recente (ao abrir e ao trocar de critério ou de período).
  useEffect(() => {
    if (inner <= width + 1) return;
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 0);
    return () => clearTimeout(t);
  }, [inner, width, points]);
  const pick = (x: number) => {
    if (!slot || n === 0) return;
    const i = Math.min(n - 1, Math.max(0, Math.floor(x / slot)));
    onSelect(points[i].month);
  };

  const bars = useMemo(() => points.map((p, i) => {
    const x = i * slot;
    const bw = Math.max(MIN_BAR - 2, slot * 0.6);
    const yTop = Math.min(y(p.value), zeroY);
    const h = Math.max(Math.abs(y(p.value) - zeroY), 1);
    const fill = p.current || p.partial ? 'transparent' : theme.colors.primary;
    return (
      <View key={p.month} pointerEvents="none" style={{ position: 'absolute', left: x, top: 0, width: slot, height: H }}>
        <View style={{ position: 'absolute', left: (slot - bw) / 2, top: yTop, width: bw, height: h, backgroundColor: fill, borderWidth: p.current || p.partial ? 2 : 0, borderStyle: p.partial ? 'dotted' : 'solid', borderColor: theme.colors.primary, overflow: 'hidden' }}>
          {p.current && <Hatch color={theme.colors.primary} width={bw} height={h} />}
        </View>
        {/* Mês tocado: contorno mais grosso em volta da barra, na cor do texto (forma, não só cor). */}
        {p.month === selected && <View pointerEvents="none" style={{ position: 'absolute', left: (slot - bw) / 2 - 4, top: yTop - 4, width: bw + 8, height: h + 8, borderWidth: 3, borderColor: theme.colors.onSurface, borderRadius: 3 }} />}
      </View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [points, slot, theme, selected]);

  const line = useMemo(() => {
    const xy = (i: number) => ({ x: i * slot + slot / 2, y: y(points[i].value) });
    return points.map((p, i) => {
      const a = xy(i);
      const prevP = points[i - 1];
      let seg: React.ReactNode = null;
      if (prevP) {
        const b = xy(i - 1);
        const dx = a.x - b.x; const dy = a.y - b.y;
        const len = Math.sqrt(dx * dx + dy * dy); const ang = Math.atan2(dy, dx);
        // Buraco no meio da série (mês sem ponto) ou estimado: tracejado.
        const [py, pm] = prevP.month.split('-').map(Number); const [cy, cm] = p.month.split('-').map(Number);
        const gap = (cy * 12 + cm) - (py * 12 + pm) > 1;
        seg = <View key={`s${p.month}`} pointerEvents="none" style={{ position: 'absolute', left: (a.x + b.x) / 2 - len / 2, top: (a.y + b.y) / 2 - 1, width: len, height: 0, borderTopWidth: 2, borderStyle: gap || p.estimated || prevP.estimated ? 'dashed' : 'solid', borderColor: theme.colors.primary, transform: [{ rotate: `${ang}rad` }] }} />;
      }
      return { seg, marker: (
        <React.Fragment key={p.month}>
          {p.current && <View pointerEvents="none" style={{ position: 'absolute', left: a.x - 9, top: a.y - 9, width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.colors.primary }} />}
          <View pointerEvents="none" style={{ position: 'absolute', left: a.x - 5, top: a.y - 5, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: theme.colors.primary, backgroundColor: p.estimated ? theme.colors.surface : theme.colors.primary }} />
          {p.month === selected && <View pointerEvents="none" style={{ position: 'absolute', left: a.x - 13, top: a.y - 13, width: 26, height: 26, borderRadius: 13, borderWidth: 3, borderColor: theme.colors.onSurface }} />}
        </React.Fragment>
      ) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, slot, theme, selected]);
  // C3-19: todas as linhas primeiro e os marcadores por cima; o miolo do marcador vazado (cor da superfície) cobre o
  // traço, que para na borda do marcador.
  const lineNodes = [...line.map((x) => x.seg), ...line.map((x) => x.marker)];

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={alt} style={signed ? { paddingVertical: 8 * Math.max(fontScale, 1) } : undefined}>
      {/* Eixo (0.20): barras com o maior mês em cima e "R$ 0,00" na base; Economia com os três rótulos na margem;
          linhas com o maior e o menor valor. */}
      {!signed && <Text variant="labelSmall" style={ui.tabular}>{n ? fmt(points[maxIdx].value) : ''}</Text>}
      {/* C3-11: em Economia, "R$ 0,00" fica numa margem própria à esquerda, na altura da linha do zero, sem cobrir barra. */}
      <View style={{ flexDirection: 'row' }} onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
      {signed && (
        <View style={{ width: gutter, height: H }}>
          {n > 0 && gutterLabels(y(points[maxIdx].value), zeroY, y(points[minIdx].value), 16 * Math.max(fontScale, 1)).map((t, k) => (
            <Text key={k} variant="labelSmall" numberOfLines={1} style={[ui.tabular, { position: 'absolute', right: 4, top: t }]}>
              {k === 0 ? fmt(points[maxIdx].value) : k === 1 ? 'R$\u00a00,00' : fmt(points[minIdx].value)}
            </Text>
          ))}
        </View>
      )}
      <View style={{ flex: 1 }}>
        <ScrollView
          ref={scroll as never}
          horizontal
          scrollEnabled={inner > width + 1}
          showsHorizontalScrollIndicator={inner > width + 1}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
          <View style={{ width: inner }}>
            {/* Tocar ou arrastar escolhe o mês mais próximo (só leitura; a lista é o caminho sem gesto). */}
            <View
              style={{ height: H, borderLeftWidth: 1, borderBottomWidth: signed ? 0 : 1, borderColor: theme.colors.outlineVariant }}
              onStartShouldSetResponder={() => true}
              onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
              onResponderMove={(e) => pick(e.nativeEvent.locationX)}
            >
              {signed && <View style={{ position: 'absolute', left: 0, right: 0, top: zeroY, borderTopWidth: 1, borderColor: theme.colors.outline }} />}
              {width > 0 && (kind === 'bar' ? bars : lineNodes)}

            </View>
            {/* C3-15: rótulos do eixo numa linha só, sem se tocar e sem sair da borda. Com colunas estreitas ("Tudo") ou
                fonte grande, alguns meses ficam sem rótulo, contando do mais recente. */}
            <View style={{ height: 18 * Math.max(fontScale, 1) + 6, marginTop: 2 }}>
              {ticks.map((t) => {
                // A conta de colisão usa a largura estimada; a caixa de desenho tem folga para o texto nunca ser cortado.
                const cx = t.i * slot + slot / 2;
                const bw = t.w + 24;
                const left = Math.min(Math.max(0, cx - bw / 2), Math.max(0, inner - bw));
                const align = left === 0 && cx - bw / 2 < 0 ? 'left' : left < cx - bw / 2 ? 'right' : 'center';
                return (
                  <Text key={points[t.i].month} variant="labelSmall" numberOfLines={1} style={{ position: 'absolute', left, width: bw, textAlign: align }}>
                    {t.text}
                  </Text>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </View>
      </View>
      {!signed && <Text variant="labelSmall" style={ui.tabular}>{kind === 'bar' ? 'R$\u00a00,00' : n ? fmt(points[minIdx].value) : ''}</Text>}
    </View>
  );
}

/** Economia (0.20, C3-11): três rótulos na margem — maior, "R$ 0,00" e menor —, cada um na altura do seu valor, sem se sobrepor. */
function gutterLabels(yMax: number, yZero: number, yMin: number, lh: number): number[] {
  let tZero = yZero - lh / 2;
  let tMax = Math.min(yMax - lh / 2, tZero - lh);
  let tMin = Math.max(yMin - lh / 2, tZero + lh);
  // Mantém os três perto da área do gráfico (a coluna tem uma folga em cima e embaixo).
  const lo = -lh / 2; const hi = H - lh / 2;
  if (tMax < lo) { const d = lo - tMax; tMax += d; tZero += d; tMin = Math.max(tMin, tZero + lh); }
  if (tMin > hi) { const d = tMin - hi; tMin -= d; tZero = Math.min(tZero, tMin - lh); tMax = Math.min(tMax, tZero - lh); }
  return [tMax, tZero, tMin];
}

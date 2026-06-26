import type { IntradayPoint, OhlcvBar } from '../types';
import { change, ma, pct } from '../lib/indicators';

function buildPriceScale(values: number[], reference: number, tickCount = 4) {
  if (!values.length) {
    return { min: reference * 0.98, max: reference * 1.02, range: Math.max(reference * 0.04, 1), ticks: [reference], decimals: 2 };
  }

  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const minimumRange = Math.max(Math.abs(reference) * 0.006, 0.002);
  const paddedRange = Math.max(dataMax - dataMin, minimumRange) * 1.12;
  const roughStep = paddedRange / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceFactor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = niceFactor * magnitude;
  const midpoint = (dataMin + dataMax) / 2;
  let min = Math.floor((midpoint - paddedRange / 2) / step) * step;
  let max = Math.ceil((midpoint + paddedRange / 2) / step) * step;

  if (min > dataMin) min -= step;
  if (max < dataMax) max += step;

  const ticks: number[] = [];
  for (let item = min; item <= max + step * 0.1; item += step) ticks.push(Number(item.toFixed(10)));
  const decimals = step >= 1 ? 2 : Math.min(4, Math.max(2, Math.ceil(-Math.log10(step)) + 1));
  return { min, max, range: Math.max(max - min, step), ticks, decimals };
}

function MaLine({ values, x, y, className }: { values: Array<number | null>; x: (index: number) => number; y: (value: number) => number; className: string }) {
  const firstValid = values.findIndex((item) => item !== null);
  const path = values
    .map((value, index) => (value === null ? null : `${index === firstValid ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`))
    .filter(Boolean)
    .join(' ');

  if (!path) return null;
  return <path className={className} d={path} fill="none" />;
}

export function KLineChart({ bars, compact = false, showDates = false }: { bars: OhlcvBar[]; compact?: boolean; showDates?: boolean }) {
  const width = compact ? 420 : 760;
  const height = compact ? 150 : 280;
  const topPadding = compact ? 14 : 22;
  const bottomPadding = compact ? 18 : 24;
  const leftPadding = compact ? 12 : 20;
  const rightPadding = compact ? 48 : 58;
  const volumeHeight = compact ? 30 : 54;
  const priceHeight = height - topPadding - bottomPadding - volumeHeight - 14;
  const visibleBars = bars.slice(compact ? -36 : -70);
  const highs = visibleBars.map((bar) => bar.high);
  const lows = visibleBars.map((bar) => bar.low);
  const scale = buildPriceScale([...highs, ...lows], visibleBars.at(-1)?.close ?? 1);
  const maxVolume = Math.max(...visibleBars.map((bar) => bar.volume), 1);
  const step = (width - leftPadding - rightPadding) / Math.max(visibleBars.length, 1);
  const candleWidth = Math.max(3, Math.min(12, step * 0.58));
  const closes = visibleBars.map((bar) => bar.close);
  const ma5 = ma(closes, 5);
  const ma20 = ma(closes, 20);
  const ma60 = compact ? [] : ma(closes, 60);

  const y = (price: number) => topPadding + (scale.max - price) / scale.range * priceHeight;
  const volumeY = (volume: number) => height - bottomPadding - (volume / maxVolume) * volumeHeight;
  const x = (index: number) => leftPadding + index * step + step / 2;

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="K线图">
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line className="grid-line" x1={leftPadding} x2={width - rightPadding} y1={y(tick)} y2={y(tick)} />
          <text className="axis-label right price-tick" x={width - 4} y={y(tick) + 3}>{tick.toFixed(scale.decimals)}</text>
        </g>
      ))}
      {visibleBars.map((bar, index) => {
        const isUp = bar.close >= bar.open;
        const candleTop = y(Math.max(bar.open, bar.close));
        const candleBottom = y(Math.min(bar.open, bar.close));
        const candleHeight = Math.max(1, candleBottom - candleTop);
        const volumeTop = volumeY(bar.volume);

        return (
          <g key={`${bar.date}-${index}`}>
            <line className={isUp ? 'candle up' : 'candle down'} x1={x(index)} x2={x(index)} y1={y(bar.high)} y2={y(bar.low)} />
            <rect className={isUp ? 'candle-body up' : 'candle-body down'} x={x(index) - candleWidth / 2} y={candleTop} width={candleWidth} height={candleHeight} rx="1" />
            <rect className={isUp ? 'volume up' : 'volume down'} x={x(index) - candleWidth / 2} y={volumeTop} width={candleWidth} height={height - bottomPadding - volumeTop} />
          </g>
        );
      })}
      <MaLine values={ma5} x={x} y={y} className="ma ma5" />
      <MaLine values={ma20} x={x} y={y} className="ma ma20" />
      {!compact && <MaLine values={ma60} x={x} y={y} className="ma ma60" />}
      {showDates && (
        <>
          <text className="axis-label" x={leftPadding} y={height - 4}>{visibleBars[0]?.date}</text>
          <text className="axis-label right" x={width - rightPadding} y={height - 4}>{visibleBars.at(-1)?.date}</text>
        </>
      )}
    </svg>
  );
}

export function IntradayChart({ points, preClose }: { points: IntradayPoint[]; preClose: number }) {
  const width = 520;
  const height = 310;
  const topPadding = 16;
  const bottomPadding = 20;
  const leftPadding = 14;
  const rightPadding = 88;
  const prices = [...points.map((point) => point.price), ...points.map((point) => point.avgPrice), preClose];
  const scale = buildPriceScale(prices, preClose);
  const maxVolume = Math.max(...points.map((point) => point.volume), 1);
  const priceHeight = 216;
  const volumeHeight = 46;
  const plotWidth = width - leftPadding - rightPadding;
  const x = (index: number) => leftPadding + index / Math.max(points.length - 1, 1) * plotWidth;
  const y = (price: number) => topPadding + (scale.max - price) / scale.range * priceHeight;
  const volumeY = (volume: number) => height - bottomPadding - (volume / maxVolume) * volumeHeight;
  const pricePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(point.price).toFixed(2)}`).join(' ');
  const avgPath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(point.avgPrice).toFixed(2)}`).join(' ');

  return (
    <svg className="chart intraday" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="分时图">
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line className="grid-line" x1={leftPadding} x2={width - rightPadding} y1={y(tick)} y2={y(tick)} />
          <text className="axis-label right price-tick" x={width - 4} y={y(tick) + 3}>{tick.toFixed(scale.decimals)} / {pct(change(preClose, tick))}</text>
        </g>
      ))}
      <line className="pre-close-line" x1={leftPadding} x2={width - rightPadding} y1={y(preClose)} y2={y(preClose)} />
      {points.map((point, index) => (
        <rect key={`${point.time}-${index}`} className="volume neutral" x={x(index)} y={volumeY(point.volume)} width={Math.max(1, plotWidth / Math.max(points.length, 1) * 0.7)} height={height - bottomPadding - volumeY(point.volume)} />
      ))}
      {points.length === 1 ? <circle className="intraday-dot" cx={x(0)} cy={y(points[0].price)} r="5" /> : <path className="intraday-price" d={pricePath} fill="none" />}
      {points.length > 1 && <path className="intraday-average" d={avgPath} fill="none" />}
      <text className="axis-label" x={leftPadding} y={height - 4}>{points[0]?.time}</text>
      <text className="axis-label right" x={width - rightPadding} y={height - 4}>{points.at(-1)?.time}</text>
    </svg>
  );
}

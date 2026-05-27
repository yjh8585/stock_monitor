'use client';

import { useMemo, useState } from 'react';
import IntradayMiniChart from './IntradayMiniChart';
import IntradayCombinedChart from './IntradayCombinedChart';
import type { HansaeBundle } from './HansaeDashboard';
import type { IntradayPoint } from '@/lib/hansae/data';

interface Props {
  bundle: HansaeBundle;
}

type TimeRange = '1D' | '1M' | '3M' | 'YTD' | '1Y' | '5Y';
const RANGES: TimeRange[] = ['1D', '1M', '3M', 'YTD', '1Y', '5Y'];

function dailyToSeries(rows: HansaeBundle['daily']): IntradayPoint[] {
  return rows
    .filter((r) => r.close !== null)
    .map((r) => ({
      ts: `${r.tradeDate}T15:30:00+09:00`,
      price: r.close as number,
      changePct: r.changePct,
      volume: r.volume,
    }));
}

/** 선택 기간에 따라 daily/intraday를 필터링해 단일 라인 시계열로 반환.
 *  1D : 장중 5분봉. 비어있으면(주말/장외) 최근 일봉 5거래일을 폴백.
 *  그 외 : 기간 내 일봉만 표시하되, 오늘 일봉의 가격은 최신 5분봉 가격으로 갱신.
 *         (X축 일자 고정 + 값만 실시간 반영) */
function buildChartSeries(bundle: HansaeBundle, range: TimeRange): IntradayPoint[] {
  if (range === '1D') {
    if (bundle.intraday.length > 0) return bundle.intraday;
    return dailyToSeries(bundle.daily.slice(-5));
  }
  const now = new Date();
  let cutoff: Date;
  if (range === 'YTD') {
    cutoff = new Date(now.getFullYear(), 0, 1);
  } else {
    const days = range === '1M' ? 30 : range === '3M' ? 90 : range === '1Y' ? 365 : 365 * 5;
    cutoff = new Date(now.getTime() - days * 24 * 60 * 60_000);
  }
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const daily = dailyToSeries(bundle.daily.filter((r) => r.tradeDate >= cutoffStr));

  // 오늘 5분봉 마지막 가격으로 오늘 일봉 점만 갱신(또는 신규 추가).
  // 일자 단위 X축은 그대로 두면서, 오늘 종가만 실시간 반영되는 효과를 낸다.
  const last = bundle.intraday[bundle.intraday.length - 1];
  if (!last) return daily;
  const todayDate = last.ts.slice(0, 10);
  const todayPoint: IntradayPoint = {
    ts: `${todayDate}T15:30:00+09:00`,
    price: last.price,
    changePct: last.changePct,
    volume: last.volume,
  };
  const idx = daily.findIndex((d) => d.ts.slice(0, 10) === todayDate);
  if (idx >= 0) {
    daily[idx] = todayPoint;
  } else {
    daily.push(todayPoint);
  }
  return daily;
}

const formatKRW = (n: number | null) =>
  n === null ? '—' : new Intl.NumberFormat('ko-KR').format(Math.round(n)) + '원';

const formatVol = (n: number | null) =>
  n === null ? '—' : new Intl.NumberFormat('ko-KR').format(Math.round(n));

const formatPct = (n: number | null) => {
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
};

/** 시가총액(억원) → 1조 이상은 조원, 미만은 억원 표기 */
const formatMarketCap = (eok: number | null) => {
  if (eok === null) return '—';
  if (eok >= 10_000) return `${(eok / 10_000).toFixed(1)}조원`;
  return `${new Intl.NumberFormat('ko-KR').format(Math.round(eok))}억원`;
};

export default function HansaeStockCard({ bundle }: Props) {
  const { company } = bundle;
  const pct = company.lastChangePct;
  const colorClass =
    pct === null
      ? 'text-foreground'
      : pct > 0
        ? 'text-red-500'
        : pct < 0
          ? 'text-blue-500'
          : 'text-foreground';
  const isExtreme = pct !== null && Math.abs(pct) >= 3;
  const [range, setRange] = useState<TimeRange>('1Y');
  const chartData = useMemo(() => buildChartSeries(bundle, range), [bundle, range]);

  return (
    <div
      className={[
        'rounded-md border bg-card p-4 w-full',
        'border-border',
        isExtreme ? 'ring-2 ring-amber-400/70' : '',
      ].join(' ')}
    >
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-base font-semibold">{company.name_kr}</div>
          <div className="text-sm text-muted-foreground">
            {company.ticker} · {company.market ?? '—'}
          </div>
        </div>
        <div className={`text-right ${colorClass}`}>
          <div className="text-lg font-bold">{formatKRW(company.lastPrice)}</div>
          <div className="text-sm">{formatPct(pct)}</div>
          <div className="text-[11px] text-muted-foreground">
            시총 {formatMarketCap(company.marketCap)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-1">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={[
              'px-2 py-0.5 rounded text-sm transition-colors',
              r === range
                ? 'bg-foreground text-background'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted/70',
            ].join(' ')}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="mt-2">
        {range === '1D' ? (
          <IntradayCombinedChart
            intraday={bundle.intraday}
            supply={bundle.intradaySupply}
            news={bundle.todayNews}
            posts={bundle.posts}
            height={360}
          />
        ) : (
          <IntradayMiniChart data={chartData} changePct={pct} height={320} />
        )}
      </div>
      <div className="mt-2 flex justify-between text-sm text-muted-foreground">
        <span>
          {range === '1D' ? '당일 분봉 + 수급 (KIS)' : `${range} 일봉 + 당일 5분봉`} · 거래량{' '}
          {formatVol(company.lastVolume)}
        </span>
        <span>
          {company.lastUpdatedAt
            ? new Date(company.lastUpdatedAt).toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '미수신'}
        </span>
      </div>
    </div>
  );
}

'use client';

import IntradayMiniChart from './IntradayMiniChart';
import type { HansaeBundle } from './HansaeDashboard';

interface Props {
  bundle: HansaeBundle;
  isActive: boolean;
  onClick: () => void;
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

export default function HansaeStockCard({ bundle, isActive, onClick }: Props) {
  const { company, intraday } = bundle;
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

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left rounded-md border bg-card p-4 transition-shadow',
        isActive ? 'border-foreground/50 shadow-sm' : 'border-border hover:border-foreground/30',
        isExtreme ? 'ring-2 ring-amber-400/70' : '',
      ].join(' ')}
    >
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-sm font-semibold">{company.name_kr}</div>
          <div className="text-[11px] text-muted-foreground">
            {company.ticker} · {company.market ?? '—'}
          </div>
        </div>
        <div className={`text-right ${colorClass}`}>
          <div className="text-base font-bold">{formatKRW(company.lastPrice)}</div>
          <div className="text-xs">{formatPct(pct)}</div>
        </div>
      </div>
      <div className="mt-2">
        <IntradayMiniChart data={intraday} changePct={pct} height={70} />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>거래량 {formatVol(company.lastVolume)}</span>
        <span>
          {company.lastUpdatedAt
            ? new Date(company.lastUpdatedAt).toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '미수신'}
        </span>
      </div>
    </button>
  );
}

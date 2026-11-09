'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { CustomerEarnings } from '@/lib/customers/types';

const TD = 'px-3 py-1.5 whitespace-nowrap text-right tabular-nums';
const num = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 1 });
const pct = (v: number | null, signed = false) =>
  v == null ? '—' : `${signed && v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const tone = (v: number | null) =>
  v == null || v === 0 ? '' : v > 0 ? 'text-emerald-600' : 'text-rose-600';

/** 고객사 실적 표 — 분기/연간 토글, 최신 기간이 위. 금액은 현지 통화 십억(bn). */
export default function CustomerEarningsTable({ earnings }: { earnings: CustomerEarnings }) {
  const [mode, setMode] = useState<'quarter' | 'annual'>('quarter');
  if (!earnings.currency) return <p className="text-sm text-muted-foreground">재무 데이터 없음</p>;
  const rows = [...(mode === 'quarter' ? earnings.quarterly : earnings.annual)].reverse();
  const unit = earnings.currency === 'KRW' ? '십억원' : `${earnings.currency} 십억(bn)`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {/* SHORTCUT: 출처를 일반 표기 → financials.source 를 행별로 실으면 정확해진다 */}
        <span>단위: {unit} · 출처: financials(yfinance·DART)</span>
        <div role="tablist" aria-label="실적 기간 단위" className="flex gap-1">
          {(['quarter', 'annual'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              type="button"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-md border px-3 py-1',
                mode === m
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border hover:bg-muted'
              )}
            >
              {m === 'quarter' ? '분기' : '연간'}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left">기간</th>
              <th className={TD}>매출</th>
              <th className={TD}>매출 YoY</th>
              <th className={TD}>영업이익</th>
              <th className={TD}>영업이익률</th>
              <th className={TD}>순이익</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.period_label} className="border-t border-border">
                <td className="px-3 py-1.5 text-left">{p.period_label}</td>
                <td className={TD}>{num(p.revenue_bn)}</td>
                <td className={cn(TD, tone(p.revenue_yoy_pct))}>{pct(p.revenue_yoy_pct, true)}</td>
                <td className={cn(TD, tone(p.operating_income_bn))}>
                  {num(p.operating_income_bn)}
                </td>
                <td className={cn(TD, tone(p.operating_margin_pct))}>
                  {pct(p.operating_margin_pct)}
                </td>
                <td className={cn(TD, tone(p.net_income_bn))}>{num(p.net_income_bn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

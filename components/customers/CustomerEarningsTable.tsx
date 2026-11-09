'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { CustomerEarnings } from '@/lib/customers/types';
import {
  pctClass,
  pctText,
  type EarningsCellField,
  type EarningsFootnotes,
} from '@/lib/customers/format';

const TD = 'px-3 py-1.5 whitespace-nowrap text-right tabular-nums';
const num = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 1 });

interface Props {
  earnings: CustomerEarnings;
  /** 회사 발표 조정 영업이익 열(회사 이름 그대로 · 예 EBIT-adjusted) — 값은 점의 `adjusted` 에서 metric 으로 찾는다. */
  adjustedRows?: { metric: string; name: string }[];
  /** 칸 출처 각주(해외 · 서버가 earningsFootnotes 로 만든다). 있으면 출처 문구도 「회사 공시 우선」으로 바뀐다. */
  footnotes?: { quarter: EarningsFootnotes; annual: EarningsFootnotes };
}

/** 고객사 실적 표 — 분기/연간 토글, 최신 기간이 위. 금액은 현지 통화 십억(bn). */
export default function CustomerEarningsTable({ earnings, adjustedRows = [], footnotes }: Props) {
  const [mode, setMode] = useState<'quarter' | 'annual'>('quarter');
  if (!earnings.currency) return <p className="text-sm text-muted-foreground">재무 데이터 없음</p>;
  const rows = [...(mode === 'quarter' ? earnings.quarterly : earnings.annual)].reverse();
  const unit = earnings.currency === 'KRW' ? '십억원' : `${earnings.currency} 십억(bn)`;
  const fn = footnotes?.[mode];
  // 지금 단위(분기/연간)에 값이 하나도 없는 조정 지표 열은 감춘다(연간·누계로만 내는 지표 — 분기 열이 「—」뿐).
  const adjustedCols = adjustedRows.filter((a) =>
    rows.some((p) => p.adjusted?.some((x) => x.metric === a.metric))
  );
  const sup = (label: string, field: EarningsCellField) => {
    const marks = fn?.marks[`${label}|${field}`];
    return marks ? (
      <sup className="ml-0.5 text-[10px] text-muted-foreground">{marks.join(',')}</sup>
    ) : null;
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {/* SHORTCUT: 출처를 일반 표기 → financials.source 를 행별로 실으면 정확해진다 */}
        <span>
          단위: {unit} · 출처:{' '}
          {footnotes ? '회사 공시 우선 · 없는 칸은 시장 데이터(각주)' : 'financials(yfinance·DART)'}
        </span>
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
              {adjustedCols.map((a) => (
                <th
                  key={a.metric}
                  className={TD}
                  title="회사 발표 조정 지표 — 회사가 쓴 이름 그대로"
                >
                  {a.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.period_label} className="border-t border-border">
                <td className="px-3 py-1.5 text-left">{p.period_label}</td>
                <td className={TD}>
                  {num(p.revenue_bn)}
                  {sup(p.period_label, 'revenue')}
                </td>
                <td className={cn(TD, pctClass(p.revenue_yoy_pct))}>
                  {pctText(p.revenue_yoy_pct)}
                </td>
                <td className={cn(TD, pctClass(p.operating_income_bn))}>
                  {num(p.operating_income_bn)}
                  {sup(p.period_label, 'operating_income')}
                </td>
                <td className={cn(TD, pctClass(p.operating_margin_pct))}>
                  {pctText(p.operating_margin_pct, false)}
                </td>
                <td className={cn(TD, pctClass(p.net_income_bn))}>
                  {num(p.net_income_bn)}
                  {sup(p.period_label, 'net_income')}
                </td>
                {adjustedCols.map((a) => {
                  const v = p.adjusted?.find((x) => x.metric === a.metric)?.value_bn ?? null;
                  return (
                    <td key={a.metric} className={cn(TD, pctClass(v))}>
                      {num(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fn && fn.notes.length > 0 && (
        <ol className="space-y-0.5 text-xs text-muted-foreground">
          {fn.notes.map((t, i) => (
            <li key={t}>
              <sup>{i + 1}</sup> {t}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

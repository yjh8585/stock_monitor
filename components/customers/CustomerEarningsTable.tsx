'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { CellOrigin, CustomerEarnings, CustomerEarningsPoint } from '@/lib/customers/types';
import { quarterRows, ytdAnnualPoint, type QuarterRowView } from '@/lib/customers/earnings';
import { ROW_HIGHLIGHT_CLASS, useRowHighlight } from '@/lib/useRowHighlight';
import {
  originNote,
  pctClass,
  pctText,
  type EarningsCellField,
  type EarningsFootnotes,
} from '@/lib/customers/format';

const TD = 'px-3 py-1.5 whitespace-nowrap text-right tabular-nums';

/**
 * YTD 행 영업이익의 출처 표시 — YTD 는 서버 각주표에 없는 행이라 각주 번호 대신 짧은 글자 + 마우스 설명.
 * 아래 연간 행(장부상)과 정의가 다른 합계가 나란히 놓이지 않게 한다(2026-11-11 검토).
 */
function YtdOriginMark({ origin, currency }: { origin?: CellOrigin; currency: string | null }) {
  const label =
    origin?.source === 'company_adjusted' ? '조정' : origin?.source === 'market' ? '시장' : null;
  if (!label) return null;
  return (
    <sup
      className="ml-0.5 text-[10px] text-muted-foreground"
      title={originNote(origin, currency) ?? undefined}
    >
      {label}
    </sup>
  );
}
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
  const { highlighted, rowToggleProps } = useRowHighlight();
  if (!earnings.currency) return <p className="text-sm text-muted-foreground">재무 데이터 없음</p>;
  const isQ = mode === 'quarter';
  // 분기 = QoQ·누적 칸이 붙은 줄 · 연간 = 회사 연간 행 + 아직 연간 행이 없는 올해의 YTD 행(맨 위).
  const ytd = isQ ? null : ytdAnnualPoint(earnings.quarterly, earnings.annual);
  const rows: (CustomerEarningsPoint & Partial<QuarterRowView>)[] = isQ
    ? quarterRows(earnings.quarterly).reverse()
    : [...(ytd ? [ytd] : []), ...[...earnings.annual].reverse()];
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
              {isQ && (
                <th className={TD} title="직전 분기 대비(1분기는 전년 4분기와)">
                  매출 QoQ
                </th>
              )}
              <th className={TD}>영업이익</th>
              <th className={TD}>영업이익률</th>
              <th className={TD}>순이익</th>
              {isQ && (
                <>
                  <th className={TD} title="그해 1분기부터 이 분기까지 합 — 빠진 분기가 있으면 —">
                    누적 매출
                  </th>
                  <th className={TD} title="그해 1분기부터 이 분기까지 합 — 빠진 분기가 있으면 —">
                    누적 영업이익
                  </th>
                </>
              )}
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
              <tr
                key={p.period_label}
                {...rowToggleProps(`${mode}|${p.period_label}`, p.period_label)}
                className={cn(
                  'border-t border-border cursor-pointer',
                  highlighted.has(`${mode}|${p.period_label}`)
                    ? ROW_HIGHLIGHT_CLASS
                    : p === ytd && 'bg-muted/30'
                )}
              >
                <td className="px-3 py-1.5 text-left">{p.period_label}</td>
                <td className={TD}>
                  {num(p.revenue_bn)}
                  {sup(p.period_label, 'revenue')}
                </td>
                <td className={cn(TD, pctClass(p.revenue_yoy_pct))}>
                  {pctText(p.revenue_yoy_pct)}
                </td>
                {isQ && (
                  <td className={cn(TD, pctClass(p.revenue_qoq_pct ?? null))}>
                    {pctText(p.revenue_qoq_pct ?? null)}
                  </td>
                )}
                <td className={cn(TD, pctClass(p.operating_income_bn))}>
                  {num(p.operating_income_bn)}
                  {sup(p.period_label, 'operating_income')}
                  {p === ytd && p.operating_income_bn != null && (
                    <YtdOriginMark
                      origin={p.origin?.operating_income}
                      currency={earnings.currency}
                    />
                  )}
                </td>
                <td className={cn(TD, pctClass(p.operating_margin_pct))}>
                  {pctText(p.operating_margin_pct, false)}
                </td>
                <td className={cn(TD, pctClass(p.net_income_bn))}>
                  {num(p.net_income_bn)}
                  {sup(p.period_label, 'net_income')}
                </td>
                {isQ && (
                  <>
                    <td className={TD}>{num(p.ytd_revenue_bn ?? null)}</td>
                    <td className={cn(TD, pctClass(p.ytd_operating_income_bn ?? null))}>
                      {num(p.ytd_operating_income_bn ?? null)}
                    </td>
                  </>
                )}
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

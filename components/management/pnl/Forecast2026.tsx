'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import type { Basis, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  /** basis별 월별 원본 — 1~3월 합산용 */
  monthlyByBasis: EntriesByBasis;
  /** basis별 연간 합계 — 2025 연간(period_month=0) 조회용 */
  annualByBasis: EntriesByBasis;
}

interface Metrics {
  revenue: number;
  op_income: number;
}

const ZERO: Metrics = { revenue: 0, op_income: 0 };

function sumMetrics(entries: readonly PnlEntry[]): Metrics {
  let revenue = 0;
  let op = 0;
  for (const e of entries) {
    revenue += e.revenue ?? 0;
    op += e.op_income ?? 0;
  }
  return { revenue, op_income: op };
}

function fmtMillion(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('ko-KR');
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

/** 신호별 클래스 — 음수면 빨강, 양수면 기본 */
function neg(v: number | null): string {
  return v != null && v < 0 ? 'text-red-500' : '';
}

/**
 * 11. 2026 연간 추정 — 매출·영업이익.
 *
 * 추정 방법 2가지:
 *  A) YTD 연환산   : (1~3월 합) × 4
 *  B) YoY 추세 적용 : 2025 연간 × (2026 1~3월 / 2025 1~3월)
 *
 * 두 방법의 평균을 "추정치"로 별도 행에 노출하고, 산출 근거 행도 함께 보여준다.
 */
export default function Forecast2026({ monthlyByBasis, annualByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');

  const calc = useMemo(() => {
    // 2025 연간 합계 — period_month=0 (consolidated) 또는 standalone 월별 derive
    let actual2025: Metrics = ZERO;
    if (basis === 'consolidated') {
      const annual = annualByBasis.consolidated.filter(
        (e) => e.year_label === '2025' && e.period_month === 0
      );
      actual2025 = sumMetrics(annual);
    } else {
      // standalone 은 연간 행이 없어 월별 합산
      const monthly = monthlyByBasis.standalone.filter(
        (e) => e.period_year === 2025 && e.period_month >= 1 && e.period_month <= 12
      );
      actual2025 = sumMetrics(monthly);
    }
    // 2025 1~3월 합계
    const q1_2025 = sumMetrics(
      monthlyByBasis[basis].filter(
        (e) => e.period_year === 2025 && e.period_month >= 1 && e.period_month <= 3
      )
    );
    // 2026 1~3월 합계
    const q1_2026 = sumMetrics(
      monthlyByBasis[basis].filter(
        (e) => e.period_year === 2026 && e.period_month >= 1 && e.period_month <= 3
      )
    );
    // YoY% (1~3월)
    const yoyRev =
      q1_2025.revenue !== 0 ? ((q1_2026.revenue - q1_2025.revenue) / Math.abs(q1_2025.revenue)) * 100 : null;
    const yoyOp =
      q1_2025.op_income !== 0
        ? ((q1_2026.op_income - q1_2025.op_income) / Math.abs(q1_2025.op_income)) * 100
        : null;
    // A: YTD 연환산
    const annualizedRev = q1_2026.revenue * 4;
    const annualizedOp = q1_2026.op_income * 4;
    // B: YoY 추세 적용 (분모 0 회피)
    const yoyApplyRev =
      q1_2025.revenue !== 0 ? actual2025.revenue * (q1_2026.revenue / q1_2025.revenue) : null;
    const yoyApplyOp =
      q1_2025.op_income !== 0
        ? actual2025.op_income * (q1_2026.op_income / q1_2025.op_income)
        : null;
    // 평균 추정치
    const estRev = yoyApplyRev != null ? (annualizedRev + yoyApplyRev) / 2 : annualizedRev;
    const estOp = yoyApplyOp != null ? (annualizedOp + yoyApplyOp) / 2 : annualizedOp;
    return {
      actual2025,
      q1_2025,
      q1_2026,
      yoyRev,
      yoyOp,
      annualizedRev,
      annualizedOp,
      yoyApplyRev,
      yoyApplyOp,
      estRev,
      estOp,
    };
  }, [basis, annualByBasis, monthlyByBasis]);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">11. 2026 연간 추정 (매출·영업이익)</h2>
        <BasisToggle value={basis} onChange={setBasis} />
      </header>

      {/* 추정치 KPI 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <ForecastCard
          label="2026 매출 추정"
          value={calc.estRev}
          actualLabel="2025 실적"
          actualValue={calc.actual2025.revenue}
          changePct={
            calc.actual2025.revenue !== 0
              ? ((calc.estRev - calc.actual2025.revenue) / Math.abs(calc.actual2025.revenue)) * 100
              : null
          }
        />
        <ForecastCard
          label="2026 영업이익 추정"
          value={calc.estOp}
          actualLabel="2025 실적"
          actualValue={calc.actual2025.op_income}
          changePct={
            calc.actual2025.op_income !== 0
              ? ((calc.estOp - calc.actual2025.op_income) / Math.abs(calc.actual2025.op_income)) *
                100
              : null
          }
        />
      </div>

      {/* 근거 표 */}
      <div className="overflow-x-auto">
        <table className="w-full text-base border-collapse">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">구분</th>
              <th className="px-3 py-2 text-right font-medium">매출 (백만원)</th>
              <th className="px-3 py-2 text-right font-medium">영업이익 (백만원)</th>
            </tr>
          </thead>
          <tbody>
            <Row
              label="2025 연간 실적"
              rev={calc.actual2025.revenue}
              op={calc.actual2025.op_income}
            />
            <Row label="2025 1~3월" rev={calc.q1_2025.revenue} op={calc.q1_2025.op_income} />
            <Row label="2026 1~3월" rev={calc.q1_2026.revenue} op={calc.q1_2026.op_income} />
            <tr className="border-t border-border/60 bg-muted/20">
              <td className="px-3 py-2 font-medium">1~3월 YoY</td>
              <td className={`px-3 py-2 text-right tabular-nums ${neg(calc.yoyRev)}`}>
                {fmtPct(calc.yoyRev)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${neg(calc.yoyOp)}`}>
                {fmtPct(calc.yoyOp)}
              </td>
            </tr>
            <Row
              label="① YTD 연환산 (1~3월 × 4)"
              rev={calc.annualizedRev}
              op={calc.annualizedOp}
              emphasized
            />
            <Row
              label="② YoY 추세 적용 (2025 × YoY)"
              rev={calc.yoyApplyRev}
              op={calc.yoyApplyOp}
              emphasized
            />
            <tr className="border-t-2 border-border bg-blue-50 dark:bg-blue-950/30">
              <td className="px-3 py-2 font-bold">추정치 (①·② 평균)</td>
              <td
                className={`px-3 py-2 text-right tabular-nums font-bold ${calc.estRev < 0 ? 'text-red-500' : ''}`}
              >
                {fmtMillion(calc.estRev)}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums font-bold ${calc.estOp < 0 ? 'text-red-500' : ''}`}
              >
                {fmtMillion(calc.estOp)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 추정 로직 설명 */}
      <div className="mt-4 rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm leading-relaxed">
        <div className="font-medium mb-1">추정 로직</div>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">① YTD 연환산</span> : 2026 1~3월 합계를 4배
            확장. 분기 매출이 균일하다고 가정 — 빠르지만 계절성·신규 수주 반영이 약함.
          </li>
          <li>
            <span className="font-medium text-foreground">② YoY 추세 적용</span> :
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              2025 연간 × (2026 1~3월 ÷ 2025 1~3월)
            </code>
            — 전년 동기 대비 성장률을 연간 매출에 적용. 계절성·기저효과를 자연스럽게 반영.
          </li>
          <li>
            최종 <span className="font-medium text-foreground">추정치</span>는 ①·② 평균. 두 방법이
            크게 갈리는 항목은 신뢰도가 낮으니 표 본문 차이를 함께 확인.
          </li>
          <li>
            한계 : 4월 이후 신규 수주·생산 차질·환율 등은 반영하지 못함. 분기말 일회성 비용/이익도
            그대로 연환산되어 영업이익 추정은 매출보다 변동성이 크다.
          </li>
        </ul>
      </div>
    </section>
  );
}

function Row({
  label,
  rev,
  op,
  emphasized,
}: {
  label: string;
  rev: number | null;
  op: number | null;
  emphasized?: boolean;
}) {
  const cls = emphasized ? 'font-medium' : '';
  return (
    <tr className={`border-b border-border/40 ${emphasized ? 'bg-muted/10' : ''}`}>
      <td className={`px-3 py-2 ${cls}`}>{label}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${cls} ${rev != null && rev < 0 ? 'text-red-500' : ''}`}>
        {fmtMillion(rev)}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums ${cls} ${op != null && op < 0 ? 'text-red-500' : ''}`}>
        {fmtMillion(op)}
      </td>
    </tr>
  );
}

function ForecastCard({
  label,
  value,
  actualLabel,
  actualValue,
  changePct,
}: {
  label: string;
  value: number;
  actualLabel: string;
  actualValue: number;
  changePct: number | null;
}) {
  const isNeg = value < 0;
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${isNeg ? 'text-red-500' : ''}`}>
        {fmtMillion(value)}
        <span className="ml-1 text-sm font-medium text-muted-foreground">백만원</span>
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        {actualLabel}{' '}
        <span className={`tabular-nums ${actualValue < 0 ? 'text-red-500' : 'text-foreground'}`}>
          {fmtMillion(actualValue)}
        </span>
        {changePct != null && (
          <>
            {' · '}전년 대비{' '}
            <span className={`font-medium ${neg(changePct)}`}>{fmtPct(changePct)}</span>
          </>
        )}
      </div>
    </div>
  );
}

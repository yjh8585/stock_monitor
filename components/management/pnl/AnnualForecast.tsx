'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import { PNL_MIN_YEAR, ytdMonthsOfYear } from '@/lib/pnl/aggregate';
import type { Basis, CostStructureRow, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';
import { ROW_HIGHLIGHT_CLASS, useRowHighlight } from '@/lib/useRowHighlight';

type ToggleProps = ReturnType<ReturnType<typeof useRowHighlight>['rowToggleProps']>;

interface Props {
  /** basis별 월별 원본 — YTD(현재 N월까지) 합산용 */
  monthlyByBasis: EntriesByBasis;
  /** basis별 연간 합계 — 2025 연간(period_month=0) 조회용 */
  annualByBasis: EntriesByBasis;
  /** 1번 표용 비용구조 — 원타임 비용 추산에 사용 (연결 기준만 보유) */
  costStructure: CostStructureRow[];
}

interface Metrics {
  revenue: number;
  op_income: number;
}

const ZERO: Metrics = { revenue: 0, op_income: 0 };

/**
 * 5개 비용 카테고리 — 1번 표 ROW_DEFS depth=2를 기반으로 정상비율 보정 대상 정의.
 *
 * 관세는 2025년부터만 별도 account로 분리 적재되어 2023·2024 비교가 불가능.
 * 회계 분류 변경(재료비 → 재료비+관세)이므로 '재료비성'으로 합산해 일관된 정상비율 산출.
 */
interface CostCategory {
  label: string;
  accounts: readonly string[];
}
const COST_CATEGORIES: readonly CostCategory[] = [
  { label: '재료비성(재료비+관세)', accounts: ['재료비', '관세'] },
  { label: '운반및보관료', accounts: ['운반및보관료'] },
  { label: '경비', accounts: ['경비'] },
  { label: '인건비', accounts: ['인건비'] },
  { label: '외주가공비', accounts: ['외주가공비'] },
];

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

function fmtSignedMillion(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const r = Math.round(n);
  if (r > 0) return `+${r.toLocaleString('ko-KR')}`;
  return r.toLocaleString('ko-KR');
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function fmtRatio(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

/** 신호별 클래스 — 음수면 빨강, 양수면 기본 */
function neg(v: number | null): string {
  return v != null && v < 0 ? 'text-red-500' : '';
}

/** 연간 account 값 조회 (연결 기준만 존재) */
function annualAccount(
  rows: readonly CostStructureRow[],
  year: number,
  account: string
): number | null {
  for (const r of rows) {
    if (
      r.period_year === year &&
      r.period_kind === 'annual' &&
      r.kind === 'actual' &&
      r.account === account
    ) {
      return r.value_mwon;
    }
  }
  return null;
}

/**
 * 연간 다수 account 합산 — 카테고리(예: 재료비+관세) 합계 산출.
 *
 * 합산 대상 account 중 하나라도 존재하면 결과를 반환(누락 account는 0 가산).
 * 모든 account가 부재면 null.
 */
function annualSumAccounts(
  rows: readonly CostStructureRow[],
  year: number,
  accounts: readonly string[]
): number | null {
  let sum = 0;
  let found = false;
  for (const account of accounts) {
    const v = annualAccount(rows, year, account);
    if (v != null) {
      sum += v;
      found = true;
    }
  }
  return found ? sum : null;
}

interface CostAdjustment {
  label: string;
  ratio23: number | null;
  ratio24: number | null;
  normalRatio: number | null;
  actualRatio25: number | null;
  actual25: number | null;
  expected25: number | null;
  /** 실제 - 기대. 양수=정상보다 컸음(영업이익에 가산), 음수=정상보다 적었음(영업이익에서 차감) */
  excess25: number | null;
}

/**
 * 2. 2026 연간 추정 — 매출·영업이익.
 *
 * 추정 방법 3가지 (2026 monthly 최대 적재 월 N을 자동 검출 — 매월 데이터 갱신 시 추정값도 변화):
 *  ① YTD 연환산   : (1~N월 합) × (12/N)
 *  ② YoY 추세 적용 : 2025 연간 × (2026 1~N월 매출 ÷ 2025 1~N월 매출)
 *                    — 매출과 영업이익 모두 매출 YoY를 적용해 부호 폭증 회피
 *  ③ 원타임 보정   : 2023→2025 매출 CAGR(2년) + 5개 비용 카테고리를 2023·2024 평균 비율로 정상화
 *
 * 추정치는 ①·②·③ 평균 (③ 산출 불가 시 ①·② 평균).
 * ③은 연결 비용구조 데이터(1번 표)가 필요하므로 standalone 모드에선 비활성.
 */
export default function AnnualForecast({ monthlyByBasis, annualByBasis, costStructure }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const { highlighted, rowToggleProps } = useRowHighlight();

  const calc = useMemo(() => {
    // 추정 대상 = 월별 실적이 들어온 가장 큰 연도. 연도를 코드에 박으면 해가 바뀔 때 멈춘다.
    const targetYear = monthlyByBasis[basis].reduce(
      (max, e) => (e.period_month >= 1 && e.period_year > max ? e.period_year : max),
      PNL_MIN_YEAR
    );
    const baseYear = targetYear - 1;

    // baseYear 연간 합계 — period_month=0 (consolidated) 또는 standalone 월별 derive
    let actualBase: Metrics = ZERO;
    if (basis === 'consolidated') {
      const annual = annualByBasis.consolidated.filter(
        (e) => e.year_label === String(baseYear) && e.period_month === 0
      );
      actualBase = sumMetrics(annual);
    } else {
      // standalone 은 연간 행이 없어 월별 합산
      const monthly = monthlyByBasis.standalone.filter(
        (e) => e.period_year === baseYear && e.period_month >= 1 && e.period_month <= 12
      );
      actualBase = sumMetrics(monthly);
    }
    // targetYear monthly 적재된 최대 월 N (1~N월이 YTD 윈도우)
    const ytdN = ytdMonthsOfYear(monthlyByBasis[basis], basis, targetYear);
    // baseYear 1~N월 합계 — 동일 윈도우로 YoY 비교
    const ytdBase = sumMetrics(
      monthlyByBasis[basis].filter(
        (e) => e.period_year === baseYear && e.period_month >= 1 && e.period_month <= ytdN
      )
    );
    // targetYear 1~N월 합계
    const ytdTarget = sumMetrics(
      monthlyByBasis[basis].filter(
        (e) => e.period_year === targetYear && e.period_month >= 1 && e.period_month <= ytdN
      )
    );
    // YoY% (1~N월)
    const yoyRev =
      ytdBase.revenue !== 0
        ? ((ytdTarget.revenue - ytdBase.revenue) / Math.abs(ytdBase.revenue)) * 100
        : null;
    const yoyOp =
      ytdBase.op_income !== 0
        ? ((ytdTarget.op_income - ytdBase.op_income) / Math.abs(ytdBase.op_income)) * 100
        : null;
    // ① YTD 연환산 — 1~N월 합계를 (12/N) 비율로 연환산. N=0이면 산출 불가(null).
    const annualScale = ytdN > 0 ? 12 / ytdN : null;
    const annualizedRev = annualScale != null ? ytdTarget.revenue * annualScale : null;
    const annualizedOp = annualScale != null ? ytdTarget.op_income * annualScale : null;
    // ② YoY 추세 적용 — 매출 YoY 비율을 매출·영업이익 둘 다에 적용
    //   영업이익도 동일 비율로 곱해, "영업이익률은 baseYear와 같다"고 가정.
    //   기존 op_income / op_income 방식은 분모 부호가 흔들려 추정이 폭증함.
    const revYoyRatio = ytdBase.revenue !== 0 ? ytdTarget.revenue / ytdBase.revenue : null;
    const yoyApplyRev = revYoyRatio != null ? actualBase.revenue * revYoyRatio : null;
    const yoyApplyOp = revYoyRatio != null ? actualBase.op_income * revYoyRatio : null;

    // === ③ 원타임 보정 추정 (consolidated 한정) ===
    // 1) 5개 비용 카테고리 각각 cagrFromYear·baseYear-1 매출 대비 비율 평균 = 정상 비율
    //    (관세는 baseYear부터 분리 적재되어 재료비와 합산해 '재료비성'으로 처리)
    //    baseYear 실제 비용 - baseYear매출×정상비율 = 초과분 (양수면 정상보다 컸음 → 영업이익에 가산)
    //    음수도 그대로 반영 (정상보다 적게 발생한 항목은 차감)
    // 2) 매출 2년 CAGR(cagrFromYear→baseYear)로 베이스 매출 추정
    // 3) 보정 매출 = (① + ② + CAGR베이스) / 3
    //    정상화 baseYear 영업이익률 = (baseYear 영업이익 + 총 초과분 합) / baseYear 매출
    //    보정 영업이익 = 정상화 영업이익률 × 보정 매출
    const cagrFromYear = PNL_MIN_YEAR;
    const rev23 = annualAccount(costStructure, cagrFromYear, '매출');
    const revPrev = annualAccount(costStructure, baseYear - 1, '매출');
    const revBase = annualAccount(costStructure, baseYear, '매출');
    const opBase = annualAccount(costStructure, baseYear, '영업이익');

    const costAdjustments: CostAdjustment[] = COST_CATEGORIES.map((cat) => {
      const v23 = annualSumAccounts(costStructure, cagrFromYear, cat.accounts);
      const vPrev = annualSumAccounts(costStructure, baseYear - 1, cat.accounts);
      const vBase = annualSumAccounts(costStructure, baseYear, cat.accounts);
      const ratio23 = rev23 && rev23 > 0 && v23 != null ? v23 / rev23 : null;
      const ratio24 = revPrev && revPrev > 0 && vPrev != null ? vPrev / revPrev : null;
      const normalRatio = ratio23 != null && ratio24 != null ? (ratio23 + ratio24) / 2 : null;
      const actualRatio25 = revBase && revBase > 0 && vBase != null ? vBase / revBase : null;
      const expected25 =
        revBase && revBase > 0 && normalRatio != null ? revBase * normalRatio : null;
      const excess25 = expected25 != null && vBase != null ? vBase - expected25 : null;
      return {
        label: cat.label,
        ratio23,
        ratio24,
        normalRatio,
        actualRatio25,
        actual25: vBase,
        expected25,
        excess25,
      };
    });

    let totalOneTime: number | null = null;
    let normalizedOp25: number | null = null;
    let normalizedOpRatio: number | null = null;
    let cagr2y: number | null = null;
    let cagrBaseRev: number | null = null;
    let adjRev: number | null = null;
    let adjOp: number | null = null;

    if (basis === 'consolidated') {
      // 모든 항목 정상비율 산출 가능해야 보정 결과를 신뢰
      const allHaveNormal = costAdjustments.every((c) => c.excess25 != null);
      if (allHaveNormal && opBase != null && revBase && revBase > 0) {
        totalOneTime = costAdjustments.reduce((sum, c) => sum + (c.excess25 ?? 0), 0);
        normalizedOp25 = opBase + totalOneTime;
        normalizedOpRatio = normalizedOp25 / revBase;
      }
      // 매출 2년 CAGR
      if (rev23 && rev23 > 0 && revBase && revBase > 0) {
        cagr2y = Math.pow(revBase / rev23, 1 / 2) - 1;
        cagrBaseRev = revBase * (1 + cagr2y);
      }
      // 보정 매출: ① + ② + CAGR베이스 평균 (①·②·CAGR 산출 불가면 빠진 항목 제외)
      const revCandidates: number[] = [];
      if (annualizedRev != null) revCandidates.push(annualizedRev);
      if (yoyApplyRev != null) revCandidates.push(yoyApplyRev);
      if (cagrBaseRev != null) revCandidates.push(cagrBaseRev);
      adjRev =
        revCandidates.length > 0
          ? revCandidates.reduce((a, b) => a + b, 0) / revCandidates.length
          : null;
      // 보정 영업이익: 정상화 영업이익률 × 보정 매출
      if (normalizedOpRatio != null && adjRev != null) {
        adjOp = normalizedOpRatio * adjRev;
      }
    }

    // 평균 추정치 (① 산출 가능 + ② / ③ 가용한 항목 평균)
    const estRevCandidates: number[] = [];
    if (annualizedRev != null) estRevCandidates.push(annualizedRev);
    if (yoyApplyRev != null) estRevCandidates.push(yoyApplyRev);
    if (adjRev != null) estRevCandidates.push(adjRev);
    const estRev =
      estRevCandidates.length > 0
        ? estRevCandidates.reduce((a, b) => a + b, 0) / estRevCandidates.length
        : null;

    const estOpCandidates: number[] = [];
    if (annualizedOp != null) estOpCandidates.push(annualizedOp);
    if (yoyApplyOp != null) estOpCandidates.push(yoyApplyOp);
    if (adjOp != null) estOpCandidates.push(adjOp);
    const estOp =
      estOpCandidates.length > 0
        ? estOpCandidates.reduce((a, b) => a + b, 0) / estOpCandidates.length
        : null;

    return {
      targetYear,
      baseYear,
      cagrFromYear,
      actualBase,
      ytdN,
      ytdBase,
      ytdTarget,
      yoyRev,
      yoyOp,
      annualizedRev,
      annualizedOp,
      yoyApplyRev,
      yoyApplyOp,
      // ③ 보정 관련
      revBase,
      opBase,
      costAdjustments,
      totalOneTime,
      normalizedOp25,
      normalizedOpRatio,
      cagr2y,
      cagrBaseRev,
      adjRev,
      adjOp,
      estRev,
      estOp,
    };
  }, [basis, annualByBasis, monthlyByBasis, costStructure]);

  const adjAvailable = calc.adjRev != null && calc.adjOp != null;

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">
          3. {calc.targetYear} 연간 추정 (매출·영업이익){' '}
          <span className="text-sm font-normal text-muted-foreground">· 단위 백만원</span>
        </h2>
        <BasisToggle value={basis} onChange={setBasis} />
      </header>

      {/* 추정치 KPI 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <ForecastCard
          label={`${calc.targetYear} 매출 추정`}
          value={calc.estRev}
          actualLabel={`${calc.baseYear} 실적`}
          actualValue={calc.actualBase.revenue}
          changePct={
            calc.estRev != null && calc.actualBase.revenue !== 0
              ? ((calc.estRev - calc.actualBase.revenue) / Math.abs(calc.actualBase.revenue)) * 100
              : null
          }
        />
        <ForecastCard
          label={`${calc.targetYear} 영업이익 추정`}
          value={calc.estOp}
          actualLabel={`${calc.baseYear} 실적`}
          actualValue={calc.actualBase.op_income}
          changePct={
            calc.estOp != null && calc.actualBase.op_income !== 0
              ? ((calc.estOp - calc.actualBase.op_income) / Math.abs(calc.actualBase.op_income)) *
                100
              : null
          }
        />
      </div>

      {/* 추정 박스 — thead + ①·②·③ + 평균 추정치 강조 (최상단) */}
      <div className="overflow-x-auto rounded-lg ring-2 ring-blue-500/50 dark:ring-blue-400/50 bg-blue-50/40 dark:bg-blue-950/20">
        <table className="w-full text-base border-collapse table-fixed">
          <colgroup>
            <col className="w-1/2" />
            <col className="w-1/4" />
            <col className="w-1/4" />
          </colgroup>
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">구분</th>
              <th className="px-3 py-2 text-right font-medium">매출 (백만원)</th>
              <th className="px-3 py-2 text-right font-medium">영업이익 (백만원)</th>
            </tr>
          </thead>
          <tbody>
            <Row
              label={
                calc.ytdN > 0
                  ? `① YTD 연환산 (1~${calc.ytdN}월 × ${(12 / calc.ytdN).toFixed(2)})`
                  : '① YTD 연환산 (데이터 없음)'
              }
              rev={calc.annualizedRev}
              op={calc.annualizedOp}
              emphasized
              isHl={highlighted.has('est-1')}
              toggleProps={rowToggleProps('est-1', '① YTD 연환산')}
            />
            <Row
              label="② YoY 추세 적용 (매출 YoY를 양 지표에 적용)"
              rev={calc.yoyApplyRev}
              op={calc.yoyApplyOp}
              emphasized
              isHl={highlighted.has('est-2')}
              toggleProps={rowToggleProps('est-2', '② YoY 추세 적용')}
            />
            <Row
              label="③ 원타임 보정 추정 (CAGR + 정상 영업이익률)"
              rev={calc.adjRev}
              op={calc.adjOp}
              emphasized
              note={
                basis === 'standalone'
                  ? '연결 비용구조 데이터 기반 — 별도 기준 미지원'
                  : !adjAvailable
                    ? `${calc.cagrFromYear}·${calc.baseYear - 1} 비용구조 데이터 부족`
                    : undefined
              }
              isHl={highlighted.has('est-3')}
              toggleProps={rowToggleProps('est-3', '③ 원타임 보정 추정')}
            />
            <tr
              className={`border-t-2 border-blue-500/40 dark:border-blue-400/40 cursor-pointer ${
                highlighted.has('est-total')
                  ? ROW_HIGHLIGHT_CLASS
                  : 'bg-blue-100/60 dark:bg-blue-900/40'
              }`}
              {...rowToggleProps('est-total', '추정치')}
            >
              <td className="px-3 py-2 font-bold">
                추정치 ({adjAvailable ? '①·②·③ 평균' : '①·② 평균'})
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums font-bold ${
                  calc.estRev != null && calc.estRev < 0 ? 'text-red-500' : ''
                }`}
              >
                {fmtMillion(calc.estRev)}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums font-bold ${
                  calc.estOp != null && calc.estOp < 0 ? 'text-red-500' : ''
                }`}
              >
                {fmtMillion(calc.estOp)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 근거 데이터 표 — 박스 아래 (thead 생략, 위 박스의 헤더 재사용) */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-base border-collapse table-fixed">
          <colgroup>
            <col className="w-1/2" />
            <col className="w-1/4" />
            <col className="w-1/4" />
          </colgroup>
          <tbody>
            <Row
              label={`${calc.baseYear} 연간 실적`}
              rev={calc.actualBase.revenue}
              op={calc.actualBase.op_income}
              isHl={highlighted.has('evi-actual2025')}
              toggleProps={rowToggleProps('evi-actual2025', `${calc.baseYear} 연간 실적`)}
            />
            <Row
              label={`${calc.baseYear} 1~${calc.ytdN}월`}
              rev={calc.ytdBase.revenue}
              op={calc.ytdBase.op_income}
              isHl={highlighted.has('evi-ytd2025')}
              toggleProps={rowToggleProps('evi-ytd2025', `${calc.baseYear} 1~${calc.ytdN}월`)}
            />
            <Row
              label={`${calc.targetYear} 1~${calc.ytdN}월`}
              rev={calc.ytdTarget.revenue}
              op={calc.ytdTarget.op_income}
              isHl={highlighted.has('evi-ytd2026')}
              toggleProps={rowToggleProps('evi-ytd2026', `${calc.targetYear} 1~${calc.ytdN}월`)}
            />
            <tr
              className={`border-t border-border/60 cursor-pointer ${
                highlighted.has('evi-yoy') ? ROW_HIGHLIGHT_CLASS : 'bg-muted/20'
              }`}
              {...rowToggleProps('evi-yoy', `1~${calc.ytdN}월 YoY`)}
            >
              <td className="px-3 py-2 font-medium">1~{calc.ytdN}월 YoY</td>
              <td className={`px-3 py-2 text-right tabular-nums ${neg(calc.yoyRev)}`}>
                {fmtPct(calc.yoyRev)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${neg(calc.yoyOp)}`}>
                {fmtPct(calc.yoyOp)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ③ 원타임 보정 — 비용 항목별 세부 (consolidated 만) */}
      {basis === 'consolidated' && adjAvailable && (
        <div className="mt-4 overflow-x-auto">
          <div className="text-sm font-medium mb-1">③ 원타임 보정 — 비용 항목별 세부</div>
          <table className="w-full text-sm border-collapse">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">비용 항목</th>
                <th className="px-3 py-1.5 text-right font-medium">{calc.cagrFromYear} 비율</th>
                <th className="px-3 py-1.5 text-right font-medium">{calc.baseYear - 1} 비율</th>
                <th className="px-3 py-1.5 text-right font-medium">정상 비율</th>
                <th className="px-3 py-1.5 text-right font-medium">{calc.baseYear} 실제 비율</th>
                <th className="px-3 py-1.5 text-right font-medium">{calc.baseYear} 초과액</th>
              </tr>
            </thead>
            <tbody>
              {calc.costAdjustments.map((c) => (
                <tr
                  key={c.label}
                  className={`border-b border-border/40 cursor-pointer ${
                    highlighted.has(`ot-${c.label}`) ? ROW_HIGHLIGHT_CLASS : 'hover:bg-muted/30'
                  }`}
                  {...rowToggleProps(`ot-${c.label}`, c.label)}
                >
                  <td className="px-3 py-1.5">{c.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtRatio(c.ratio23)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtRatio(c.ratio24)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtRatio(c.normalRatio)}</td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      c.actualRatio25 != null &&
                      c.normalRatio != null &&
                      c.actualRatio25 > c.normalRatio
                        ? 'text-red-500'
                        : ''
                    }`}
                  >
                    {fmtRatio(c.actualRatio25)}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums font-medium ${
                      c.excess25 != null && c.excess25 > 0
                        ? 'text-red-500'
                        : c.excess25 != null && c.excess25 < 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : ''
                    }`}
                  >
                    {fmtSignedMillion(c.excess25)}
                  </td>
                </tr>
              ))}
              <tr
                className={`border-t-2 border-border font-semibold cursor-pointer ${
                  highlighted.has('ot-total') ? ROW_HIGHLIGHT_CLASS : 'bg-muted/20'
                }`}
                {...rowToggleProps('ot-total', '총 원타임 가산')}
              >
                <td className="px-3 py-1.5" colSpan={5}>
                  총 원타임 가산 (영업이익 정상화 보정액)
                </td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums ${
                    calc.totalOneTime != null && calc.totalOneTime > 0
                      ? 'text-red-500'
                      : calc.totalOneTime != null && calc.totalOneTime < 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : ''
                  }`}
                >
                  {fmtSignedMillion(calc.totalOneTime)}
                </td>
              </tr>
              <tr
                className={`font-semibold cursor-pointer ${
                  highlighted.has('ot-normalized')
                    ? ROW_HIGHLIGHT_CLASS
                    : 'bg-blue-50 dark:bg-blue-950/30'
                }`}
                {...rowToggleProps('ot-normalized', `정상화 ${calc.baseYear} 영업이익`)}
              >
                <td className="px-3 py-1.5" colSpan={5}>
                  정상화 {calc.baseYear} 영업이익 / 영업이익률
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {fmtMillion(calc.normalizedOp25)} ({fmtRatio(calc.normalizedOpRatio)})
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted-foreground">
            초과액 = {calc.baseYear} 실제 비용 − {calc.baseYear} 매출 × 정상비율. 양수(빨강)는{' '}
            {calc.baseYear}년에 정상보다 컸음 → 영업이익에 가산하여 정상화. 음수(초록)는 정상보다
            적었음 → 영업이익에서 차감하여 정상화. CAGR({calc.cagrFromYear}→{calc.baseYear}){' '}
            {calc.cagr2y != null && (
              <span className="text-foreground">{fmtPct(calc.cagr2y * 100)}</span>
            )}{' '}
            을 매출 베이스에 함께 반영함.
          </p>
        </div>
      )}

      {/* 추정 로직 설명 */}
      <div className="mt-4 rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm leading-relaxed">
        <div className="font-medium mb-1">추정 로직</div>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">① YTD 연환산</span> : {calc.targetYear}{' '}
            1~N월 합계를 (12÷N)배 확장. 월 추가 적재 시 자동 재산출 — 분기 평균 가정의 단순성은
            유지하되 계절성·신규 수주는 부분 반영.
          </li>
          <li>
            <span className="font-medium text-foreground">② YoY 추세 적용</span> :
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              {calc.baseYear} 연간 × ({calc.targetYear} 1~N월 매출 ÷ {calc.baseYear} 1~N월 매출)
            </code>
            — 매출 성장률을 매출과 영업이익에 동일 적용. 영업이익률이 {calc.baseYear}와 같다고 가정.
            영업이익 자체의 비율 곱셈은 부호가 흔들려 폭증하기 때문에 매출 YoY로 통일.
          </li>
          <li>
            <span className="font-medium text-foreground">③ 원타임 보정 추정</span> :
            <ul className="mt-1 list-[circle] pl-5 space-y-0.5">
              <li>
                매출 — {calc.cagrFromYear}→{calc.baseYear} 2년 CAGR 베이스를 ①·②와 함께 3개 평균.
              </li>
              <li>
                영업이익 — 5개 비용
                카테고리(재료비성[재료비+관세]·운반및보관료·경비·인건비·외주가공비)를{' '}
                {calc.cagrFromYear}·{calc.baseYear - 1} 평균 비율로 정상화. 관세는 {calc.baseYear}
                년부터 분리 적재되어 재료비와 합산해 일관된 정상비율을 산출. 양/음 초과 모두
                영업이익에 반영해 정상화 영업이익률 산출 후 보정 매출에 적용.
              </li>
            </ul>
          </li>
          <li>
            최종 <span className="font-medium text-foreground">추정치</span>는 산출 가능한 항목의
            평균. 세 방법이 크게 갈리면 신뢰도가 낮으니 행별 차이를 함께 확인.
          </li>
          <li>
            한계 : 4월 이후 신규 수주·생산 차질·환율은 반영되지 않음. ③은 {calc.cagrFromYear}·
            {calc.baseYear - 1} 평균을 정상으로 가정하므로 구조적 변화(원가 구조 자체 이동)도
            일회성으로 분류될 수 있음.
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
  note,
  isHl,
  toggleProps,
}: {
  label: string;
  rev: number | null;
  op: number | null;
  emphasized?: boolean;
  note?: string;
  isHl: boolean;
  toggleProps: ToggleProps;
}) {
  const cls = emphasized ? 'font-medium' : '';
  return (
    <tr
      className={`border-b border-border/40 cursor-pointer ${
        isHl ? ROW_HIGHLIGHT_CLASS : emphasized ? 'bg-muted/10' : 'hover:bg-muted/30'
      }`}
      {...toggleProps}
    >
      <td className={`px-3 py-2 ${cls}`}>
        {label}
        {note && <span className="ml-2 text-xs text-muted-foreground">({note})</span>}
      </td>
      <td
        className={`px-3 py-2 text-right tabular-nums ${cls} ${
          rev != null && rev < 0 ? 'text-red-500' : ''
        }`}
      >
        {fmtMillion(rev)}
      </td>
      <td
        className={`px-3 py-2 text-right tabular-nums ${cls} ${
          op != null && op < 0 ? 'text-red-500' : ''
        }`}
      >
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
  value: number | null;
  actualLabel: string;
  actualValue: number;
  changePct: number | null;
}) {
  const isNeg = value != null && value < 0;
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

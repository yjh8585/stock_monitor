'use client';

import { useMemo } from 'react';
import type { CostStructureRow } from '@/lib/pnl/types';

interface Props {
  costStructure: CostStructureRow[];
}

/** 표 컬럼 정의 — 연도 라벨, 매칭 필터 */
type ColumnDef = {
  label: string;
  match: (r: CostStructureRow) => boolean;
};

/** 행 정의 — 단일 '구분' 컬럼에 depth 들여쓰기로 카테고리·계정을 함께 표시. */
type RowDef = {
  label: string;
  /** 0=매출/영업이익, 1=카테고리(재료비성 등), 2=계정(재료비/관세 등) */
  depth: 0 | 1 | 2;
  /** 합산 대상 account 목록 (1개=계정, 다수=카테고리 합) */
  accounts: readonly string[];
  /** 굵게/구분선 강조 */
  emphasis: 'header' | 'category' | 'normal' | 'footer';
};

const ROW_DEFS: readonly RowDef[] = [
  { label: '매출', depth: 0, accounts: ['매출'], emphasis: 'header' },
  { label: '재료비성', depth: 1, accounts: ['재료비', '관세'], emphasis: 'category' },
  { label: '재료비', depth: 2, accounts: ['재료비'], emphasis: 'normal' },
  { label: '관세', depth: 2, accounts: ['관세'], emphasis: 'normal' },
  { label: '경비성', depth: 1, accounts: ['운반및보관료', '경비'], emphasis: 'category' },
  { label: '운반및보관료', depth: 2, accounts: ['운반및보관료'], emphasis: 'normal' },
  { label: '경비', depth: 2, accounts: ['경비'], emphasis: 'normal' },
  { label: '인건비성', depth: 1, accounts: ['인건비', '외주가공비'], emphasis: 'category' },
  { label: '인건비', depth: 2, accounts: ['인건비'], emphasis: 'normal' },
  { label: '외주가공비', depth: 2, accounts: ['외주가공비'], emphasis: 'normal' },
  { label: '영업이익', depth: 0, accounts: ['영업이익'], emphasis: 'footer' },
];

/** 진행 연도(2026) monthly 실적의 최대 월수 계산 — 1~N월까지 적재된 데이터를 자동 합산. */
function maxYtdMonth(rows: readonly CostStructureRow[], year: number): number {
  let maxM = 0;
  for (const r of rows) {
    if (r.period_year !== year || r.period_kind !== 'monthly' || r.kind !== 'actual') continue;
    if (r.period_month > maxM) maxM = r.period_month;
  }
  return maxM;
}

function buildColumnDefs(rows: readonly CostStructureRow[]): ColumnDef[] {
  const ytdMonth = maxYtdMonth(rows, 2026);
  const defs: ColumnDef[] = [
    {
      label: '2023',
      match: (r) => r.period_year === 2023 && r.period_kind === 'annual' && r.kind === 'actual',
    },
    {
      label: '2024',
      match: (r) => r.period_year === 2024 && r.period_kind === 'annual' && r.kind === 'actual',
    },
    {
      label: '2025',
      match: (r) => r.period_year === 2025 && r.period_kind === 'annual' && r.kind === 'actual',
    },
  ];
  if (ytdMonth > 0) {
    defs.push({
      label: ytdMonth === 12 ? '2026' : `2026 YTD (1~${ytdMonth}월)`,
      match: (r) =>
        r.period_year === 2026 &&
        r.period_kind === 'monthly' &&
        r.kind === 'actual' &&
        r.period_month >= 1 &&
        r.period_month <= ytdMonth,
    });
  }
  return defs;
}

function fmtMillion(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Math.round(v).toLocaleString('ko-KR');
}

function fmtRatio(part: number | null, total: number | null): string {
  if (part === null || total === null || total === 0 || !Number.isFinite(total)) return '—';
  return `${((part / total) * 100).toFixed(1)}%`;
}

/** 다수 account를 한 번에 합산 (카테고리 소계용). */
function sumAccounts(rows: CostStructureRow[], accounts: readonly string[]): number | null {
  let hasValue = false;
  let sum = 0;
  for (const r of rows) {
    if (!accounts.includes(r.account)) continue;
    if (r.value_mwon === null) continue;
    sum += r.value_mwon;
    hasValue = true;
  }
  return hasValue ? sum : null;
}

/**
 * 1. 전사 비용구조 — 엑셀 비용비율 시트 기반.
 *
 * - 행: 매출 / 재료비·관세 / 운반및보관료·경비 / 인건비·외주가공비 / 영업이익
 * - 열: 2023~2025 연간 실적, 2026 YTD (1~3월 합)
 * - 각 셀: 백만원 (위) + 매출 대비 비율% (아래)
 * - 연결 기준만 (별도 비용비율 데이터는 시트에 없음)
 */
export default function CostStructure({ costStructure }: Props) {
  /** 컬럼별 필터링된 row 묶음 + 매출 캐시. 2026 YTD 컬럼은 데이터에서 최대 월 자동 검출. */
  const columns = useMemo(() => {
    return buildColumnDefs(costStructure).map((col) => {
      const rows = costStructure.filter(col.match);
      const revenue = sumAccounts(rows, ['매출']);
      return { ...col, rows, revenue };
    });
  }, [costStructure]);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="mb-3">
        <h2 className="text-lg font-semibold">1. 전사 비용구조</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          연결 기준 · 2026은 1~{maxYtdMonth(costStructure, 2026) || 0}월 누적(YTD) 실적 · 단위 백만원
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-base">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-muted border-r border-border px-3 py-2 text-left font-medium">
                구분
              </th>
              {columns.map((c) => (
                <th key={c.label} className="px-3 py-2 text-right font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROW_DEFS.map((row) => {
              const isEmphasized =
                row.emphasis === 'header' ||
                row.emphasis === 'footer' ||
                row.emphasis === 'category';
              // thead(bg-muted/40 회색)와 색조를 달리해 구분.
              // 9. 전년 대비 월별 비교의 blue-600 베이스 + 45% 투명도 2톤과 동일 계열 사용:
              //  매출/영업이익 = 진한 파랑
              //  카테고리      = 옅은 파랑
              //  일반          = 무색
              const rowBg =
                row.emphasis === 'header' || row.emphasis === 'footer'
                  ? 'bg-blue-100 dark:bg-blue-900/40'
                  : row.emphasis === 'category'
                    ? 'bg-blue-50 dark:bg-blue-950/30'
                    : '';
              const rowExtra =
                row.emphasis === 'footer'
                  ? 'border-t-2 border-border'
                  : row.emphasis === 'category'
                    ? 'border-t border-border/60'
                    : '';
              const rowClass = `${rowBg} ${rowExtra} ${isEmphasized ? 'font-semibold' : ''}`.trim();
              // sticky 라벨 셀은 자체 배경이 우선해서 행 배경이 가려진다. 명시적으로 동일 톤을 입혀준다.
              const labelBg = rowBg || 'bg-card';
              const indentStyle = { paddingLeft: `${0.75 + row.depth * 1.25}rem` };
              const isRevenue = row.label === '매출';
              return (
                <tr key={row.label} className={rowClass}>
                  <td
                    className={`sticky left-0 z-10 ${labelBg} border-r border-border py-2 pr-3 align-middle`}
                    style={indentStyle}
                  >
                    {row.label}
                  </td>
                  {columns.map((c) => {
                    const value = sumAccounts(c.rows, row.accounts);
                    const isNegative = value !== null && value < 0;
                    return (
                      <td key={c.label} className="px-3 py-2 text-right align-middle tabular-nums">
                        <div className={isNegative ? 'text-red-500' : ''}>{fmtMillion(value)}</div>
                        {!isRevenue ? (
                          <div
                            className={
                              isNegative ? 'text-sm text-red-500' : 'text-sm text-muted-foreground'
                            }
                          >
                            {fmtRatio(value, c.revenue)}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">100.0%</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

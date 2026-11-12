import { MIN_YOY_PREV_SALES } from '@/lib/oem-companies/kg-mobility/aggregate';
import type { CompanySaleRowWithPt, CompanyTimeSeriesPoint, OemSalesGroupMonth } from '@/lib/types';

/**
 * MarkLines 월 판매 점 → 분기 점(물량 차트 「분기」 보기 · A9). 석 달이 다 있는 분기만 — 진행 중인 분기를
 * 두 달 합으로 그리면 회사 발표 분기와 견줄 때 「급감」으로 보인다. period = 'YYYY-Qn'(회사 발표 분기와 같은 꼴).
 * YoY 는 월 점과 같은 문턱(MIN_YOY_PREV_SALES).
 */
export function monthlyToQuarterly(monthly: CompanyTimeSeriesPoint[]): CompanyTimeSeriesPoint[] {
  const sums = new Map<string, { sales: number; months: number }>();
  for (const p of monthly) {
    const m = /^(\d{4})-(\d{2})$/.exec(p.period);
    if (!m) continue;
    const key = `${m[1]}-Q${Math.ceil(Number(m[2]) / 3)}`;
    const cur = sums.get(key) ?? { sales: 0, months: 0 };
    sums.set(key, { sales: cur.sales + p.sales, months: cur.months + 1 });
  }
  const full = [...sums].filter(([, v]) => v.months === 3).sort(([a], [b]) => a.localeCompare(b));
  const byKey = new Map(full);
  return full.map(([period, v]) => {
    const prev = byKey.get(`${Number(period.slice(0, 4)) - 1}${period.slice(4)}`)?.sales;
    return {
      period,
      period_label: period.replace('-', ''),
      sales: v.sales,
      yoy_pct: prev == null || prev < MIN_YOY_PREV_SALES ? null : ((v.sales - prev) / prev) * 100,
    };
  });
}

/** MarkLines 차종 월 행(나라별 · 판매 또는 생산) — `customer_accounts.marklines_models` 가 있는 고객사. */
export interface ModelMonthRow {
  model: string;
  year_month: number;
  value: number;
}

/**
 * 차종 월 행 → 그룹 월 꼴(차종 합) — 아래 groupMonthToSaleRows 에 그대로 넘긴다(그룹 전체 대신 그 회사 차종만).
 * 첫 달~끝 달 사이 빈 달은 0대로 채운다 — 적재기(import_oem_sales.py)가 0대 행을 저장하지 않아, 차종 몇 개만 모으면
 * 판매 없는 달이 «행 없음»이 되고 연간 집계는 그 달을 전년 비교에서 빼 KPI 와 YoY 가 갈린다(Codex 2026-11-12).
 */
export function modelMonthsToGroupMonth(
  rows: ModelMonthRow[],
  group: string
): OemSalesGroupMonth[] {
  const sums = new Map<number, number>();
  for (const r of rows) sums.set(r.year_month, (sums.get(r.year_month) ?? 0) + r.value);
  if (sums.size === 0) return [];
  const yms = [...sums.keys()];
  const out: OemSalesGroupMonth[] = [];
  for (let ym = Math.min(...yms); ym <= Math.max(...yms); ym = ym % 100 === 12 ? ym + 89 : ym + 1) {
    out.push({ oem_group: group, year_month: ym, sales: sums.get(ym) ?? 0 });
  }
  return out;
}

export interface ModelQuarterRow {
  model: string;
  kind: 'production' | 'sales';
  values: (number | null)[];
}

/** 차종별 분기 생산·판매 표 — periods = 'YYYY-Qn'(오름차순 · 최근 columns 개). */
export interface ModelQuarterTable {
  periods: string[];
  rows: ModelQuarterRow[];
}

const quarterOf = (ym: number) => `${Math.floor(ym / 100)}-Q${Math.ceil((ym % 100) / 3)}`;

/**
 * 차종별 분기 표 — 생산 블록 다음 판매 블록 · 블록 안은 보이는 분기 합이 큰 차종부터.
 * 분기는 그 갈래(생산·판매)에서 석 달이 다 들어온 것만 값이 있다(생산은 판매보다 한 달 늦게 들어온다 —
 * 진행 중인 분기를 한두 달 합으로 적으면 급감으로 보인다 · monthlyToQuarterly 와 같은 규칙).
 * 그 분기에 그 차종 행이 하나도 없으면 null(「—」 · 출시 전·단종 뒤).
 */
export function modelQuarterTable(
  production: ModelMonthRow[],
  sales: ModelMonthRow[],
  columns = 6
): ModelQuarterTable | null {
  const complete = (rows: ModelMonthRow[]) => {
    const months = new Map<string, Set<number>>();
    for (const r of rows) {
      const q = quarterOf(r.year_month);
      months.set(q, (months.get(q) ?? new Set()).add(r.year_month));
    }
    return new Set([...months].filter(([, ms]) => ms.size === 3).map(([q]) => q));
  };
  const done = { production: complete(production), sales: complete(sales) };
  const periods = [...new Set([...done.production, ...done.sales])].sort().slice(-columns);
  if (periods.length === 0) return null;
  const block = (kind: 'production' | 'sales', rows: ModelMonthRow[]): ModelQuarterRow[] => {
    const sums = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const byQ = sums.get(r.model) ?? new Map<string, number>();
      const q = quarterOf(r.year_month);
      byQ.set(q, (byQ.get(q) ?? 0) + r.value);
      sums.set(r.model, byQ);
    }
    return [...sums]
      .map(([model, byQ]) => ({
        model,
        kind,
        values: periods.map((p) => (done[kind].has(p) ? (byQ.get(p) ?? null) : null)),
      }))
      .filter((r) => r.values.some((v) => v != null))
      .sort((a, b) => sumOf(b.values) - sumOf(a.values) || a.model.localeCompare(b.model));
  };
  const rows = [...block('production', production), ...block('sales', sales)];
  return rows.length > 0 ? { periods, rows } : null;
}

const sumOf = (vs: (number | null)[]) => vs.reduce<number>((s, v) => s + (v ?? 0), 0);

/**
 * MarkLines 그룹 월 판매 → OEM 회사 탭 집계 함수(`kg-mobility/aggregate.ts`)의 입력 행.
 * 그룹 월 표엔 지역·차종·PT 가 없어 빈 값 → EV 비중은 계산하지 않는다(호출부가 null 로 덮는다).
 */
export function groupMonthToSaleRows(
  rows: OemSalesGroupMonth[],
  group: string
): CompanySaleRowWithPt[] {
  return rows
    .filter((r) => r.oem_group === group)
    .map((r) => {
      const s = String(r.year_month);
      return {
        period_type: 'month' as const,
        year_period: `${s.slice(0, 4)}-${s.slice(4, 6)}`,
        region: '',
        vehicle_model: '',
        vehicle_type: '',
        powertrain: null,
        sales_units: r.sales,
        source_url: null,
        resolved_powertrain: null,
      };
    });
}

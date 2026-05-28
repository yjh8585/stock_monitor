/** 재고(/management/inventory) 도메인 — pure 변환 함수. */
import type {
  InventoryRow,
  StatusMonthPoint,
  AchievementMonthPoint,
  InventoryKpis,
  AchievementCategory,
  TransportItem,
} from './types';

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function fmtMonth(year: number, month: number): string {
  return `${year}.${String(month).padStart(2, '0')}`;
}

/**
 * 단일 row를 원화(억원)로 환산.
 * - '억원' → 그대로
 * - '백만USD' → value × fx_rate / 100 (백만USD × 원/USD ÷ 100 = 억원)
 * - unit null (회전율) → null
 * - value null 또는 (백만USD 인데 fx_rate null) → null
 */
export function convertToKrwEok(r: InventoryRow): number | null {
  if (r.value === null) return null;
  if (r.unit === '억원') return round(r.value);
  if (r.unit === '백만USD') {
    if (r.fx_rate === null) return null;
    return round((r.value * r.fx_rate) / 100);
  }
  return null;
}

/**
 * 차트 1 (재고 현황) 월별 포인트 빌더 — 실적만.
 *
 * - operating/management/compensation: 각 분류 단일 항목 (억원)
 * - transport: 영업 + 미국환산 + 우즈벡환산
 * - total: 4개 합 (data label용)
 * - turnover: 전체-회전율 행
 *
 * (year, month) 키로 그룹핑 후 오름차순 정렬.
 */
export function buildStatusPoints(rows: readonly InventoryRow[]): StatusMonthPoint[] {
  const byKey = new Map<string, StatusMonthPoint>();
  for (const r of rows) {
    if (r.kind !== 'actual') continue;
    const key = `${r.period_year}-${r.period_month}`;
    let p = byKey.get(key);
    if (!p) {
      p = {
        monthLabel: fmtMonth(r.period_year, r.period_month),
        year: r.period_year,
        month: r.period_month,
        operating: null,
        management: null,
        compensation: null,
        transport: null,
        total: null,
        turnover: null,
      };
      byKey.set(key, p);
    }
    if (r.category === '운영' && r.item === '운영 재고') {
      p.operating = convertToKrwEok(r);
    } else if (r.category === '관리' && r.item === '관리 재고') {
      p.management = convertToKrwEok(r);
    } else if (r.category === '보상' && r.item === '보상 재고') {
      p.compensation = convertToKrwEok(r);
    } else if (r.category === '운송') {
      const v = convertToKrwEok(r);
      if (v !== null) p.transport = round((p.transport ?? 0) + v);
    } else if (r.category === '전체' && r.item === '회전율') {
      p.turnover = r.value === null ? null : round(r.value);
    }
  }
  for (const p of byKey.values()) {
    const parts = [p.operating, p.management, p.compensation, p.transport];
    if (parts.every((v) => v === null)) {
      p.total = null;
    } else {
      p.total = round(parts.reduce<number>((s, v) => s + (v ?? 0), 0));
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.year - b.year || a.month - b.month);
}

const CATEGORY_FILTER: Record<AchievementCategory, (r: InventoryRow) => boolean> = {
  total: (r) => r.category === '전체' && r.item === '전체 재고',
  operating: (r) => r.category === '운영' && r.item === '운영 재고',
  management: (r) => r.category === '관리' && r.item === '관리 재고',
  compensation: (r) => r.category === '보상' && r.item === '보상 재고',
  transport: (r) =>
    r.category === '운송' &&
    (r.item === '영업 재고' || r.item === '미국 운송' || r.item === '우즈벡 운송'),
};

interface AchAgg {
  plan: number;
  planHasVal: boolean;
  actual: number;
  actualHasVal: boolean;
  year: number;
  month: number;
}

function aggregateAchievement(
  rows: readonly InventoryRow[],
): AchievementMonthPoint[] {
  const byKey = new Map<string, AchAgg>();
  for (const r of rows) {
    const key = `${r.period_year}-${r.period_month}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        plan: 0,
        planHasVal: false,
        actual: 0,
        actualHasVal: false,
        year: r.period_year,
        month: r.period_month,
      };
      byKey.set(key, agg);
    }
    const v = convertToKrwEok(r);
    if (v === null) continue;
    if (r.kind === 'plan') {
      agg.plan += v;
      agg.planHasVal = true;
    } else {
      agg.actual += v;
      agg.actualHasVal = true;
    }
  }
  const pts: AchievementMonthPoint[] = [];
  for (const [, agg] of byKey) {
    const plan = agg.planHasVal ? round(agg.plan) : null;
    const actual = agg.actualHasVal ? round(agg.actual) : null;
    const rate = plan && plan !== 0 && actual !== null ? round((actual / plan) * 100) : null;
    pts.push({
      monthLabel: fmtMonth(agg.year, agg.month),
      year: agg.year,
      month: agg.month,
      plan,
      actual,
      rate,
    });
  }
  return pts.sort((a, b) => a.year - b.year || a.month - b.month);
}

/**
 * 차트 2 (계획대비 실적) — 카테고리별 월별 포인트.
 * 운송은 3개 항목 합산. 그 외는 단일 항목. 단위는 모두 억원.
 */
export function buildAchievementPoints(
  rows: readonly InventoryRow[],
  category: AchievementCategory,
): AchievementMonthPoint[] {
  return aggregateAchievement(rows.filter(CATEGORY_FILTER[category]));
}

const TRANSPORT_ITEM_MAP: Record<TransportItem, string> = {
  us: '미국 운송',
  uz: '우즈벡 운송',
  sales: '영업 재고',
};

/**
 * 차트 3 (계획대비 운송) — 운송 분류 단일 항목 토글.
 */
export function buildTransportPoints(
  rows: readonly InventoryRow[],
  item: TransportItem,
): AchievementMonthPoint[] {
  const targetItem = TRANSPORT_ITEM_MAP[item];
  return aggregateAchievement(
    rows.filter((r) => r.category === '운송' && r.item === targetItem),
  );
}

/**
 * KPI 카드 — 최신 실적 월(전체 재고 actual 존재) 기준.
 */
export function buildKpis(rows: readonly InventoryRow[]): InventoryKpis {
  const totalActuals = rows.filter(
    (r) =>
      r.category === '전체' &&
      r.item === '전체 재고' &&
      r.kind === 'actual' &&
      r.value !== null,
  );
  if (totalActuals.length === 0) {
    return {
      latestLabel: '—',
      totalEok: null,
      totalMomPct: null,
      turnover: null,
      turnoverDays: null,
      achievementPct: null,
      transportSharePct: null,
    };
  }
  const sorted = [...totalActuals].sort(
    (a, b) => b.period_year - a.period_year || b.period_month - a.period_month,
  );
  const latest = sorted[0];
  const prev = sorted[1] ?? null;
  const latestLabel = fmtMonth(latest.period_year, latest.period_month);
  const totalEok = convertToKrwEok(latest);

  let totalMomPct: number | null = null;
  if (totalEok !== null && prev !== null) {
    const prevVal = convertToKrwEok(prev);
    if (prevVal !== null && prevVal !== 0) {
      totalMomPct = round(((totalEok - prevVal) / prevVal) * 100);
    }
  }

  const turnoverRow = rows.find(
    (r) =>
      r.category === '전체' &&
      r.item === '회전율' &&
      r.kind === 'actual' &&
      r.period_year === latest.period_year &&
      r.period_month === latest.period_month,
  );
  const turnover = turnoverRow?.value ?? null;
  const turnoverDays = turnover && turnover !== 0 ? Math.round(365 / turnover) : null;

  const planRow = rows.find(
    (r) =>
      r.category === '전체' &&
      r.item === '전체 재고' &&
      r.kind === 'plan' &&
      r.period_year === latest.period_year &&
      r.period_month === latest.period_month,
  );
  const planVal = planRow ? convertToKrwEok(planRow) : null;
  const achievementPct =
    totalEok !== null && planVal !== null && planVal !== 0
      ? round((totalEok / planVal) * 100)
      : null;

  let transportSum = 0;
  let transportHas = false;
  for (const r of rows) {
    if (
      r.category !== '운송' ||
      r.kind !== 'actual' ||
      r.period_year !== latest.period_year ||
      r.period_month !== latest.period_month
    )
      continue;
    const v = convertToKrwEok(r);
    if (v !== null) {
      transportSum += v;
      transportHas = true;
    }
  }
  const transportSharePct =
    transportHas && totalEok !== null && totalEok !== 0
      ? round((transportSum / totalEok) * 100)
      : null;

  return {
    latestLabel,
    totalEok,
    totalMomPct,
    turnover,
    turnoverDays,
    achievementPct,
    transportSharePct,
  };
}

/** 인원(/management/personnel) 도메인 — pure 변환 함수. */
import type {
  PersonnelRow,
  PersonnelKind,
  KindMode,
  OverseasRegion,
  MixOption,
  OverallStackPoint,
  DomesticStackPoint,
  OverseasPoint,
  MixPoint,
  FieldMixPoint,
  TableCell,
  TableRowItem,
  TableData,
} from './types';

/** 국내 detail 중 '현장'으로 분류되는 부문 */
const FIELD_DETAILS = new Set(['생산', '품질', '연구소']);

const OVERSEAS_REGION_MAP: Record<OverseasRegion, PersonnelRow['region']> = {
  us: '미국',
  cn: '중국',
  uz: '우즈벡',
  intel: '이인텔리전스',
};

/** YYYY-MM-DD → 'YYYY.MM' (월까지만 표시. 과거=12, 올해=현재월) */
function fmtPeriod(date: string): string {
  const [y, m] = date.split('-');
  return `${y}.${m}`;
}

/** kind 필터 — KindMode에 해당하는 kind 목록 */
function kindsOf(mode: KindMode): PersonnelKind[] {
  if (mode === 'all') return ['임원', '사무', '생산'];
  if (mode === 'office') return ['임원', '사무'];
  return ['생산'];
}

function sumHeadcount(rows: readonly PersonnelRow[]): number | null {
  let sum = 0;
  let has = false;
  for (const r of rows) {
    if (r.headcount !== null) {
      sum += r.headcount;
      has = true;
    }
  }
  return has ? sum : null;
}

function uniqueDates(rows: readonly PersonnelRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) set.add(r.period_date);
  return Array.from(set).sort();
}

/**
 * 차트 1 — 전체 인원 현황 (5층 누적).
 * - 국내(외주 포함) / 미국 / 중국 / 우즈벡 / 이인텔리전스
 * - mode: all / office(=임원+사무) / production
 */
export function buildOverallPoints(
  rows: readonly PersonnelRow[],
  mode: KindMode
): OverallStackPoint[] {
  const kinds = new Set<PersonnelKind>(kindsOf(mode));
  const filtered = rows.filter((r) => kinds.has(r.kind));
  const dates = uniqueDates(filtered);
  return dates.map((date) => {
    const at = filtered.filter((r) => r.period_date === date);
    const domestic = sumHeadcount(at.filter((r) => r.region === '국내' || r.region === '외주'));
    const us = sumHeadcount(at.filter((r) => r.region === '미국'));
    const cn = sumHeadcount(at.filter((r) => r.region === '중국'));
    const uz = sumHeadcount(at.filter((r) => r.region === '우즈벡'));
    const intel = sumHeadcount(at.filter((r) => r.region === '이인텔리전스'));
    const parts = [domestic, us, cn, uz, intel];
    const total = parts.every((v) => v === null)
      ? null
      : parts.reduce<number>((s, v) => s + (v ?? 0), 0);
    return {
      periodLabel: fmtPeriod(date),
      periodDate: date,
      domestic,
      us,
      cn,
      uz,
      intel,
      total,
    };
  });
}

/**
 * 차트 2 — 국내 인원 현황 (3층 누적).
 * - 국내(11 detail 합) / 사내외주 / 협력사원
 * - mode: all / office / production
 */
export function buildDomesticPoints(
  rows: readonly PersonnelRow[],
  mode: KindMode
): DomesticStackPoint[] {
  const kinds = new Set<PersonnelKind>(kindsOf(mode));
  const filtered = rows.filter((r) => kinds.has(r.kind));
  const dates = uniqueDates(filtered);
  return dates.map((date) => {
    const at = filtered.filter((r) => r.period_date === date);
    const domestic = sumHeadcount(at.filter((r) => r.region === '국내'));
    const internal = sumHeadcount(at.filter((r) => r.region === '외주' && r.detail === '사내외주'));
    const partner = sumHeadcount(at.filter((r) => r.region === '외주' && r.detail === '협력사원'));
    const parts = [domestic, internal, partner];
    const total = parts.every((v) => v === null)
      ? null
      : parts.reduce<number>((s, v) => s + (v ?? 0), 0);
    return {
      periodLabel: fmtPeriod(date),
      periodDate: date,
      domestic,
      internal,
      partner,
      total,
    };
  });
}

/**
 * 차트 3 — 해외/자회사 단일 막대.
 * - region: us/cn/uz/intel
 * - 임원+사무+생산 모두 합산
 */
export function buildOverseasPoints(
  rows: readonly PersonnelRow[],
  region: OverseasRegion
): OverseasPoint[] {
  const target = OVERSEAS_REGION_MAP[region];
  const filtered = rows.filter((r) => r.region === target);
  const dates = uniqueDates(filtered);
  return dates.map((date) => {
    const at = filtered.filter((r) => r.period_date === date);
    return {
      periodLabel: fmtPeriod(date),
      periodDate: date,
      headcount: sumHeadcount(at),
    };
  });
}

/**
 * MixOption → 행 필터 함수.
 */
function mixFilter(option: MixOption): (r: PersonnelRow) => boolean {
  switch (option) {
    case 'all':
      return () => true;
    case 'domestic-outsource':
      return (r) => r.region === '국내' || r.region === '외주';
    case 'domestic':
      return (r) => r.region === '국내';
    case 'us':
      return (r) => r.region === '미국';
    case 'cn':
      return (r) => r.region === '중국';
    case 'uz':
      return (r) => r.region === '우즈벡';
  }
}

/**
 * 차트 4 — 사무/생산 비중.
 * - 사무 = 임원+사무, 생산 = 생산
 * - 누적막대 2층 + 비중(%) 데이터 레이블
 */
export function buildMixPoints(rows: readonly PersonnelRow[], option: MixOption): MixPoint[] {
  const filtered = rows.filter(mixFilter(option));
  const dates = uniqueDates(filtered);
  return dates.map((date) => {
    const at = filtered.filter((r) => r.period_date === date);
    const office = sumHeadcount(at.filter((r) => r.kind === '임원' || r.kind === '사무'));
    const production = sumHeadcount(at.filter((r) => r.kind === '생산'));
    const total = office === null && production === null ? null : (office ?? 0) + (production ?? 0);
    const officePct =
      total !== null && total !== 0 && office !== null ? (office / total) * 100 : null;
    const productionPct =
      total !== null && total !== 0 && production !== null ? (production / total) * 100 : null;
    return {
      periodLabel: fmtPeriod(date),
      periodDate: date,
      office,
      production,
      total,
      officePct,
      productionPct,
    };
  });
}

/**
 * 차트 5 — 현장/관리 구분 (국내 인원 기준).
 * - 현장 = 지역=국내 + detail∈{생산, 품질, 연구소}
 * - 관리 = 지역=국내 + detail∉{생산, 품질, 연구소}
 * - 임원·사무·생산 모두 합산 (kind 무관)
 */
export function buildFieldMixPoints(rows: readonly PersonnelRow[]): FieldMixPoint[] {
  const filtered = rows.filter((r) => r.region === '국내');
  const dates = uniqueDates(filtered);
  return dates.map((date) => {
    const at = filtered.filter((r) => r.period_date === date);
    const field = sumHeadcount(at.filter((r) => FIELD_DETAILS.has(r.detail)));
    const admin = sumHeadcount(at.filter((r) => !FIELD_DETAILS.has(r.detail)));
    const total = field === null && admin === null ? null : (field ?? 0) + (admin ?? 0);
    const fieldPct = total !== null && total !== 0 && field !== null ? (field / total) * 100 : null;
    const adminPct = total !== null && total !== 0 && admin !== null ? (admin / total) * 100 : null;
    return {
      periodLabel: fmtPeriod(date),
      periodDate: date,
      field,
      admin,
      total,
      fieldPct,
      adminPct,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// 차트 6 — 인원 수 표
// ─────────────────────────────────────────────────────────────────────

/** 특정 (region, detail) 그룹의 시점별 cell 계산 */
function buildCell(
  rows: readonly PersonnelRow[],
  periods: string[],
  pred: (r: PersonnelRow) => boolean
): Record<string, TableCell> {
  const out: Record<string, TableCell> = {};
  for (const date of periods) {
    const at = rows.filter((r) => r.period_date === date && pred(r));
    const e = sumHeadcount(at.filter((r) => r.kind === '임원'));
    const s = sumHeadcount(at.filter((r) => r.kind === '사무'));
    const p = sumHeadcount(at.filter((r) => r.kind === '생산'));
    const parts = [e, s, p];
    const total = parts.every((v) => v === null)
      ? null
      : parts.reduce<number>((acc, v) => acc + (v ?? 0), 0);
    out[date] = { 임원: e, 사무: s, 생산: p, total };
  }
  return out;
}

/** 국내 detail 표시 순서 (엑셀 입력 순서 유지) */
const DOMESTIC_DETAIL_ORDER = [
  'PM',
  '구매',
  '생산',
  '연구소',
  '영업',
  '재무',
  '지원',
  '총괄',
  '품질',
  '해외',
  '현지화',
];

const OVERSEAS_ORDER: PersonnelRow['region'][] = ['미국', '중국', '우즈벡', '이인텔리전스'];

/**
 * 차트 5 — 표 데이터 빌더.
 * 구조:
 *   국내 detail 11개 + 국내 소계
 *   외주 detail 2개(사내외주·협력사원) + 국내+외주 소계
 *   해외/자회사 4개 + 해외 소계
 *   전체 합계
 */
export function buildTableData(rows: readonly PersonnelRow[]): TableData {
  const dates = uniqueDates(rows);
  const periods = dates.map((d) => ({ date: d, label: fmtPeriod(d) }));
  const result: TableRowItem[] = [];

  // 1) 국내 detail 11개
  for (const det of DOMESTIC_DETAIL_ORDER) {
    result.push({
      type: 'detail',
      group: '국내',
      label: det,
      values: buildCell(rows, dates, (r) => r.region === '국내' && r.detail === det),
    });
  }
  // 1a) 국내 소계
  result.push({
    type: 'subtotal',
    group: '국내',
    label: '국내 소계',
    values: buildCell(rows, dates, (r) => r.region === '국내'),
  });

  // 2) 외주 detail 2개
  for (const det of ['사내외주', '협력사원']) {
    result.push({
      type: 'detail',
      group: '외주',
      label: det,
      values: buildCell(rows, dates, (r) => r.region === '외주' && r.detail === det),
    });
  }
  // 2a) 국내+외주 소계
  result.push({
    type: 'subtotal',
    group: '국내+외주',
    label: '국내+외주 소계',
    values: buildCell(rows, dates, (r) => r.region === '국내' || r.region === '외주'),
  });

  // 3) 해외/자회사 4개 (region별 단일 행)
  for (const reg of OVERSEAS_ORDER) {
    result.push({
      type: 'detail',
      group: '해외 및 자회사',
      label: reg,
      values: buildCell(rows, dates, (r) => r.region === reg),
    });
  }
  // 3a) 해외 소계
  result.push({
    type: 'subtotal',
    group: '해외 및 자회사',
    label: '해외 및 자회사 소계',
    values: buildCell(
      rows,
      dates,
      (r) =>
        r.region === '미국' ||
        r.region === '중국' ||
        r.region === '우즈벡' ||
        r.region === '이인텔리전스'
    ),
  });

  // 4) 전체 합계
  result.push({
    type: 'total',
    group: '전체',
    label: '전체 합계',
    values: buildCell(rows, dates, () => true),
  });

  return { periods, rows: result };
}

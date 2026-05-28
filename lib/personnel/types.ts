/** 인원(/management/personnel) 도메인 타입. */

export type PersonnelKind = '임원' | '사무' | '생산';
export type PersonnelRegion = '국내' | '외주' | '미국' | '중국' | '우즈벡' | '이인텔리전스';

/** personnel_entries DB row */
export interface PersonnelRow {
  region: PersonnelRegion;
  detail: string;
  kind: PersonnelKind;
  /** YYYY-MM-DD */
  period_date: string;
  headcount: number | null;
}

/** 차트 1·2 토글 — 사무 = 임원 + 사무 */
export type KindMode = 'all' | 'office' | 'production';

/** 차트 3 해외 자회사 토글 */
export type OverseasRegion = 'us' | 'cn' | 'uz' | 'intel';

/** 차트 4 사무/생산 비중 드롭다운 옵션 */
export type MixOption = 'all' | 'domestic-outsource' | 'domestic' | 'us' | 'cn' | 'uz';

/** 차트 1 — 전체 인원 현황 (5층 누적) */
export interface OverallStackPoint {
  periodLabel: string;
  periodDate: string;
  /** 국내(외주 포함) */
  domestic: number | null;
  us: number | null;
  cn: number | null;
  uz: number | null;
  intel: number | null;
  total: number | null;
}

/** 차트 2 — 국내 인원 현황 (3층 누적) */
export interface DomesticStackPoint {
  periodLabel: string;
  periodDate: string;
  /** 지역=국내 (11개 detail 합) */
  domestic: number | null;
  /** 외주-사내외주 */
  internal: number | null;
  /** 외주-협력사원 */
  partner: number | null;
  total: number | null;
}

/** 차트 3 — 해외/자회사 단일 막대 */
export interface OverseasPoint {
  periodLabel: string;
  periodDate: string;
  headcount: number | null;
}

/** 차트 4 — 사무/생산 비중 */
export interface MixPoint {
  periodLabel: string;
  periodDate: string;
  /** 임원+사무 */
  office: number | null;
  production: number | null;
  total: number | null;
  /** office / total × 100 */
  officePct: number | null;
  productionPct: number | null;
}

/** 차트 5 — 표의 한 cell (시점별 구분 카운트) */
export interface TableCell {
  임원: number | null;
  사무: number | null;
  생산: number | null;
  /** 임원+사무+생산 */
  total: number | null;
}

/** 차트 5 — 표의 한 행 */
export interface TableRowItem {
  /** 'detail'(상세 행) / 'subtotal'(소계) / 'total'(전체 합계) */
  type: 'detail' | 'subtotal' | 'total';
  /** 그룹 라벨 (예: '국내', '외주', '해외 및 자회사', '전체') */
  group: string;
  /** 행 라벨 (예: 'PM', '사내외주', '국내 소계', '전체 합계') */
  label: string;
  /** periodDate → cell */
  values: Record<string, TableCell>;
}

/** 차트 5 — 표 전체 데이터 */
export interface TableData {
  /** 시점 목록 (오름차순) */
  periods: { date: string; label: string }[];
  rows: TableRowItem[];
}

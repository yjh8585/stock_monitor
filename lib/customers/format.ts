/**
 * 고객사 화면 공용 표시 함수 — 요약 표·개별 페이지(서버)와 실적 표('use client')가 함께 쓴다.
 * 지시어 없는 파일이라 서버 컴포넌트가 값으로 import 해도 된다.
 */
import { isSeparateBasis, type GuidanceCard, type GuidanceRowTs, type ReportedRow } from './ir';
import type { CellOrigin, CustomerEarningsPoint } from './types';

/** 퍼센트 문자열 — 값이 없으면 「—」, signed 면 양수에 + 를 붙인다. */
export function pctText(v: number | null, signed = true): string {
  if (v == null) return '—';
  return `${signed && v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

/** 증감 색 — 양수 초록·음수 빨강·0/없음 회색. */
export function pctClass(v: number | null): string {
  if (v == null || v === 0) return 'text-muted-foreground';
  return v > 0 ? 'text-emerald-600' : 'text-rose-600';
}

// ---------------------------------------------------------------- 금액·범위
const CURRENCY_NAME: Record<string, string> = {
  USD: '달러',
  EUR: '유로',
  KRW: '원',
  VND: '동',
  JPY: '엔',
  CNY: '위안',
  GBP: '파운드',
};

const num = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** 숫자 뒤에 붙는 단위 — 퍼센트·대수는 붙여 쓰고 금액은 띄운다. 모르는 단위(text 등)는 빈 문자열. */
function unitSuffix(unit: string, currency: string | null): string {
  const cur = currency ? (CURRENCY_NAME[currency] ?? currency) : '';
  switch (unit) {
    case 'percent':
      return '%';
    case 'units':
      return '대';
    case 'billion':
      return ` ${['십억', cur].filter(Boolean).join(' ')}`;
    case 'million':
      return ` ${['백만', cur].filter(Boolean).join(' ')}`;
    case 'trillion':
      return ` ${['조', cur].filter(Boolean).join(' ')}`;
    case 'per_share':
      return ` ${cur}/주`.replace(/^ \//, '/');
    default:
      return '';
  }
}

/** 전망 범위 문자열 — 「14.5~15.5 십억 달러」 · 같으면 한 값 · 한쪽만 있으면 이상·이하 · 둘 다 없으면 「—」. */
export function rangeText(
  low: number | null,
  high: number | null,
  unit: string,
  currency: string | null = null
): string {
  const suffix = unitSuffix(unit, currency);
  if (low == null && high == null) return '—';
  if (low != null && high != null)
    return low === high ? `${num(low)}${suffix}` : `${num(low)}~${num(high)}${suffix}`;
  return low != null ? `${num(low)}${suffix} 이상` : `${num(high!)}${suffix} 이하`;
}

const APPROX = /^(?:(?:around|approximately|about|roughly)\b|약\s)/i;

/**
 * 가이던스 원문 구절(value_text)이 근사 낱말로 시작하면 숫자 앞에 붙일 「약 」 — 전망을 단정으로 바꾸지 않는다
 * (폭스바겐 'around €315 billion' · Task 15 Codex 대조). 근사 구절이 아니면 빈 문자열이라 다른 행 표시는 그대로.
 */
export function approxPrefix(valueText: string | null): string {
  return valueText && APPROX.test(valueText.trim()) ? '약 ' : '';
}

/** 금액 한 값 — 단위(billion·million·per_share·percent·units)와 통화 이름을 붙인다. */
export function amountText(value: number | null, unit: string, currency: string | null): string {
  return rangeText(value, value, unit, currency);
}

const SCALE: Record<string, number> = { million: 1e6, billion: 1e9, trillion: 1e12 };

/**
 * 금액 단위 맞추기(million·billion·trillion 사이) — 가이던스(십억·조)와 공시 실적(백만)을 한 줄에서 견주게.
 * 둘 중 하나라도 금액 규모 단위가 아니면(per_share·percent 등) 그대로 돌려준다.
 */
export function toUnit(value: number, from: string, to: string): { value: number; unit: string } {
  if (!(from in SCALE) || !(to in SCALE)) return { value, unit: from };
  return { value: (value * SCALE[from]) / SCALE[to], unit: to };
}

// ---------------------------------------------------------------- 기간 라벨
/** 2026-Q3 → 2026년 3분기 · 2026-FY → 2026년 연간(4분기) · 2026-9M → 9개월 누계 · 2026-6M → 반기 · 2026 → 연간. */
export function periodText(period: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return `${q[1]}년 ${q[2]}분기`;
  const fy = /^(\d{4})-FY$/.exec(period);
  if (fy) return `${fy[1]}년 연간(4분기)`;
  const ytd = /^(\d{4})-(3|6|9)M$/.exec(period);
  if (ytd)
    return `${ytd[1]}년 ${ytd[2] === '6' ? '반기' : ytd[2] === '3' ? '1분기 누계' : '9개월 누계'}`;
  if (/^\d{4}$/.test(period)) return `${period}년 연간`;
  return period;
}

// ---------------------------------------------------------------- 실적 칸 각주
const DERIVED_NOTE = '회사 발표 누계 차이로 계산';

/** 실적 칸 출처 각주 — 회사 장부상(누계 차이 아님)은 null. 금액은 십억 단위(value_bn). */
export function originNote(origin: CellOrigin | undefined, currency: string | null): string | null {
  if (!origin) return null;
  switch (origin.source) {
    case 'company_reported':
      return origin.derived ? DERIVED_NOTE : null;
    case 'company_adjusted':
      return [
        `회사 발표 조정 영업이익(${origin.metric_name ?? '이름 미상'}) — 장부상 미발표`,
        ...(origin.derived ? [DERIVED_NOTE] : []),
      ].join(' · ');
    case 'market':
      return [
        '회사 미발표 · 시장 데이터 추정',
        ...(origin.company_cumulative ?? []).map(
          (c) =>
            `회사 발표 ${periodText(c.period).replace('년', '')} ${c.metric_name} ${amountText(c.value_bn, 'billion', currency)}`
        ),
      ].join(' · ');
    case 'none':
      return '미발표';
  }
}

const NET_DEFINITION: Record<'total' | 'parent', string> = {
  total: '순이익 = 세후 합계(비지배지분 포함)',
  parent: '순이익 = 지배주주 귀속',
};

export type EarningsCellField = 'revenue' | 'operating_income' | 'net_income';
export interface EarningsFootnotes {
  /** 번호 순 각주 문장(1부터). */
  notes: string[];
  /** `${period_label}|${field}` → 그 칸에 붙일 각주 번호. */
  marks: Record<string, number[]>;
}

/**
 * 표 한 벌(분기 또는 연간)의 칸별 각주 — 같은 문장은 번호 하나로 묶는다.
 * 순이익 정의(세후 합계 / 지배주주 귀속)는 «섞였을 때만» 칸마다 붙인다 — 한 정의뿐이면 열 전체가 같아 표시할 이유가 없다.
 */
export function earningsFootnotes(
  points: CustomerEarningsPoint[],
  currency: string | null
): EarningsFootnotes {
  const notes: string[] = [];
  const marks: Record<string, number[]> = {};
  const defs = new Set(
    points
      .filter((p) => p.net_income_bn != null)
      .map((p) => p.origin?.net_income.definition)
      .filter((d): d is 'total' | 'parent' => d != null)
  );
  const mark = (key: string, text: string | null) => {
    if (!text) return;
    let n = notes.indexOf(text) + 1;
    if (n === 0) n = notes.push(text);
    marks[key] = [...(marks[key] ?? []), n];
  };
  for (const p of points) {
    if (!p.origin) continue;
    for (const field of ['revenue', 'operating_income', 'net_income'] as const) {
      const key = `${p.period_label}|${field}`;
      mark(key, originNote(p.origin[field], currency));
      const def = p.origin[field].definition;
      if (field === 'net_income' && defs.size > 1 && def && p.net_income_bn != null)
        mark(key, NET_DEFINITION[def]);
    }
  }
  return { notes, marks };
}

// ---------------------------------------------------------------- 가이던스
export type DirectionTone = 'up' | 'down' | 'flat' | 'new';

/**
 * 방향 배지 — 상향(초록)·하향(빨강)·유지(회색)·최초(파랑). 같은 FY 의 철회(상태 행) «뒤에» 처음 낸 전망은
 * 수집기가 initiated 로 찍지만 실제로는 재개라 「재개」로 바꿔 보인다(폴라리스 FY2025 형).
 */
export function guidanceDirection(
  row: GuidanceRowTs,
  statusNotes: GuidanceRowTs[]
): { label: string; tone: DirectionTone } {
  switch (row.direction) {
    case 'raised':
      return { label: '상향', tone: 'up' };
    case 'lowered':
      return { label: '하향', tone: 'down' };
    case 'maintained':
      return { label: '유지', tone: 'flat' };
    case 'withdrawn':
      return { label: '철회', tone: 'down' };
    case 'initiated': {
      const resumed = statusNotes.some(
        (s) =>
          s.stated === 'withdrawn' && s.period === row.period && s.published_at < row.published_at
      );
      return { label: resumed ? '재개' : '최초', tone: 'new' };
    }
    default:
      return { label: row.direction ?? '—', tone: 'flat' };
  }
}

/**
 * 같은 것을 다른 지표 이름으로 다시 낸 매출 전망(성장률 % → 금액 · 매출 → 조정 매출)을 한 계열로 본다.
 * SHORTCUT: 지표 이름 묶음을 손으로 적었다 → 다른 계열에서 같은 일이 생기면 여기에 한 줄 더한다(수집기가 계열 키를 내면 그쪽으로).
 */
const METRIC_FAMILY: Record<string, string> = {
  revenue_growth: 'revenue',
  adjusted_sales: 'revenue',
};

export interface GuidanceChainView {
  /** 지금 살아 있는 카드(계열의 마지막 지표). */
  card: GuidanceCard;
  /** 같은 FY·통화·계열에서 앞서 쓰던 지표의 카드 — 오래된 것부터. 비면 지표가 바뀐 적이 없다. */
  predecessors: GuidanceCard[];
}

/**
 * 「전망 기준 변경」 묶기 — 같은 (계열, 통화, FY) 안에서 앞 카드의 마지막 공시가 뒤 카드의 첫 공시보다 이르면
 * 앞 지표가 뒤 지표로 «바뀐» 것이다(폭스바겐 매출 성장률 → 매출 금액). 기간이 겹치면(둘 다 갱신 중) 따로 둔다.
 */
export function mergeGuidanceChains(cards: GuidanceCard[]): GuidanceChainView[] {
  const groups = new Map<string, GuidanceCard[]>();
  for (const c of cards) {
    const k = `${METRIC_FAMILY[c.metric] ?? c.metric}|${c.currency ?? ''}|${c.period}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const first = (c: GuidanceCard) => c.history[0].published_at;
  const last = (c: GuidanceCard) => c.history.at(-1)!.published_at;
  const out: GuidanceChainView[] = [];
  for (const list of groups.values()) {
    const chains: GuidanceChainView[] = [];
    for (const c of [...list].sort((a, b) => first(a).localeCompare(first(b)))) {
      const prev = chains.find((v) => last(v.card) < first(c));
      if (prev) {
        prev.predecessors.push(prev.card);
        prev.card = c;
      } else chains.push({ card: c, predecessors: [] });
    }
    out.push(...chains);
  }
  return out;
}

/** 기간의 끝 순서 키 — 분기 n · 누계 nM → n/3 · 연간 → 4. 같은 끝이면 누계(전망과 견줄 수 있는 값)를 앞세운다. */
function periodEndKey(r: ReportedRow): number {
  const y = Number(r.period.slice(0, 4));
  const q = /-Q([1-4])$/.exec(r.period);
  const m = /-(3|6|9)M$/.exec(r.period);
  const n = q ? Number(q[1]) : m ? Number(m[1]) / 3 : 4;
  return y * 100 + n * 10 + (r.period_grain === 'quarter' ? 0 : 1);
}

/**
 * 가이던스 카드 밑 「최근 실적」 한 줄 재료 — 같은 지표·통화의 공시 실적 중 가장 늦은 기간 하나.
 * 별도 기준 행(「(별도)」)은 연결 전망과 견줄 수 없어 뺀다. 없으면 null.
 */
export function latestActual(
  reported: ReportedRow[],
  metric: string,
  currency: string | null
): ReportedRow | null {
  return (
    reported
      .filter(
        (r) =>
          r.metric === metric &&
          !isSeparateBasis(r.metric_name) &&
          (currency == null || r.currency === currency)
      )
      .sort((a, b) => periodEndKey(a) - periodEndKey(b))
      .at(-1) ?? null
  );
}

// ---------------------------------------------------------------- 자료실·물량 라벨
const DOC_TYPE: Record<string, string> = {
  earnings_release: '실적 발표',
  prelim_results: '잠정 실적',
  periodic: '정기 보고서',
  current_report: '수시 공시',
  guidance: '전망 공시',
  ir_event: 'IR 행사',
  presentation: '발표 자료',
  sales_release: '판매 실적',
  fact_sheet: '팩트시트',
  investor_day: '투자자의 날',
};

/** 문서 종류 배지 — 모르는 값은 그대로. */
export function docTypeLabel(docType: string): string {
  return DOC_TYPE[docType] ?? docType;
}

const VOLUME_METRIC: Record<string, string> = {
  deliveries: '인도',
  wholesale: '도매 판매',
  sales: '판매',
  production: '생산',
  shipments: '출하',
};
const VOLUME_REGION: Record<string, string> = {
  north_america: '북미',
  international: '해외',
  domestic: '국내',
  overseas: '해외',
  export: '수출',
  ckd: 'CKD',
  special: '특수',
  vietnam: '베트남',
};

/** 회사 발표 물량 계열 이름 — region 'total' 은 지표 이름만. */
export function volumeSeriesLabel(metric: string, region: string): string {
  const m = VOLUME_METRIC[metric] ?? metric;
  return region === 'total' ? m : `${m} · ${VOLUME_REGION[region] ?? region}`;
}

/**
 * 고객사 화면 공용 표시 함수 — 요약 표·개별 페이지(서버)와 실적 표('use client')가 함께 쓴다.
 * 지시어 없는 파일이라 서버 컴포넌트가 값으로 import 해도 된다.
 */
import {
  isSeparateBasis,
  type GuidanceCard,
  type GuidanceChange,
  type GuidanceRowTs,
  type GuidanceValue,
  type ReportedRow,
} from './ir';
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

/** 시각(timestamptz 문자열) → 서울 날짜 YYYY-MM-DD. `slice(0, 10)` 은 UTC 날짜라 서울 오전 9시 전 기록이 전날로 찍힌다. */
export function seoulDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
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

// ---------------------------------------------------------------- 가이던스 지표 이름·설명
/**
 * 가이던스 지표(customer_guidance.metric) → 한국어 이름 + 용어 설명(있는 것만).
 * 요약 표 「최근 가이던스 변경」 문구(A6)와 카드 ⓘ 설명(A11)이 함께 쓴다 — 두 벌로 두면 갈린다.
 * SHORTCUT: 수집기가 새 지표 코드를 내면 여기에 한 줄 더해야 한국어로 보인다(없으면 회사 원문 이름 그대로).
 */
export const METRIC_INFO: Record<string, { ko: string; desc?: string }> = {
  revenue: { ko: '매출' },
  revenue_growth: { ko: '매출 성장률', desc: '전년 대비 매출 증감률(%).' },
  adjusted_sales: { ko: '조정 매출', desc: '회사가 일회성 항목 등을 빼고 다시 계산한 매출.' },
  operating_income: { ko: '영업이익' },
  operating_margin: {
    ko: '영업이익률',
    desc: '매출 대비 영업이익 비율(%). 회사마다 원문 이름이 다르다(카드의 회색 원문 이름).',
  },
  operating_margin_adjusted: {
    ko: '조정 영업이익률',
    desc: '일회성 특별 요인(special effects)을 뺀 영업이익률 — 회사의 «평소 실력»을 보려는 숫자다.',
  },
  special_items: {
    ko: '일회성 특별 요인',
    desc:
      '독일어 Sondereffekte · 영어 special effects — 평소 영업과 무관한 한 번뿐인 손익(손상차손·구조조정 비용 등). ' +
      '폭스바겐 2026년 예: 포르쉐 영업권 손상 약 60억 유로 · 조기퇴직 구조조정 · 중국 자회사 자산 손상(원문 = 2026-09-18 전망 수정 공시).',
  },
  aoi_margin: {
    ko: '조정 영업이익률(AOI)',
    desc: '스텔란티스 Adjusted Operating Income 률 — 구조조정 비용·손상 등 일회성 항목을 뺀 영업이익률.',
  },
  ebit_adjusted: {
    ko: '조정 영업이익(EBIT-adjusted)',
    desc: 'GM 의 이자·세금 전 이익에서 일회성 항목을 뺀 값 — 회사가 주력으로 내는 이익 지표.',
  },
  adjusted_ebitda: {
    ko: '조정 EBITDA',
    desc: '이자·세금·감가상각 전 이익(EBITDA)에서 일회성 항목을 뺀 값.',
  },
  net_income_parent: { ko: '지배주주 순이익' },
  eps_diluted: { ko: '희석 주당순이익(EPS)' },
  eps_adjusted: {
    ko: '조정 주당순이익(EPS)',
    desc: '일회성 항목을 뺀 순이익을 주식 수로 나눈 값.',
  },
  free_cash_flow: {
    ko: '잉여현금흐름(FCF)',
    desc: '영업으로 번 현금에서 투자에 쓴 돈을 뺀 나머지.',
  },
  industrial_fcf: {
    ko: '산업 부문 잉여현금흐름',
    desc: '금융(할부·리스) 사업을 뺀 자동차 본업의 잉여현금흐름.',
  },
  adjusted_automotive_fcf: {
    ko: '조정 자동차 잉여현금흐름',
    desc: '금융 사업을 뺀 자동차 부문 잉여현금흐름에서 일회성 항목을 조정한 값(GM).',
  },
  automotive_net_cash_flow: {
    ko: '자동차 부문 순현금흐름',
    desc: '폭스바겐 자동차 부문이 한 해 동안 남긴 현금(투자 뒤).',
  },
  automotive_ncf_margin: {
    ko: '자동차 부문 순현금흐름률',
    desc: '자동차 부문 순현금흐름을 매출로 나눈 비율(%).',
  },
  automotive_net_liquidity: {
    ko: '자동차 부문 순유동성',
    desc: '자동차 부문이 가진 현금에서 금융 부채를 뺀 값 — 재무 여력.',
  },
  automotive_operating_cash_flow: { ko: '자동차 부문 영업현금흐름' },
  automotive_ebitda_margin: { ko: '자동차 부문 EBITDA 이익률' },
  investment_ratio: {
    ko: '투자 비율',
    desc: '투자액을 매출로 나눈 비율(%) — 폭스바겐 자동차 부문 지표.',
  },
  capex: { ko: '설비투자' },
  bev_share: { ko: '전기차(BEV) 판매 비중' },
  deliveries: { ko: '인도 대수' },
  sales_units: { ko: '판매 대수' },
  order_intake: { ko: '수주' },
  other: { ko: '전망' },
};

/** 지표 한국어 이름 — 표에 없으면 회사 원문 이름. */
export function metricKo(metric: string, fallbackLabel: string): string {
  return METRIC_INFO[metric]?.ko ?? fallbackLabel;
}

/** 전망 값 한 개 표기 — 숫자가 없고 원문 구절만 있으면 그 구절. */
export function guidanceValueText(v: GuidanceValue, currency: string | null): string {
  if (v.low == null && v.high == null) return v.value_text ?? '—';
  return `${approxPrefix(v.value_text)}${rangeText(v.low, v.high, v.unit, currency)}`;
}

/**
 * 요약 표 「최근 가이던스 변경」 한 줄 — 「인도 대수 전망 하향: 62,000~67,000대 → 58,000~63,000대」.
 * 앞 값이 없으면 새 값만. 날짜·문서 종류는 화면이 옆에 따로 붙인다.
 */
export function guidanceChangeText(c: GuidanceChange): string {
  const head = `${metricKo(c.metric, c.metric_label)} 전망 ${c.direction === 'raised' ? '상향' : '하향'}`;
  const after = guidanceValueText(c.after, c.currency);
  return c.before
    ? `${head}: ${guidanceValueText(c.before, c.currency)} → ${after}`
    : `${head}: ${after}`;
}

// ---------------------------------------------------------------- 가이던스
export type DirectionTone = 'up' | 'down' | 'flat' | 'new';

/** 회사가 문장으로 밝힌 방향(행의 stated) — 상태 메모·「기준 변경」 배지가 함께 쓴다. */
export const STATED_LABEL: Record<string, string> = {
  withdrawn: '철회',
  maintained: '유지 확인',
  raised: '상향',
  lowered: '하향',
};

/**
 * 방향 배지 — 상향(초록)·하향(빨강)·유지(회색)·최초(파랑). 같은 FY 의 철회(상태 행) «뒤에» 처음 낸 전망은
 * 수집기가 initiated 로 찍지만 실제로는 재개라 「재개」로 바꿔 보인다(폴라리스 FY2025 형).
 * chainStart = 전망 기준이 바뀐 사슬(mergeGuidanceChains)의 뒤쪽 지표 첫 행 — 새 지표라 initiated 지만 처음 낸 전망이
 * 아니라 「기준 변경」(행의 stated 가 있으면 「기준 변경 · 상향」처럼 함께 · 폴라리스 FY2026 형). 재개가 먼저다.
 */
export function guidanceDirection(
  row: GuidanceRowTs,
  statusNotes: GuidanceRowTs[],
  opts: { chainStart?: boolean } = {}
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
      if (resumed) return { label: '재개', tone: 'new' };
      if (opts.chainStart) {
        const stated = row.stated ? (STATED_LABEL[row.stated] ?? row.stated) : null;
        return { label: stated ? `기준 변경 · ${stated}` : '기준 변경', tone: 'new' };
      }
      return { label: '최초', tone: 'new' };
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
  shareholder_letter: '주주서한',
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
  us: '미국',
  china: '중국',
};

/** 회사 발표 기간 이름 — 2026-9M → 2026년 1~9월 · 2026-6M → 2026년 상반기 · 2026-Q1·3M → 2026년 1분기 · 2026 → 2026년 연간. */
export function reportedPeriodLabel(period: string): string {
  const m = /^(\d{4})(?:-(?:Q([1-4])|([369])M))?$/.exec(period);
  if (!m) return period;
  if (m[2]) return `${m[1]}년 ${m[2]}분기`;
  if (m[3]) return `${m[1]}년 ${m[3] === '3' ? '1분기' : m[3] === '6' ? '상반기' : '1~9월'}`;
  return `${m[1]}년 연간`;
}

/** 회사 발표 금액 한 칸 — 'million' → 백만 · 'billion' → 십억(통화 코드 그대로 · 음수 부호 유지). */
export function reportedAmountText(r: { value: number; unit: string; currency: string }): string {
  const scale = r.unit === 'billion' ? '십억' : r.unit === 'million' ? '백만' : '';
  return `${r.value.toLocaleString('en-US')}${scale ? ` ${scale}` : ''} ${r.currency}`;
}

/** 회사 발표 물량 계열 이름 — region 'total' 은 지표 이름만. */
export function volumeSeriesLabel(metric: string, region: string): string {
  const m = VOLUME_METRIC[metric] ?? metric;
  return region === 'total' ? m : `${m} · ${VOLUME_REGION[region] ?? region}`;
}

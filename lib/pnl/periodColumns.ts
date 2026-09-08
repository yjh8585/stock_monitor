/**
 * 손익 표 3종(비용구조·고정변동 구조·BEP)이 공통으로 쓰는 「연도 열」 파생.
 *
 * 🔴 연도를 코드에 박지 않는다 — 열은 **데이터에 실제로 있는 연도**에서 나온다.
 * 셋이 각자 2023·2024·2025 를 리터럴로 들고 있었고, 그래서 해가 바뀌면 세 화면이
 * 동시에 지난해에 멈췄다.
 *
 * 규칙은 `preparePnlData` 의 연간 derive 와 같다 — **확정 연간 행이 있는 연도는
 * 그것을 쓰고, 없는 연도만 월별 누적(YTD)으로 만든다.**
 */

export interface PeriodRowLike {
  period_year: number;
  period_kind: string;
  period_month: number;
}

export interface PeriodColumn<T> {
  /** 화면 라벨 — '2024' 또는 '2026 YTD' */
  label: string;
  /** 그 열에 속하는 행인가 */
  match: (r: T) => boolean;
  /** YTD 열이면 누적 개월 수, 연간 열이면 null */
  ytdMonths: number | null;
}

const PASS = () => true;

export function buildPeriodColumns<T extends PeriodRowLike>(
  rows: readonly T[],
  extraFilter: (r: T) => boolean = PASS
): PeriodColumn<T>[] {
  const annualYears = new Set<number>();
  /** 연도 → 그 연도 월별 행의 최대 월 */
  const monthlyMax = new Map<number, number>();

  for (const r of rows) {
    if (!extraFilter(r)) continue;
    if (r.period_kind === 'annual') {
      annualYears.add(r.period_year);
    } else if (r.period_kind === 'monthly') {
      const prev = monthlyMax.get(r.period_year) ?? 0;
      if (r.period_month > prev) monthlyMax.set(r.period_year, r.period_month);
    }
  }

  const columns: PeriodColumn<T>[] = [...annualYears]
    .sort((a, b) => a - b)
    .map((year) => ({
      label: String(year),
      ytdMonths: null,
      match: (r: T) => extraFilter(r) && r.period_year === year && r.period_kind === 'annual',
    }));

  // 진행 중 연도 = 월별만 있고 확정 연간이 아직 없는 연도 중 가장 큰 것.
  const ytdYear = [...monthlyMax.keys()]
    .filter((y) => !annualYears.has(y))
    .sort((a, b) => b - a)[0];

  if (ytdYear !== undefined) {
    const months = monthlyMax.get(ytdYear) ?? 0;
    columns.push({
      label: months === 12 ? String(ytdYear) : `${ytdYear} YTD`,
      ytdMonths: months,
      match: (r: T) =>
        extraFilter(r) &&
        r.period_year === ytdYear &&
        r.period_kind === 'monthly' &&
        r.period_month >= 1 &&
        r.period_month <= months,
    });
  }

  return columns;
}

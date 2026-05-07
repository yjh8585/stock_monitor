import { RelatedStockRow, FinancialYear, LatestQuarter } from '@/lib/types';

/** 회사 설명 영역에서 보여줄 요약 + 재무 문자열 */
export interface DescriptionParts {
  summary: string;
  financial: string;
}

/** 매출 금액(백만 원본 통화) → KRW 단위 한국어 표기 */
export function formatKrwRevenue(revenueOriginal: number, fx: number): string {
  const revB = (revenueOriginal * fx) / 1_000;
  return revB >= 1_000
    ? `${(revB / 1_000).toFixed(1)}조원`
    : `${Math.round(revB).toLocaleString('ko-KR')}십억원`;
}

/** 최근 분기 실적 한국어 요약 */
export function buildQuarterlySection(row: RelatedStockRow, lq: LatestQuarter): string {
  if (lq.revenue == null) return '';
  const fx = row.fx_fin_to_krw ?? row.fx_to_krw ?? 1;
  const parts: string[] = [];

  let revStr = `매출 ${formatKrwRevenue(lq.revenue, fx)}`;
  if (lq.prev_revenue != null && lq.prev_revenue !== 0) {
    const yoy = ((lq.revenue - lq.prev_revenue) / Math.abs(lq.prev_revenue)) * 100;
    revStr += ` (전년동기 ${yoy >= 0 ? '▲' : '▼'}${Math.abs(yoy).toFixed(1)}%)`;
  }
  parts.push(revStr);

  if (lq.operating_income != null) {
    const opB = (lq.operating_income * fx) / 1_000;
    let opStr = `영업이익 ${Math.round(opB).toLocaleString('ko-KR')}십억원`;
    if (lq.prev_operating_income != null && lq.prev_operating_income !== 0) {
      const yoy =
        ((lq.operating_income - lq.prev_operating_income) / Math.abs(lq.prev_operating_income)) *
        100;
      opStr += ` (전년동기 ${yoy >= 0 ? '▲' : '▼'}${Math.abs(yoy).toFixed(1)}%)`;
    }
    parts.push(opStr);
  }

  if (lq.operating_margin != null) {
    let opmStr = `영업이익률 ${lq.operating_margin.toFixed(1)}%`;
    if (lq.prev_operating_margin != null) {
      const pp = lq.operating_margin - lq.prev_operating_margin;
      opmStr += ` (전년동기 ${pp >= 0 ? '▲' : '▼'}${Math.abs(pp).toFixed(1)}pp)`;
    }
    parts.push(opmStr);
  }

  return `${lq.fiscal_year}년 ${lq.fiscal_quarter}분기 실적: ${parts.join(', ')}.`;
}

/** 연간 재무 요약 한국어 문자열 */
export function buildKoreanFinancialSection(
  row: RelatedStockRow,
  latestYear: string,
  latest: FinancialYear,
  prev: FinancialYear | null
): string {
  const fx = row.fx_fin_to_krw ?? row.fx_to_krw ?? 1;
  const parts: string[] = [];

  if (latest.revenue != null) {
    const revB = (latest.revenue * fx) / 1_000;
    const revStr =
      revB >= 1_000
        ? `${(revB / 1_000).toFixed(1)}조원`
        : `${Math.round(revB).toLocaleString('ko-KR')}십억원`;
    parts.push(`매출 ${revStr}`);
  }

  if (prev?.revenue != null && latest.revenue != null && prev.revenue !== 0) {
    const g = ((latest.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100;
    parts.push(`전년대비 ${g >= 0 ? '▲' : '▼'}${Math.abs(g).toFixed(1)}%`);
  }

  if (latest.operating_margin != null) {
    parts.push(`영업이익률 ${latest.operating_margin.toFixed(1)}%`);
  }

  if (
    prev?.operating_income != null &&
    latest.operating_income != null &&
    prev.operating_income !== 0
  ) {
    const og =
      ((latest.operating_income - prev.operating_income) / Math.abs(prev.operating_income)) * 100;
    parts.push(`영업이익 ${og >= 0 ? '▲' : '▼'}${Math.abs(og).toFixed(1)}%`);
  }

  if (parts.length === 0) return '';
  return `${latestYear}년 결산: ${parts.join(', ')}.`;
}

/** 행 클릭 시 표시할 회사 설명(summary) + 재무 요약(financial) */
export function buildDescription(row: RelatedStockRow, latestYear: string): DescriptionParts {
  const fy = row.financials_by_year;
  const lq = row.latest_quarter;

  const quarterly = lq ? buildQuarterlySection(row, lq) : '';
  const annualForQuarter = (() => {
    if (!lq || lq.fiscal_quarter !== 4 || !fy) return '';
    const yearKey = String(lq.fiscal_year);
    const latest = fy[yearKey];
    if (!latest || latest.revenue == null) return '';
    const prev = fy[String(lq.fiscal_year - 1)] ?? null;
    return buildKoreanFinancialSection(row, yearKey, latest, prev);
  })();
  const quarterAndAnnual = [quarterly, annualForQuarter].filter(Boolean).join(' ');

  const annualFallback = (() => {
    if (quarterAndAnnual) return '';
    const yr = parseInt(latestYear);
    const candidates = [String(yr), String(yr - 1), String(yr - 2)] as const;
    const found = candidates.find((y) => fy?.[y]?.revenue != null);
    if (!found || !fy) return '';
    const latest = fy[found];
    const prev = fy[String(parseInt(found) - 1)] ?? null;
    return buildKoreanFinancialSection(row, found, latest, prev);
  })();
  const financial = quarterAndAnnual || annualFallback;

  return {
    summary:
      row.business_summary ??
      (row.country === 'KR' && row.market
        ? '회사 설명이 아직 수집되지 않았습니다. (수집 예정)'
        : '회사 설명이 아직 수집되지 않았습니다.'),
    financial,
  };
}

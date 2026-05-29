import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import CompanyTopModelsTable from '@/components/oem-companies/common/CompanyTopModelsTable';
import type { CompanyTopModelsResult } from '@/lib/types';

interface Props {
  /** 연도별 사전 가공된 CompanyTopModelsResult. */
  byYear: Record<string, CompanyTopModelsResult>;
  /** 사용 가능 연도 (오름차순). */
  years: string[];
}

/** US retail 차종 TOP10 — CompanyTopModelsTable 양식 통일 (합계+비중+YTD/YTD YoY+latest/prev/YoY).
 *  - 분류 드롭다운 X (단일 region US)
 *  - 연도 드롭다운 X (최신 YTD 연도 자동 선택)
 *  - PT 컬럼 X (retail 데이터에 PT 정보 없음) */
export default function HyundaiUsRetailTopCard({ byYear, years }: Props) {
  if (years.length === 0) return null;
  const selectedYear = years[years.length - 1];
  const current: CompanyTopModelsResult = byYear[selectedYear] ?? {
    rows: [],
    totals: { latestPeriod: 0, prevPeriod: 0, ytd: 0 },
  };

  const isYtdMode = current.rows.some((r) => (r.ytdSales ?? 0) > 0);
  const latestLabel = isYtdMode ? String(parseInt(selectedYear, 10) - 1) : selectedYear;
  const prevLabel = String(parseInt(latestLabel, 10) - 1);
  const ytdLabel = isYtdMode ? `${selectedYear} YTD` : undefined;

  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>미국 retail 차종 TOP10</CardTitle>
      </CardHeader>
      <CardContent>
        <CompanyTopModelsTable
          dataAll={current}
          title=""
          latestPeriodLabel={latestLabel}
          prevPeriodLabel={prevLabel}
          ytdPeriodLabel={ytdLabel}
          hideGroupSelect
          hidePtColumn
          hideUnifiedNote
        />
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
          출처: hyundai.com IR · HMA 미국 retail sales · Total/Industry/MarketShare 제외.
        </p>
      </CardContent>
    </Card>
  );
}

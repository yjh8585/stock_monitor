import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import CompanyTopModelsTable from '@/components/oem-companies/common/CompanyTopModelsTable';
import type { CompanyTopModelsResult } from '@/lib/types';

interface Props {
  byYear: Record<string, CompanyTopModelsResult>;
  years: string[];
}

/** EU retail 차종 TOP10 — US와 동일 양식 (단일 region, YTD 자동, PT 없음). */
export default function HyundaiEuRetailTopCard({ byYear, years }: Props) {
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
        <CardTitle>유럽 retail 차종 TOP10</CardTitle>
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
          출처: hyundai.com IR · HME 유럽 retail sales · industry/market_share 미제공.
        </p>
      </CardContent>
    </Card>
  );
}

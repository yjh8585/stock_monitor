import OemDashboard from '@/components/oem/OemDashboard';
import { getOemData } from '@/lib/oem/source';

/** OEM 페이지 (server) — fetch + cache + 사전 가공은 lib/oem/{source,aggregate}.ts에 격리. */
export default async function OemPage() {
  const data = await getOemData();

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">글로벌 OEM 판매량 대시보드</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          MarkLines 글로벌 자동차 판매 데이터 · 2020.01~ · {data.oemGroupCount}개 OEM 그룹 · 판매
          매월 갱신 · AI 전망 주 1회(월)
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        <OemDashboard
          groupMonth={data.groupMonth}
          groupPtMonth={data.groupPtMonth}
          typeSegMonth={data.typeSegMonth}
          countryTop15={data.countryTop15}
          oemCountryMatrix={data.oemCountryMatrix}
          usaOemSeries={data.usaOemSeries}
          naModelSeries={data.naModelSeries}
          outlooks={data.outlooks}
        />
      </div>
    </div>
  );
}

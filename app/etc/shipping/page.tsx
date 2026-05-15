import SeriesChart from '@/components/charts/SeriesChart';
import PlaceholderChart from '@/components/charts/PlaceholderChart';
import { getMarketSeries, getSeriesMetaByCategory } from '@/lib/series';

const ORDER = ['KCCI', 'KUWI'] as const;
const COLOR: Record<string, string> = {
  KCCI: '#16a34a',
  KUWI: '#dc2626',
};
const NOTE_BY_CODE: Record<string, string> = {
  KCCI: '한국해양진흥공사(KOMSA) 공시',
  KUWI: 'KCCI 미주서안 세부 지수 — KOMSA',
};

export default async function ShippingPage() {
  const metas = await getSeriesMetaByCategory('shipping');
  // 실데이터가 있는 시리즈만 fetch (commodities 페이지와 동일 패턴)
  const dataByCode = Object.fromEntries(
    await Promise.all(
      metas
        .filter((m) => m.hasData)
        .map(async (m) => [m.series_code, await getMarketSeries(m.series_code)] as const)
    )
  );

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">운임</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          KCCI · KUWI — 한국해양진흥공사 컨테이너 운임 지수(주간 발표) · 매일 KST 06:00 수집
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ORDER.map((code) => {
            const meta = metas.find((m) => m.series_code === code);
            if (!meta) return null;
            if (!meta.hasData) {
              return (
                <PlaceholderChart
                  key={code}
                  title={meta.label}
                  unit={meta.unit}
                  note={NOTE_BY_CODE[code]}
                />
              );
            }
            return (
              <SeriesChart
                key={code}
                title={meta.label}
                unit={meta.unit}
                source={meta.source}
                data={dataByCode[code] ?? []}
                color={COLOR[code] ?? '#2962FF'}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

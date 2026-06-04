import SeriesChart from '@/components/charts/SeriesChart';
import PlaceholderChart from '@/components/charts/PlaceholderChart';
import {
  getMarketSeries,
  getMarketSeriesLive,
  appendLivePoint,
  getSeriesMetaByCategory,
} from '@/lib/series';

// 라이브 끝점 대상 (선물·24h) — STEEL_KR(KOMIS)·DUBAI(FRED 월별)는 제외
const LIVE_CODES = new Set(['ALU', 'COPPER', 'HRC', 'LIT', 'WTI', 'BRENT']);

const ORDER = ['ALU', 'COPPER', 'STEEL_KR', 'HRC', 'LIT', 'WTI', 'BRENT', 'DUBAI'] as const;
const COLOR: Record<string, string> = {
  ALU: '#64748b',
  COPPER: '#b45309',
  HRC: '#0ea5e9',
  LIT: '#7c3aed',
  WTI: '#16a34a',
  BRENT: '#dc2626',
};

export default async function CommoditiesPage() {
  const metas = await getSeriesMetaByCategory('commodity');
  // 실데이터가 있는 시리즈만 fetch
  const dataByCode = Object.fromEntries(
    await Promise.all(
      metas
        .filter((m) => m.hasData)
        .map(async (m) => {
          const daily = await getMarketSeries(m.series_code);
          if (!LIVE_CODES.has(m.series_code)) return [m.series_code, daily] as const;
          const live = await getMarketSeriesLive(m.series_code);
          return [m.series_code, appendLivePoint(daily, live)] as const;
        })
    )
  );

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">원자재</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          알루미늄·구리·철강·리튬·WTI·Brent (5년 일봉) · Dubai (월별) · 매일 KST 06:00 갱신
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
                  note="yfinance 미제공 — 후속 PR에서 스크래퍼로 수집 예정"
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

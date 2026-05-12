import SeriesChart from '@/components/charts/SeriesChart';
import {
  getExchangeRateSeries,
  getMarketSeries,
  getSeriesMetaByCategory,
  type SeriesMeta,
} from '@/lib/series';

const SERIES_COLOR: Record<string, string> = {
  USDKRW: '#2962FF',
  EURKRW: '#22c55e',
  CNYKRW: '#f59e0b',
  DXY: '#a855f7',
  EURUSD: '#ef4444',
};

export default async function FxPage() {
  const [usd, eur, cny, dxy, eurusd, metas] = await Promise.all([
    getExchangeRateSeries('USD'),
    getExchangeRateSeries('EUR'),
    getExchangeRateSeries('CNY'),
    getMarketSeries('DXY'),
    getMarketSeries('EURUSD'),
    getSeriesMetaByCategory('fx_extra'),
  ]);

  const metaOf = (code: string): SeriesMeta | undefined =>
    metas.find((m) => m.series_code === code);
  const dxyMeta = metaOf('DXY');
  const eurusdMeta = metaOf('EURUSD');

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">환율</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          USD·EUR·CNY → KRW · 달러 인덱스(DXY) · EUR/USD (5년 일봉)
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SeriesChart
            title="USD/KRW"
            unit="KRW"
            source="Yahoo Finance"
            data={usd}
            color={SERIES_COLOR.USDKRW}
          />
          <SeriesChart
            title="EUR/KRW"
            unit="KRW"
            source="Yahoo Finance"
            data={eur}
            color={SERIES_COLOR.EURKRW}
          />
          <SeriesChart
            title="CNY/KRW"
            unit="KRW"
            source="Yahoo Finance"
            data={cny}
            color={SERIES_COLOR.CNYKRW}
          />
          {dxyMeta && (
            <SeriesChart
              title={dxyMeta.label}
              unit={dxyMeta.unit}
              source={dxyMeta.source}
              data={dxy}
              color={SERIES_COLOR.DXY}
            />
          )}
          {eurusdMeta && (
            <SeriesChart
              title={eurusdMeta.label}
              unit={eurusdMeta.unit}
              source={eurusdMeta.source}
              data={eurusd}
              color={SERIES_COLOR.EURUSD}
            />
          )}
        </div>
      </div>
    </div>
  );
}

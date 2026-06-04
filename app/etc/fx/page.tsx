import SeriesChart from '@/components/charts/SeriesChart';
import {
  appendLivePoint,
  getExchangeRateSeries,
  getLiveExchangeRate,
  getMarketSeries,
  getMarketSeriesLive,
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
  const [usd, eur, cny, dxy, eurusd, metas, usdLive, eurLive, cnyLive, dxyLive, eurusdLive] =
    await Promise.all([
      getExchangeRateSeries('USD'),
      getExchangeRateSeries('EUR'),
      getExchangeRateSeries('CNY'),
      getMarketSeries('DXY'),
      getMarketSeries('EURUSD'),
      getSeriesMetaByCategory('fx_extra'),
      getLiveExchangeRate('USD'),
      getLiveExchangeRate('EUR'),
      getLiveExchangeRate('CNY'),
      getMarketSeriesLive('DXY'),
      getMarketSeriesLive('EURUSD'),
    ]);

  // 차트 끝점만 라이브 가격으로 갱신 (과거 종가는 그대로)
  const usdData = appendLivePoint(usd, usdLive);
  const eurData = appendLivePoint(eur, eurLive);
  const cnyData = appendLivePoint(cny, cnyLive);
  const dxyData = appendLivePoint(dxy, dxyLive);
  const eurusdData = appendLivePoint(eurusd, eurusdLive);

  const metaOf = (code: string): SeriesMeta | undefined =>
    metas.find((m) => m.series_code === code);
  const dxyMeta = metaOf('DXY');
  const eurusdMeta = metaOf('EURUSD');

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">환율</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          USD·EUR·CNY → KRW · 달러 인덱스(DXY) · EUR/USD (5년 일봉) · 차트 끝점은 매시간 라이브 갱신
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SeriesChart
            title="USD/KRW"
            unit="KRW"
            source="Yahoo Finance"
            data={usdData}
            color={SERIES_COLOR.USDKRW}
          />
          <SeriesChart
            title="EUR/KRW"
            unit="KRW"
            source="Yahoo Finance"
            data={eurData}
            color={SERIES_COLOR.EURKRW}
          />
          <SeriesChart
            title="CNY/KRW"
            unit="KRW"
            source="Yahoo Finance"
            data={cnyData}
            color={SERIES_COLOR.CNYKRW}
          />
          {dxyMeta && (
            <SeriesChart
              title={dxyMeta.label}
              unit={dxyMeta.unit}
              source={dxyMeta.source}
              data={dxyData}
              color={SERIES_COLOR.DXY}
            />
          )}
          {eurusdMeta && (
            <SeriesChart
              title={eurusdMeta.label}
              unit={eurusdMeta.unit}
              source={eurusdMeta.source}
              data={eurusdData}
              color={SERIES_COLOR.EURUSD}
            />
          )}
        </div>
      </div>
    </div>
  );
}

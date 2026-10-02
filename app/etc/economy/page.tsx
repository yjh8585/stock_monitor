import SeriesChart from '@/components/charts/SeriesChart';
import MultiSeriesChart from '@/components/charts/MultiSeriesChart';
import {
  getMarketSeries,
  getMarketSeriesLive,
  appendLivePoint,
  getSeriesMetaByCategory,
  type SeriesMeta,
  type SeriesPoint,
} from '@/lib/series';

const SINGLE_CODES = ['KOSPI', 'KOSDAQ', 'SPX', 'IXIC', 'GOLD', 'SILVER', 'BTC', 'ETH'] as const;
const COLOR: Record<string, string> = {
  KOSPI: '#2962FF',
  KOSDAQ: '#0ea5e9',
  SPX: '#16a34a',
  IXIC: '#a855f7',
  GOLD: '#f59e0b',
  SILVER: '#64748b',
  BTC: '#f7931a',
  ETH: '#627eea',
};

export default async function EconomyPage() {
  const [
    tnx,
    irx,
    tyx,
    kospi,
    kosdaq,
    spx,
    ixic,
    gold,
    silver,
    btc,
    eth,
    metas,
    kospiL,
    kosdaqL,
    spxL,
    ixicL,
    goldL,
    silverL,
    btcL,
    ethL,
  ] = await Promise.all([
    getMarketSeries('UST10Y'),
    getMarketSeries('UST2Y'),
    getMarketSeries('UST30Y'),
    getMarketSeries('KOSPI'),
    getMarketSeries('KOSDAQ'),
    getMarketSeries('SPX'),
    getMarketSeries('IXIC'),
    getMarketSeries('GOLD'),
    getMarketSeries('SILVER'),
    getMarketSeries('BTC'),
    getMarketSeries('ETH'),
    getSeriesMetaByCategory('economy'),
    getMarketSeriesLive('KOSPI'),
    getMarketSeriesLive('KOSDAQ'),
    getMarketSeriesLive('SPX'),
    getMarketSeriesLive('IXIC'),
    getMarketSeriesLive('GOLD'),
    getMarketSeriesLive('SILVER'),
    getMarketSeriesLive('BTC'),
    getMarketSeriesLive('ETH'),
  ]);

  const metaOf = (code: string): SeriesMeta | undefined =>
    metas.find((m) => m.series_code === code);
  // 일봉 끝점에 라이브 현재가를 합성 (국채 제외)
  const liveByCode: Record<(typeof SINGLE_CODES)[number], SeriesPoint[]> = {
    KOSPI: appendLivePoint(kospi, kospiL),
    KOSDAQ: appendLivePoint(kosdaq, kosdaqL),
    SPX: appendLivePoint(spx, spxL),
    IXIC: appendLivePoint(ixic, ixicL),
    GOLD: appendLivePoint(gold, goldL),
    SILVER: appendLivePoint(silver, silverL),
    BTC: appendLivePoint(btc, btcL),
    ETH: appendLivePoint(eth, ethL),
  };
  const dataOf = (code: (typeof SINGLE_CODES)[number]) => liveByCode[code];

  const ust10 = metaOf('UST10Y');
  const ust2 = metaOf('UST2Y');
  const ust30 = metaOf('UST30Y');
  const ustSource = ust10?.source ?? 'Yahoo Finance';

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">경제</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          미국 국채(30Y/10Y/2Y) · 한국·미국 주가지수 · 금/은 · 비트코인·이더리움 · 5년 일봉 + 지수
          끝점 매시간 라이브(국채 제외)
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ust10 && ust2 && ust30 && (
            <MultiSeriesChart
              title="미국 국채 수익률 (30Y / 10Y / 2Y)"
              unit="%"
              source={ustSource}
              series={[
                { label: ust30.label, color: '#9333ea', data: tyx },
                { label: ust10.label, color: '#2962FF', data: tnx },
                { label: ust2.label, color: '#ef4444', data: irx },
              ]}
            />
          )}
          {SINGLE_CODES.map((code) => {
            const meta = metaOf(code);
            if (!meta) return null;
            return (
              <SeriesChart
                key={code}
                title={meta.label}
                unit={meta.unit}
                source={meta.source}
                data={dataOf(code)}
                color={COLOR[code]}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

import SeriesChart from '@/components/charts/SeriesChart';
import MultiSeriesChart from '@/components/charts/MultiSeriesChart';
import {
  getMarketSeries,
  getSeriesMetaByCategory,
  getEconomyOutlook,
  type SeriesMeta,
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
const SENTIMENT_STYLE: Record<string, string> = {
  bullish: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  neutral: 'bg-muted text-muted-foreground',
  bearish: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export default async function EconomyPage() {
  const [tnx, irx, tyx, kospi, kosdaq, spx, ixic, gold, silver, btc, eth, metas, outlook] =
    await Promise.all([
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
      getEconomyOutlook(),
    ]);

  const metaOf = (code: string): SeriesMeta | undefined =>
    metas.find((m) => m.series_code === code);
  const dataOf = (code: (typeof SINGLE_CODES)[number]) => {
    switch (code) {
      case 'KOSPI':
        return kospi;
      case 'KOSDAQ':
        return kosdaq;
      case 'SPX':
        return spx;
      case 'IXIC':
        return ixic;
      case 'GOLD':
        return gold;
      case 'SILVER':
        return silver;
      case 'BTC':
        return btc;
      case 'ETH':
        return eth;
    }
  };

  const ust10 = metaOf('UST10Y');
  const ust2 = metaOf('UST2Y');
  const ust30 = metaOf('UST30Y');
  const ustSource = ust10?.source ?? 'Yahoo Finance';

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">경제</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          미국 국채(30Y/10Y/2Y) · 한국·미국 주가지수 · 금/은 · 비트코인·이더리움 · 미국 경제 전망
          노트 · 지수 매시간 · 전망 매일 KST 06:30 갱신
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

        <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-base font-semibold">미국 경제 전망</h2>
            {outlook?.sentiment && (
              <span
                className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${SENTIMENT_STYLE[outlook.sentiment] ?? 'bg-muted text-muted-foreground'}`}
              >
                {outlook.sentiment}
              </span>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {outlook?.note_date ?? '—'} · WMT/TGT/COST · F/GM/STLA · AN/ABG/LAD · FDX/UPS/CASS
              뉴스·8-K 통합 요약
            </span>
          </div>
          {outlook ? (
            <div className="rounded-md border border-border bg-background/50 px-5 py-4">
              <p className="text-base md:text-lg leading-8 text-foreground whitespace-pre-line">
                {outlook.summary}
              </p>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-6 text-center">
              아직 통합 요약이 적재되지 않았습니다. <code>collect_macro_outlook</code> 실행을 기다려
              주세요.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

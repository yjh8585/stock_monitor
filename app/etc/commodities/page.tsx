import SeriesChart from '@/components/charts/SeriesChart';
import MultiSeriesChart from '@/components/charts/MultiSeriesChart';
import PlaceholderChart from '@/components/charts/PlaceholderChart';
import { OEM_COLORS } from '@/components/charts/palette';
import {
  getMarketSeries,
  getMarketSeriesLive,
  appendLivePoint,
  getExchangeRateSeries,
  getSeriesMetaByCategory,
} from '@/lib/series';
import {
  comexCopperToUsdPerMt,
  usHrcToUsdPerMt,
  krwVatToUsdPerMt,
  cnyVatToUsdPerMt,
} from '@/lib/commodityUnits';

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

  // 상단 지역 비교 차트 — 전부 USD/t · 세금 제외(2026-11-09 사용자 선택). 새 시리즈 3종(COPPER_LME·
  // COPPER_KR·HRC_CN)도 commodity 분류라 위 반복에서 이미 읽혔다. 단일 차트 목록(ORDER)에는 넣지 않는다.
  const [usdKrw, cnyKrw] = await Promise.all([
    getExchangeRateSeries('USD'),
    getExchangeRateSeries('CNY'),
  ]);
  const copperSeries = [
    {
      label: '미국 COMEX',
      color: COLOR.COPPER, // 아래 단일 COMEX 구리 차트와 같은 색
      data: comexCopperToUsdPerMt(dataByCode.COPPER ?? []),
    },
    // 빨강(OEM_COLORS[1])은 COMEX 갈색과 붙어 보여 파랑으로 둔다(2026-11-09 캡처 확인)
    { label: '국제 LME', color: OEM_COLORS[0], data: dataByCode.COPPER_LME ?? [] },
    {
      label: '한국 조달청 (부가세 제외)',
      color: OEM_COLORS[2],
      data: krwVatToUsdPerMt(dataByCode.COPPER_KR ?? [], usdKrw),
    },
  ];
  const hrcSeries = [
    // 미국 색은 아래 단일 「HRC」 차트와 같게 둔다
    { label: '미국 CME HRC', color: COLOR.HRC, data: usHrcToUsdPerMt(dataByCode.HRC ?? []) },
    {
      label: '중국 SHFE (증치세 제외)',
      color: OEM_COLORS[1],
      data: cnyVatToUsdPerMt(dataByCode.HRC_CN ?? [], cnyKrw, usdKrw),
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">원자재</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          알루미늄·구리·철강·리튬·WTI·Brent (5년 일봉 + 끝점 매시간 라이브) · Dubai (월별) · 매일
          KST 06:00 갱신 · 상단 비교 차트는 달러/톤·세금 제외로 환산
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MultiSeriesChart
            title="구리 — 미국·국제·한국"
            unit="USD/t"
            source="COMEX · KOMIS(LME Cash) · 조달청 비축 판매가 · 환율 일봉 환산"
            series={copperSeries}
          />
          <MultiSeriesChart
            title="열연강판 — 미국·중국"
            unit="USD/t"
            source="CME HRC 선물 · SHFE 주력월물 결산가 · 환율 일봉 환산"
            series={hrcSeries}
          />
        </div>
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

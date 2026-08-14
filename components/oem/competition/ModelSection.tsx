'use client';

/**
 * 차종 1개 섹션 — 헤더(종합 등급) + 시장 탭 + KPI + 차트 7종 + 서술.
 *
 * 시장 탭인 이유: 셀토스는 인도·미국·한국에서 경쟁군이 완전히 다르다(인도는 Creta·Nexon,
 * 미국은 HR-V·Kona). 한 화면에 섞으면 점유율·재고·리콜이 전부 다른 모집단의 값이 뒤엉킨다.
 * 시장이 하나뿐인 차종은 탭을 그리지 않는다(불필요한 클릭을 만들지 않는다).
 */
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CompetitionOutlook } from '@/lib/oem-competition/types';
import { evaluateMarket } from '@/lib/oem-competition/signals';
import CompetitorRankChart from './CompetitorRankChart';
import ConsumerRadar from './ConsumerRadar';
import InventoryChart from './InventoryChart';
import InventoryTrendChart from './InventoryTrendChart';
import KpiStrip from './KpiStrip';
import ModelCycleChart from './ModelCycleChart';
import ModelNarrative from './ModelNarrative';
import PositionBubble from './PositionBubble';
import SafetyChart from './SafetyChart';
import SalesTrendChart from './SalesTrendChart';
import ShareChangeBars from './ShareChangeBars';
import ShareTrendChart from './ShareTrendChart';
import { SIGNAL_COLORS, SignalDot } from './shared';

/** 시장 하나에 딸린 차트 전부. 탭을 바꾸면 이 덩어리만 갈린다. */
function MarketPanel({
  market,
  outlook,
}: {
  market: CompetitionOutlook['markets'][number];
  outlook: CompetitionOutlook;
}) {
  const signals = evaluateMarket(market);

  return (
    <div className="space-y-3">
      <KpiStrip market={market} />

      {/* 종합 판단 근거는 차트보다 먼저 읽혀야 한다 — 사용자 지시 2026-08-14 로 여기로 올렸다. */}
      <ModelNarrative outlook={outlook} market={market} />

      {market.segmentNote && (
        <p className="text-xs text-muted-foreground">
          경쟁군 기준: {market.segmentNote} · 경쟁 차종 {market.competitors.length}종
        </p>
      )}

      {/* 항목별 판정을 한 줄로 다시 보인다 — 차트를 스크롤하며 등급을 잊지 않도록 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {signals.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5" title={s.hint}>
            <SignalDot signal={s.signal} size={8} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="tabular-nums">{s.display}</span>
          </span>
        ))}
      </div>

      {/* 배치 규칙: **같은 질문에 답하는 두 카드를 이웃에** 둔다(2열이라 좌우로 붙는다).
          판매 추이↔순위 · 점유율 변화↔점유율 추이 · 재고 최신↔재고 추이 — "지금 얼마인가"와
          "어디로 가는가"를 나란히 봐야 수준과 방향을 함께 읽는다. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SalesTrendChart market={market} />
        <CompetitorRankChart market={market} />
        <ShareChangeBars market={market} />
        <ShareTrendChart market={market} />
        {/* 판매·점유율이 왜 그렇게 움직였나에 대한 첫 번째 답 — 세대 나이. 점유율 카드 바로
            다음에 둬야 "밀리고 있다 → 노후해서인가"로 눈이 이어진다. */}
        <ModelCycleChart market={market} noteDate={outlook.noteDate} />
        <InventoryChart market={market} />
        <InventoryTrendChart market={market} />
        <PositionBubble market={market} />
        <SafetyChart market={market} />
        <ConsumerRadar market={market} noteDate={outlook.noteDate} />
      </div>
    </div>
  );
}

export default function ModelSection({
  outlook,
  index,
}: {
  outlook: CompetitionOutlook;
  index: number;
}) {
  const [tab, setTab] = useState(outlook.markets[0]?.market ?? '');

  return (
    <section
      id={`model-${outlook.modelKey}`}
      // 스코어보드에서 앵커로 내려올 때 헤더에 가리지 않게 여백을 준다
      className="scroll-mt-4 space-y-3 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">
          <span className="text-muted-foreground mr-1.5">{index + 1}.</span>
          {outlook.modelName}
          <span className="text-sm font-normal text-muted-foreground ml-2">{outlook.oemGroup}</span>
        </h3>
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: SIGNAL_COLORS[outlook.label] }}
          />
          {outlook.label}
          <span className="text-xs font-normal text-muted-foreground ml-1">{outlook.noteDate}</span>
        </span>
      </div>

      {outlook.markets.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">시장별 데이터 없음</p>
      ) : outlook.markets.length === 1 ? (
        <MarketPanel market={outlook.markets[0]} outlook={outlook} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <TabsList>
            {outlook.markets.map((m) => (
              <TabsTrigger key={m.market} value={m.market}>
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {outlook.markets.map((m) => (
            <TabsContent key={m.market} value={m.market} className="pt-3">
              <MarketPanel market={m} outlook={outlook} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </section>
  );
}

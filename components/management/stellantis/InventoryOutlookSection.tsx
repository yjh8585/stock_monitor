import { ChartSection } from '@/components/management/plan/_selectors';
import { MIN_CONDITIONAL_SAMPLES } from '@/lib/stellantis-forecast/aggregate';
import type { ConditionalRate, InventoryOutlook } from '@/lib/stellantis-forecast/types';

/**
 * 4. 재고가 이 방향이면 자사 매출은 어디로 가는가 — 조건부 빈도.
 *
 * "6개월간 재고가 쌓였다면 자사 매출이 줄어들 확률은?"에 **과거를 세어** 답한다. 회귀·모형을
 * 쓰지 않는 이유는 표본이 수십 개뿐이라 계수를 추정하면 근거 없는 그럴듯한 숫자가 나오기 때문이다.
 *
 * **비율만 크게 띄우지 않는 것이 이 섹션의 설계 의도다.** 표본 15개짜리 59%는 사실처럼 읽히지만
 * 신뢰구간이 절반 이상을 덮는다. 그래서 (1) 분자/분모를 항상 함께 쓰고 (2) Wilson 95% 구간을 막대에
 * 겹쳐 그리고 (3) **조건과 무관한 전체 감소율(기준선)**을 나란히 둔다 — 원래 절반의 기간에 매출이
 * 줄었다면 "축적 국면에 50% 감소"는 아무 정보도 아니기 때문이다.
 *
 * server component — 상호작용이 없어 클라이언트 JS를 태우지 않는다.
 */

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export default function InventoryOutlookSection({ outlooks }: { outlooks: InventoryOutlook[] }) {
  return (
    <ChartSection title="4. 재고 방향이 자사 매출에 시사하는 것" unit="">
      <p className="mb-3 text-sm text-muted-foreground">
        과거 각 시점에서 <b>직전 기간의 재고 방향</b>을 조건으로 두고,{' '}
        <b>일정 기간 뒤 자사 매출이 전년 동기보다 줄었는지</b>를 셌습니다. 모형이 아니라 빈도입니다.
        조건과 무관한 <b>전체 감소율(기준선)</b>보다 뚜렷하게 높아야 의미가 있습니다.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {outlooks.map((o) => (
          <OutlookCard key={o.key} outlook={o} />
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        ⚠️ 창이 겹치는 시점들끼리 서로 닮아(자기상관) 실제 독립 표본은 표시된 분모보다 적습니다 —
        진짜 신뢰구간은 표시된 것보다 넓습니다. 국면 판정 창(6개월/2분기)과 결과 시점(6개월/2분기)은
        탐지된 시차와 무관하게 <b>미리 고정</b>했습니다. 데이터를 보고 창을 고르면 어떤 계열에서든
        높은 숫자를 만들어낼 수 있기 때문입니다.
      </p>
    </ChartSection>
  );
}

function OutlookCard({ outlook: o }: { outlook: InventoryOutlook }) {
  const isBuilding = o.currentState === 'building';
  const now = isBuilding ? o.building : o.draining;
  const unit = o.key === 'monthly' ? '개월' : '분기';

  return (
    <div className="rounded-lg p-4 ring-1 ring-foreground/10">
      <div className="mb-1 text-base font-medium">{o.label}</div>
      <div className="mb-3 text-xs text-muted-foreground">
        조건: {o.conditionLabel} · 결과: {o.outcomeLabel}
      </div>

      {/* 현재 국면 — 이 카드에서 지금 당장 읽어야 할 한 줄. */}
      <div
        className={`mb-3 rounded-md p-3 ${isBuilding ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}
        data-testid={`outlook-current-${o.key}`}
      >
        <div className="text-sm">
          현재{' '}
          <b className={isBuilding ? 'text-red-600' : 'text-emerald-600'}>
            재고 {isBuilding ? '축적' : '소진'}
          </b>{' '}
          국면 · {o.currentStreak}
          {unit} 연속
        </div>
        {o.hasEnoughSamples ? (
          <div className="mt-1 text-sm text-muted-foreground">
            과거 같은 국면 <b>{now.total}</b>번 중 <b>{now.declines}</b>번 매출 감소 →{' '}
            <b className={isBuilding ? 'text-red-600' : 'text-emerald-600'}>{pct(now.rate)}</b> (95%
            구간 {pct(now.ciLow)}~{pct(now.ciHigh)})
          </div>
        ) : (
          <div className="mt-1 text-sm text-muted-foreground">
            표본이 국면당 {MIN_CONDITIONAL_SAMPLES}개에 못 미쳐 비율을 신뢰할 수 없습니다.
          </div>
        )}
      </div>

      <div className="space-y-2">
        <RateBar label="재고 축적 뒤 매출 감소" rate={o.building} tone="red" />
        <RateBar label="재고 소진 뒤 매출 감소" rate={o.draining} tone="emerald" />
        <RateBar label="전체 기간 매출 감소 (기준선)" rate={o.base} tone="neutral" />
      </div>
    </div>
  );
}

/** 비율 막대 + Wilson 95% 구간 오버레이. 구간을 안 그리면 표본 부족이 숨는다. */
function RateBar({
  label,
  rate,
  tone,
}: {
  label: string;
  rate: ConditionalRate;
  tone: 'red' | 'emerald' | 'neutral';
}) {
  const fill =
    tone === 'red' ? 'bg-red-500' : tone === 'emerald' ? 'bg-emerald-500' : 'bg-muted-foreground';

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className={tone === 'neutral' ? 'text-muted-foreground' : ''}>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {rate.total === 0 ? (
            '표본 없음'
          ) : (
            <>
              <b className="text-foreground">{pct(rate.rate)}</b> ({rate.declines}/{rate.total}) ·
              95% {pct(rate.ciLow)}~{pct(rate.ciHigh)}
            </>
          )}
        </span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-sm bg-muted">
        {rate.total > 0 ? (
          <>
            {/* 신뢰구간 — 옅은 띠. 점추정 막대보다 먼저 그려 뒤에 깔린다. */}
            <div
              className="absolute inset-y-0 bg-foreground/15"
              style={{
                left: `${rate.ciLow * 100}%`,
                width: `${Math.max((rate.ciHigh - rate.ciLow) * 100, 1)}%`,
              }}
            />
            {/* 점추정 — 구간 위 진한 선. */}
            <div
              className={`absolute inset-y-0 w-[3px] ${fill}`}
              style={{ left: `calc(${rate.rate * 100}% - 1.5px)` }}
            />
          </>
        ) : null}
        {/* 50% 기준선 — 동전 던지기 대비 위치를 눈으로 잡아준다. */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/20" />
      </div>
    </div>
  );
}

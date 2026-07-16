import { ChartSection } from '@/components/management/plan/_selectors';
import { monthLabel } from '@/lib/stellantis-forecast/aggregate';
import type { PlantEventType, PlantEventWithContext } from '@/lib/stellantis-forecast/types';
import { fmtSigned } from './format';

/**
 * 5. 스텔란티스 공장 동향 — 재고 국면과 대조.
 *
 * 이벤트 하나하나에 **그때 재고가 어땠는지**(직전 6개월 누적 생산−소매)를 붙여 나란히 놓는다.
 * 회사가 발표한 사유(`statedReason`)와 당시 갭의 부호가 어긋날 수 있고, 그 판단은 화면이 아니라
 * 보는 사람이 한다 — 여기선 사실만 붙여 놓는다.
 *
 * 데이터는 **수동 큐레이션**(`lib/stellantis-forecast/plant-events.ts`)이다. 출처 링크를 모두 달아
 * 원문 확인이 가능하게 했다.
 *
 * server component — 상호작용이 없어 클라이언트 JS를 태우지 않는다.
 */

/** 이벤트 유형 → 한국어 라벨 + 색. 감산 방향(빨강)과 증산 방향(초록)을 부호처럼 읽게 한다. */
const EVENT_STYLE: Record<PlantEventType, { label: string; badge: string }> = {
  downtime: { label: '가동 중단', badge: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  shift_cut: { label: '시프트 축소', badge: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  layoff: { label: '휴업·해고', badge: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  closure: { label: '폐쇄', badge: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  shift_add: {
    label: '시프트 증설',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  },
  production_add: {
    label: '생산 추가',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  },
  restart: { label: '재가동', badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  retooling: { label: '설비 전환', badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  other: { label: '기타', badge: 'bg-muted text-muted-foreground' },
};

/** 이벤트 기간 표기 — 단발이면 한 달만, 이어지면 범위. */
function periodText(start: number, end: number): string {
  return start === end ? monthLabel(start) : `${monthLabel(start)} ~ ${monthLabel(end)}`;
}

export default function PlantEventsSection({ events }: { events: PlantEventWithContext[] }) {
  if (events.length === 0) {
    return (
      <ChartSection title="5. 스텔란티스 공장 동향" unit="">
        <div className="py-8 text-center text-base text-muted-foreground">
          등록된 이벤트가 없습니다.
        </div>
      </ChartSection>
    );
  }

  return (
    <ChartSection title="5. 스텔란티스 공장 동향 — 재고 국면과 대조" unit="">
      <p className="mb-3 text-sm text-muted-foreground">
        가동 중단·설비 전환·시프트 증감 등 <b>{events.length}건</b>. 각 이벤트에{' '}
        <b>직전 6개월 누적 (생산 − 소매)</b>를 붙였습니다 — 이벤트가 재고 과잉의 <b>결과</b>인지
        보려는 것이므로, 이벤트 자체가 만든 감산이 섞이지 않도록 <b>시작 이전</b> 6개월만 씁니다.
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        수동 큐레이션 데이터입니다(자동 수집 아님). 각 건은 웹 검색으로 찾은 뒤 원문 대조로
        교차검증했습니다. 출처 링크로 원문을 확인할 수 있습니다.
      </p>

      <ol className="space-y-3">
        {events.map((item, idx) => (
          <EventRow
            // 같은 공장·월·유형이라도 별개 이벤트(예: 같은 달 두 차례 해고)가 있어 index를 더해
            // 고유 key를 보장한다. PLANT_EVENTS는 안정 상수 + attachEventContext가 안정 정렬이라
            // index가 렌더 간 안정적이다.
            key={`${item.event.plant}-${item.event.startYearMonth}-${item.event.eventType}-${idx}`}
            item={item}
          />
        ))}
      </ol>
    </ChartSection>
  );
}

function EventRow({ item }: { item: PlantEventWithContext }) {
  const { event, precedingCumGap, precedingState } = item;
  const style = EVENT_STYLE[event.eventType];

  return (
    <li className="rounded-lg p-3 ring-1 ring-foreground/10">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {periodText(event.startYearMonth, event.endYearMonth)}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${style.badge}`}>
          {style.label}
        </span>
        <span className="text-sm font-medium">{event.plant}</span>
        <span className="text-xs text-muted-foreground">{event.country}</span>
        {event.models.length > 0 ? (
          <span className="text-xs text-muted-foreground">{event.models.join(' · ')}</span>
        ) : null}
      </div>

      <p className="text-sm">{event.summary}</p>

      {event.statedReason ? (
        <p className="mt-1 text-xs text-muted-foreground">
          <b>보도된 사유:</b> {event.statedReason}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {precedingState === 'unknown' ? (
          <span className="text-muted-foreground">직전 6개월 재고 국면: 데이터 범위 밖</span>
        ) : (
          <span
            className={
              precedingState === 'building'
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }
          >
            직전 6개월 재고 {precedingState === 'building' ? '축적' : '소진'} (
            {fmtSigned(precedingCumGap ?? 0)}대)
          </span>
        )}
        <a
          href={event.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {event.sourceName}
          {event.sourceDate ? ` (${event.sourceDate})` : ''}
        </a>
      </div>
    </li>
  );
}

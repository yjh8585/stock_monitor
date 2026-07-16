'use client';

import { useMemo, useState } from 'react';
import { ChartSection } from '@/components/management/plan/_selectors';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { addMonths, monthLabel } from '@/lib/stellantis-forecast/aggregate';
import type { PlantEventType, PlantEventWithContext } from '@/lib/stellantis-forecast/types';
import { fmtSigned } from './format';

/**
 * 3. 스텔란티스 공장 동향 — 재고 국면과 대조.
 *
 * 이벤트 하나하나에 **그때 재고가 어땠는지**(직전 6개월 누적 생산−소매)를 붙여 나란히 놓는다.
 * 회사가 발표한 사유(`statedReason`)와 당시 갭의 부호가 어긋날 수 있고, 그 판단은 화면이 아니라
 * 보는 사람이 한다 — 여기선 사실만 붙여 놓는다.
 *
 * 데이터 출처는 둘이다: **공장 가동 이벤트**는 수동 큐레이션(`plant-events.ts`),
 * **재고**(딜러 재고일수)는 Cox 딜러 재고 데이터에서 자동 생성(`buildCoxInventoryEvents`).
 *
 * client component — 최근 24개월 표시 창 + 분류 드롭다운 필터에 상태가 필요하다(데이터는 전부
 * 서버가 넘기고, 화면에서만 걸러 낸다 — 누적은 유지하되 표시만 제한, 사용자 지시 2026-07-17).
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
  // 재고(딜러 네트워크) — 음영으로 강조되는 항목. 배지도 앰버를 진하게 써 설비 전환과 구분한다.
  inventory: { label: '재고', badge: 'bg-amber-500/25 text-amber-800 dark:text-amber-300' },
  other: { label: '기타', badge: 'bg-muted text-muted-foreground' },
};

/** 드롭다운 묶음 분류 → 세부 eventType 매핑(사용자 지시 2026-07-17 — 단순 묶음). */
type CategoryGroup = 'all' | 'cut' | 'add' | 'retool' | 'inventory' | 'other';

const GROUP_OF: Record<PlantEventType, Exclude<CategoryGroup, 'all'>> = {
  downtime: 'cut',
  shift_cut: 'cut',
  layoff: 'cut',
  closure: 'cut',
  shift_add: 'add',
  production_add: 'add',
  restart: 'add',
  retooling: 'retool',
  inventory: 'inventory',
  other: 'other',
};

const GROUP_OPTIONS: { value: CategoryGroup; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'cut', label: '감산' },
  { value: 'add', label: '증산' },
  { value: 'retool', label: '설비 전환' },
  { value: 'inventory', label: '재고' },
  { value: 'other', label: '기타' },
];

/** 표시 창(개월) — 오늘 기준 최근 24개월 + 그 이후(예정) 이벤트만 보여준다. */
const WINDOW_MONTHS = 24;

/** 이벤트 기간 표기 — 단발이면 한 달만, 이어지면 범위. */
function periodText(start: number, end: number): string {
  return start === end ? monthLabel(start) : `${monthLabel(start)} ~ ${monthLabel(end)}`;
}

export default function PlantEventsSection({ events }: { events: PlantEventWithContext[] }) {
  const [group, setGroup] = useState<CategoryGroup>('all');

  // 오늘 기준 24개월 전 컷오프(YYYYMM). client 렌더 시점의 실제 '오늘'을 쓴다.
  const cutoff = useMemo(() => {
    const now = new Date();
    const nowYearMonth = now.getFullYear() * 100 + (now.getMonth() + 1);
    return addMonths(nowYearMonth, -WINDOW_MONTHS);
  }, []);

  // 표시 창: 종료월이 컷오프 이후인 이벤트(진행 중·예정 포함). 데이터는 그대로 두고 표시만 제한.
  const windowed = useMemo(
    () => events.filter((e) => e.event.endYearMonth >= cutoff),
    [events, cutoff]
  );

  const filtered = useMemo(
    () =>
      group === 'all' ? windowed : windowed.filter((e) => GROUP_OF[e.event.eventType] === group),
    [windowed, group]
  );

  if (events.length === 0) {
    return (
      <ChartSection title="3. 스텔란티스 공장 동향" unit="">
        <div className="py-8 text-center text-base text-muted-foreground">
          등록된 이벤트가 없습니다.
        </div>
      </ChartSection>
    );
  }

  const groupLabel = GROUP_OPTIONS.find((o) => o.value === group)?.label ?? '전체';

  return (
    <ChartSection
      title="3. 스텔란티스 공장 동향 — 재고 국면과 대조"
      unit=""
      controls={
        <Select
          items={GROUP_OPTIONS}
          value={group}
          onValueChange={(v) => v != null && setGroup(v as CategoryGroup)}
        >
          <SelectTrigger className="h-8 w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUP_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        최근 24개월 <b>{filtered.length}건</b>
        {group !== 'all' ? <> · 분류 “{groupLabel}”</> : null}. 각 이벤트에{' '}
        <b>직전 6개월 누적 (생산 − 소매)</b>를 붙였습니다 — 이벤트가 재고 과잉의 <b>결과</b>인지
        보려는 것이므로, 이벤트 자체가 만든 감산이 섞이지 않도록 <b>시작 이전</b> 6개월만 씁니다.
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        <b>공장 가동 이벤트</b>는 수동 큐레이션(웹 검색으로 찾은 뒤 원문 대조로 교차검증)이고,{' '}
        <b>재고</b>(딜러 재고일수)는 Cox Automotive 데이터로 <b>자동 수집</b>됩니다. 최근 24개월과
        예정 이벤트만 표시하며(과거 데이터는 계속 누적), 출처 링크로 원문을 확인할 수 있습니다.
      </p>

      {filtered.length === 0 ? (
        <div className="py-8 text-center text-base text-muted-foreground">
          최근 24개월에 “{groupLabel}” 분류의 이벤트가 없습니다.
        </div>
      ) : (
        <ol className="space-y-3">
          {filtered.map((item, idx) => (
            <EventRow
              // 같은 공장·월·유형이라도 별개 이벤트(예: 같은 달 두 차례 해고)가 있어 index를 더해
              // 고유 key를 보장한다. events는 안정 정렬(attachEventContext)이라 index가 안정적이다.
              key={`${item.event.plant}-${item.event.startYearMonth}-${item.event.eventType}-${idx}`}
              item={item}
            />
          ))}
        </ol>
      )}
    </ChartSection>
  );
}

function EventRow({ item }: { item: PlantEventWithContext }) {
  const { event, precedingCumGap, precedingState } = item;
  const style = EVENT_STYLE[event.eventType];
  // '재고'(딜러 네트워크) 항목은 배경 음영으로 강조한다(사용자 지시 2026-07-17 — 중요하니 눈에 띄게).
  const rowClass =
    event.eventType === 'inventory'
      ? 'bg-amber-50 ring-amber-300/60 dark:bg-amber-950/25 dark:ring-amber-500/25'
      : 'ring-foreground/10';

  return (
    <li className={`rounded-lg p-3 ring-1 ${rowClass}`}>
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

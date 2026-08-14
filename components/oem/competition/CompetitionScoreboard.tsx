'use client';

/**
 * 10개 차종 × 5개 항목 신호등 표 — 페이지 맨 위의 요약.
 *
 * 차종별 상세는 스크롤이 길어 전체 그림이 안 잡힌다. 여기서 "어디가 빨간가"를 먼저 보고
 * 클릭해 해당 섹션으로 이동한다.
 *
 * 종합 등급은 열 하나가 아니라 **행 전체의 음영**으로 표시한다(사용자 지시 2026-08-14). 열로 두면
 * 표 오른쪽 끝까지 눈이 가야 등급을 알 수 있는데, 음영은 행을 훑는 동안 이미 읽힌다. 색만으로
 * 정보를 전달하지 않도록 차종명 앞에 신호등 점(aria-label 포함)을 함께 둔다.
 *
 * 다중 시장 차종(셀토스 3개 등)은 시장마다 등급이 다르다. 한 줄로 요약해야 하므로
 * **가장 나쁜 등급**을 쓴다(worstSignal) — 평균을 내면 한 시장의 위험이 사라진다.
 */
import { evaluateMarket, SIGNAL_ITEMS, worstSignal } from '@/lib/oem-competition/signals';
import type { Signal, SignalItemKey } from '@/lib/oem-competition/signals';
import type { CompetitionOutlook } from '@/lib/oem-competition/types';
import { SIGNAL_COLORS, SignalDot } from './shared';

/** 미국 전용 지표 — 툴팁에 "어느 시장이 판정됐는지"를 반드시 밝혀야 하는 열. */
const US_ONLY_ITEMS = new Set<SignalItemKey>(['inventory', 'safety']);

/**
 * 행 배경 — 등급 색을 카드 배경에 섞는다.
 *
 * 반투명(`#16a34a14`)이 아니라 `color-mix` 로 **불투명 색**을 만드는 이유: 첫 열이 sticky 라
 * 가로 스크롤 시 그 아래로 다른 셀이 지나가는데, 반투명이면 글자가 겹쳐 보인다.
 */
function rowBackground(label: Signal): string {
  return `color-mix(in srgb, ${SIGNAL_COLORS[label]} 12%, var(--card))`;
}

function summarize(outlooks: CompetitionOutlook[]) {
  const counts: Record<Signal, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
  for (const o of outlooks) counts[o.label] = (counts[o.label] ?? 0) + 1;
  return counts;
}

export default function CompetitionScoreboard({ outlooks }: { outlooks: CompetitionOutlook[] }) {
  const counts = summarize(outlooks);

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">종합 스코어보드</span>
        <span className="text-xs text-muted-foreground flex items-center gap-3">
          <span>행 색 = 종합 등급</span>
          {(['GREEN', 'YELLOW', 'RED'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <SignalDot signal={s} size={8} />
              {counts[s]}종
            </span>
          ))}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="text-left font-normal px-3 py-2 sticky left-0 bg-card">차종</th>
              <th className="text-left font-normal px-2 py-2 hidden sm:table-cell">그룹</th>
              {SIGNAL_ITEMS.map((i) => (
                <th
                  key={i.key}
                  className="font-normal px-2 py-2 whitespace-nowrap"
                  title={
                    US_ONLY_ITEMS.has(i.key)
                      ? '미국 전용 소스(Cox·NHTSA)라 미국 시장이 있는 차종만 판정된다. 인도·한국·중국·유럽 시장은 값 자체가 없다.'
                      : undefined
                  }
                >
                  {i.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {outlooks.map((o) => {
              const perMarket = o.markets.map(evaluateMarket);
              const bg = rowBackground(o.label);
              return (
                <tr
                  key={o.modelKey}
                  className="border-t border-border/50 transition-[filter] hover:brightness-95 dark:hover:brightness-125"
                  style={{ backgroundColor: bg }}
                  title={`종합 ${o.label} · ${o.noteDate} 판정`}
                >
                  <td className="px-3 py-2 sticky left-0" style={{ backgroundColor: bg }}>
                    <span className="flex items-center gap-1.5">
                      <SignalDot signal={o.label} title={`종합 ${o.label}`} />
                      {/* 앵커 이동 — 스코어보드에서 본 빨간 항목으로 바로 내려가기 위한 것 */}
                      <a href={`#model-${o.modelKey}`} className="hover:underline font-medium">
                        {o.modelName}
                      </a>
                      {o.markets.length > 1 && (
                        <span className="text-xs text-muted-foreground">
                          {o.markets.length}개 시장
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground hidden sm:table-cell">
                    {o.oemGroup}
                  </td>
                  {SIGNAL_ITEMS.map((item) => {
                    const s = worstSignal(perMarket, item.key);
                    const perMarketText = perMarket
                      .map((results, idx) => {
                        const r = results.find((x) => x.key === item.key);
                        return `${o.markets[idx].label}: ${r?.display ?? '—'}`;
                      })
                      .join(' · ');
                    // 미국 전용 지표는 "어느 시장이 판정됐나"를 밝히지 않으면, 미국만의 결과가
                    // 차종 전체의 결과로 읽힌다(사용자 지적 2026-08-14).
                    const detail = US_ONLY_ITEMS.has(item.key)
                      ? `미국 전용 지표 — ${perMarketText}`
                      : perMarketText;
                    return (
                      <td key={item.key} className="px-2 py-2 text-center">
                        <SignalDot signal={s} title={detail} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
        <strong>행 배경색이 종합 등급</strong>이다(초록·노랑·빨강). 종합은 AI 가 서술 근거까지 함께
        본 판단이라 항목별 결과와 다를 수 있다. 항목별 신호등은 수치 규칙으로 자동 판정하며, 각 점에
        마우스를 올리면 시장별 값이 나온다. 시장이 여럿인 차종은 <strong>가장 나쁜 시장</strong>의
        등급을 표시한다. <strong>유통재고·안전성은 미국 전용 소스</strong>(Cox·NHTSA)라 미국 시장이
        있는 차종만 판정되고, 글로벌 시장에 붙은 값은 참고치라 등급을 매기지 않는다.
      </p>
    </div>
  );
}

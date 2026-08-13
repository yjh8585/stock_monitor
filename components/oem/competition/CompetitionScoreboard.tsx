'use client';

/**
 * 10개 차종 × 5개 항목 신호등 표 — 페이지 맨 위의 요약.
 *
 * 차종별 상세는 스크롤이 길어 전체 그림이 안 잡힌다. 여기서 "어디가 빨간가"를 먼저 보고
 * 클릭해 해당 섹션으로 이동한다.
 *
 * 다중 시장 차종(셀토스 3개 등)은 시장마다 등급이 다르다. 한 줄로 요약해야 하므로
 * **가장 나쁜 등급**을 쓴다(worstSignal) — 평균을 내면 한 시장의 위험이 사라진다.
 */
import { evaluateMarket, SIGNAL_ITEMS, worstSignal } from '@/lib/oem-competition/signals';
import type { Signal } from '@/lib/oem-competition/signals';
import type { CompetitionOutlook } from '@/lib/oem-competition/types';
import { SIGNAL_COLORS, SignalDot } from './shared';

const OVERALL_STYLE: Record<Signal, string> = {
  GREEN: 'text-green-700 dark:text-green-300',
  YELLOW: 'text-amber-700 dark:text-amber-300',
  RED: 'text-red-700 dark:text-red-300',
};

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
                <th key={i.key} className="font-normal px-2 py-2 whitespace-nowrap">
                  {i.label}
                </th>
              ))}
              <th className="font-normal px-3 py-2">종합</th>
            </tr>
          </thead>
          <tbody>
            {outlooks.map((o) => {
              const perMarket = o.markets.map(evaluateMarket);
              return (
                <tr key={o.modelKey} className="border-t border-border/50 hover:bg-muted/40">
                  <td className="px-3 py-2 sticky left-0 bg-card">
                    {/* 앵커 이동 — 스코어보드에서 본 빨간 항목으로 바로 내려가기 위한 것 */}
                    <a href={`#model-${o.modelKey}`} className="hover:underline font-medium">
                      {o.modelName}
                    </a>
                    {o.markets.length > 1 && (
                      <span className="text-xs text-muted-foreground ml-1.5">
                        {o.markets.length}개 시장
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground hidden sm:table-cell">
                    {o.oemGroup}
                  </td>
                  {SIGNAL_ITEMS.map((item) => {
                    const s = worstSignal(perMarket, item.key);
                    const detail = perMarket
                      .map((results, idx) => {
                        const r = results.find((x) => x.key === item.key);
                        return `${o.markets[idx].label}: ${r?.display ?? '—'}`;
                      })
                      .join(' · ');
                    return (
                      <td key={item.key} className="px-2 py-2 text-center">
                        <SignalDot signal={s} title={detail} />
                      </td>
                    );
                  })}
                  <td className={`px-3 py-2 text-center font-medium ${OVERALL_STYLE[o.label]}`}>
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle"
                      style={{ backgroundColor: SIGNAL_COLORS[o.label] }}
                    />
                    {o.label}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
        항목별 신호등은 수치 규칙으로 자동 판정한다(각 점에 마우스를 올리면 시장별 값이 나온다).
        시장이 여럿인 차종은 <strong>가장 나쁜 시장</strong>의 등급을 표시한다. 종합은 AI 가 서술
        근거까지 함께 본 판단이라 항목별 결과와 다를 수 있다.
      </p>
    </div>
  );
}

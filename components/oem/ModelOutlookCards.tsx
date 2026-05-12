'use client';

import type { OemModelOutlook } from '@/lib/types';

interface Props {
  outlooks: OemModelOutlook[];
}

/** 색상 라벨 → Tailwind 클래스 (연한 배경) */
const LABEL_STYLES: Record<OemModelOutlook['label'], { bg: string; dot: string; text: string }> = {
  GREEN: {
    bg: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900',
    dot: 'bg-green-500',
    text: 'text-green-700 dark:text-green-300',
  },
  YELLOW: {
    bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900',
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
  },
  RED: {
    bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900',
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-300',
  },
};

/** 북미 핵심 차종 — AI(Claude Haiku 4.5) 평가 카드 (주 1회 갱신) */
export default function ModelOutlookCards({ outlooks }: Props) {
  if (outlooks.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        AI 평가 데이터 없음. <code>scripts/collect_oem_model_outlook.py</code> 실행이 필요합니다.
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-3">
        Claude Haiku 4.5 기반 종합 평가 · 매주 월요일 자동 갱신 · 색상은 소비자 평가 + 판매전망 종합
        판단
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {outlooks.map((o) => (
          <OutlookCard key={o.model_key} outlook={o} />
        ))}
      </div>
    </div>
  );
}

function OutlookCard({ outlook }: { outlook: OemModelOutlook }) {
  const style = LABEL_STYLES[outlook.label] ?? LABEL_STYLES.YELLOW;
  return (
    <div className={`rounded-md border p-4 ${style.bg}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-base">{outlook.model_name}</div>
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${style.dot}`} />
          <span className={`text-xs font-medium ${style.text}`}>{outlook.label}</span>
        </div>
      </div>
      <div className="text-xs text-muted-foreground mb-3">
        {outlook.oem_group} · {outlook.region} · {outlook.note_date}
      </div>
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground font-medium uppercase mb-1">
            소비자 평가
          </div>
          <p className="leading-relaxed">{outlook.consumer_view}</p>
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-medium uppercase mb-1">판매 전망</div>
          <p className="leading-relaxed">{outlook.outlook}</p>
        </div>
        <div className="pt-2 border-t border-border/50">
          <div className="text-xs text-muted-foreground italic leading-relaxed">
            {outlook.rationale}
          </div>
        </div>
      </div>
    </div>
  );
}

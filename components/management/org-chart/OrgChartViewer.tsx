'use client';

import { useEffect, useState } from 'react';

import type { OrgChartMeta } from '@/lib/org-chart/source';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y}년 ${m}월 ${d}일`;
}

export default function OrgChartViewer({ charts }: { charts: OrgChartMeta[] }) {
  const [selected, setSelected] = useState(charts[0]?.chart_date ?? '');
  const [expanded, setExpanded] = useState(false);
  const [fitToScreen, setFitToScreen] = useState(false);
  const current = charts.find((c) => c.chart_date === selected);

  // 팝업 열림 동안 Esc로 닫기 + 배경 스크롤 잠금.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  if (charts.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        게시된 조직도가 없습니다. 로컬에서 <code>scripts/sync_org_chart.py</code>를 실행해
        적재하세요.
      </div>
    );
  }

  // 캐시버스트 토큰(?v=created_at) — 재렌더 시 토큰이 바뀌어 브라우저가 새 이미지를 받는다.
  const imgSrc = current
    ? `/api/management/org-chart/image/${selected}?v=${encodeURIComponent(current.created_at)}`
    : '';

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label htmlFor="org-date" className="text-sm font-medium">
          시점
        </label>
        <select
          id="org-date"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          {charts.map((c) => (
            <option key={c.chart_date} value={c.chart_date}>
              {formatDate(c.chart_date)}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          현재 표시: <strong className="text-foreground">{formatDate(selected)}</strong>
        </span>
        {current && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="ml-auto rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            전체화면으로 보기
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto rounded-md border border-border bg-white">
        {current && (
          // 인증 프록시 엔드포인트(동적·비공개)라 next/image 대신 img 사용.
          // 클릭하면 전체화면 팝업으로 크게 본다. key={selected}로 시점 변경 시 재마운트.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={selected}
            src={imgSrc}
            alt={`조직도 ${formatDate(selected)}`}
            onClick={() => setExpanded(true)}
            title="클릭하면 전체화면으로 크게 봅니다"
            className="h-auto w-full min-w-[1000px] cursor-zoom-in"
          />
        )}
      </div>

      {expanded && current && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/90"
          role="dialog"
          aria-modal="true"
          aria-label={`조직도 전체화면 ${formatDate(selected)}`}
          onClick={() => setExpanded(false)}
        >
          <div
            className="flex shrink-0 items-center justify-between gap-2 px-4 py-2 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm font-medium">
              한세모빌리티 조직도 — {formatDate(selected)}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFitToScreen((v) => !v)}
                className="rounded-md border border-white/30 px-3 py-1 text-sm hover:bg-white/10"
              >
                {fitToScreen ? '원본 크기' : '화면 맞춤'}
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-md border border-white/30 px-3 py-1 text-sm hover:bg-white/10"
              >
                닫기 ✕
              </button>
            </div>
          </div>
          {/* 기본은 원본 해상도로 스크롤(작은 글씨도 또렷). '화면 맞춤'은 전체를 한눈에. */}
          <div
            className={
              fitToScreen
                ? 'flex flex-1 items-center justify-center overflow-hidden p-2'
                : 'flex-1 overflow-auto p-2'
            }
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgSrc}
              alt={`조직도 ${formatDate(selected)}`}
              className={
                fitToScreen ? 'max-h-full max-w-full object-contain' : 'max-w-none bg-white'
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

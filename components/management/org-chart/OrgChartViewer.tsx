'use client';

import { useState } from 'react';

import { ImageLightbox } from '@/components/common/ImageLightbox';
import type { OrgChartMeta } from '@/lib/org-chart/source';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y}년 ${m}월 ${d}일`;
}

/** 같은 날짜에 여러 판(인원 포함/미포함 등)이 있어 날짜만으로는 못 가른다 → 제목을 병기한다. */
function formatLabel(c: OrgChartMeta): string {
  return c.title ? `${formatDate(c.chart_date)} — ${c.title}` : formatDate(c.chart_date);
}

export default function OrgChartViewer({ charts }: { charts: OrgChartMeta[] }) {
  const [selected, setSelected] = useState(charts[0]?.id ?? 0);
  const [expanded, setExpanded] = useState(false);
  const current = charts.find((c) => c.id === selected);

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
    ? `/api/management/org-chart/image/${current.id}?v=${encodeURIComponent(current.created_at)}`
    : '';
  const currentLabel = current ? formatLabel(current) : '';

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label htmlFor="org-date" className="text-sm font-medium">
          시점
        </label>
        <select
          id="org-date"
          value={selected}
          onChange={(e) => setSelected(Number(e.target.value))}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          {charts.map((c) => (
            <option key={c.id} value={c.id}>
              {formatLabel(c)}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          현재 표시: <strong className="text-foreground">{currentLabel}</strong>
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
            alt={`조직도 ${currentLabel}`}
            onClick={() => setExpanded(true)}
            title="클릭하면 전체화면으로 크게 봅니다"
            className="h-auto w-full min-w-[1000px] cursor-zoom-in"
          />
        )}
      </div>

      {expanded && current && (
        <ImageLightbox
          src={imgSrc}
          alt={`조직도 ${currentLabel}`}
          label={currentLabel}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';

import type { OrgChartMeta } from '@/lib/org-chart/source';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y}년 ${m}월 ${d}일`;
}

export default function OrgChartViewer({ charts }: { charts: OrgChartMeta[] }) {
  const [selected, setSelected] = useState(charts[0]?.chart_date ?? '');
  const current = charts.find((c) => c.chart_date === selected);

  if (charts.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        게시된 조직도가 없습니다. 로컬에서 <code>scripts/sync_org_chart.py</code>를 실행해
        적재하세요.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex shrink-0 items-center gap-2">
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
      </div>
      <div className="flex-1 overflow-auto rounded-md border border-border bg-white">
        {current && (
          // 인증 프록시 엔드포인트(동적·비공개)라 next/image 대신 img 사용.
          // key={selected}로 날짜 변경 시 img 노드를 새로 마운트 → 이전 이미지 고착 방지.
          // ?v=created_at로 클라이언트/프록시 캐시도 우회(시점별 고유 URL).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={selected}
            src={`/api/management/org-chart/image/${selected}?v=${encodeURIComponent(current.created_at)}`}
            alt={`조직도 ${formatDate(selected)}`}
            className="h-auto w-full min-w-[1000px]"
          />
        )}
      </div>
    </div>
  );
}

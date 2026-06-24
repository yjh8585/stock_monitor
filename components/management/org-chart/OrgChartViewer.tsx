'use client';

import { useState } from 'react';

import type { OrgChartMeta } from '@/lib/org-chart/source';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y}년 ${m}월 ${d}일`;
}

export default function OrgChartViewer({ charts }: { charts: OrgChartMeta[] }) {
  const [selected, setSelected] = useState(charts[0]?.chart_date ?? '');

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
      </div>
      <div className="flex-1 overflow-auto rounded-md border border-border bg-white">
        {selected && (
          // 인증 프록시 엔드포인트(동적·비공개)라 next/image 대신 img 사용
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/management/org-chart/image/${selected}`}
            alt={`조직도 ${formatDate(selected)}`}
            className="h-auto w-full min-w-[1000px]"
          />
        )}
      </div>
    </div>
  );
}

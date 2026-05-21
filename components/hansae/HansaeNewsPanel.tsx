'use client';

import { useEffect, useState } from 'react';

interface NewsItem {
  title: string;
  url: string;
  source: string;
  published_at: string | null;
}

interface Props {
  companyName: string;
}

export default function HansaeNewsPanel({ companyName }: Props) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/news/search?q=${encodeURIComponent(companyName)}&country=kr`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok) {
          setItems(json.items ?? []);
          setError(null);
        } else {
          setItems([]);
          setError(json.error ?? 'unknown_error');
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyName]);

  return (
    <div className="h-full rounded-md border border-border bg-card p-4 flex flex-col min-h-0">
      <div className="flex items-baseline justify-between mb-2 shrink-0">
        <h2 className="text-lg font-semibold">뉴스</h2>
        <span className="text-sm text-muted-foreground">{companyName} · Google News</span>
      </div>
      {loading ? (
        <div className="text-sm text-muted-foreground">뉴스 로딩…</div>
      ) : error ? (
        <div className="text-sm text-red-500">뉴스 로드 실패: {error}</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground">최근 뉴스 없음</div>
      ) : (
        <ul className="space-y-2 flex-1 overflow-auto pr-1">
          {items.slice(0, 5).map((it) => (
            <li key={it.url} className="text-sm">
              <a
                href={it.url}
                target="_blank"
                rel="noreferrer"
                className="hover:underline line-clamp-2"
              >
                {it.title}
              </a>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {it.source}
                {it.published_at
                  ? ` · ${new Date(it.published_at).toLocaleString('ko-KR', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

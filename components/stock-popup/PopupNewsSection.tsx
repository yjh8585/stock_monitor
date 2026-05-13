'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { safeDateLabel } from '@/lib/format';
import { NewsItem } from '@/lib/types';

interface ExternalNewsItem {
  title: string;
  url: string;
  source: string;
  published_at: string | null;
}

interface Props {
  companyId: string;
  companyName: string;
  ticker: string;
  country: string;
}

const NUMERIC_TICKER = /^\d{6}$/;

function buildExternalLink(
  companyName: string,
  ticker: string,
  isKR: boolean
): { href: string; label: string } {
  const q = encodeURIComponent(companyName);
  if (isKR && NUMERIC_TICKER.test(ticker)) {
    return {
      href: `https://finance.naver.com/item/news_news.naver?code=${ticker}`,
      label: '네이버 금융 뉴스',
    };
  }
  if (isKR) {
    return {
      href: `https://search.naver.com/search.naver?where=news&query=${q}`,
      label: '네이버 뉴스 검색',
    };
  }
  return {
    href: `https://news.google.com/search?q=${q}&hl=ko`,
    label: 'Google 뉴스 검색',
  };
}

/** 팝업 우측 뉴스 패널 — DB 뉴스 없으면 외부 검색 fallback */
export default function PopupNewsSection({ companyId, companyName, ticker, country }: Props) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [external, setExternal] = useState<ExternalNewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  const isKR = country === 'KR';
  const link = buildExternalLink(companyName, ticker, isKR);

  useEffect(() => {
    let cancelled = false;

    async function loadNews() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase
          .from('news')
          .select('id, title, url, source, published_at')
          .eq('company_id', companyId)
          .order('published_at', { ascending: false })
          .limit(10);
        if (cancelled) return;
        const items = (data as NewsItem[]) ?? [];
        setNews(items);

        if (items.length === 0) {
          const params = new URLSearchParams({ q: companyName, country: isKR ? 'kr' : 'global' });
          const r = await fetch(`/api/news/search?${params}`);
          if (!cancelled && r.ok) {
            const j = (await r.json()) as { items?: ExternalNewsItem[] };
            setExternal(j.items ?? []);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadNews();
    return () => { cancelled = true; };
  }, [companyId, companyName, isKR]);

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <header className="px-3 py-2 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold">최신 뉴스</h2>
      </header>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">로딩 중…</p>
        ) : news.length > 0 ? (
          <ul className="divide-y divide-border">
            {news.map((item) => {
              const dateLabel = safeDateLabel(item.published_at);
              return (
                <li key={item.id} className="px-3 py-3">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-foreground hover:underline block leading-snug"
                  >
                    {item.title}
                  </a>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {item.source && <span>{item.source} · </span>}
                    {dateLabel}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : external.length > 0 ? (
          <ul className="divide-y divide-border">
            {external.map((item) => {
              const dateLabel = safeDateLabel(item.published_at);
              return (
                <li key={item.url} className="px-3 py-3">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-foreground hover:underline block leading-snug"
                  >
                    {item.title}
                  </a>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {item.source && <span>{item.source} · </span>}
                    {dateLabel}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-3 py-4 text-xs text-muted-foreground">수집된 뉴스가 없습니다.</p>
        )}
      </div>
      <div className="px-3 py-2 border-t border-border shrink-0">
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          {link.label} <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}

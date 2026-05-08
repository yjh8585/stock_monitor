'use client';

import { useState } from 'react';
import { Newspaper, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { NewsItem } from '@/lib/types';

interface NewsModalProps {
  companyId: string;
  companyName: string;
  ticker?: string | null;
  country?: string;
}

const NUMERIC_TICKER = /^\d{6}$/;

/** 외부 뉴스 검색 링크 — 한국 상장사: 네이버 금융 / 한국 비상장: 네이버 검색 / 해외: 구글 뉴스 */
function buildExternalLink(
  companyName: string,
  ticker: string | null | undefined,
  isKR: boolean
): { href: string; label: string } {
  const q = encodeURIComponent(companyName);
  if (isKR) {
    if (ticker && NUMERIC_TICKER.test(ticker)) {
      return {
        href: `https://finance.naver.com/item/news_news.naver?code=${ticker}`,
        label: '네이버 금융 뉴스',
      };
    }
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

interface ExternalNewsItem {
  title: string;
  url: string;
  source: string;
  published_at: string | null;
}

/** 종목 뉴스 Dialog: news 테이블 + 비어 있으면 외부 검색 fetch */
export default function NewsModal({ companyId, companyName, ticker, country }: NewsModalProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [external, setExternal] = useState<ExternalNewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);

  const isKR = country === 'KR';
  const link = buildExternalLink(companyName, ticker, isKR);

  const loadNews = async () => {
    if (opened) return;
    setOpened(true);
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase
      .from('news')
      .select('id, title, url, source, published_at')
      .eq('company_id', companyId)
      .order('published_at', { ascending: false })
      .limit(10);
    const items = (data as NewsItem[]) ?? [];
    setNews(items);

    if (items.length === 0) {
      try {
        const params = new URLSearchParams({
          q: companyName,
          country: isKR ? 'kr' : 'global',
        });
        const r = await fetch(`/api/news/search?${params}`);
        if (r.ok) {
          const j = (await r.json()) as { items?: ExternalNewsItem[] };
          setExternal(j.items ?? []);
        }
      } catch {
        // 네트워크 오류 — 외부 링크 fallback 만 표시
      }
    }
    setLoading(false);
  };

  return (
    <Dialog>
      <DialogTrigger
        onClick={loadNews}
        className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
        title="뉴스 보기"
      >
        <Newspaper size={12} />
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{companyName} 최신 뉴스</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">로딩 중…</p>
        ) : (
          <div className="space-y-3">
            {news.length > 0 && (
              <ul className="space-y-2">
                {news.map((n) => (
                  <li key={n.id}>
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-foreground hover:underline block"
                    >
                      {n.title}
                    </a>
                    <span className="text-[10px] text-muted-foreground">
                      {n.source} · {new Date(n.published_at).toLocaleDateString('ko-KR')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {news.length === 0 && external.length > 0 && (
              <ul className="space-y-2">
                {external.map((n, i) => (
                  <li key={i}>
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-foreground hover:underline block"
                    >
                      {n.title}
                    </a>
                    <span className="text-[10px] text-muted-foreground">
                      {n.source}
                      {n.published_at
                        ? ` · ${new Date(n.published_at).toLocaleDateString('ko-KR')}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {news.length === 0 && external.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                수집된 뉴스가 없습니다.
              </p>
            )}
            <div className="pt-2 border-t border-border">
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
        )}
      </DialogContent>
    </Dialog>
  );
}

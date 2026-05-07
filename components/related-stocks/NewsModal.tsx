'use client';

import { useState } from 'react';
import { Newspaper } from 'lucide-react';
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

/** 종목 뉴스 Dialog */
export default function NewsModal({ companyId, companyName, ticker, country }: NewsModalProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);

  const isKR = country === 'KR';

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
    setNews((data as NewsItem[]) ?? []);
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
        ) : news.length === 0 ? (
          <div className="py-4">
            <p className="text-xs text-muted-foreground text-center">수집된 뉴스가 없습니다.</p>
            {isKR && ticker && (
              <a
                href={`https://finance.naver.com/item/news_news.naver?code=${ticker}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline block text-center mt-2"
              >
                네이버 금융에서 뉴스 보기 ↗
              </a>
            )}
          </div>
        ) : (
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
      </DialogContent>
    </Dialog>
  );
}

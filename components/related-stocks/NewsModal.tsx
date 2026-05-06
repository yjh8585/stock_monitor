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

interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string | null;
  published_at: string;
}

interface NewsModalProps {
  companyId: string;
  companyName: string;
}

/** 종목 뉴스 Dialog */
export default function NewsModal({ companyId, companyName }: NewsModalProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);

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
      .limit(5);
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
          <p className="text-xs text-muted-foreground py-4 text-center">
            수집된 뉴스가 없습니다. (수집 예정)
          </p>
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

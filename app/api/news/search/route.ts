import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface NewsItem {
  title: string;
  url: string;
  source: string;
  published_at: string | null;
}

const HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).trim();
}

/** 구글 뉴스 RSS 파싱 (한국어/영어 분기). 네이버 검색 페이지는 SPA 동적 렌더링이라 fetch 어려움 → 한국어 검색도 구글 RSS 활용. */
async function searchGoogleNews(q: string, lang: 'ko' | 'en'): Promise<NewsItem[]> {
  const url =
    lang === 'ko'
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`
      : `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const r = await fetch(url, { headers: HTTP_HEADERS, cache: 'no-store' });
  if (!r.ok) return [];
  const xml = await r.text();

  const items: NewsItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  for (const m of xml.matchAll(itemRe)) {
    if (items.length >= 10) break;
    const block = m[1];
    const pick = (tag: string) => {
      const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
      const mm = block.match(re);
      return mm ? mm[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() : '';
    };
    const title = stripHtml(pick('title'));
    const link = pick('link');
    const pub = pick('pubDate');
    const sourceMatch = block.match(/<source[^>]*>([^<]+)<\/source>/);
    const source = sourceMatch ? sourceMatch[1].trim() : 'Google News';
    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      source,
      published_at: pub ? new Date(pub).toISOString() : null,
    });
  }
  return items;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const q = (params.get('q') ?? '').trim();
  const country = (params.get('country') ?? 'kr').toLowerCase();
  if (!q) return NextResponse.json({ items: [] });

  try {
    const items = await searchGoogleNews(q, country === 'kr' ? 'ko' : 'en');
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] }, { status: 200 });
  }
}

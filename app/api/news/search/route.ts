import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import logger from '@/lib/logger';

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

const QUERY_MAX_LEN = 100;
const RATE_WINDOW_MS = 60_000; // 1분
const RATE_MAX_HITS = 60; // 분당 60회

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(QUERY_MAX_LEN),
  country: z.enum(['kr', 'global']).default('kr'),
});

// TODO: 운영에서는 Upstash Ratelimit + Redis로 교체. Vercel serverless는 인스턴스 분리되어 in-memory는 효과 제한.
const rateBuckets = new Map<string, { hits: number; resetAt: number }>();

function checkRateLimit(key: string): { ok: boolean; resetAt: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { hits: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true, resetAt: now + RATE_WINDOW_MS };
  }
  bucket.hits += 1;
  if (bucket.hits > RATE_MAX_HITS) return { ok: false, resetAt: bucket.resetAt };
  return { ok: true, resetAt: bucket.resetAt };
}

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
  if (!r.ok) {
    throw new Error(`Google News RSS ${r.status}`);
  }
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

/** 뉴스 검색 — Zod 입력 검증 + per-IP rate limit + 명시적 4xx/5xx + Pino 로깅 */
export async function GET(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';

  // rate limit
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    logger.warn({ ip, resetAt: rl.resetAt }, '/api/news/search rate limit hit');
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  // 입력 검증
  const parsed = QuerySchema.safeParse({
    q: req.nextUrl.searchParams.get('q') ?? '',
    country: req.nextUrl.searchParams.get('country') ?? 'kr',
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_params', detail: parsed.error.issues },
      { status: 400 }
    );
  }
  const { q, country } = parsed.data;

  try {
    const items = await searchGoogleNews(q, country === 'kr' ? 'ko' : 'en');
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    logger.error({ err, q, country }, '/api/news/search upstream 실패');
    return NextResponse.json({ ok: false, error: 'upstream_failed' }, { status: 502 });
  }
}

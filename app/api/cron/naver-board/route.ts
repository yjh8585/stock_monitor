/**
 * 네이버 종목토론 30분 cron.
 * 한세 3종목의 최근 7일치 글을 수집해 naver_board_posts UPSERT.
 */
import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchNaverBoardPosts } from '@/lib/naver/board';

const HANSAE_TICKERS = ['016450', '105630', '069640'];

// 본문 fetch까지 포함하면 1종목 ~30~50초. 종목 3개면 2~3분이라 cron 300s 한도 안전.
export const maxDuration = 290;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get('secret') === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const sb = createSupabaseAdminClient();
  const { data: companies, error } = await sb
    .from('companies')
    .select('id,ticker')
    .in('ticker', HANSAE_TICKERS);
  if (error || !companies) {
    logger.error({ err: error }, 'companies 조회 실패');
    return NextResponse.json({ ok: false, error: 'companies_query_failed' }, { status: 500 });
  }

  const summary: { ticker: string; inserted: number; total: number }[] = [];
  for (const c of companies as { id: string; ticker: string }[]) {
    try {
      const posts = await fetchNaverBoardPosts(c.ticker, 7, 10, true);
      if (posts.length === 0) {
        summary.push({ ticker: c.ticker, inserted: 0, total: 0 });
        continue;
      }
      const rows = posts.map((p) => ({
        company_id: c.id,
        post_id: p.postId,
        posted_at: p.postedAt.toISOString(),
        title: p.title,
        body: p.body,
        views: p.views,
        likes: p.likes,
        dislikes: p.dislikes,
        fetched_at: new Date().toISOString(),
      }));
      const { count, error: upErr } = await sb
        .from('naver_board_posts')
        .upsert(rows, { onConflict: 'company_id,post_id', count: 'exact' });
      if (upErr) {
        logger.error({ err: upErr, ticker: c.ticker }, 'naver_board_posts upsert 실패');
        summary.push({ ticker: c.ticker, inserted: 0, total: posts.length });
        continue;
      }
      summary.push({ ticker: c.ticker, inserted: count ?? rows.length, total: posts.length });
    } catch (err) {
      logger.error({ err, ticker: c.ticker }, '종목토론 수집 실패');
      summary.push({ ticker: c.ticker, inserted: 0, total: 0 });
    }
  }

  logger.info({ summary }, '네이버 종목토론 수집 완료');
  return NextResponse.json({ ok: true, summary });
}

/**
 * 감성 분석 cron — 30분 간격.
 * board_sentiment에 아직 없는 naver_board_posts 글을 종목별 최대 50개씩 가져와 LLM 분류.
 */
import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { classifyPosts, SENTIMENT_MODEL } from '@/lib/sentiment/analyze';

const HANSAE_TICKERS = ['016450', '105630', '069640', '053280'];
const BATCH_SIZE = 50;
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
    return NextResponse.json({ ok: false, error: 'companies_query_failed' }, { status: 500 });
  }

  const summary: { ticker: string; analyzed: number }[] = [];
  for (const c of companies as { id: string; ticker: string }[]) {
    // 클라이언트에서 LEFT JOIN 시뮬레이션: 최근 글 → 이미 분석된 글 제외 → BATCH_SIZE만큼만 분석
    const { data: candidates } = await sb
      .from('naver_board_posts')
      .select('post_id,title')
      .eq('company_id', c.id)
      .order('posted_at', { ascending: false })
      .limit(BATCH_SIZE * 2);
    const candidateRows = candidates ?? [];
    if (candidateRows.length === 0) {
      summary.push({ ticker: c.ticker, analyzed: 0 });
      continue;
    }
    const ids = candidateRows.map((p) => p.post_id);
    const { data: already } = await sb
      .from('board_sentiment')
      .select('post_id')
      .eq('company_id', c.id)
      .in('post_id', ids);
    const seen = new Set((already ?? []).map((r) => r.post_id));
    const posts = candidateRows.filter((p) => !seen.has(p.post_id)).slice(0, BATCH_SIZE);

    if (posts.length === 0) {
      summary.push({ ticker: c.ticker, analyzed: 0 });
      continue;
    }

    const results = await classifyPosts(posts.map((p) => ({ postId: p.post_id, title: p.title })));

    if (results.length > 0) {
      const rows = results.map((r) => ({
        company_id: c.id,
        post_id: r.postId,
        label: r.label,
        score: r.score,
        reason: r.reason,
        model: SENTIMENT_MODEL,
        analyzed_at: new Date().toISOString(),
      }));
      const { error: upErr } = await sb
        .from('board_sentiment')
        .upsert(rows, { onConflict: 'company_id,post_id' });
      if (upErr) {
        logger.error({ err: upErr, ticker: c.ticker }, 'board_sentiment upsert 실패');
      }
    }
    summary.push({ ticker: c.ticker, analyzed: results.length });
  }
  logger.info({ summary }, '감성 분석 완료');
  return NextResponse.json({ ok: true, summary });
}

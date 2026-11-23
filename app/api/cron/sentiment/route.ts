/**
 * 감성 분석 cron — 30분 간격.
 * board_sentiment에 아직 없는 naver_board_posts 글을 종목별 최대 50개씩 가져와 LLM 분류.
 */
import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { latestHaikuModel } from '@/lib/reports/anthropic';
import { classifyPosts } from '@/lib/sentiment/analyze';

const HANSAE_TICKERS = ['016450', '105630', '069640', '053280'];
const BATCH_SIZE = 50;
export const maxDuration = 290;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  // 헤더로만 받는다 — 주소(`?secret=`)는 접속 기록에 평문으로 남는다(GHA 크론은 Bearer 헤더)
  return auth === `Bearer ${secret}`;
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
  // 분류 호출·저장 실패 종목 — 하나라도 있으면 502 로 응답해 GHA(curl --fail-with-body)가 실패로 알린다
  const failed: { ticker: string; stage: 'classify' | 'upsert' }[] = [];
  for (const c of companies as { id: string; ticker: string }[]) {
    // 클라이언트에서 LEFT JOIN 시뮬레이션: 최근 글 → 이미 분석된 글 제외 → BATCH_SIZE만큼만 분석
    const { data: candidates, error: candErr } = await sb
      .from('naver_board_posts')
      .select('post_id,title')
      .eq('company_id', c.id)
      .order('posted_at', { ascending: false })
      .limit(BATCH_SIZE * 2);
    if (candErr) {
      logger.error({ err: candErr, ticker: c.ticker }, '감성 분석 후보 조회 실패');
      return NextResponse.json(
        { ok: false, error: 'candidates_query_failed', ticker: c.ticker },
        { status: 500 }
      );
    }
    const candidateRows = candidates ?? [];
    if (candidateRows.length === 0) {
      summary.push({ ticker: c.ticker, analyzed: 0 });
      continue;
    }
    const ids = candidateRows.map((p) => p.post_id);
    const { data: already, error: alreadyErr } = await sb
      .from('board_sentiment')
      .select('post_id')
      .eq('company_id', c.id)
      .in('post_id', ids);
    if (alreadyErr) {
      logger.error({ err: alreadyErr, ticker: c.ticker }, '분석 완료 글 조회 실패');
      return NextResponse.json(
        { ok: false, error: 'already_query_failed', ticker: c.ticker },
        { status: 500 }
      );
    }
    const seen = new Set((already ?? []).map((r) => r.post_id));
    const posts = candidateRows.filter((p) => !seen.has(p.post_id)).slice(0, BATCH_SIZE);

    if (posts.length === 0) {
      summary.push({ ticker: c.ticker, analyzed: 0 });
      continue;
    }

    const model = await latestHaikuModel();
    const results = await classifyPosts(
      posts.map((p) => ({ postId: p.post_id, title: p.title })),
      model
    );
    if (results === null) {
      failed.push({ ticker: c.ticker, stage: 'classify' });
      summary.push({ ticker: c.ticker, analyzed: 0 });
      continue;
    }

    let saved = 0;
    if (results.length > 0) {
      const rows = results.map((r) => ({
        company_id: c.id,
        post_id: r.postId,
        label: r.label,
        score: r.score,
        reason: r.reason,
        model,
        analyzed_at: new Date().toISOString(),
      }));
      const { error: upErr } = await sb
        .from('board_sentiment')
        .upsert(rows, { onConflict: 'company_id,post_id' });
      if (upErr) {
        logger.error({ err: upErr, ticker: c.ticker }, 'board_sentiment upsert 실패');
        failed.push({ ticker: c.ticker, stage: 'upsert' });
      } else {
        saved = rows.length;
      }
    }
    summary.push({ ticker: c.ticker, analyzed: saved });
  }
  if (failed.length > 0) {
    logger.error({ summary, failed }, '감성 분석 일부 실패');
    return NextResponse.json(
      { ok: false, error: 'partial_failure', summary, failed },
      { status: 502 }
    );
  }
  logger.info({ summary }, '감성 분석 완료');
  return NextResponse.json({ ok: true, summary });
}

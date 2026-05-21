/**
 * 네이버 종목토론 수집 — 한세 3종목.
 *
 * 배경:
 *   기존 /api/cron/naver-board가 Vercel Hobby plan 60s 한계에 걸려 504.
 *   GHA runner에서 직접 fetchNaverBoardPosts() 호출 후 Supabase upsert로 전환
 *   (다른 collect_*.py 워크플로와 동일한 패턴, Vercel timeout 무관).
 *
 * 실행: npx tsx scripts/collect_naver_board.ts
 * 환경: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js';
import { fetchNaverBoardPosts } from '../lib/naver/board';

const HANSAE_TICKERS = ['016450', '105630', '069640'];

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 미설정');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: companies, error } = await sb
    .from('companies')
    .select('id,ticker')
    .in('ticker', HANSAE_TICKERS);
  if (error || !companies) {
    console.error('companies 조회 실패:', error?.message);
    process.exit(1);
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
        console.error(`${c.ticker} upsert 실패:`, upErr.message);
        summary.push({ ticker: c.ticker, inserted: 0, total: posts.length });
        continue;
      }
      summary.push({ ticker: c.ticker, inserted: count ?? rows.length, total: posts.length });
    } catch (err) {
      console.error(`${c.ticker} 수집 실패:`, err);
      summary.push({ ticker: c.ticker, inserted: 0, total: 0 });
    }
  }

  console.log('네이버 종목토론 수집 완료:', JSON.stringify(summary));

  const revUrl = process.env.NEXT_REVALIDATE_URL;
  const revSecret = process.env.NEXT_REVALIDATE_SECRET;
  if (revUrl && revSecret) {
    try {
      const r = await fetch(revUrl, {
        method: 'POST',
        headers: { 'x-revalidate-secret': revSecret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['naver_board_posts'] }),
      });
      console.log('revalidate:', r.status);
    } catch (err) {
      console.warn('revalidate 실패:', err);
    }
  }
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});

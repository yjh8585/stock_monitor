/**
 * 네이버 종목토론 수집 — 한세 4종목.
 *
 * 배경:
 *   기존 /api/cron/naver-board가 Vercel Hobby plan 60s 한계에 걸려 504.
 *   GHA runner에서 직접 fetchNaverBoardPosts() 호출 후 Supabase upsert로 전환
 *   (다른 collect_*.py 워크플로와 동일한 패턴, Vercel timeout 무관).
 *
 * 🔴 종료코드로 「조용한 정지」를 막는다(2026-09-12 개편 때 나흘을 잃고 신설):
 *   0 = 정상 · 1 = 환경·DB 문제 · 3 = 수집 경로가 깨졌다(구조 변경 의심)
 *   exit 3 은 종목이 하나라도 실패했거나, **네 종목 모두 네이버가 글을 0건 준** 경우다.
 *   글이 0건인 것과 API 가 빈 배열을 주는 것을 가르려고 rawCount 를 함께 본다.
 *
 * 실행: npx tsx scripts/collect_naver_board.ts
 * 환경: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js';
import { fetchNaverBoardPosts } from '../lib/naver/board';

const HANSAE_TICKERS = ['016450', '105630', '069640', '053280'];
/** 수집 경로가 깨진 것으로 보고 실패시키는 종료코드. */
const EXIT_BROKEN = 3;

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

  const summary: { ticker: string; inserted: number; total: number; raw: number }[] = [];
  const failed: string[] = [];
  for (const c of companies as { id: string; ticker: string }[]) {
    try {
      // 본문은 개편 뒤 목록 응답에 함께 오지만(추가 요청 없음) 감성 분석은 제목만
      // 쓰므로 종전대로 담지 않는다.
      const { posts, rawCount } = await fetchNaverBoardPosts(c.ticker, 7, 10, false);
      if (posts.length === 0) {
        summary.push({ ticker: c.ticker, inserted: 0, total: 0, raw: rawCount });
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
        failed.push(c.ticker);
        summary.push({ ticker: c.ticker, inserted: 0, total: posts.length, raw: rawCount });
        continue;
      }
      summary.push({
        ticker: c.ticker,
        inserted: count ?? rows.length,
        total: posts.length,
        raw: rawCount,
      });
    } catch (err) {
      console.error(`${c.ticker} 수집 실패:`, err);
      failed.push(c.ticker);
      summary.push({ ticker: c.ticker, inserted: 0, total: 0, raw: 0 });
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

  // 🔴 여기서 조용히 0 으로 끝내지 않는다 — 옛 수집기가 그래서 나흘을 잃었다.
  if (failed.length > 0) {
    console.error(`::error::종목토론 수집 실패 ${failed.join(', ')} — 수집 경로 확인 필요`);
    process.exit(EXIT_BROKEN);
  }
  if (summary.every((s) => s.raw === 0)) {
    console.error('::error::네 종목 모두 네이버가 글을 0건 반환 — 구조가 또 바뀌었을 수 있습니다');
    process.exit(EXIT_BROKEN);
  }
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});

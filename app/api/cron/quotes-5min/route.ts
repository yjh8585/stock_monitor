/**
 * 5분 시세 수집 cron — Vercel Cron이 KST 장중에 매 5분 호출.
 *
 * 1) Authorization: Bearer <CRON_SECRET> 검증 (로컬은 ?secret= 쿼리도 허용)
 * 2) 한세 3종목(016450/105630/069640)을 companies에서 조회
 * 3) 키움 getQuote 병렬 호출
 * 4) companies.last_* UPDATE + stock_quotes_5min INSERT
 *
 * 응답: { ok: true, fetched: number, errors: string[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getKiwoomClient } from '@/lib/kiwoom/client';
import { revalidateTag } from 'next/cache';

const HANSAE_TICKERS = ['016450', '105630', '069640'];

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
  const { data: companies, error: cErr } = await sb
    .from('companies')
    .select('id,ticker')
    .in('ticker', HANSAE_TICKERS);
  if (cErr || !companies) {
    logger.error({ err: cErr }, 'companies 조회 실패');
    return NextResponse.json({ ok: false, error: 'companies_query_failed' }, { status: 500 });
  }

  const kiwoom = getKiwoomClient();
  const errors: string[] = [];
  let fetched = 0;
  const now = new Date();
  // 5분 경계로 정규화: 14:37 → 14:35
  const ts = new Date(now.getTime() - (now.getTime() % (5 * 60_000)));

  await Promise.all(
    companies.map(async (c) => {
      const company = c as { id: string; ticker: string };
      try {
        const q = await kiwoom.getQuote(company.ticker);
        const { error: insErr } = await sb.from('stock_quotes_5min').upsert({
          company_id: company.id,
          ts: ts.toISOString(),
          price: q.price,
          change_pct: q.changePct,
          volume: q.volume,
        });
        if (insErr) {
          errors.push(`${company.ticker} insert: ${insErr.message}`);
          return;
        }
        const { error: upErr } = await sb
          .from('companies')
          .update({
            last_price: q.price,
            last_change_pct: q.changePct,
            last_volume: q.volume,
            last_updated_at: q.ts.toISOString(),
          })
          .eq('id', company.id);
        if (upErr) {
          errors.push(`${company.ticker} update: ${upErr.message}`);
          return;
        }
        fetched += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${company.ticker}: ${msg}`);
        logger.error({ err, ticker: company.ticker }, '5분 시세 수집 실패');
      }
    })
  );

  // 클라이언트 캐시 무효화 (companies 메타 — last_price 변경 반영)
  revalidateTag('companies', 'max');

  logger.info({ fetched, errors: errors.length, ts: ts.toISOString() }, '5분 시세 수집 완료');
  return NextResponse.json({ ok: errors.length === 0, fetched, errors, ts: ts.toISOString() });
}

/**
 * 캐시 무효화 API — Python 데이터 수집 스크립트가 DB UPDATE 후 호출.
 *
 * 사용:
 *   POST /api/revalidate
 *   Headers: { "x-revalidate-secret": "<NEXT_REVALIDATE_SECRET>" }
 *   Body: { "tags": ["related_stocks_view", "exchange_rates_live"] }
 *
 * 또는 단순:
 *   POST /api/revalidate?secret=XXX&tag=related_stocks_view
 *
 * tag=all → 모든 페이지 캐시 무효화
 */
import { updateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

const ALL_TAGS = [
  'related_stocks_view',
  'domestic_stocks_view',
  'parts_top100_stocks_view',
  'exchange_rates_live',
  'oem_sales_group_month',
  'oem_sales_group_pt_month',
  'oem_sales_group_country_month',
  'oem_sales_type_seg_month',
];

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-revalidate-secret') ?? req.nextUrl.searchParams.get('secret');
  const expected = process.env.NEXT_REVALIDATE_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'NEXT_REVALIDATE_SECRET 미설정 (.env.local 추가 필요)' },
      { status: 500 }
    );
  }
  if (secret !== expected) {
    return NextResponse.json({ error: 'invalid secret' }, { status: 401 });
  }

  let tags: string[] = [];
  const queryTag = req.nextUrl.searchParams.get('tag');
  if (queryTag) tags = [queryTag];

  try {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body.tags)) tags = body.tags as string[];
  } catch {}

  if (tags.length === 0) {
    return NextResponse.json({ error: 'tags 누락 (body.tags 또는 ?tag=)' }, { status: 400 });
  }

  // tag='all' → 모든 페이지 무효화
  if (tags.includes('all')) tags = ALL_TAGS;

  const revalidated: string[] = [];
  for (const t of tags) {
    updateTag(t);
    revalidated.push(t);
  }

  return NextResponse.json({ ok: true, revalidated, at: new Date().toISOString() });
}

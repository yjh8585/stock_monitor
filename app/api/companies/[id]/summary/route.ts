import { NextResponse } from 'next/server';

import logger from '@/lib/logger';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';

/** companies.id 는 uuid — 형식이 아니면 DB 를 때리지 않고 거절한다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 회사 설명(business_summary) 단건 조회 — 표에서 행을 펼칠 때만 호출한다.
 *
 * 이 값은 펼침 행에서만 쓰는데 표 payload 에 전부 실으면 주식 뷰 3개 합 283KB 가 된다.
 * ISR write 는 payload 크기(8KB 단위) 기준 과금이라 재기록마다 그만큼 비용이 붙어,
 * ISR payload 에서 빼고 필요할 때만 여기서 준다. 배경 → docs/isr-write-optimization.md
 *
 * proxy.ts 의 PUBLIC_PATH_PREFIXES 에 없으므로 세션이 필요한 보호 라우트다.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: '잘못된 회사 id' }, { status: 400 });
  }

  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase
    .from('companies')
    .select('business_summary')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, id }, 'business_summary 조회 실패');
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }

  return NextResponse.json(
    { business_summary: data?.business_summary ?? null },
    // 설명은 enrich 스크립트가 가끔 갱신하는 정도라 브라우저 캐시로 재요청을 줄인다.
    // 세션별 보호 라우트이므로 public 이 아니라 private.
    { headers: { 'Cache-Control': 'private, max-age=300' } }
  );
}

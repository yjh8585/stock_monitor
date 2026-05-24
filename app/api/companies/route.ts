import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import logger from '@/lib/logger';
import { createCompanyInputSchema } from '@/lib/companies/schemas';
import { fail, ok } from '@/lib/reports/api-response';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * 신규 회사 INSERT — `/management/companies` 폼 백엔드.
 *
 * 흐름:
 *   1) Zod 검증 (필수 컬럼 enum + length).
 *   2) ticker 중복 사전 조회 — UNIQUE constraint 의존하지 않고 사용자에 명확한 메시지.
 *   3) admin client로 INSERT — 트리거(`companies_auto_page_mapping`, `companies_normalize_*`,
 *      `company_type` DEFAULT)가 후처리.
 *   4) 캐시 무효화 — companies + 3개 stocks view (data_source별로 매핑됨).
 *
 * 후속: 메타·재무·뉴스 보강은 `scripts/onboard_company.py --ticker <T>` 실행. API는
 * INSERT까지만 책임.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(fail('INVALID_JSON', '요청 본문이 올바른 JSON이 아닙니다.'), {
      status: 400,
    });
  }

  const parsed = createCompanyInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(fail('INVALID_INPUT', parsed.error.message), { status: 400 });
  }
  const input = parsed.data;

  const supabase = createSupabaseAdminClient();

  // 중복 ticker 사전 조회 — UNIQUE constraint도 잡지만 메시지 명확성을 위해.
  const { data: existing, error: dupErr } = await supabase
    .from('companies')
    .select('id, ticker, name_kr')
    .eq('ticker', input.ticker)
    .maybeSingle();
  if (dupErr) {
    logger.error({ err: dupErr }, '중복 조회 실패');
    return NextResponse.json(fail('LOOKUP_FAILED', dupErr.message), { status: 500 });
  }
  if (existing) {
    return NextResponse.json(
      fail('DUPLICATE_TICKER', `ticker '${input.ticker}'은 이미 등록됨 (${existing.name_kr})`),
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from('companies')
    .insert({
      ticker: input.ticker,
      name: input.name,
      name_kr: input.name_kr,
      country: input.country,
      currency: input.currency,
      data_source: input.data_source,
      market: input.market ?? null,
      company_type: input.company_type,
      region: input.region ?? null,
      group_name: input.group_name ?? null,
      status: input.status,
    })
    .select('id, ticker, name_kr')
    .single();
  if (error) {
    logger.error({ err: error, ticker: input.ticker }, '회사 INSERT 실패');
    return NextResponse.json(fail('INSERT_FAILED', error.message), { status: 500 });
  }

  // 트리거가 company_pages 자동 매핑 + customers/products 자동 정규화.
  // 목록·뷰 캐시 무효화 (3개 페이지뷰 모두).
  revalidateTag('companies', 'max');
  revalidateTag('related_stocks_view', 'max');
  revalidateTag('domestic_stocks_view', 'max');
  revalidateTag('parts_top100_stocks_view', 'max');

  logger.info({ id: data.id, ticker: data.ticker, name_kr: data.name_kr }, '회사 INSERT 성공');
  return NextResponse.json(ok(data), { status: 201 });
}

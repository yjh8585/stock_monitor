import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import logger from '@/lib/logger';
import { createCompanyInputSchema } from '@/lib/companies/schemas';
import { fail, ok } from '@/lib/reports/api-response';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const GITHUB_OWNER = 'yjh8585';
const GITHUB_REPO = 'stock_monitor';
const ONBOARD_WORKFLOW = 'onboard-company.yml';

/**
 * GitHub workflow_dispatch 호출 — INSERT 후 onboard_company.py 자동 실행.
 *
 * fire-and-forget: API는 dispatch 시작만 트리거하고 결과는 모름. 사용자가
 * Actions UI에서 확인. dispatch 자체 실패는 응답에 명시 — INSERT는 유지(graceful).
 */
async function triggerOnboardWorkflow(
  ticker: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    return { ok: false, error: 'GITHUB_PAT 환경변수 미설정' };
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${ONBOARD_WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ ref: 'master', inputs: { ticker } }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `GitHub API ${res.status}: ${text.slice(0, 200)}` };
    }
    // 204 No Content. workflow run URL은 별도 폴링이 필요해 일단 workflow page URL 반환.
    return {
      ok: true,
      url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${ONBOARD_WORKFLOW}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 신규 회사 INSERT + onboarding 자동 트리거.
 *
 * 흐름:
 *   1) Zod 검증.
 *   2) ticker 중복 사전 조회.
 *   3) admin client INSERT — 트리거(auto_page_mapping/normalize_customers/products) 후처리.
 *   4) 캐시 무효화 (companies + 3 stocks views).
 *   5) GitHub workflow_dispatch로 `scripts/onboard_company.py --ticker XXX` 자동 실행 트리거.
 *      dispatch 실패해도 INSERT는 유지 — graceful fallback.
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

  revalidateTag('companies', 'max');
  revalidateTag('related_stocks_view', 'max');
  revalidateTag('domestic_stocks_view', 'max');
  revalidateTag('parts_top100_stocks_view', 'max');

  // workflow_dispatch — fire-and-forget. INSERT는 이미 성공이라 graceful.
  // ticker는 NOT NULL이지만 Supabase select 추론이 nullable로 잡혀 narrow.
  const insertedTicker = data.ticker ?? input.ticker;
  const dispatch = await triggerOnboardWorkflow(insertedTicker);
  if (!dispatch.ok) {
    logger.warn(
      { err: dispatch.error, ticker: data.ticker },
      'onboard workflow_dispatch 실패 — INSERT는 유지'
    );
  } else {
    logger.info({ ticker: data.ticker, url: dispatch.url }, 'onboard workflow_dispatch 트리거됨');
  }

  return NextResponse.json(
    ok({
      ...data,
      actionsRunUrl: dispatch.ok ? dispatch.url : null,
      dispatchError: dispatch.ok ? null : dispatch.error,
    }),
    { status: 201 }
  );
}

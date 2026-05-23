/**
 * 익명(anon) Supabase 클라이언트 — 인증 쿠키 없이 동작.
 *
 * 용도: `'use cache'` 함수 안에서 anon RLS 정책으로 충분한 view/테이블 조회.
 * cookies 의존이 없어 Cache Components의 PPR 경계와 충돌하지 않는다.
 *
 * RLS 우회가 필요한 경우는 `createSupabaseAdminClient` (`./admin`)를 사용한다.
 * 사외비 테이블(`pnl_*`, `chat_audit_log`)은 `confidentialDb` (`./confidential`)를 통해 접근.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

let _client: ReturnType<typeof createClient<Database>> | null = null;

/** 싱글톤 anon 클라이언트. 매 호출마다 createClient 호출 비용 회피. */
export function createSupabaseAnonClient() {
  if (_client) return _client;
  _client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
  return _client;
}

/**
 * service_role 권한 Supabase 클라이언트 — RLS를 우회하므로 서버 라우트/서비스에서만 사용.
 *
 * 용도: 보고서 게시판의 INSERT/UPDATE/DELETE, Storage 업로드 등 쓰기 작업.
 * 절대 클라이언트 컴포넌트에서 import 하지 말 것.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

let _client: ReturnType<typeof createClient<Database>> | null = null;

/** 싱글턴 admin 클라이언트. */
export function createSupabaseAdminClient() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.');
  }
  _client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

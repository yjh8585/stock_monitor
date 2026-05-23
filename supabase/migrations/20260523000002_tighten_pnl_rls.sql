-- pnl_entries / pnl_cost_structure: anon 직접 SELECT 차단.
-- 기존 정책 USING(true)은 NEXT_PUBLIC_SUPABASE_ANON_KEY로 외부에서 직접 추출이 가능했음.
-- 한세모빌리티 손익은 사외비/영업비밀 등급이므로 RLS를 닫고 서버 컴포넌트에서
-- service_role(admin client)만 접근하도록 변경한다. service_role은 RLS를 자동 우회한다.
--
-- 영향 코드:
-- - app/management/pnl/page.tsx : createSupabaseAnonClient → createSupabaseAdminClient
-- - lib/chat/tools.ts : query_pnl 도구 제거 완료 (외부 LLM 전송 차단)

DROP POLICY IF EXISTS "Anyone can read pnl_entries" ON pnl_entries;
DROP POLICY IF EXISTS "Anyone can read pnl_cost_structure" ON pnl_cost_structure;

-- RLS는 enabled 상태 유지. 정책이 없으므로 anon/authenticated 모두 deny (default deny).
-- service_role 키는 RLS를 우회하므로 서버 컴포넌트는 정상 동작.

COMMENT ON TABLE pnl_entries IS '한세모빌리티 손익 — 사외비. 서버 컴포넌트의 admin client(service_role)로만 접근.';
COMMENT ON TABLE pnl_cost_structure IS '한세모빌리티 비용구조 — 사외비. 서버 컴포넌트의 admin client(service_role)로만 접근.';

/**
 * 사외비(confidential) 테이블 전용 wrapper — service_role 권한으로 RLS 우회.
 *
 * 사외비 테이블은 ENABLE ROW LEVEL SECURITY + 정책 없음(default-deny) 패턴이라
 * anon 키로는 빈 결과만 받는다. 이 wrapper를 통하면 자동으로 service_role 클라이언트를
 * 거치므로 정상 접근 가능. 동시에 TypeScript union으로 사외비 테이블 외 접근을 차단한다.
 *
 * 사용:
 *   import { confidentialDb } from '@/lib/supabase/confidential';
 *   const { data } = await confidentialDb.from('pnl_entries').select('*').range(0, 999);
 *   await confidentialDb.from('chat_audit_log').insert({ ... });
 *
 *   // ↓ 컴파일 에러: 사외비 명단에 없는 테이블
 *   // confidentialDb.from('companies');
 *
 * 새 사외비 테이블 추가 절차 (AGENTS.md "사외비 테이블 격리" 섹션 참고):
 *   1. supabase/migrations/*.sql: CREATE TABLE + ENABLE RLS (정책 없이)
 *   2. mcp__supabase__generate_typescript_types → database.types.ts 갱신
 *   3. CONFIDENTIAL_TABLES 배열에 테이블명 한 줄 추가
 *   4. 호출처: confidentialDb.from('새 테이블').select(...)
 *
 * 절대 클라이언트 컴포넌트에서 import 하지 말 것 (service_role 키 노출).
 */
import 'server-only';
import type { Database } from '@/lib/database.types';
import { createSupabaseAdminClient } from './admin';

/**
 * 사외비 테이블 명단.
 * - pnl_entries / pnl_cost_structure: 손익 데이터 (migration 20260523000002)
 * - chat_audit_log: 챗봇 도구 호출 감사 로그 (migration 20260523000003)
 * - pnl_plan: 계획 대비 실적 (migration 20260528000001)
 * - inventory_entries: 재고 계획·실적 추이 (migration 20260528000002)
 * - personnel_entries: 인원 추이 (migration 20260528000003)
 * - pnl_fixed_variable: 전사 고정비/변동비 비용구조 (migration 20260609000001)
 * - finance_entries: 재무(대차대조표) 추이 (migration 20260610000001)
 * - loan_entries: 이인텔리전스 자회사 대여금 계획·실적 (migration 20260611000001)
 * - management_uploads: 경영관리 엑셀 업로드 작업 추적 (migration 20260624000001)
 * - org_charts: 조직도 이미지 메타 (migration 20260624000002)
 * - longterm_revenue_plan: 영업본부 중장기 매출 전망 (migration 20260715000001)
 */
const CONFIDENTIAL_TABLES = [
  'pnl_entries',
  'pnl_cost_structure',
  'chat_audit_log',
  'pnl_plan',
  'inventory_entries',
  'personnel_entries',
  'pnl_fixed_variable',
  'finance_entries',
  'loan_entries',
  'management_uploads',
  'org_charts',
  'longterm_revenue_plan',
] as const;

/**
 * 사외비 테이블 union 타입.
 * `keyof Database['public']['Tables']`와 교차해서 명단의 모든 테이블이
 * 실제 schema에 존재함을 컴파일러가 강제한다. DB에서 사라지면 즉시 빌드 에러.
 */
export type ConfidentialTable = (typeof CONFIDENTIAL_TABLES)[number] &
  keyof Database['public']['Tables'];

/**
 * 사외비 테이블 전용 클라이언트. .from(table)만 노출 — .rpc/.storage/.auth는
 * 의도적으로 미노출(YAGNI). 필요해지면 그때 추가.
 *
 * createSupabaseAdminClient()는 내부에서 lazy singleton이라 모듈 객체로 써도
 * import 시점 부작용 없음.
 */
export const confidentialDb = {
  from<T extends ConfidentialTable>(table: T) {
    return createSupabaseAdminClient().from(table);
  },
};

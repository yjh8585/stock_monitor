/**
 * 챗봇 도구 호출 감사 로그 기록 (fire-and-forget).
 *
 * 챗봇 도구 호출은 결과적으로 Anthropic API로 데이터가 전송되므로 누가 무엇을 조회했는지
 * 추적 가능해야 한다. 실패해도 챗봇 응답을 막지 않기 위해 비동기 + try/catch로 격리한다.
 *
 * 저장 위치: chat_audit_log (migration 20260523000003). service_role 전용 RLS.
 */
import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import logger from '@/lib/logger';
import type { UserRole } from './types';

export interface ToolAuditEntry {
  userId: string;
  userRole: UserRole;
  toolName: string;
  input: unknown;
  /** 도구 결과 row 수. rows 배열을 못 찾으면 null */
  rowCount: number | null;
  isError: boolean;
  errorMsg?: string;
}

/** 결과 객체에서 rows 배열의 길이를 안전하게 추출. */
export function extractRowCount(result: unknown): number | null {
  if (!result || typeof result !== 'object') return null;
  const rec = result as Record<string, unknown>;
  const rows = rec.rows;
  if (Array.isArray(rows)) return rows.length;
  if (typeof rec.count === 'number') return rec.count;
  return null;
}

/**
 * 감사 로그 비동기 기록. await 하지 말 것 — fire-and-forget.
 * 실패해도 챗봇 응답 흐름을 막지 않는다.
 */
export function logToolCall(entry: ToolAuditEntry): void {
  // Promise 만 띄우고 await 하지 않음.
  void (async () => {
    try {
      const supabase = createSupabaseAdminClient();
      // chat_audit_log는 database.types.ts에 아직 미반영(Auto-gen 대기) → 런타임 cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('chat_audit_log').insert({
        user_id: entry.userId,
        user_role: entry.userRole,
        tool_name: entry.toolName,
        input_json: entry.input,
        row_count: entry.rowCount,
        is_error: entry.isError,
        error_msg: entry.errorMsg ?? null,
      });
      if (error) {
        logger.warn(
          { err: error, tool: entry.toolName, uid: entry.userId },
          'chat_audit_log INSERT 실패'
        );
      }
    } catch (err) {
      logger.warn({ err, tool: entry.toolName }, 'chat_audit_log 기록 예외');
    }
  })();
}

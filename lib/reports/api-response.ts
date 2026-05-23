/**
 * 보고서 API 공통 응답 형식.
 * (dto 아님 — Zod 스키마는 dto/post.dto.ts에 둠.)
 */
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function fail(code: string, message: string): ApiResponse<never> {
  return { success: false, error: { code, message } };
}

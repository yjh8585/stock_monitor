/**
 * 로그인 역할(Role)의 단일 진실 공급원.
 *
 * users.ts는 'server-only'라 proxy.ts(미들웨어)에서 직접 못 쓴다.
 * 이 파일은 server-only가 아니므로 session.ts·permissions.ts 등 미들웨어 경유
 * 모듈에서도 안전하게 import 가능 → 역할 추가 시 검증 누락(세션 거부로 로그인 불가)을 방지한다.
 *
 * 새 역할 추가는 여기 ROLES 한 곳만 고치면 type·세션 검증·권한 분기가 함께 따라온다.
 */
export const ROLES = ['mobility', 'hmobility', 'guest', 'holdings', 'admin'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

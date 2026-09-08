/** 로그인 후 리다이렉트할 `next` 경로를 검증한다 — 오픈 리다이렉트 방지. */
export function sanitizeNext(next: unknown): string {
  if (typeof next !== 'string') return '/';
  // `//evil.com` 뿐 아니라 `/\evil.com` 도 브라우저가 프로토콜 상대 URL 로 읽는다.
  // 제어문자·개행이 섞인 값도 헤더를 오염시키므로 함께 막는다.
  if (!next.startsWith('/')) return '/';
  if (/^\/[/\\]/.test(next)) return '/';
  if (/[\x00-\x1f\x7f]/.test(next)) return '/';
  if (next.startsWith('/login')) return '/';
  return next;
}

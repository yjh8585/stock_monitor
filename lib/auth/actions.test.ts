import { describe, expect, it } from 'vitest';

import { sanitizeNext } from './sanitize-next';

describe('sanitizeNext — 오픈 리다이렉트 방지', () => {
  it('백슬래시 프로토콜 상대 URL을 막는다', () => {
    expect(sanitizeNext('/\\evil.com')).toBe('/');
  });

  it('슬래시 프로토콜 상대 URL을 막는다', () => {
    expect(sanitizeNext('//evil.com')).toBe('/');
  });

  it('정상 경로는 통과시킨다', () => {
    expect(sanitizeNext('/reports')).toBe('/reports');
  });

  it('/login으로 시작하는 경로는 막는다', () => {
    expect(sanitizeNext('/login?x=1')).toBe('/');
  });

  it('제어문자·개행이 섞인 값을 막는다', () => {
    expect(sanitizeNext('/a\nb')).toBe('/');
  });

  it('문자열이 아니거나 /로 시작하지 않으면 막는다', () => {
    expect(sanitizeNext(undefined)).toBe('/');
    expect(sanitizeNext('evil.com')).toBe('/');
  });
});

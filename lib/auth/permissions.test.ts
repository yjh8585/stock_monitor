import { describe, expect, it } from 'vitest';

import { canAccess } from './permissions';

describe('canAccess — 조직도(/management/org-chart)', () => {
  const page = '/management/org-chart';
  const api = '/api/management/org-chart/image/2026-07-01';

  it('admin·holdings·mobility는 페이지 허용', () => {
    expect(canAccess(page, 'admin')).toBe(true);
    expect(canAccess(page, 'holdings')).toBe(true);
    expect(canAccess(page, 'mobility')).toBe(true);
  });

  it('hmobility·guest는 페이지 차단', () => {
    expect(canAccess(page, 'hmobility')).toBe(false);
    expect(canAccess(page, 'guest')).toBe(false);
  });

  it('이미지 API도 페이지와 동일 게이트', () => {
    expect(canAccess(api, 'admin')).toBe(true);
    expect(canAccess(api, 'holdings')).toBe(true);
    expect(canAccess(api, 'mobility')).toBe(true);
    expect(canAccess(api, 'hmobility')).toBe(false);
    expect(canAccess(api, 'guest')).toBe(false);
  });
});

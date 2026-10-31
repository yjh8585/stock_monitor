import { describe, expect, it } from 'vitest';

import { canAccess, canPublishReports, canUseChat } from './permissions';

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

describe('canAccess — 기타 > 경영표준(/etc/mgmt-standard)', () => {
  it('사외비 열람 역할(admin·holdings·mobility)만 목차·상세 허용', () => {
    for (const path of ['/etc/mgmt-standard', '/etc/mgmt-standard/123']) {
      expect(canAccess(path, 'admin')).toBe(true);
      expect(canAccess(path, 'holdings')).toBe(true);
      expect(canAccess(path, 'mobility')).toBe(true);
      expect(canAccess(path, 'hmobility')).toBe(false);
      expect(canAccess(path, 'guest')).toBe(false);
    }
  });

  it('다른 기타 탭은 그대로 열려 있다', () => {
    expect(canAccess('/etc/fx', 'guest')).toBe(true);
    expect(canAccess('/etc/economy', 'hmobility')).toBe(true);
  });
});

describe('canPublishReports', () => {
  it('admin·holdings·mobility 는 게시할 수 있다', () => {
    expect(canPublishReports('admin')).toBe(true);
    expect(canPublishReports('holdings')).toBe(true);
    expect(canPublishReports('mobility')).toBe(true);
  });

  it('hmobility·guest 는 게시할 수 없다', () => {
    expect(canPublishReports('hmobility')).toBe(false);
    expect(canPublishReports('guest')).toBe(false);
  });
});

describe('canUseChat', () => {
  it('guest 를 제외한 4역할은 챗봇을 쓸 수 있다', () => {
    expect(canUseChat('admin')).toBe(true);
    expect(canUseChat('holdings')).toBe(true);
    expect(canUseChat('mobility')).toBe(true);
    expect(canUseChat('hmobility')).toBe(true);
  });

  it('guest 는 챗봇을 쓸 수 없다', () => {
    expect(canUseChat('guest')).toBe(false);
  });
});

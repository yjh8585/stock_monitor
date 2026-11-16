import { describe, expect, it } from 'vitest';

import {
  canAccess,
  canAccessConfidentialReports,
  canAccessCustomers,
  canPublishReports,
  canReadPost,
  canUseChat,
  firstManagementPath,
} from './permissions';

describe('canReadPost — 글 한 편 열람(상세 화면·첨부 프록시 공용)', () => {
  const mgmtStandard = { is_confidential: true, category: '경영표준' };
  const confidential = { is_confidential: true, category: '산업' };
  const open = { is_confidential: false, category: null };

  it('경영표준 글은 admin·holdings 만 — mobility 는 주소를 직접 쳐도 못 연다(2026-11-16)', () => {
    expect(canReadPost('admin', mgmtStandard)).toBe(true);
    expect(canReadPost('holdings', mgmtStandard)).toBe(true);
    expect(canReadPost('mobility', mgmtStandard)).toBe(false);
    expect(canReadPost('hmobility', mgmtStandard)).toBe(false);
    expect(canReadPost('guest', mgmtStandard)).toBe(false);
  });

  it('경영표준이 아닌 사외비 글은 mobility 도 그대로 연다', () => {
    expect(canReadPost('mobility', confidential)).toBe(true);
    expect(canReadPost('hmobility', confidential)).toBe(false);
    expect(canReadPost('guest', confidential)).toBe(false);
  });

  it('공개 글은 전 역할', () => {
    expect(canReadPost('guest', open)).toBe(true);
    expect(canReadPost('mobility', open)).toBe(true);
  });
});

describe('canAccess — 조직도(/management/org-chart)', () => {
  const page = '/management/org-chart';
  const api = '/api/management/org-chart/image/2026-07-01';

  it('admin·holdings는 페이지 허용', () => {
    expect(canAccess(page, 'admin')).toBe(true);
    expect(canAccess(page, 'holdings')).toBe(true);
  });

  it('mobility·hmobility·guest는 페이지 차단', () => {
    expect(canAccess(page, 'mobility')).toBe(false);
    expect(canAccess(page, 'hmobility')).toBe(false);
    expect(canAccess(page, 'guest')).toBe(false);
  });

  it('이미지 API도 페이지와 동일 게이트', () => {
    expect(canAccess(api, 'admin')).toBe(true);
    expect(canAccess(api, 'holdings')).toBe(true);
    expect(canAccess(api, 'mobility')).toBe(false);
    expect(canAccess(api, 'hmobility')).toBe(false);
    expect(canAccess(api, 'guest')).toBe(false);
  });
});

describe('canAccess — mobility 경영관리는 스텔란티스만(2026-11-16)', () => {
  it('스텔란티스 탭과 랜딩(/management)만 허용', () => {
    expect(canAccess('/management', 'mobility')).toBe(true);
    expect(canAccess('/management/stellantis', 'mobility')).toBe(true);
    expect(firstManagementPath('mobility')).toBe('/management/stellantis');
  });

  it('나머지 경영관리 탭은 차단', () => {
    for (const tab of [
      'pnl',
      'plan',
      'inventory',
      'production',
      'personnel',
      'finance',
      'org-chart',
      'upload',
      'companies',
    ]) {
      expect(canAccess(`/management/${tab}`, 'mobility')).toBe(false);
    }
  });

  it('경영관리 밖의 사외비 권한은 그대로', () => {
    expect(canAccessConfidentialReports('mobility')).toBe(true);
    expect(canPublishReports('mobility')).toBe(true);
    expect(canAccess('/customers', 'mobility')).toBe(true);
    expect(canAccess('/oem/suppliers', 'mobility')).toBe(true);
  });

  it('비교 페이지·경영표준도 차단(2026-11-16 추가 지시)', () => {
    expect(canAccess('/compare', 'mobility')).toBe(false);
    expect(canAccess('/etc/mgmt-standard', 'mobility')).toBe(false);
    expect(canAccess('/compare', 'holdings')).toBe(true);
    expect(canAccess('/compare', 'hmobility')).toBe(true);
  });

  it('holdings 는 경영관리 전체 그대로', () => {
    expect(canAccess('/management/pnl', 'holdings')).toBe(true);
    expect(canAccess('/management/stellantis', 'holdings')).toBe(true);
  });
});

describe('canAccess — 기타 > 경영표준(/etc/mgmt-standard)', () => {
  it('admin·holdings 만 목차·상세 허용(mobility 는 2026-11-16 부터 차단)', () => {
    for (const path of ['/etc/mgmt-standard', '/etc/mgmt-standard/123']) {
      expect(canAccess(path, 'admin')).toBe(true);
      expect(canAccess(path, 'holdings')).toBe(true);
      expect(canAccess(path, 'mobility')).toBe(false);
      expect(canAccess(path, 'hmobility')).toBe(false);
      expect(canAccess(path, 'guest')).toBe(false);
    }
  });

  it('다른 기타 탭은 그대로 열려 있다', () => {
    expect(canAccess('/etc/fx', 'guest')).toBe(true);
    expect(canAccess('/etc/economy', 'hmobility')).toBe(true);
  });
});

describe('고객사 페이지 접근(/customers)', () => {
  it('사외비 역할만 들어간다', () => {
    expect(canAccessCustomers('admin')).toBe(true);
    expect(canAccessCustomers('holdings')).toBe(true);
    expect(canAccessCustomers('mobility')).toBe(true);
    expect(canAccessCustomers('hmobility')).toBe(false);
    expect(canAccessCustomers('guest')).toBe(false);
  });

  it('canAccess 가 요약·개별 경로를 같은 기준으로 막는다', () => {
    for (const path of ['/customers', '/customers/acme-motors']) {
      expect(canAccess(path, 'admin')).toBe(true);
      expect(canAccess(path, 'holdings')).toBe(true);
      expect(canAccess(path, 'mobility')).toBe(true);
      expect(canAccess(path, 'hmobility')).toBe(false);
      expect(canAccess(path, 'guest')).toBe(false);
    }
  });

  it('비슷한 접두사는 막지 않는다', () => {
    expect(canAccess('/customersfoo', 'guest')).toBe(true);
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

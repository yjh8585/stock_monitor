import type { Role } from './roles';

/** admin 전용 페이지 prefix — 비관리자는 proxy.ts에서 `/`로 redirect. */
const ADMIN_ONLY_PATHS = ['/management/companies', '/management/upload'];

/** hmobility가 접근 가능한 경영관리 하부 페이지(재고·생산·인원). */
const HMOBILITY_MANAGEMENT_PATHS = [
  '/management/inventory',
  '/management/production',
  '/management/personnel',
];

function matchesPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isAdmin(role: Role): boolean {
  return role === 'admin';
}

/**
 * 사외비 보고서(`posts.is_confidential = true`) 열람 권한.
 *
 * 조직도(`/management/org-chart`)와 같은 기준 — 현장(hmobility)·게스트는 차단한다.
 * 화이트리스트로 적어 새 역할이 추가돼도 기본은 차단되게 한다.
 *
 * 주의: 이 게이트는 `/reports` 라우트 자체를 막지 않는다(비사외비 글은 전 역할 공개).
 * 사외비 행의 실제 차단은 DB RLS(`posts_select_public`)가 담당하고,
 * 이 함수는 service_role 조회를 허용할지 결정한다.
 */
export function canAccessConfidentialReports(role: Role): boolean {
  return role === 'admin' || role === 'holdings' || role === 'mobility';
}

/**
 * 역할별 라우트 접근 권한.
 *
 * - admin: 전체 허용
 * - holdings: 회사관리 제외 전체(한세그룹·경영관리 포함)
 * - mobility: 한세그룹·회사관리 제외 전체(경영관리 전체 허용)
 * - hmobility: 한세그룹·회사관리 제외 + 경영관리는 재고·생산·인원만
 * - guest: 한세그룹·경영관리·비교 차단, 그 외 허용
 */
export function canAccess(pathname: string, role: Role): boolean {
  if (role === 'admin') return true;

  // 관리자 전용(회사관리)
  if (ADMIN_ONLY_PATHS.some((p) => matchesPath(pathname, p))) {
    return false;
  }

  // guest 전용 차단: 비교 페이지(경영관리·한세그룹은 아래 공통 분기에서 차단)
  if (role === 'guest' && matchesPath(pathname, '/compare')) {
    return false;
  }

  // 한세그룹 — holdings만 허용
  if (matchesPath(pathname, '/hansae')) {
    return role === 'holdings';
  }

  // 경영관리
  if (matchesPath(pathname, '/management')) {
    if (role === 'guest') return false;
    if (role === 'hmobility') {
      // 랜딩(/management)은 허용 → page.tsx가 접근 가능한 탭으로 redirect
      if (pathname === '/management') return true;
      return HMOBILITY_MANAGEMENT_PATHS.some((p) => matchesPath(pathname, p));
    }
    return true; // mobility, holdings
  }

  // 조직도 이미지 API — 페이지(/management/org-chart)와 동일 게이트.
  // canAccess의 /management 분기는 '/api/...' 접두사를 매칭하지 못하므로 명시적으로 처리.
  if (matchesPath(pathname, '/api/management/org-chart')) {
    return role !== 'guest' && role !== 'hmobility';
  }

  return true;
}

/** 로그인 직후 `/` 진입 시 역할별 기본 랜딩 경로(무한 redirect 방지). */
export function landingPathForRole(role: Role): string {
  // guest는 경영관리에 접근할 수 없으므로 관련회사 표로 보낸다.
  return role === 'guest' ? '/related-stocks' : '/management';
}

/** `/management` 진입 시 역할별 첫 탭(접근 가능한 탭으로 redirect). */
export function firstManagementPath(role: Role): string {
  if (role === 'guest') return '/related-stocks'; // proxy가 막지만 방어적 처리
  if (role === 'hmobility') return '/management/inventory';
  return '/management/pnl';
}

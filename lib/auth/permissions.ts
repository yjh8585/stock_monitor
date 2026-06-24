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

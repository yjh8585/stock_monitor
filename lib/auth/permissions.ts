import type { Role } from './users';

/** admin 전용 페이지 prefix — 비관리자는 proxy.ts에서 `/`로 redirect. */
const ADMIN_ONLY_PATHS = ['/management/companies'];

export function isAdmin(role: Role): boolean {
  return role === 'admin';
}

export function canAccess(pathname: string, role: Role): boolean {
  if (role === 'mobility' && pathname.startsWith('/hansae')) {
    return false;
  }
  if (
    !isAdmin(role) &&
    ADMIN_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return false;
  }
  return true;
}

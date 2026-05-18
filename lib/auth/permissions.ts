import type { Role } from './users';

export function canAccess(pathname: string, role: Role): boolean {
  if (role === 'mobility' && pathname.startsWith('/hansae')) {
    return false;
  }
  return true;
}

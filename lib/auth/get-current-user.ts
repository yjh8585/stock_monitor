import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, decodeSession } from './session';
import { getDisplayNameByRole, type Role } from './users';

export type CurrentUser = {
  id: string;
  role: Role;
  displayName: string;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await decodeSession(token);
  if (!session) return null;
  return {
    id: session.sub,
    role: session.role,
    displayName: getDisplayNameByRole(session.role),
  };
}

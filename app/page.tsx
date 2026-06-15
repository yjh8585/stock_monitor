import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { landingPathForRole } from '@/lib/auth/permissions';

/** 진입 시 역할별 기본 페이지로 이동(guest는 경영관리 접근 불가 → 관련회사). */
export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  redirect(landingPathForRole(user.role));
}

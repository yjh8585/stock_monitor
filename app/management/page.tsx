import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { firstManagementPath } from '@/lib/auth/permissions';

/** /management 진입 시 역할별 첫 탭으로 이동(hmobility는 재고). */
export default async function ManagementPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  redirect(firstManagementPath(user.role));
}

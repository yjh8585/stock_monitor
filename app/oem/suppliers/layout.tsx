import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccess } from '@/lib/auth/permissions';

/** /oem/suppliers 트리 — 구매 전략(사외비)이라 하위 페이지 전에 권한부터 본다(페이지도 한 번 더 막는다). */
export default async function SuppliersLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || !canAccess('/oem/suppliers', user.role)) redirect('/');
  return children;
}

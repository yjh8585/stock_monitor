import { getCurrentUser } from '@/lib/auth/get-current-user';
import AppLayout from './AppLayout';

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return <AppLayout user={user}>{children}</AppLayout>;
}

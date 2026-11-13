import { OemTabs } from '@/components/oem/OemTabs';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccessSuppliers } from '@/lib/auth/permissions';

export default async function OemLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const showSuppliers = !!user && canAccessSuppliers(user.role);
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">OEM</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          전체 시장(MarkLines) + 회사별 IR 차종 판매 · 매월 갱신
        </p>
        <OemTabs showSuppliers={showSuppliers} />
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}

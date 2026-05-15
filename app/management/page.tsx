import { redirect } from 'next/navigation';

/** /management 진입 시 손익 탭으로 자동 이동 */
export default function ManagementPage() {
  redirect('/management/pnl');
}

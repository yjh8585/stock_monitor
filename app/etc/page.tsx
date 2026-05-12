import { redirect } from 'next/navigation';

/** /etc 진입 시 환율 탭으로 자동 이동 */
export default function EtcPage() {
  redirect('/etc/fx');
}

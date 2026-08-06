import { Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

/**
 * 사외비 보고서 표식.
 *
 * 이 배지가 보인다는 것은 열람 권한이 있다는 뜻이다(권한 없는 역할은 목록·상세에서
 * 행 자체가 오지 않는다 — RLS `posts_select_public`). 원문에 찍힌 "외부 공유 금지"를
 * 화면에서도 잊지 않도록 남긴다.
 */
export function PostConfidentialBadge() {
  return (
    <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100" variant="secondary">
      <Lock className="mr-1 h-3 w-3" aria-hidden />
      사외비
    </Badge>
  );
}

import { Badge } from '@/components/ui/badge';
import type { PostStatus } from '@/lib/reports/types';

const STATUS_LABEL: Record<PostStatus, string> = {
  processing: '처리중',
  completed: '완료',
  failed: '실패',
};

const STATUS_VARIANT: Record<PostStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  processing: 'secondary',
  completed: 'default',
  failed: 'destructive',
};

export function PostStatusBadge({ status }: { status: PostStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

import { Badge } from '@/components/ui/badge';
import type { PostSourceType } from '@/lib/reports/types';

export function PostSourceBadge({ sourceType }: { sourceType: PostSourceType }) {
  if (sourceType === 'youtube') {
    return (
      <Badge className="bg-red-100 text-red-700 hover:bg-red-100" variant="secondary">
        유튜브
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100" variant="secondary">
      보고서
    </Badge>
  );
}

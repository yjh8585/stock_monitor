'use client';

import PageError from '@/components/common/PageError';

export default function OemError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError {...props} title="OEM 판매량 데이터를 불러오지 못했습니다" />;
}

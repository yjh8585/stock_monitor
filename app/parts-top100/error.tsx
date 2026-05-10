'use client';

import PageError from '@/components/common/PageError';

export default function PartsTop100Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError {...props} title="부품사 Top100 데이터를 불러오지 못했습니다" />;
}

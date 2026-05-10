'use client';

import PageError from '@/components/common/PageError';

export default function RelatedStocksError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError {...props} title="관련회사 데이터를 불러오지 못했습니다" />;
}

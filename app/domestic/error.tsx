'use client';

import PageError from '@/components/common/PageError';

export default function DomesticError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError {...props} title="국내자동차 데이터를 불러오지 못했습니다" />;
}

'use client';

import PageError from '@/components/common/PageError';

export default function HumanoidError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PageError {...props} title="휴머노이드 데이터를 불러오지 못했습니다" />;
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import type { PostStatus } from '@/lib/reports/types';

const POLL_INTERVAL_MS = 3000;

interface Props {
  postId: number;
  initialStatus: PostStatus;
}

/**
 * 처리중 상태일 때만 폴링하면서 상태가 바뀌면 페이지를 갱신한다.
 */
export function PostStatusWatcher({ postId, initialStatus }: Props) {
  const router = useRouter();
  const stopped = useRef(false);

  useEffect(() => {
    if (initialStatus !== 'processing') return;
    stopped.current = false;

    const interval = setInterval(async () => {
      if (stopped.current) return;
      try {
        const res = await fetch(`/api/posts/${postId}/status`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.success) return;
        const status: PostStatus = json.data.status;
        if (status !== 'processing') {
          stopped.current = true;
          router.refresh();
        }
      } catch {
        // 네트워크 오류는 무시 — 다음 주기에 재시도
      }
    }, POLL_INTERVAL_MS);

    return () => {
      stopped.current = true;
      clearInterval(interval);
    };
  }, [postId, initialStatus, router]);

  return null;
}

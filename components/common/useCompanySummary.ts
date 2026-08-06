'use client';

import { useEffect, useState } from 'react';

/**
 * 회사 설명(business_summary)을 행 펼침 시점에만 가져온다.
 *
 * 이 값은 펼침 행에서만 쓰는데 표 payload 에 전부 실으면 주식 뷰 3개 합 283KB 가 되고,
 * ISR write 는 payload 크기 기준 과금이라 재기록마다 비용이 된다 → payload 에서 빼고
 * 펼칠 때만 `/api/companies/[id]/summary` 로 받는다. docs/isr-write-optimization.md
 *
 * 한 번 받으면 접었다 펴도 재요청하지 않는다(행 컴포넌트가 마운트된 채 상태를 유지).
 * 실패해도 loaded 를 세워 재시도 폭주를 막는다 — 설명만 비고 표의 나머지는 정상이다.
 */
export function useCompanySummary(companyId: string, enabled: boolean) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;

    fetch(`/api/companies/${companyId}/summary`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { business_summary?: string | null } | null) => {
        if (cancelled) return;
        setSummary(data?.business_summary ?? null);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId, enabled, loaded]);

  return { summary, loaded };
}

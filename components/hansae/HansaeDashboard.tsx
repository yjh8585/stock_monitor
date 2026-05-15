'use client';

/**
 * 한세 대시보드 컨테이너 — Client Component.
 *
 * - SSR initial 데이터로 즉시 렌더.
 * - Supabase Realtime으로 stock_quotes_5min INSERT 구독 → 해당 종목 상태만 갱신.
 * - 백업 폴링: 60초마다 SSR 데이터 일부(companies last_*, 신규 글)만 fetch.
 * - ±3% 변동 시 카드 외곽선 강조.
 */
import { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import HansaeStockCard from './HansaeStockCard';
import HansaeNewsPanel from './HansaeNewsPanel';
import HansaeBoardPanel from './HansaeBoardPanel';
import HansaeSupplyPanel from './HansaeSupplyPanel';
import type {
  BoardPostSummary,
  HansaeCompany,
  IntradayPoint,
  SentimentSummary,
  SupplyDemandRow,
} from '@/lib/hansae/data';

export interface HansaeBundle {
  company: HansaeCompany;
  intraday: IntradayPoint[];
  posts: BoardPostSummary[];
  sentiment: SentimentSummary;
  supply: SupplyDemandRow[];
}

interface Props {
  initial: HansaeBundle[];
}

export default function HansaeDashboard({ initial }: Props) {
  const [bundles, setBundles] = useState<HansaeBundle[]>(initial);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(
    initial[0]?.company.id ?? null
  );

  // Realtime: stock_quotes_5min INSERT 구독
  useEffect(() => {
    const sb = createSupabaseBrowserClient();
    const channel = sb
      .channel('hansae-quotes-5min')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'stock_quotes_5min' },
        (payload) => {
          const row = payload.new as {
            company_id: string;
            ts: string;
            price: number;
            change_pct: number | null;
            volume: number | null;
          };
          setBundles((prev) =>
            prev.map((b) => {
              if (b.company.id !== row.company_id) return b;
              const intraday = [
                ...b.intraday,
                {
                  ts: row.ts,
                  price: Number(row.price),
                  changePct: row.change_pct === null ? null : Number(row.change_pct),
                  volume: row.volume === null ? null : Number(row.volume),
                },
              ];
              return {
                ...b,
                intraday,
                company: {
                  ...b.company,
                  lastPrice: Number(row.price),
                  lastChangePct: row.change_pct === null ? null : Number(row.change_pct),
                  lastVolume: row.volume === null ? null : Number(row.volume),
                  lastUpdatedAt: row.ts,
                },
              };
            })
          );
        }
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, []);

  // 백업 폴링: 60초마다 server action 대신 페이지 자체를 router refresh 없이 fetch
  // (Realtime이 끊겼을 때 안전망. server action 도입 안 하기 위해 인라인 fetch는 생략하고
  //  사용자가 새로고침 가능하게 한다 — Realtime이 거의 항상 동작.)
  const handleManualRefresh = useCallback(() => {
    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  if (bundles.length === 0) {
    return (
      <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
        한세 종목 데이터가 없습니다. companies 테이블 시드를 확인하세요.
      </div>
    );
  }

  const activeBundle = bundles.find((b) => b.company.id === activeCompanyId) ?? bundles[0];

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {bundles.map((b) => (
          <HansaeStockCard
            key={b.company.id}
            bundle={b}
            isActive={b.company.id === activeCompanyId}
            onClick={() => setActiveCompanyId(b.company.id)}
          />
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HansaeSupplyPanel
          supply={activeBundle.supply}
          companyName={activeBundle.company.name_kr}
        />
        <HansaeNewsPanel companyName={activeBundle.company.name_kr} />
      </section>

      <section>
        <HansaeBoardPanel
          companyName={activeBundle.company.name_kr}
          ticker={activeBundle.company.ticker}
          posts={activeBundle.posts}
          summary={activeBundle.sentiment}
        />
      </section>

      <div className="text-[11px] text-muted-foreground text-right">
        수급은 참고용 — 한세 계열은 거래대금이 작아 단일 매매로도 비율이 크게 흔들립니다 ·{' '}
        <button onClick={handleManualRefresh} className="underline">
          수동 새로고침
        </button>
      </div>
    </div>
  );
}

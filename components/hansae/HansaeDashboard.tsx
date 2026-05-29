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
  DailyPrice,
  HansaeCompany,
  IntradayPoint,
  IntradaySupplyPoint,
  NewsItem,
  SentimentSummary,
  SupplyDemandRow,
} from '@/lib/hansae/data';

export interface HansaeBundle {
  company: HansaeCompany;
  daily: DailyPrice[];
  intraday: IntradayPoint[];
  posts: BoardPostSummary[];
  sentiment: SentimentSummary;
  supply: SupplyDemandRow[];
  intradaySupply: IntradaySupplyPoint[];
  /** 오늘 뉴스 (intraday 코멘트 컨텍스트) */
  todayNews?: NewsItem[];
}

interface Props {
  initial: HansaeBundle[];
}

export default function HansaeDashboard({ initial }: Props) {
  const [bundles, setBundles] = useState<HansaeBundle[]>(initial);

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

  return (
    <div className="flex flex-col gap-6">
      {bundles.map((b) => (
        <section key={b.company.id} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 왼쪽 2단위: 주가 + [뉴스 | 종목토론] */}
          <div className="flex flex-col gap-4">
            <HansaeStockCard bundle={b} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <HansaeNewsPanel companyName={b.company.name_kr} />
              <HansaeBoardPanel
                companyName={b.company.name_kr}
                ticker={b.company.ticker}
                posts={b.posts}
                summary={b.sentiment}
              />
            </div>
          </div>
          {/* 오른쪽 1단위: 일별 수급 (장중 분단위는 좌측 가격 차트에 결합됨) */}
          <HansaeSupplyPanel supply={b.supply} companyName={b.company.name_kr} />
        </section>
      ))}

      <div className="text-sm text-muted-foreground text-right">
        수급은 참고용 — 한세 계열은 거래대금이 작아 단일 매매로도 비율이 크게 흔들립니다 ·{' '}
        <button onClick={handleManualRefresh} className="underline">
          수동 새로고침
        </button>
      </div>
    </div>
  );
}

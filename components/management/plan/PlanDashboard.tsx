'use client';

import dynamic from 'next/dynamic';
import LazyMount from '@/components/common/LazyMount';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { PlanRow } from '@/lib/plan/types';
import type { LongtermRow } from '@/lib/plan/longterm';

// 차트 컴포넌트 — recharts 청크를 차트 단위로 lazy 분리.
// 각 차트는 LazyMount 안에 들어가 viewport 진입 시 청크 download + mount.
const LongtermRevenueChart = dynamic(() => import('./LongtermRevenueChart'), { ssr: false });
const OrderTargetChart = dynamic(() => import('./OrderTargetChart'), { ssr: false });
const OrderFunnelChart = dynamic(() => import('./OrderFunnelChart'), { ssr: false });
const RevenueTargetChart = dynamic(() => import('./RevenueTargetChart'), { ssr: false });
const OpIncomeTargetChart = dynamic(() => import('./OpIncomeTargetChart'), { ssr: false });
const UsTargetChart = dynamic(() => import('./UsTargetChart'), { ssr: false });
const SangsukTargetChart = dynamic(() => import('./SangsukTargetChart'), { ssr: false });
const JilinTargetChart = dynamic(() => import('./JilinTargetChart'), { ssr: false });
const ImprovementTargetChart = dynamic(() => import('./ImprovementTargetChart'), { ssr: false });
const FactoryTargetChart = dynamic(() => import('./FactoryTargetChart'), { ssr: false });

interface Props {
  rows: PlanRow[];
  /** 전사 매출/영업이익 실적용 (차트 3·4) */
  prepared: PreparedPnlData;
  /** 현재 USD→KRW (원/USD). 없으면 null */
  usdKrw: number | null;
  /** 중장기 매출 전망 (차트 1) */
  longterm: LongtermRow[];
}

/**
 * 계획 페이지 클라이언트 루트.
 *
 * - 서버에서 getPlanData()로 사전 가공된 데이터를 받아 10개 차트에 전달.
 * - 모든 차트는 LazyMount + dynamic import로 viewport 진입 시 청크 fetch.
 */
export default function PlanDashboard({ rows, prepared, usdKrw, longterm }: Props) {
  return (
    <div className="max-w-[1600px] mx-auto px-6 py-4 space-y-6">
      <LazyMount className="min-h-[480px] md:min-h-[560px]">
        <LongtermRevenueChart rows={longterm} />
      </LazyMount>
      <LazyMount className="min-h-[480px] md:min-h-[560px]">
        <OrderTargetChart rows={rows} />
      </LazyMount>
      <LazyMount className="min-h-[480px] md:min-h-[560px]">
        <OrderFunnelChart rows={rows} />
      </LazyMount>
      <LazyMount className="min-h-[480px] md:min-h-[560px]">
        <RevenueTargetChart rows={rows} prepared={prepared} />
      </LazyMount>
      <LazyMount className="min-h-[480px] md:min-h-[560px]">
        <OpIncomeTargetChart rows={rows} prepared={prepared} />
      </LazyMount>
      <LazyMount className="min-h-[480px] md:min-h-[560px]">
        <UsTargetChart rows={rows} usdKrw={usdKrw} />
      </LazyMount>
      <LazyMount className="min-h-[480px] md:min-h-[560px]">
        <SangsukTargetChart rows={rows} />
      </LazyMount>
      <LazyMount className="min-h-[480px] md:min-h-[560px]">
        <JilinTargetChart rows={rows} />
      </LazyMount>
      <LazyMount className="min-h-[480px] md:min-h-[560px]">
        <ImprovementTargetChart rows={rows} />
      </LazyMount>
      <LazyMount className="min-h-[480px] md:min-h-[560px]">
        <FactoryTargetChart rows={rows} />
      </LazyMount>
    </div>
  );
}

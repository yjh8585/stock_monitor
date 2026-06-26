'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { attachMargin, buildAchievement } from '@/lib/plan/aggregate';
import type { AchievementPoint, PlanRow } from '@/lib/plan/types';

type Item = '매출' | '영업이익';
type Cur = 'usd' | 'krw';

export default function UsTargetChart({
  rows,
  usdKrw,
}: {
  rows: PlanRow[];
  usdKrw: number | null;
}) {
  const [item, setItem] = useState<Item>('매출');
  const [cur, setCur] = useState<Cur>('usd');
  const points = useMemo<AchievementPoint[]>(() => {
    // pnl_plan 단위 'USD 백만'. USD 모드는 그대로. KRW 모드는 억원 환산:
    //   USD백만 × usdKrw(원/USD) = 백만원 ... ÷100 = 억원. → 곱 factor = usdKrw/100.
    const raw = buildAchievement(pick(rows, '미국', item, 'consolidated'), { unit: 'USD 백만' });
    // 영업이익 모드는 매출(USD 백만)로 영업이익률 부여. 마진은 통화 환산 불변.
    const base =
      item === '영업이익'
        ? attachMargin(
            raw,
            buildAchievement(pick(rows, '미국', '매출', 'consolidated'), { unit: 'USD 백만' })
          )
        : raw;
    if (cur === 'usd' || !usdKrw) return base;
    const f = usdKrw / 100;
    return base.map((p) => ({
      ...p,
      plan: p.plan == null ? null : Math.round(p.plan * f * 10000) / 10000,
      actual: p.actual == null ? null : Math.round(p.actual * f * 10000) / 10000,
      // rate·영업이익률은 비율이라 환산 불변 (...p로 통과)
    }));
  }, [rows, item, cur, usdKrw]);
  const unitLabel = cur === 'usd' ? 'USD 백만' : '억원';
  return (
    <ChartSection
      title="5. 미국법인 목표 달성"
      unit={unitLabel}
      controls={
        <>
          <ToggleGroup
            options={[
              { value: '매출', label: '매출' },
              { value: '영업이익', label: '영업이익' },
            ]}
            value={item}
            onChange={setItem}
          />
          <ToggleGroup
            options={[
              { value: 'usd', label: 'USD' },
              { value: 'krw', label: '원화' },
            ]}
            value={cur}
            onChange={setCur}
          />
        </>
      }
    >
      <PlanAchievementChart
        points={points}
        unitLabel={unitLabel}
        amountDigits={item === '영업이익' ? 1 : 0}
      />
    </ChartSection>
  );
}

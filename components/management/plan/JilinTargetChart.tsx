'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { attachMargin, buildAchievement } from '@/lib/plan/aggregate';
import type { PlanRow } from '@/lib/plan/types';

type Item = '매출' | '영업이익';

export default function JilinTargetChart({ rows }: { rows: PlanRow[] }) {
  const [item, setItem] = useState<Item>('매출');
  const points = useMemo(() => {
    const base = buildAchievement(pick(rows, '지린', item, 'consolidated'), { unit: '억원' });
    if (item !== '영업이익') return base;
    const rev = buildAchievement(pick(rows, '지린', '매출', 'consolidated'), { unit: '억원' });
    return attachMargin(base, rev);
  }, [rows, item]);
  return (
    <ChartSection
      title="7. 지린법인 목표 달성"
      unit="억원"
      controls={
        <ToggleGroup
          options={[
            { value: '매출', label: '매출' },
            { value: '영업이익', label: '영업이익' },
          ]}
          value={item}
          onChange={setItem}
        />
      }
    >
      <PlanAchievementChart
        points={points}
        unitLabel="억원"
        amountDigits={item === '영업이익' ? 1 : 0}
      />
    </ChartSection>
  );
}

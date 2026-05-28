'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement } from '@/lib/plan/aggregate';
import type { PlanRow } from '@/lib/plan/types';

type Item = '매출' | '영업이익';

export default function SangsukTargetChart({ rows }: { rows: PlanRow[] }) {
  const [item, setItem] = useState<Item>('매출');
  const points = useMemo(
    () => buildAchievement(pick(rows, '상숙', item, 'consolidated'), { unit: '억원' }),
    [rows, item]
  );
  return (
    <ChartSection
      title="6. 상숙법인 목표 달성 · 단위 억원"
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

'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement } from '@/lib/plan/aggregate';
import type { PlanRow } from '@/lib/plan/types';

type Item = 'Design VE' | 'MCIP' | '단가인상';

export default function ImprovementTargetChart({ rows }: { rows: PlanRow[] }) {
  const [item, setItem] = useState<Item>('Design VE');
  const points = useMemo(
    () => buildAchievement(pick(rows, '손익개선', item, 'consolidated'), { unit: '백만원' }),
    [rows, item]
  );
  return (
    <ChartSection
      title="8. 손익개선 목표 달성 · 단위 백만원"
      controls={
        <ToggleGroup
          options={[
            { value: 'Design VE', label: 'Design VE' },
            { value: 'MCIP', label: 'MCIP' },
            { value: '단가인상', label: '단가인상' },
          ]}
          value={item}
          onChange={setItem}
        />
      }
    >
      <PlanAchievementChart points={points} unitLabel="백만원" />
    </ChartSection>
  );
}

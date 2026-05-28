'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement } from '@/lib/plan/aggregate';
import type { PlanRow } from '@/lib/plan/types';

type Div = '구동' | '제동' | '조향' | '전장';

export default function FactoryTargetChart({ rows }: { rows: PlanRow[] }) {
  const [div, setDiv] = useState<Div>('구동');
  const points = useMemo(
    () => buildAchievement(pick(rows, '공장', `${div} 매출`, 'standalone'), { unit: '억원' }),
    [rows, div]
  );
  return (
    <ChartSection
      title="9. 공장 매출 목표 달성"
      unit="억원"
      controls={
        <ToggleGroup
          options={[
            { value: '구동', label: '구동' },
            { value: '제동', label: '제동' },
            { value: '조향', label: '조향' },
            { value: '전장', label: '전장' },
          ]}
          value={div}
          onChange={setDiv}
        />
      }
    >
      <PlanAchievementChart points={points} unitLabel="억원" />
    </ChartSection>
  );
}

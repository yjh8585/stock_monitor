'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup } from './_selectors';
import { buildCorpAchievement } from './RevenueTargetChart';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { Basis } from '@/lib/pnl/types';
import type { PlanRow } from '@/lib/plan/types';

export default function OpIncomeTargetChart({
  rows,
  prepared,
}: {
  rows: PlanRow[];
  prepared: PreparedPnlData;
}) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const points = useMemo(
    () => buildCorpAchievement(rows, prepared, basis, '영업이익', 'op_income'),
    [rows, prepared, basis]
  );
  return (
    <ChartSection
      title="4. 전사 영업이익 목표 달성 · 단위 억원"
      controls={
        <ToggleGroup
          options={[
            { value: 'consolidated', label: '연결' },
            { value: 'standalone', label: '별도' },
          ]}
          value={basis}
          onChange={setBasis}
        />
      }
    >
      <PlanAchievementChart points={points} unitLabel="억원" />
    </ChartSection>
  );
}

'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup } from './_selectors';
import { buildCorpAchievement } from '@/lib/plan/aggregate';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { Basis } from '@/lib/pnl/types';
import type { PlanRow } from '@/lib/plan/types';

export default function RevenueTargetChart({
  rows,
  prepared,
}: {
  rows: PlanRow[];
  prepared: PreparedPnlData;
}) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const points = useMemo(
    () => buildCorpAchievement(rows, prepared, basis, '매출', 'revenue'),
    [rows, prepared, basis]
  );
  return (
    <ChartSection
      title="3. 전사 매출목표 달성"
      unit="억원"
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

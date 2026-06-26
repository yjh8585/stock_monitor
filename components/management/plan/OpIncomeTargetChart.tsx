'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup } from './_selectors';
import { attachMargin, buildCorpAchievement } from '@/lib/plan/aggregate';
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
  const points = useMemo(() => {
    const op = buildCorpAchievement(rows, prepared, basis, '영업이익', 'op_income');
    const rev = buildCorpAchievement(rows, prepared, basis, '매출', 'revenue');
    return attachMargin(op, rev);
  }, [rows, prepared, basis]);
  return (
    <ChartSection
      title="4. 전사 영업이익 목표 달성"
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

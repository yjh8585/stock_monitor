'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement, fillCancelExcluded } from '@/lib/plan/aggregate';
import type { PlanRow } from '@/lib/plan/types';

type Mode = 'gross' | 'net';

export default function OrderTargetChart({ rows }: { rows: PlanRow[] }) {
  const [mode, setMode] = useState<Mode>('gross');
  const points = useMemo(() => {
    const gross = buildAchievement(pick(rows, '수주', '수주액', 'consolidated'), { unit: '억원' });
    if (mode === 'gross') return gross;
    const cancel = buildAchievement(
      pick(rows, '수주', '수주액(취소 제외)', 'consolidated'),
      { unit: '억원' }
    );
    return fillCancelExcluded(gross, cancel);
  }, [rows, mode]);
  return (
    <ChartSection
      title="1. 전사 수주목표 달성"
      controls={
        <ToggleGroup
          options={[
            { value: 'gross', label: '수주액' },
            { value: 'net', label: '수주액(취소 제외)' },
          ]}
          value={mode}
          onChange={setMode}
        />
      }
    >
      <PlanAchievementChart points={points} unitLabel="억원" />
    </ChartSection>
  );
}

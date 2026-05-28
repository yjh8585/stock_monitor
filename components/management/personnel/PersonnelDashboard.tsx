'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import LazyMount from '@/components/common/LazyMount';
import { ChartSection, ToggleGroup } from '@/components/management/plan/_selectors';
import {
  buildDomesticPoints,
  buildFieldMixPoints,
  buildMixPoints,
  buildOverallPoints,
  buildOverseasPoints,
  buildTableData,
} from '@/lib/personnel/aggregate';
import type { KindMode, MixOption, OverseasRegion, PersonnelRow } from '@/lib/personnel/types';

const PersonnelOverallChart = dynamic(() => import('./PersonnelOverallChart'), { ssr: false });
const PersonnelDomesticChart = dynamic(() => import('./PersonnelDomesticChart'), { ssr: false });
const PersonnelOverseasChart = dynamic(() => import('./PersonnelOverseasChart'), { ssr: false });
const PersonnelMixChart = dynamic(() => import('./PersonnelMixChart'), { ssr: false });
const PersonnelFieldMixChart = dynamic(() => import('./PersonnelFieldMixChart'), { ssr: false });
const PersonnelTable = dynamic(() => import('./PersonnelTable'), { ssr: false });

interface Props {
  rows: PersonnelRow[];
}

const KIND_OPTIONS: { value: KindMode; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'office', label: '사무' },
  { value: 'production', label: '생산' },
];

const OVERSEAS_OPTIONS: { value: OverseasRegion; label: string }[] = [
  { value: 'us', label: '미국' },
  { value: 'cn', label: '중국' },
  { value: 'uz', label: '우즈벡' },
  { value: 'intel', label: '이인텔리전스' },
];

const MIX_OPTIONS: { value: MixOption; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'domestic-outsource', label: '국내+외주' },
  { value: 'domestic', label: '국내' },
  { value: 'us', label: '미국' },
  { value: 'cn', label: '중국' },
  { value: 'uz', label: '우즈벡' },
];

export default function PersonnelDashboard({ rows }: Props) {
  const [overallMode, setOverallMode] = useState<KindMode>('all');
  const [domesticMode, setDomesticMode] = useState<KindMode>('all');
  const [overseasReg, setOverseasReg] = useState<OverseasRegion>('us');
  const [mixOption, setMixOption] = useState<MixOption>('all');

  const overallPts = useMemo(() => buildOverallPoints(rows, overallMode), [rows, overallMode]);
  const domesticPts = useMemo(() => buildDomesticPoints(rows, domesticMode), [rows, domesticMode]);
  const overseasPts = useMemo(() => buildOverseasPoints(rows, overseasReg), [rows, overseasReg]);
  const mixPts = useMemo(() => buildMixPoints(rows, mixOption), [rows, mixOption]);
  const fieldMixPts = useMemo(() => buildFieldMixPoints(rows), [rows]);
  const tableData = useMemo(() => buildTableData(rows), [rows]);

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-4 space-y-4">
      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="1. 전체 인원 현황"
          unit="명"
          controls={
            <ToggleGroup options={KIND_OPTIONS} value={overallMode} onChange={setOverallMode} />
          }
        >
          <PersonnelOverallChart points={overallPts} />
        </ChartSection>
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="2. 국내 인원 현황"
          unit="명"
          controls={
            <ToggleGroup options={KIND_OPTIONS} value={domesticMode} onChange={setDomesticMode} />
          }
        >
          <PersonnelDomesticChart points={domesticPts} />
        </ChartSection>
      </LazyMount>

      <LazyMount className="min-h-[400px] md:min-h-[480px]">
        <ChartSection
          title="3. 해외 및 자회사 인원 현황"
          unit="명"
          controls={
            <ToggleGroup options={OVERSEAS_OPTIONS} value={overseasReg} onChange={setOverseasReg} />
          }
        >
          <PersonnelOverseasChart points={overseasPts} />
        </ChartSection>
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="4. 사무 / 생산 구분"
          unit="명"
          controls={
            <select
              value={mixOption}
              onChange={(e) => setMixOption(e.target.value as MixOption)}
              className="rounded-md border border-border bg-background px-2.5 py-1 text-sm"
            >
              {MIX_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          }
        >
          <PersonnelMixChart points={mixPts} />
        </ChartSection>
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection title="5. 현장 / 관리 구분" unit="명 · 국내 인원 기준">
          <PersonnelFieldMixChart points={fieldMixPts} />
        </ChartSection>
      </LazyMount>

      <LazyMount className="min-h-[600px]">
        <ChartSection title="6. 인원 수" unit="명">
          <PersonnelTable data={tableData} />
        </ChartSection>
      </LazyMount>
    </div>
  );
}

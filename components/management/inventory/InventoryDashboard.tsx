'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import LazyMount from '@/components/common/LazyMount';
import { ChartSection, ToggleGroup } from '@/components/management/plan/_selectors';
import InventoryKpiCards from './InventoryKpiCards';
import {
  buildAchievementPoints,
  buildCountryStatusPoints,
  buildDomesticAchievementPoints,
  buildKpis,
  buildOverseasAchievementPoints,
  buildStatusPoints,
  buildTransportPoints,
} from '@/lib/inventory/aggregate';
import type {
  AchievementCategory,
  DomesticItem,
  InventoryRow,
  OverseasItem,
  TransportItem,
} from '@/lib/inventory/types';

const InventoryStatusChart = dynamic(() => import('./InventoryStatusChart'), { ssr: false });
const InventoryCountryStatusChart = dynamic(() => import('./InventoryCountryStatusChart'), {
  ssr: false,
});
const InventoryAchievementChart = dynamic(() => import('./InventoryAchievementChart'), {
  ssr: false,
});

interface Props {
  rows: InventoryRow[];
}

const ACH_OPTIONS: { value: AchievementCategory; label: string }[] = [
  { value: 'total', label: '전체' },
  { value: 'operating', label: '운영' },
  { value: 'management', label: '관리' },
  { value: 'compensation', label: '보상' },
  { value: 'transport', label: '운송' },
];

const DOMESTIC_OPTIONS: { value: DomesticItem; label: string }[] = [
  { value: 'drive', label: '구동' },
  { value: 'brake', label: '제동조향' },
  { value: 'electronics', label: '전장' },
];

const OVERSEAS_OPTIONS: { value: OverseasItem; label: string }[] = [
  { value: 'us', label: '미국' },
  { value: 'uz', label: '우즈벡' },
];

const TRANSPORT_OPTIONS: { value: TransportItem; label: string }[] = [
  { value: 'us', label: '미국' },
  { value: 'uz', label: '우즈벡' },
  { value: 'sales', label: '영업재고' },
];

export default function InventoryDashboard({ rows }: Props) {
  const [achCat, setAchCat] = useState<AchievementCategory>('total');
  const [domItem, setDomItem] = useState<DomesticItem>('drive');
  const [ovsItem, setOvsItem] = useState<OverseasItem>('us');
  const [tranItem, setTranItem] = useState<TransportItem>('us');

  const kpis = useMemo(() => buildKpis(rows), [rows]);
  const statusPts = useMemo(() => buildStatusPoints(rows), [rows]);
  const countryPts = useMemo(() => buildCountryStatusPoints(rows), [rows]);
  const achPts = useMemo(() => buildAchievementPoints(rows, achCat), [rows, achCat]);
  const domPts = useMemo(() => buildDomesticAchievementPoints(rows, domItem), [rows, domItem]);
  const ovsPts = useMemo(() => buildOverseasAchievementPoints(rows, ovsItem), [rows, ovsItem]);
  const tranPts = useMemo(() => buildTransportPoints(rows, tranItem), [rows, tranItem]);

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-4 space-y-4">
      <InventoryKpiCards kpis={kpis} />

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <InventoryStatusChart points={statusPts} />
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <InventoryCountryStatusChart points={countryPts} />
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="3. 계획 대비 실적 (전사)"
          unit="억원"
          controls={<ToggleGroup options={ACH_OPTIONS} value={achCat} onChange={setAchCat} />}
        >
          <InventoryAchievementChart points={achPts} unitLabel="억원" />
        </ChartSection>
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="4. 계획 대비 실적 (국내)"
          unit="억원"
          controls={
            <ToggleGroup options={DOMESTIC_OPTIONS} value={domItem} onChange={setDomItem} />
          }
        >
          <InventoryAchievementChart points={domPts} unitLabel="억원" />
        </ChartSection>
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="5. 계획 대비 실적 (해외)"
          unit="억원"
          controls={
            <ToggleGroup options={OVERSEAS_OPTIONS} value={ovsItem} onChange={setOvsItem} />
          }
        >
          <InventoryAchievementChart points={ovsPts} unitLabel="억원" />
        </ChartSection>
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="6. 계획 대비 실적 (운송)"
          unit="억원"
          controls={
            <ToggleGroup options={TRANSPORT_OPTIONS} value={tranItem} onChange={setTranItem} />
          }
        >
          <InventoryAchievementChart points={tranPts} unitLabel="억원" />
        </ChartSection>
      </LazyMount>
    </div>
  );
}

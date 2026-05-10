'use client';

import { useMemo } from 'react';
import type { OemSalesGroupCountryMonth } from '@/lib/types';
import { fmtUnits } from './helpers';

interface Props {
  groupCountryMonth: OemSalesGroupCountryMonth[];
}

const TOP_OEMS = 10;
const TOP_COUNTRIES = 10;
const YEAR_START = 202501;
const YEAR_END = 202512;

/** TOP10 OEM × TOP10 국가 매트릭스 — 색조 그라데이션 (행 기준 normalize) */
export default function OemCountryHeatmap({ groupCountryMonth }: Props) {
  const { oems, countries, matrix, rowMaxes } = useMemo(() => {
    const oemTotal = new Map<string, number>();
    const countryTotal = new Map<string, number>();

    for (const r of groupCountryMonth) {
      if (r.year_month < YEAR_START || r.year_month > YEAR_END) continue;
      oemTotal.set(r.oem_group, (oemTotal.get(r.oem_group) ?? 0) + r.sales);
      countryTotal.set(r.country, (countryTotal.get(r.country) ?? 0) + r.sales);
    }

    const topOems = [...oemTotal.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_OEMS)
      .map(([n]) => n);
    const topCountries = [...countryTotal.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_COUNTRIES)
      .map(([n]) => n);

    const oemSet = new Set(topOems);
    const countrySet = new Set(topCountries);
    const cell = new Map<string, number>(); // `${oem}|${country}` → sales
    for (const r of groupCountryMonth) {
      if (r.year_month < YEAR_START || r.year_month > YEAR_END) continue;
      if (!oemSet.has(r.oem_group) || !countrySet.has(r.country)) continue;
      const k = `${r.oem_group}|${r.country}`;
      cell.set(k, (cell.get(k) ?? 0) + r.sales);
    }

    const mat: number[][] = topOems.map((oem) =>
      topCountries.map((c) => cell.get(`${oem}|${c}`) ?? 0)
    );
    // 행별 최대값 (셀 색조 normalize 용)
    const maxes = mat.map((row) => Math.max(...row));
    return { oems: topOems, countries: topCountries, matrix: mat, rowMaxes: maxes };
  }, [groupCountryMonth]);

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 bg-card p-2 text-left border-b border-border min-w-[200px]">
              OEM \ 국가
            </th>
            {countries.map((c) => (
              <th
                key={c}
                className="p-2 text-center border-b border-border font-medium min-w-[80px] text-muted-foreground"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {oems.map((oem, i) => (
            <tr key={oem}>
              <td className="sticky left-0 bg-card p-2 border-b border-border/50 font-medium">
                {oem}
              </td>
              {countries.map((c, j) => {
                const v = matrix[i][j];
                const max = rowMaxes[i] || 1;
                const intensity = max > 0 ? v / max : 0;
                return <HeatCell key={c} value={v} intensity={intensity} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span>약함</span>
        <div className="flex">
          {[0.05, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
            <div
              key={v}
              className="w-6 h-3"
              style={{ backgroundColor: `rgba(37, 99, 235, ${v})` }}
            />
          ))}
        </div>
        <span>강함</span>
        <span className="ml-2">(행 기준 normalize · 각 OEM의 주력 시장 강조)</span>
      </div>
    </div>
  );
}

function HeatCell({ value, intensity }: { value: number; intensity: number }) {
  const bg = `rgba(37, 99, 235, ${Math.max(0.05, intensity * 0.85)})`;
  const textColor = intensity > 0.5 ? 'text-white' : 'text-foreground';
  return (
    <td
      className={`p-2 text-center border-b border-border/50 tabular-nums ${textColor}`}
      style={{ backgroundColor: bg }}
      title={`${value.toLocaleString('ko-KR')} 대`}
    >
      {value > 0 ? fmtUnits(value) : '—'}
    </td>
  );
}

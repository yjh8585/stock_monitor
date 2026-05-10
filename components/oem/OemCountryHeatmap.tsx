'use client';

import { useMemo } from 'react';
import { fmtUnits } from './helpers';

export interface OemCountryMatrix {
  oems: string[];
  countries: string[];
  matrix: number[][];
}

interface Props {
  data: OemCountryMatrix;
}

/** TOP10 OEM × TOP10 국가 매트릭스 — 색조 그라데이션 (행 기준 normalize) */
export default function OemCountryHeatmap({ data }: Props) {
  const { oems, countries, matrix } = data;
  const rowMaxes = useMemo(() => matrix.map((row) => Math.max(...row, 0)), [matrix]);

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-separate border-spacing-0">
        <caption className="sr-only">TOP10 OEM별 TOP10 국가 판매량 매트릭스 (2025년)</caption>
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
                return <HeatCell key={c} oem={oem} country={c} value={v} intensity={intensity} />;
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

function HeatCell({
  oem,
  country,
  value,
  intensity,
}: {
  oem: string;
  country: string;
  value: number;
  intensity: number;
}) {
  const bg = `rgba(37, 99, 235, ${Math.max(0.05, intensity * 0.85)})`;
  const textColor = intensity > 0.5 ? 'text-white' : 'text-foreground';
  return (
    <td
      role="cell"
      aria-label={`${oem} ${country}: ${value.toLocaleString('ko-KR')} 대`}
      className={`p-2 text-center border-b border-border/50 tabular-nums ${textColor}`}
      style={{ backgroundColor: bg }}
      title={`${value.toLocaleString('ko-KR')} 대`}
    >
      {value > 0 ? fmtUnits(value) : '—'}
    </td>
  );
}

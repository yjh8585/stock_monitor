// 서버 컴포넌트 — 차트는 기존 CompanyTimeSeriesChart(클라이언트)에 두 번째 계열만 넘긴다.
import CompanyKpiCards from '@/components/oem-companies/common/CompanyKpiCards';
import CompanyTimeSeriesChart from '@/components/oem-companies/common/CompanyTimeSeriesChart';
import type { VolumeSeries } from '@/lib/customers/ir';
import type { CustomerDetail } from '@/lib/customers/source';
import { volumeSeriesLabel } from '@/lib/customers/format';

/** MarkLines 판매와 견줄 회사 계열 — 전체(total) 중 판매 성격이 가까운 지표부터. */
const CHART_METRIC_ORDER = ['sales', 'wholesale', 'deliveries', 'shipments', 'production'];
const QUARTER_COLUMNS = 6;

interface Props {
  volume: CustomerDetail['volume'];
  series: VolumeSeries[];
}

function chartSeries(series: VolumeSeries[]): VolumeSeries | null {
  const total = series.filter(
    (s) => s.region === 'total' && (s.monthly.length > 0 || s.annual.length > 0)
  );
  const rank = (s: VolumeSeries) => {
    const i = CHART_METRIC_ORDER.indexOf(s.metric);
    return i === -1 ? CHART_METRIC_ORDER.length : i;
  };
  return [...total].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** 물량 비교 — MarkLines 그룹 판매(1단계 그래프) + 회사 발표 계열 한 줄 · 정의 차이 상자 · 회사 발표 분기 표. */
export default function CustomerVolumeCompare({ volume, series }: Props) {
  const main = chartSeries(series);
  const quarterly = series.filter((s) => s.quarterly.length > 0);
  const periods = [...new Set(quarterly.flatMap((s) => s.quarterly.map((q) => q.period)))]
    .sort()
    .slice(-QUARTER_COLUMNS);
  // 같은 정의 문구를 여러 계열(지역)이 함께 쓰면 첫 계열(전체가 먼저 온다)의 이름으로 한 번만.
  const definitions = series.filter(
    (s, i) => series.findIndex((x) => x.definition === s.definition) === i
  );
  const vehiclesOnly = series.some((s) => /이륜차\s*제외/.test(s.definition));
  return (
    <div className="space-y-3">
      {volume.group && volume.kpi ? (
        <>
          <p className="text-xs text-muted-foreground">
            MarkLines 그룹 「{volume.group}」 전체 판매 — 그룹 단위라 계열 브랜드가 함께 잡힌다.
            {main && ' 노란 선 = 회사 발표 값(정의가 달라 맞지 않을 수 있다 — 아래 상자).'}
          </p>
          <CompanyKpiCards kpi={volume.kpi} />
          <CompanyTimeSeriesChart
            monthly={volume.monthly}
            annual={volume.annual}
            title="MarkLines 그룹 판매"
            secondary={
              main
                ? {
                    label: `회사 발표 ${volumeSeriesLabel(main.metric, main.region)}`,
                    primaryLabel: 'MarkLines 판매',
                    monthly: main.monthly,
                    annual: main.annual,
                  }
                : undefined
            }
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {volume.group
            ? `MarkLines 그룹 「${volume.group}」 판매 자료가 아직 없다.`
            : 'MarkLines 에 이 회사 단독 그룹이 없다.'}
        </p>
      )}
      {series.length > 0 && (
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2 text-xs">
          <p className="flex flex-wrap items-center gap-2 font-medium text-sm">
            정의 차이 — 회사 발표 물량
            {vehiclesOnly && (
              <span className="rounded border border-border px-1.5 text-[11px] font-normal">
                자동차만(전기 이륜차 제외)
              </span>
            )}
          </p>
          <ul className="space-y-0.5 text-muted-foreground">
            {definitions.map((s) => (
              <li key={s.definition}>
                <span className="text-foreground">{volumeSeriesLabel(s.metric, s.region)}</span> —{' '}
                {s.definition}
              </li>
            ))}
          </ul>
          {periods.length > 0 && (
            <div className="overflow-x-auto">
              <table className="text-xs tabular-nums">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left font-normal">회사 발표 분기</th>
                    {periods.map((p) => (
                      <th key={p} className="px-2 py-1 text-right font-normal">
                        {p.replace('-', ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quarterly.map((s) => {
                    const byPeriod = new Map(s.quarterly.map((q) => [q.period, q]));
                    return (
                      <tr key={`${s.metric}|${s.region}`} className="border-t border-border">
                        <td className="px-2 py-1 whitespace-nowrap">
                          {volumeSeriesLabel(s.metric, s.region)}
                        </td>
                        {periods.map((p) => {
                          const q = byPeriod.get(p);
                          return (
                            <td key={p} className="px-2 py-1 text-right whitespace-nowrap">
                              {q ? q.value.toLocaleString('ko-KR') : '—'}
                              {q?.derived && (
                                <span
                                  className="ml-1 text-[10px] text-muted-foreground"
                                  title="회사가 분기 값을 따로 내지 않아 누계 차이로 계산"
                                >
                                  계산값
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

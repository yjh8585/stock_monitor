// 서버 컴포넌트 — 차트는 기존 CompanyTimeSeriesChart(클라이언트)에 두 번째 계열만 넘긴다.
import CompanyKpiCards from '@/components/oem-companies/common/CompanyKpiCards';
import CompanyTimeSeriesChart from '@/components/oem-companies/common/CompanyTimeSeriesChart';
import { regionQuarterCharts, type VolumeSeries } from '@/lib/customers/ir';
import type { CustomerDetail } from '@/lib/customers/source';
import { volumeSeriesLabel } from '@/lib/customers/format';
import { monthlyToQuarterly, type ModelQuarterTable } from '@/lib/customers/volume';
import HighlightRow from './HighlightRow';

/** MarkLines 판매와 견줄 회사 계열 — 전체(total) 중 판매 성격이 가까운 지표부터. */
const CHART_METRIC_ORDER = ['sales', 'wholesale', 'deliveries', 'shipments', 'production'];
const QUARTER_COLUMNS = 6;

interface Props {
  volume: CustomerDetail['volume'];
  series: VolumeSeries[];
}

function chartSeries(series: VolumeSeries[]): VolumeSeries | null {
  // 분기 값만 내는 회사(해외 대부분)도 잡는다 — 빠뜨려 회사 발표가 차트에 안 실렸다(2026-11-11 사용자 지적).
  const total = series.filter(
    (s) =>
      s.region === 'total' &&
      (s.monthly.length > 0 || s.annual.length > 0 || s.quarterly.length > 0)
  );
  const rank = (s: VolumeSeries) => {
    const i = CHART_METRIC_ORDER.indexOf(s.metric);
    return i === -1 ? CHART_METRIC_ORDER.length : i;
  };
  return [...total].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

const KIND_LABEL = { production: '생산', sales: '판매' } as const;

/**
 * 차종 모드의 차종별 분기 생산·판매(MarkLines 추정). 회사가 차종별 물량을 따로 내지 않으면 맞춰 볼 곳이 없다 —
 * 신차는 판매(등록) 집계가 생산보다 늦게 잡히고 차종 나눔도 흔들려(합은 회사 발표와 가깝다) 생산을 먼저 본다.
 */
function ModelQuarterTableView({ table }: { table: ModelQuarterTable }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2 text-xs">
      <p className="font-medium text-sm">MarkLines 차종별 분기 생산·판매 (대)</p>
      <p className="text-muted-foreground">
        MarkLines 추정값 — 생산은 공장 기준, 판매는 시장 등록 기준이다. 신차는 판매 집계가 생산보다
        늦게 잡히고 차종 간 나눔이 흔들릴 수 있어(차종 합은 회사 발표 인도와 가깝다) 신차 물량은
        생산 쪽을 먼저 본다. 석 달이 다 들어온 분기만 적는다.
      </p>
      <div className="overflow-x-auto">
        <table className="text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left font-normal">구분</th>
              <th className="px-2 py-1 text-left font-normal">차종</th>
              {table.periods.map((p) => (
                <th key={p} className="px-2 py-1 text-right font-normal">
                  {p.replace('-', ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <HighlightRow
                key={`${r.kind}|${r.model}`}
                label={`${KIND_LABEL[r.kind]} ${r.model}`}
                className="border-t border-border"
              >
                <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                  {KIND_LABEL[r.kind]}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">{r.model}</td>
                {r.values.map((v, i) => (
                  <td key={table.periods[i]} className="px-2 py-1 text-right whitespace-nowrap">
                    {v == null ? '—' : v.toLocaleString('ko-KR')}
                  </td>
                ))}
              </HighlightRow>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
            {volume.models
              ? `MarkLines 차종 합 판매(${volume.models.join('·')}) — 묶음 그룹 「${volume.group}」 안에서 이 회사 차종만 모았다.`
              : `MarkLines 그룹 「${volume.group}」 전체 판매 — 그룹 단위라 계열 브랜드가 함께 잡힌다.`}
            {main &&
              ' 노란 막대 = 회사 발표 값(정의가 달라 맞지 않을 수 있다 — 아래 상자). 분기 = MarkLines 석 달 합(석 달이 다 찬 분기만).'}
          </p>
          <CompanyKpiCards kpi={volume.kpi} />
          <CompanyTimeSeriesChart
            monthly={volume.monthly}
            annual={volume.annual}
            quarterly={monthlyToQuarterly(volume.monthly)}
            title={volume.models ? 'MarkLines 차종 합 판매' : 'MarkLines 그룹 판매'}
            secondary={
              main
                ? {
                    label: `회사 발표 ${volumeSeriesLabel(main.metric, main.region)}`,
                    primaryLabel: 'MarkLines 판매',
                    monthly: main.monthly,
                    annual: main.annual,
                    quarterly: main.quarterly,
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
      {volume.missingModels.length > 0 && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
          MarkLines 에서 못 찾은 차종명: {volume.missingModels.join('·')} — 철자가 다르면 합에서
          빠진다(명단 차종명 확인 필요).
        </p>
      )}
      {volume.modelTable && <ModelQuarterTableView table={volume.modelTable} />}
      {regionQuarterCharts(series).map((c) => (
        // 결정 E9 — 지역 계열(VW 중국 인도)은 위 MarkLines 비교 차트에 섞지 않고 따로 분기 막대로
        <CompanyTimeSeriesChart
          key={`${c.metric}|${c.region}`}
          monthly={[]}
          annual={c.points}
          title={`회사 발표 ${volumeSeriesLabel(c.metric, c.region)} (분기)`}
          hideModeToggle
          seriesLabel={volumeSeriesLabel(c.metric, c.region)}
        />
      ))}
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
                      <HighlightRow
                        key={`${s.metric}|${s.region}`}
                        label={volumeSeriesLabel(s.metric, s.region)}
                        className="border-t border-border"
                      >
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
                      </HighlightRow>
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

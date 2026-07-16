import { ChartSection } from '@/components/management/plan/_selectors';
import type { DriverLagProfile, RevenueDriverAnalysis } from '@/lib/stellantis-forecast/types';
import { fmtSigned } from './format';

/**
 * 3. 자사 매출은 무엇을 따라가는가 — 축 3개 × 시차별 상관 프로파일.
 *
 * **최대 |r| 한 값만 크게 띄우지 않는 것이 이 섹션의 설계 의도다.** 축 3개에 시차 후보를 모두
 * 시험해 최대값을 고르면 우연만으로도 큰 값이 나온다(다중비교). 그래서 전 후보를 막대로 펼쳐
 * "이웃 시차까지 완만하게 높은가(=실제 관계일 가능성) / 한 점만 뾰족한가(=우연일 가능성)"를
 * 눈으로 판정하게 한다. 채택값은 그 모양의 요약일 뿐이다.
 *
 * server component — 상호작용이 없어 클라이언트 JS를 태우지 않는다.
 */

/** |r| → 막대 색. 관계의 방향(부호)이 아니라 세기를 보여주는 것이 목적이다. */
function strengthTone(r: number): string {
  const a = Math.abs(r);
  if (a >= 0.5) return 'bg-blue-600';
  if (a >= 0.3) return 'bg-blue-400';
  return 'bg-blue-200';
}

export default function DriverAnalysisSection({ drivers }: { drivers: RevenueDriverAnalysis }) {
  return (
    <ChartSection title="3. 자사 매출은 시간을 두고 무엇을 따라가는가" unit="">
      <p className="mb-3 text-sm text-muted-foreground">
        자사 스텔란티스향 매출(별도 기준)과 스텔란티스 3축(생산·소매·출하)의{' '}
        <b>전년 동기 대비 증감률</b>끼리 시차별 상관을 냅니다. 시차가{' '}
        <b>양수면 자사 매출이 그 축보다 먼저</b>, 음수면 나중에 움직였다는 뜻입니다.
      </p>

      <div className="space-y-4">
        {drivers.profiles.map((profile) => (
          <ProfileRow
            key={profile.axis}
            profile={profile}
            isLeader={drivers.leader?.axis === profile.axis}
          />
        ))}
      </div>

      <div className="mt-4 rounded-lg bg-muted/40 p-3">
        <div className="mb-1 text-sm font-medium">이 분석을 어디까지 믿어야 하는가</div>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {drivers.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </ChartSection>
  );
}

function ProfileRow({ profile, isLeader }: { profile: DriverLagProfile; isLeader: boolean }) {
  const unit = profile.granularity === 'quarter' ? '분기' : '개월';

  return (
    <div
      className={`rounded-lg p-3 ring-1 ${isLeader ? 'ring-blue-500/50' : 'ring-foreground/10'}`}
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="text-base font-medium">{profile.axisLabel}</span>
        {isLeader ? (
          <span className="rounded bg-blue-600 px-1.5 py-0.5 text-xs font-semibold text-white">
            상관 최대
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {profile.granularity === 'quarter' ? '분기 단위 축' : '월 단위 축'}
        </span>
      </div>

      {profile.lag === null ? (
        <div className="text-sm text-muted-foreground">{profile.unavailableReason}</div>
      ) : (
        <>
          <div className="mb-2 text-sm">
            채택 시차{' '}
            <b>
              {fmtSigned(profile.lag.lagMonths / (profile.granularity === 'quarter' ? 3 : 1))}
              {unit}
            </b>{' '}
            · r = <b>{profile.lag.r.toFixed(2)}</b> · 표본 {profile.lag.n}개
          </div>
          {/* 전 시차 후보 — 채택값 하나만 믿지 말라는 뜻으로 모양 전체를 편다. */}
          <div className="space-y-1">
            {profile.lag.candidates.map((c) => {
              const isPicked = c.lagMonths === profile.lag!.lagMonths;
              const shown = c.lagMonths / (profile.granularity === 'quarter' ? 3 : 1);
              return (
                <div key={c.lagMonths} className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-16 shrink-0 text-right tabular-nums ${isPicked ? 'font-semibold' : 'text-muted-foreground'}`}
                  >
                    {fmtSigned(shown)}
                    {unit}
                  </span>
                  {/* |r| 0~1을 폭 0~100%로 — 부호는 옆 숫자로 읽고 막대는 세기만 표현한다. */}
                  <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted">
                    <div
                      className={`h-full ${strengthTone(c.r)} ${isPicked ? '' : 'opacity-50'}`}
                      style={{ width: `${Math.min(Math.abs(c.r), 1) * 100}%` }}
                    />
                  </div>
                  <span
                    className={`w-24 shrink-0 tabular-nums ${isPicked ? 'font-semibold' : 'text-muted-foreground'}`}
                  >
                    r = {c.r.toFixed(2)}
                  </span>
                  <span className="w-14 shrink-0 text-right text-muted-foreground tabular-nums">
                    n = {c.n}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

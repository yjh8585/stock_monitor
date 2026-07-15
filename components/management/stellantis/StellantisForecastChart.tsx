'use client';

import dynamic from 'next/dynamic';
import { ChartSection } from '@/components/management/plan/_selectors';
import type { ForecastSeries } from '@/lib/stellantis-forecast/types';
import { ChartFallback } from './ChartFallback';
import { scenarioColor } from './scenarioStyle';

const Inner = dynamic(() => import('./StellantisForecastChartInner'), {
  ssr: false,
  loading: () => <ChartFallback size="md" />,
});

/**
 * 차트 4 — 자사 매출 실적 + 전망 시나리오 3종.
 *
 * 하나의 숫자를 내놓는 대신 **가정을 드러낸다**(사용자 결정 2026-07-15 — 회귀 예측 거부).
 * 그래서 각 시나리오의 `assumption` 문장을 차트 바로 아래에 그대로 노출한다. 가정을 숨긴 전망은
 * 검증할 수 없고, 검증할 수 없는 숫자는 의사결정에 쓸 수 없다.
 */
export default function StellantisForecastChart({ forecast }: { forecast: ForecastSeries }) {
  if (forecast.scenarios.length === 0) {
    return (
      <ChartSection title="4. 자사 매출 전망 (실적 + 시나리오)" unit="억원">
        <p className="py-12 text-center text-base text-muted-foreground">
          전망에 필요한 출하·원단위 데이터가 아직 없습니다.
        </p>
      </ChartSection>
    );
  }

  return (
    <ChartSection title="4. 자사 매출 전망 (실적 + 시나리오)" unit="억원">
      <p className="mb-2 text-sm text-muted-foreground">
        전망 = <b>북미 출하 전망 × 대당 매출 원단위</b>(3번). 빗금 막대가 전망, 채워진 막대가
        실적입니다.
        {forecast.lowConfidence
          ? ' 원단위 변동이 커(3번 CV 임계 초과) 이 전망은 참고용입니다.'
          : ''}
      </p>
      <Inner forecast={forecast} />
      <div className="mt-3 border-t border-border pt-3">
        <h3 className="mb-2 text-sm font-semibold">
          시나리오 가정 — 숫자보다 이 문장을 먼저 보십시오
        </h3>
        <ul className="space-y-1.5">
          {forecast.scenarios.map((s, i) => (
            <li key={s.key} className="flex gap-2 text-sm">
              <span
                className="mt-1 inline-block size-3 shrink-0 rounded-sm"
                style={{ background: scenarioColor(i) }}
                aria-hidden
              />
              <span>
                <b>{s.label}</b> — <span className="text-muted-foreground">{s.assumption}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartSection>
  );
}

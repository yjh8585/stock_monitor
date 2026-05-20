/**
 * 오늘 분봉 가격 + 잠정 누적 수급을 결합해 한국어 코멘트 2~3줄을 생성한다.
 * - LLM 호출 없음. 순수 규칙 기반.
 * - 첫째 줄: 총평(등락률 + 주도 투자자 또는 부호 불일치 진단)
 * - 둘째 줄: 최신 슬롯의 외국인/기관 누적값
 * - 셋째 줄(선택): 가장 영향 큰 변화 구간 코멘트
 */
import type { IntradayPoint, IntradaySupplyPoint } from '@/lib/hansae/data';

export interface Commentary {
  headline: string;
  detail: string;
  cause?: string;
}

const KST = 'Asia/Seoul';

function fmtSigned(n: number | null): string {
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${Math.round(n).toLocaleString('ko-KR')}`;
}

function fmtPct(n: number | null): string {
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function nearestSupplyAt(
  supply: IntradaySupplyPoint[],
  targetTs: number,
): IntradaySupplyPoint | null {
  if (supply.length === 0) return null;
  let best = supply[0];
  let bestDelta = Math.abs(new Date(best.snapshotTs).getTime() - targetTs);
  for (const s of supply) {
    const d = Math.abs(new Date(s.snapshotTs).getTime() - targetTs);
    if (d < bestDelta) {
      bestDelta = d;
      best = s;
    }
  }
  return best;
}

function fmtTimeKst(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: KST,
  });
}

/**
 * 가격·수급으로부터 코멘트 생성.
 * @param intraday  오늘 5분봉 (시간 오름차순)
 * @param supply    오늘 잠정 누적 수급 스냅샷 (시간 오름차순)
 */
export function buildIntradayCommentary(
  intraday: IntradayPoint[],
  supply: IntradaySupplyPoint[],
): Commentary | null {
  if (intraday.length < 2) return null;

  const first = intraday[0];
  const last = intraday[intraday.length - 1];
  const priceChangePct =
    first.price > 0 ? ((last.price - first.price) / first.price) * 100 : 0;

  const latestSupply = supply.length > 0 ? supply[supply.length - 1] : null;
  const foreign = latestSupply?.foreignNet ?? 0;
  const institution = latestSupply?.institutionNet ?? 0;
  const individual = latestSupply?.individualNet ?? 0;

  // 주도 투자자 판단: |순매수|가 가장 큰 쪽
  const ranked = [
    { key: 'foreign', label: '외국인', value: foreign },
    { key: 'institution', label: '기관', value: institution },
    { key: 'individual', label: '개인', value: individual },
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const leader = ranked[0];

  // 부호 일치 판정 (가격 ↑ + 주도자 매수 / 가격 ↓ + 주도자 매도)
  const priceUp = priceChangePct > 0.05;
  const priceDown = priceChangePct < -0.05;
  const leaderBuy = leader.value > 0;
  const leaderSell = leader.value < 0;
  let cause: string | undefined;
  if (priceDown && leaderSell) {
    cause = `${leader.label} 매도(${fmtSigned(leader.value)}주)가 하락 견인`;
  } else if (priceUp && leaderBuy) {
    cause = `${leader.label} 매수(${fmtSigned(leader.value)}주)가 상승 견인`;
  } else if (priceDown && leaderBuy) {
    cause = `${leader.label}은 매수 중이지만 다른 주체 매도 우세`;
  } else if (priceUp && leaderSell) {
    cause = `${leader.label}은 매도 중이지만 다른 주체 매수 우세`;
  } else if (Math.abs(priceChangePct) <= 0.05) {
    cause = '가격은 보합 — 외국인·기관 누적 거래 미미';
  }

  const headline = latestSupply
    ? `오늘 ${fmtPct(priceChangePct)} · ${cause ?? '주가/수급 방향 혼조'}`
    : `오늘 ${fmtPct(priceChangePct)} · 잠정 수급 미수신`;

  const detail = latestSupply
    ? `외국인 ${fmtSigned(foreign)} / 기관 ${fmtSigned(institution)} / 개인 ${fmtSigned(individual)} ` +
      `(${fmtTimeKst(latestSupply.snapshotTs)} 기준 잠정 누적)`
    : '오늘 외국인·기관 누적값이 아직 들어오지 않았습니다.';

  // 가장 영향 큰 시점: 스냅샷 간 외국인 변화량이 가장 큰 구간
  let strongCause: string | undefined;
  if (supply.length >= 2) {
    let bestDelta = 0;
    let bestIdx = -1;
    for (let i = 1; i < supply.length; i++) {
      const dF =
        (supply[i].foreignNet ?? 0) - (supply[i - 1].foreignNet ?? 0);
      if (Math.abs(dF) > Math.abs(bestDelta)) {
        bestDelta = dF;
        bestIdx = i;
      }
    }
    if (bestIdx > 0 && Math.abs(bestDelta) > 0) {
      const slotIso = supply[bestIdx].snapshotTs;
      const slotTs = new Date(slotIso).getTime();
      // 같은 시각의 분봉 가격과 직전 슬롯 분봉 가격 비교
      const priceNow = nearestSupplyAt(
        intraday.map((p) => ({
          snapshotTs: p.ts,
          foreignNet: p.price,
          institutionNet: null,
          individualNet: null,
        })),
        slotTs,
      );
      const prevSlotTs = new Date(supply[bestIdx - 1].snapshotTs).getTime();
      const pricePrev = nearestSupplyAt(
        intraday.map((p) => ({
          snapshotTs: p.ts,
          foreignNet: p.price,
          institutionNet: null,
          individualNet: null,
        })),
        prevSlotTs,
      );
      const dPrice =
        priceNow && pricePrev && pricePrev.foreignNet
          ? ((priceNow.foreignNet! - pricePrev.foreignNet) / pricePrev.foreignNet) *
            100
          : null;
      const direction = bestDelta > 0 ? '매수 유입' : '매도 출회';
      const tail =
        dPrice !== null
          ? ` → 가격 ${fmtPct(dPrice)}`
          : '';
      strongCause = `${fmtTimeKst(slotIso)} 외국인 ${direction} ${fmtSigned(bestDelta)}주${tail}`;
    }
  }

  return { headline, detail, cause: strongCause };
}

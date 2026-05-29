/**
 * 오늘 분봉 가격 + 잠정 누적 수급을 결합해 한국어 코멘트 2~3줄을 생성한다.
 * - LLM 호출 없음. 순수 규칙 기반.
 * - 첫째 줄: 총평(등락률 + 주도 투자자 또는 부호 불일치 진단)
 * - 둘째 줄: 최신 슬롯의 외국인/기관 누적값
 * - 셋째 줄(선택): 가장 영향 큰 변화 구간 코멘트
 */
import type {
  BoardPostSummary,
  IntradayPoint,
  IntradaySupplyPoint,
  NewsItem,
} from '@/lib/hansae/data';

export interface Commentary {
  headline: string;
  detail: string;
  cause?: string;
  /** 오늘 뉴스 헤드라인 1~3개 (간략) */
  newsTopics?: string[];
  /** 종목토론 핫토픽 1~3개 (감성 라벨 포함) */
  boardTopics?: string[];
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
  targetTs: number
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

/** 제목 끝 출처 괄호/날짜 정리 (보고서 표시와 동일) */
function shortenTitle(title: string, maxLen = 50): string {
  const cleaned = title.replace(/\s*\([^)]*\)\s*$/u, '').trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen - 1) + '…' : cleaned;
}

const LABEL_KR: Record<string, string> = {
  positive: '긍정',
  negative: '부정',
  neutral: '중립',
};

function buildNewsTopics(news: NewsItem[] | undefined): string[] {
  if (!news || news.length === 0) return [];
  // 가장 최근 published_at 순 상위 3개
  const top = news.slice(0, 3);
  return top.map((n) => {
    const src = n.source ? `[${n.source}] ` : '';
    return `${src}${shortenTitle(n.title)}`;
  });
}

function buildBoardTopics(posts: BoardPostSummary[] | undefined): string[] {
  if (!posts || posts.length === 0) return [];
  // 오늘 게시글 우선 + 조회수·추천 합산이 큰 순으로 핫토픽 추출
  const startToday = new Date();
  startToday.setUTCHours(0, 0, 0, 0);
  const todayMs = startToday.getTime();
  const ranked = [...posts]
    .filter((p) => new Date(p.postedAt).getTime() >= todayMs)
    .sort((a, b) => b.views + b.likes * 5 - (a.views + a.likes * 5))
    .slice(0, 3);
  if (ranked.length === 0) return [];
  return ranked.map((p) => {
    const label = p.label ? `(${LABEL_KR[p.label] ?? p.label}) ` : '';
    return `${label}${shortenTitle(p.title, 45)}`;
  });
}

/**
 * 가격·수급·뉴스·종목토론으로부터 코멘트 생성.
 * @param intraday  오늘 5분봉 (시간 오름차순)
 * @param supply    오늘 잠정 누적 수급 스냅샷 (시간 오름차순)
 * @param news      오늘 발행 뉴스 (선택, 최신 순)
 * @param posts     최근 종목토론 게시글 (선택, 감성 라벨 포함)
 */
export function buildIntradayCommentary(
  intraday: IntradayPoint[],
  supply: IntradaySupplyPoint[],
  news?: NewsItem[],
  posts?: BoardPostSummary[]
): Commentary | null {
  if (intraday.length < 2) return null;

  const first = intraday[0];
  const last = intraday[intraday.length - 1];
  const priceChangePct = first.price > 0 ? ((last.price - first.price) / first.price) * 100 : 0;

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
      const dF = (supply[i].foreignNet ?? 0) - (supply[i - 1].foreignNet ?? 0);
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
        slotTs
      );
      const prevSlotTs = new Date(supply[bestIdx - 1].snapshotTs).getTime();
      const pricePrev = nearestSupplyAt(
        intraday.map((p) => ({
          snapshotTs: p.ts,
          foreignNet: p.price,
          institutionNet: null,
          individualNet: null,
        })),
        prevSlotTs
      );
      const dPrice =
        priceNow && pricePrev && pricePrev.foreignNet
          ? ((priceNow.foreignNet! - pricePrev.foreignNet) / pricePrev.foreignNet) * 100
          : null;
      const direction = bestDelta > 0 ? '매수 유입' : '매도 출회';
      const tail = dPrice !== null ? ` → 가격 ${fmtPct(dPrice)}` : '';
      strongCause = `${fmtTimeKst(slotIso)} 외국인 ${direction} ${fmtSigned(bestDelta)}주${tail}`;
    }
  }

  const newsTopics = buildNewsTopics(news);
  const boardTopics = buildBoardTopics(posts);

  return {
    headline,
    detail,
    cause: strongCause,
    newsTopics: newsTopics.length > 0 ? newsTopics : undefined,
    boardTopics: boardTopics.length > 0 ? boardTopics : undefined,
  };
}

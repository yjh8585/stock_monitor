/**
 * 키움 mock 구현 — 앱키 발급 전 UI/크론 동작 검증용.
 * 종목별 기준가 근처에서 의사 랜덤 변동값 반환. 동일 ticker 호출 시 매번 다른 값.
 */
import type { KiwoomClient, KiwoomInvestorTrend, KiwoomQuote } from '@/lib/kiwoom/types';

const MOCK_BASE_PRICES: Record<string, number> = {
  '016450': 14500, // 한세예스24홀딩스
  '105630': 23000, // 한세실업
  '069640': 4200, // 한세엠케이
};

function jitter(base: number, pct: number): number {
  const delta = (Math.random() - 0.5) * 2 * pct;
  return Math.round(base * (1 + delta));
}

export class MockKiwoomClient implements KiwoomClient {
  async getQuote(ticker: string): Promise<KiwoomQuote> {
    const base = MOCK_BASE_PRICES[ticker] ?? 10000;
    const price = jitter(base, 0.03);
    const changePct = Number((((price - base) / base) * 100).toFixed(2));
    const volume = Math.floor(Math.random() * 500_000) + 10_000;
    return { ticker, price, changePct, volume, ts: new Date() };
  }

  async getInvestorTrend(ticker: string, tradeDate: string): Promise<KiwoomInvestorTrend> {
    const scale = () => Math.floor((Math.random() - 0.5) * 200_000);
    return {
      ticker,
      tradeDate,
      foreignNet: scale(),
      institutionNet: scale(),
      individualNet: scale(),
      programNet: scale(),
    };
  }
}

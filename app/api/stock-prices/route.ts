/**
 * 단일 회사 주가 시계열 조회 API — /etc/stock-prices 페이지가 클라이언트에서 호출.
 *
 * GET /api/stock-prices?id=<companyId>
 *  → { series: [{ time: "YYYY-MM-DD", value: <close> }, ...] }
 *
 * 캐싱은 데이터 액세스 함수(getStockPriceSeries)의 'use cache' + cacheTag('stock_prices')에 위임.
 * 전체 회사를 SSR로 직렬화하면 RSC 페이로드가 수MB로 폭발 + RangeError → 페이지 분리.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getStockPriceSeries } from '@/lib/stockPrices';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id 누락' }, { status: 400 });
  }
  const series = await getStockPriceSeries(id);
  return NextResponse.json({ series });
}

import type { CustomerShare, PnlRevenueRow, ShareAccount, ShareResult } from './types';

const ym = (y: number, m: number) => y * 12 + (m - 1);
const fmtYm = (n: number) => `${Math.floor(n / 12)}.${String((n % 12) + 1).padStart(2, '0')}`;
const empty = (): CustomerShare => ({ sharePct: null, topProducts: [] });

/**
 * 손익 매출 → 고객사별 비중(사용자 선택 2026-11-09: 연결·최신월 앵커 12개월·0월 제외 — 거르기는 호출부).
 * 창 = 매출이 있는 최신월로 끝나는 12개월 · 분모 = 창 안 전체 고객 매출 합.
 */
export function computeShares(rows: PnlRevenueRow[], accounts: ShareAccount[]): ShareResult {
  const valued = rows.filter((r): r is PnlRevenueRow & { revenue: number } => r.revenue != null);
  if (valued.length === 0) {
    return {
      windowLabel: '',
      byCompany: Object.fromEntries(accounts.map((a) => [a.company_id, empty()])),
    };
  }
  const end = Math.max(...valued.map((r) => ym(r.period_year, r.period_month)));
  const start = end - 11;
  const inWindow = valued.filter((r) => {
    const k = ym(r.period_year, r.period_month);
    return k >= start && k <= end;
  });
  const total = inWindow.reduce((s, r) => s + r.revenue, 0);

  const byCompany: Record<string, CustomerShare> = {};
  for (const a of accounts) {
    if (a.pnl_customers.length === 0 || total === 0) {
      byCompany[a.company_id] = empty();
      continue;
    }
    const names = new Set(a.pnl_customers);
    const mine = inWindow.filter((r) => names.has(r.customer));
    const sum = mine.reduce((s, r) => s + r.revenue, 0);
    const byProduct = new Map<string, number>();
    for (const r of mine) byProduct.set(r.product, (byProduct.get(r.product) ?? 0) + r.revenue);
    const topProducts = [...byProduct.entries()]
      .filter(([, v]) => v > 0)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([p]) => p);
    byCompany[a.company_id] = { sharePct: (sum / total) * 100, topProducts };
  }
  return { windowLabel: `${fmtYm(start)}~${fmtYm(end)}`, byCompany };
}

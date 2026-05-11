/**
 * 회사명 클릭 시 외부 링크/팝업 열기.
 * - 비상장 + homepage_url → homepage 새 창
 * - KR 상장 → 내부 stock-popup
 * - 그 외 상장 → Yahoo Finance 새 창
 *
 * 두 Row 컴포넌트(StockRow, DomesticRow)에서 공유.
 */
const POPUP_OPTS = 'width=1400,height=900,scrollbars=yes,resizable=yes';

interface CompanyLinkInput {
  id: string;
  ticker: string | null;
  country: string;
  market: string | null;
  homepage_url: string | null;
}

export function openCompanyLink(row: CompanyLinkInput): void {
  if (!row.market) {
    if (row.homepage_url) window.open(row.homepage_url, '_blank', POPUP_OPTS);
    return;
  }
  if (row.country === 'KR') {
    window.open(`/stock-popup/${row.id}`, '_blank', POPUP_OPTS);
  } else {
    window.open(`https://finance.yahoo.com/quote/${row.ticker ?? ''}`, '_blank', POPUP_OPTS);
  }
}

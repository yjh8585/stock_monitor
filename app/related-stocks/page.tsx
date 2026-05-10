import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RelatedStockRow, ExchangeRates } from '@/lib/types';
import StockTable from '@/components/related-stocks/StockTable';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export default async function RelatedStocksPage() {
  const supabase = await createSupabaseServerClient();

  const [{ data: viewData, error: viewErr }, { data: fxData, error: fxErr }] = await Promise.all([
    supabase
      .from('related_stocks_view')
      .select('*')
      .order('company_type', { ascending: true })
      .order('name_kr', { ascending: true }),
    supabase.from('exchange_rates_live').select('base,rate').in('base', ['USD', 'EUR', 'CNY']),
  ]);

  if (viewErr) {
    logger.error({ err: viewErr }, 'related_stocks_view 조회 실패');
    throw new Error(`Supabase related_stocks_view 조회 실패: ${viewErr.message}`);
  }
  if (fxErr) logger.error({ err: fxErr }, 'exchange_rates_live 조회 실패');

  const rows: RelatedStockRow[] = (viewData ?? []) as RelatedStockRow[];

  const rates: ExchangeRates = { USD: null, EUR: null, CNY: null };
  for (const r of fxData ?? []) {
    const base = r.base as keyof ExchangeRates;
    if (base in rates) rates[base] = Number(r.rate);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">관련회사</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          자동차 산업 주요 기업 {rows.length}개사 실적·주가
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        <StockTable rows={rows} rates={rates} />
      </div>
    </div>
  );
}

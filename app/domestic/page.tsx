import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DomesticStockRow, ExchangeRates } from '@/lib/types';
import DomesticTable from '@/components/domestic/DomesticTable';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export default async function DomesticPage() {
  const supabase = await createSupabaseServerClient();

  const [{ data: viewData, error: viewErr }, { data: fxData, error: fxErr }] = await Promise.all([
    supabase
      .from('domestic_stocks_view')
      .select('*')
      .order('sales_rank', { ascending: true, nullsFirst: false }),
    supabase.from('exchange_rates_live').select('base,rate').in('base', ['USD', 'EUR', 'CNY']),
  ]);

  if (viewErr) {
    logger.error({ err: viewErr }, 'domestic_stocks_view 조회 실패');
    throw new Error(`Supabase domestic_stocks_view 조회 실패: ${viewErr.message}`);
  }
  if (fxErr) logger.error({ err: fxErr }, 'exchange_rates_live 조회 실패');

  const rows: DomesticStockRow[] = (viewData ?? []) as DomesticStockRow[];

  const rates: ExchangeRates = { USD: null, EUR: null, CNY: null };
  for (const r of fxData ?? []) {
    const base = r.base as keyof ExchangeRates;
    if (base in rates) rates[base] = Number(r.rate);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">국내자동차</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          국내 자동차 부품사 {rows.length}개사 (매출액 기준)
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        <DomesticTable rows={rows} rates={rates} />
      </div>
    </div>
  );
}

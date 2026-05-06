import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RelatedStockRow } from '@/lib/types';
import StockTable from '@/components/related-stocks/StockTable';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export default async function RelatedStocksPage() {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('related_stocks_view')
    .select('*')
    .order('company_type', { ascending: true })
    .order('name_kr', { ascending: true });

  if (error) {
    logger.error({ err: error }, 'related_stocks_view 조회 실패');
  }

  const rows: RelatedStockRow[] = (data ?? []) as RelatedStockRow[];

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">관련주식</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          자동차 산업 주요 기업 {rows.length}개사 실적·주가
        </p>
      </div>
      <div className="flex-1 overflow-auto">
        <StockTable rows={rows} />
      </div>
    </div>
  );
}

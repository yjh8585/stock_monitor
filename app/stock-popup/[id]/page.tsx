import { createSupabaseServerClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import IframePanel from '@/components/stock-popup/IframePanel';

interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string | null;
  published_at: string;
}

function getExternalUrl(ticker: string, country: string): string {
  if (country === 'KR') {
    return `https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?pGB=1&gicode=A${ticker}&cID=AA&MenuYn=Y&ReportGB=&NewMenuID=11&stkGb=701`;
  }
  return `https://finance.yahoo.com/quote/${ticker}`;
}

export default async function StockPopupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: company, error } = await supabase
    .from('companies')
    .select('id, ticker, name_kr, country')
    .eq('id', id)
    .single();

  if (error || !company) notFound();

  const { data: newsData } = await supabase
    .from('news')
    .select('id, title, url, source, published_at')
    .eq('company_id', id)
    .order('published_at', { ascending: false })
    .limit(10);

  const news = (newsData ?? []) as NewsItem[];
  const externalUrl = getExternalUrl(company.ticker as string, company.country as string);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* 좌측 3/4: 주식 정보 iframe */}
      <div className="flex flex-col border-r border-border" style={{ width: '75%' }}>
        <header className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 bg-muted/40">
          <span className="font-semibold text-sm">{company.name_kr as string}</span>
          <span className="text-xs text-muted-foreground">{company.ticker as string}</span>
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink size={12} />
            직접 열기
          </a>
        </header>
        <div className="flex-1 overflow-hidden">
          <IframePanel src={externalUrl} title={company.name_kr as string} />
        </div>
      </div>

      {/* 우측 1/4: 최신 뉴스 */}
      <div className="flex flex-col overflow-hidden" style={{ width: '25%' }}>
        <header className="px-3 py-2 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">최신 뉴스</h2>
        </header>
        <div className="flex-1 overflow-y-auto">
          {news.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              수집된 뉴스가 없습니다. (수집 예정)
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {news.map((item) => (
                <li key={item.id} className="px-3 py-3">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-foreground hover:underline block leading-snug"
                  >
                    {item.title}
                  </a>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {item.source && <span>{item.source} · </span>}
                    {new Date(item.published_at).toLocaleDateString('ko-KR')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

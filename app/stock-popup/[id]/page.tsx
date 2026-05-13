import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { cacheLife, cacheTag } from 'next/cache';
import { ExternalLink } from 'lucide-react';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import IframePanel from '@/components/stock-popup/IframePanel';
import PopupNewsSection from '@/components/stock-popup/PopupNewsSection';

/**
 * Cache Components 는 dynamic route 에 generateStaticParams 결과를 최소 1개 요구한다.
 * placeholder 만 prerender 하고 실제 id 는 dynamicParams 로 런타임 생성.
 */
export async function generateStaticParams() {
  return [{ id: '0' }];
}

function getFnguideUrl(ticker: string): string {
  return `https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?pGB=1&gicode=A${ticker}&cID=AA&MenuYn=Y&ReportGB=&NewMenuID=11&stkGb=701`;
}

/** 거래소(market) → TradingView 심볼 변환 후 widgetembed URL 반환 */
function getTradingViewUrl(ticker: string, market: string): string {
  const t = ticker.toUpperCase();
  let symbol: string;
  switch (market.toUpperCase()) {
    case 'KOSPI':
    case 'KOSDAQ':
      symbol = `KRX:${t}`;
      break;
    case 'XETRA':
      symbol = `XETR:${t.replace(/\.DE$/i, '')}`;
      break;
    case 'TSE':
      symbol = `TSE:${t.replace(/\.T$/i, '')}`;
      break;
    case 'HKEX':
      symbol = `HKEX:${t.replace(/\.HK$/i, '')}`;
      break;
    case 'LSE':
      symbol = `LSE:${t.replace(/\.L$/i, '')}`;
      break;
    case 'NYSE':
      symbol = `NYSE:${t}`;
      break;
    case 'NASDAQ':
      symbol = `NASDAQ:${t}`;
      break;
    default:
      symbol = t;
  }
  const params = new URLSearchParams({
    symbol,
    interval: 'D',
    hidesidetoolbar: '0',
    hidetoptoolbar: '0',
    symboledit: '1',
    saveimage: '1',
    toolbarbg: 'f1f3f6',
    studies: '[]',
    hidevolume: '0',
    theme: 'light',
    locale: 'ko',
  });
  return `https://www.tradingview.com/widgetembed/?${params.toString()}`;
}

/** 회사 메타 + 뉴스 fetch — id가 cache key. cacheLife='hours' 자동 갱신. */
async function getCompanyData(id: string) {
  'use cache';
  cacheLife('hours');
  cacheTag(`company:${id}`);

  const supabase = createSupabaseAnonClient();
  const { data: company, error } = await supabase
    .from('companies')
    .select('id, ticker, name_kr, country, market')
    .eq('id', id)
    .single();
  if (error || !company) return null;

  return { company };
}

/** params 동적 read + 회사 데이터 fetch (PPR 경계 안에서 await) */
async function StockPopupBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getCompanyData(id);
  if (!data) notFound();
  const { company } = data;

  const ticker = company.ticker as string;
  const market = (company.market as string) ?? 'NYSE';
  const isKR = company.country === 'KR';

  const iframeUrl = isKR ? getFnguideUrl(ticker) : getTradingViewUrl(ticker, market);
  const externalUrl = isKR ? getFnguideUrl(ticker) : `https://finance.yahoo.com/quote/${ticker}`;

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* 좌측 3/4: 주식 정보 iframe */}
      <div className="flex flex-col border-r border-border" style={{ width: '75%' }}>
        <header className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 bg-muted/40">
          <span className="font-semibold text-sm">{company.name_kr as string}</span>
          <span className="text-xs text-muted-foreground">{ticker}</span>
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
          <IframePanel src={iframeUrl} title={company.name_kr as string} />
        </div>
      </div>

      {/* 우측 1/4: 최신 뉴스 */}
      <div className="flex flex-col overflow-hidden" style={{ width: '25%' }}>
        <PopupNewsSection
          companyId={company.id as string}
          companyName={company.name_kr as string}
          ticker={ticker}
          country={company.country as string}
        />
      </div>
    </div>
  );
}

export default function StockPopupPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={<div className="p-6 text-sm text-muted-foreground">주식 정보 로딩 중…</div>}
    >
      <StockPopupBody params={params} />
    </Suspense>
  );
}

// 「지역·차종·점유율」 절 — 탭 3개(값 없는 탭은 숨김 · 결정 C4). 서버 컴포넌트 — 탭 틀(components/ui/tabs)만 클라이언트.
// 짝짓기(계획서 C 「짝짓기 표」): 대수·매출 = HyundaiQuarterlyRegionsChart(unit 인자) · 비중·점유율 = CustomerBreakdownTable ·
// 국내 3사 = OEM 탭 부품 그대로(domestic 노드 — CustomerDomesticOem 이 같은 인자로 빚는다).
import type { ReactNode } from 'react';
import HyundaiQuarterlyRegionsChart from '@/components/oem-companies/hyundai/HyundaiQuarterlyRegionsChart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  KIND_TITLE,
  KINDS,
  type BreakdownKind,
  type BreakdownSource,
  type BreakdownTab,
  type BreakdownTerm,
} from '@/lib/customers/breakdown';
import CustomerBreakdownTable from './CustomerBreakdownTable';

/** 출처 링크 — 상세에 요약 카드가 있으면 그 카드(#doc-<id>), 없으면 원문(PDF 면 첫 쪽으로 · 새 창). */
function SourceLink({ s, anchored }: { s: BreakdownSource; anchored: boolean }) {
  const pages = s.pages.length > 0 ? ` · ${s.pages.join('·')}쪽` : '';
  const text = `${s.publishedAt} ${s.title}${pages}`;
  if (anchored)
    return (
      <a href={`#doc-${s.docId}`} className="hover:underline">
        {text}
      </a>
    );
  if (!s.url) return <span>{text}</span>;
  const href = s.pages.length > 0 ? `${s.url}#page=${s.pages[0]}` : s.url;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
      {text}
    </a>
  );
}

/** 뜻 상자 — 물량 절 정의 상자(CustomerVolumeCompare)와 같은 클래스. 원문 표기·정의가 없는 이름은 싣지 않는다. */
function TermsBox({ terms }: { terms: BreakdownTerm[] }) {
  const shown = terms.filter((t) => t.raw.length > 0 || t.definition);
  if (shown.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2 text-xs">
      <p className="font-medium text-sm">구분의 뜻 (회사 표기 그대로)</p>
      <ul className="space-y-0.5 text-muted-foreground">
        {shown.map((t) => (
          <li key={t.label}>
            <span className="text-foreground">{t.label}</span>
            {t.raw.length > 0 && <> — 원문 {t.raw.join(' / ')}</>}
            {t.definition && <> · {t.definition}</>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CustomerBreakdown({
  tabs,
  anchoredDocIds,
  domestic,
}: {
  tabs: BreakdownTab[];
  /** 상세의 「공식 문서 요약」에 카드가 올라온 문서 id — 출처를 그 카드로 잇는다. */
  anchoredDocIds: number[];
  /** 국내 3사 — OEM 탭 부품(같은 인자). 있는 kind 는 탭을 연다. */
  domestic?: Partial<Record<BreakdownKind, ReactNode>>;
}) {
  const byKind = new Map(tabs.map((t) => [t.kind, t]));
  const kinds = KINDS.filter((k) => byKind.has(k) || domestic?.[k]);
  if (kinds.length === 0) return null;
  const anchored = new Set(anchoredDocIds);
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">지역·차종·점유율</h2>
      <Tabs defaultValue={kinds[0]}>
        <TabsList>
          {kinds.map((k) => (
            <TabsTrigger key={k} value={k}>
              {KIND_TITLE[k]}
            </TabsTrigger>
          ))}
        </TabsList>
        {kinds.map((k) => {
          // 국내 3사는 지역·차종을 OEM 탭 부품으로만 — IR 값은 점유율만 싣는다(결정 C1 · 같은 숫자가 두 번 뜨지 않게).
          const tab = domestic?.[k] && k !== 'share' ? undefined : byKind.get(k);
          return (
            <TabsContent key={k} value={k} className="pt-3 space-y-4">
              {domestic?.[k]}
              {tab?.charts.map((c) => (
                <HyundaiQuarterlyRegionsChart
                  key={c.key}
                  data={c.views[0].data}
                  views={c.views}
                  title={c.title}
                  unit={c.unit}
                />
              ))}
              {tab?.tables.map((t) => (
                <CustomerBreakdownTable key={t.key} table={t} />
              ))}
              {tab && <TermsBox terms={tab.terms} />}
              {tab && tab.sources.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>출처 — 회사 IR 문서(원문 글자와 대조해 맞은 값만):</p>
                  <ul className="space-y-0.5">
                    {tab.sources.map((s) => (
                      <li key={s.docId}>
                        <SourceLink s={s} anchored={anchored.has(s.docId)} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </section>
  );
}

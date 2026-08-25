import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';

import { MarkdownView } from '@/components/reports/markdown-view';
import { getResearchDetail } from '@/lib/humanoid/research';

/**
 * 휴머노이드 > 증권사 리포트 상세.
 *
 * `/reports/[id]` 와 같은 구조다 — 목록은 훑고, 본문은 여기서 읽는다. 요약이 마크다운
 * (`## 투자포인트` …)이라 `MarkdownView` 를 그대로 재사용한다. 목록 안에서 평문으로
 * 그리던 때는 서식이 죽어 있었다.
 *
 * Cache Components 는 generateStaticParams 가 최소 1개 반환을 요구한다.
 * 실데이터와 겹치지 않는 placeholder 만 prerender 하고 나머지는 런타임 생성.
 */
export async function generateStaticParams() {
  return [{ id: '0' }];
}

interface PageProps {
  params: Promise<{ id: string }>;
}

function MetaRow({
  publishedAt,
  opinion,
  targetPrice,
  isDelta,
  pdfUrl,
}: {
  publishedAt: string | null;
  opinion: string | null;
  targetPrice: number | null;
  isDelta: boolean;
  pdfUrl: string | null;
}) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span>{publishedAt ?? '날짜 미상'}</span>
      {opinion && <span className="text-foreground font-medium">{opinion}</span>}
      {targetPrice !== null && <span>목표 {targetPrice.toLocaleString()}원</span>}
      {isDelta && <span className="bg-muted rounded px-1.5 py-0.5">직전 대비 변화</span>}
      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline"
        >
          <FileText className="h-3 w-3" />
          원문 PDF
        </a>
      )}
    </div>
  );
}

async function ResearchDetailBody({ params }: PageProps) {
  const { id } = await params;
  const detail = await getResearchDetail(id);
  if (!detail) notFound();

  const { report, siblings } = detail;

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-6">
      <Link
        href="/humanoid/research"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-xs"
      >
        <ArrowLeft className="h-3 w-3" />
        목록으로
      </Link>

      <header className="border-border border-b pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{report.targetName}</span>
          {report.ticker && (
            <span className="text-muted-foreground text-xs">{report.ticker}</span>
          )}
          <span className="text-muted-foreground text-xs">{report.broker ?? '(미상)'}</span>
          <span className="bg-muted rounded px-1.5 py-0.5 text-[10px]">
            {report.kind === 'company' ? '종목분석' : '산업분석'}
          </span>
        </div>
        <h1 className="mt-1 text-lg font-semibold">{report.title}</h1>
        <div className="mt-2">
          <MetaRow
            publishedAt={report.publishedAt}
            opinion={report.opinion}
            targetPrice={report.targetPrice}
            isDelta={report.isDelta}
            pdfUrl={report.pdfUrl}
          />
        </div>
      </header>

      {report.summary ? (
        <div className="py-6">
          <MarkdownView content={report.summary} />
        </div>
      ) : (
        <p className="text-muted-foreground py-8 text-sm">
          아직 정리되지 않은 리포트입니다. 원문 PDF 를 확인하세요.
        </p>
      )}

      {siblings.length > 0 && (
        <section className="border-border border-t pt-4">
          <h2 className="mb-2 text-xs font-medium">
            {report.broker ?? '(미상)'} · {report.targetName} 의 다른 회차
          </h2>
          <ul className="divide-border divide-y">
            {siblings.map((s) => (
              <li key={s.id} className="py-2">
                <Link href={`/humanoid/research/${s.id}`} className="block hover:underline">
                  <span className="text-sm">{s.title}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {s.publishedAt ?? '날짜 미상'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

export default function HumanoidResearchDetailPage(props: PageProps) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground px-6 py-12 text-sm">불러오는 중…</p>}
    >
      <ResearchDetailBody {...props} />
    </Suspense>
  );
}

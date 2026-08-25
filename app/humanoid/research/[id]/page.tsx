import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';

import { MarkdownView } from '@/components/reports/markdown-view';
import { ResearchFigureGallery } from '@/components/humanoid/research-figure-gallery';
import { Card, CardContent } from '@/components/ui/card';
import { getResearchDetail } from '@/lib/humanoid/research';

/**
 * 휴머노이드 > 증권사 리포트 상세.
 *
 * `/reports/[id]` 와 같은 구조·같은 밀도로 짓는다 — 목록은 훑고, 본문은 여기서 읽는다.
 * 요약이 마크다운이라 `MarkdownView` 를 그대로 재사용한다.
 *
 * 🔴 2026-08-25 보강(사용자 지적 "다른 보고서 페이지에서 만들 듯 제대로 만들어야지"):
 *    ① 원본 자료 카드를 `/reports` 와 같은 형태로 세웠다(전에는 메타 줄의 작은 링크뿐)
 *    ② 본문에 실리지 않은 나머지 그림을 접이식 갤러리로 붙였다
 *    ③ 「직전 대비 변화」 배지가 무슨 뜻인지 화면에서 말해 준다
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
}: {
  publishedAt: string | null;
  opinion: string | null;
  targetPrice: number | null;
}) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span>{publishedAt ?? '날짜 미상'}</span>
      {opinion && <span className="text-foreground font-medium">{opinion}</span>}
      {targetPrice !== null && <span>목표주가 {targetPrice.toLocaleString()}원</span>}
    </div>
  );
}

async function ResearchDetailBody({ params }: PageProps) {
  const { id } = await params;
  const detail = await getResearchDetail(id);
  if (!detail) notFound();

  const { report, siblings } = detail;

  // 본문에 이미 실린 그림은 갤러리에서 뺀다 — 같은 그림을 두 번 보여 주지 않는다.
  const body = report.summary ?? '';
  const unusedFigures = report.images.filter((f) => !body.includes(f.url));

  return (
    <article className="mx-auto w-full max-w-3xl space-y-6 px-6 py-6">
      <Link
        href="/humanoid/research"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
      >
        <ArrowLeft className="h-3 w-3" />
        목록으로
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="bg-muted rounded px-1.5 py-0.5 text-[10px]">
            {report.kind === 'company' ? '종목분석' : '산업분석'}
          </span>
          <span className="text-sm font-medium">{report.targetName}</span>
          {report.ticker && <span className="text-muted-foreground text-xs">{report.ticker}</span>}
          <span className="text-muted-foreground text-xs">{report.broker ?? '(미상)'}</span>
          {report.isDelta && (
            <span
              className="bg-muted rounded px-1.5 py-0.5 text-[10px]"
              title="같은 증권사의 직전 리포트와 견줘 무엇이 달라졌는지가 본문 앞쪽에 정리돼 있습니다."
            >
              직전 대비 변화 포함
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold">{report.title}</h1>
        <MetaRow
          publishedAt={report.publishedAt}
          opinion={report.opinion}
          targetPrice={report.targetPrice}
        />
      </header>

      {/* 원본 자료 — /reports/[id] 와 같은 카드. 원문을 바로 열 수 있어야 한다. */}
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="text-muted-foreground font-medium">원본 자료</div>
          {report.pdfUrl ? (
            <a
              className="text-primary inline-flex items-center gap-1 hover:underline"
              href={report.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileText className="h-3.5 w-3.5" />
              {report.broker ?? '증권사'} 원문 PDF 열기
            </a>
          ) : (
            <div className="text-muted-foreground">원본 PDF 링크가 없습니다.</div>
          )}
          <p className="text-muted-foreground text-xs">
            아래 본문은 원문 리포트를 정리한 것입니다. 표준 재무제표 부록은 다루지 않습니다 — 해당
            수치는 기업 페이지에서 확인하세요.
          </p>
        </CardContent>
      </Card>

      {report.summary ? (
        <MarkdownView content={report.summary} />
      ) : (
        <p className="text-muted-foreground py-8 text-sm">
          아직 정리되지 않은 리포트입니다. 위 원문 PDF 를 확인하세요.
        </p>
      )}

      {unusedFigures.length > 0 && <ResearchFigureGallery figures={unusedFigures} />}

      {siblings.length > 0 && (
        <section className="border-border border-t pt-4">
          <h2 className="mb-2 text-sm font-medium">
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
    <Suspense fallback={<p className="text-muted-foreground px-6 py-12 text-sm">불러오는 중…</p>}>
      <ResearchDetailBody {...props} />
    </Suspense>
  );
}

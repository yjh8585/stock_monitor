import logger from '@/lib/logger';
import { CLAUDE_SUMMARY_MODEL, getAnthropicClient } from '@/lib/reports/anthropic';
import { renderPdfPagesToStorage, type PageImage } from '@/lib/reports/pdf-page-renderer';
import { formatRelatedSection, searchRelated } from '@/lib/reports/search.service';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export interface ReportPdfSummaryResult {
  title: string;
  organizationName: string;
  publishedAt: string | null;
  content: string;
  category: string | null;
}

const REPORTS_BUCKET = 'reports';

/**
 * Supabase Storage 의 PDF 를 처리한다.
 *  1) PDF 본문은 Claude PDF Document API 가 직접 읽어 본문 작성
 *  2) 동시에 PDF 의 각 페이지를 PNG 로 렌더해 Storage 에 업로드
 *  3) Claude 가 본문에 ![Page N](URL) 형태로 표·그래프 페이지를 그대로 삽입
 */
export async function analyzeReportPdf(filePath: string): Promise<ReportPdfSummaryResult> {
  const pdfBuffer = await downloadPdfBuffer(filePath);

  // 페이지 이미지 렌더는 LLM 호출과 병렬로 진행.
  const pageImagesPromise = renderPdfPagesToStorage(pdfBuffer, deriveBaseFolder(filePath)).catch(
    (err) => {
      logger.warn({ err }, 'PDF 페이지 렌더 실패 — 이미지 없이 본문만 생성');
      return [] as PageImage[];
    }
  );

  const pageImages = await pageImagesPromise;
  const pdfBase64 = pdfBuffer.toString('base64');
  const summary = await summarizePdf(pdfBase64, pageImages);

  const related = await searchRelated(`${summary.title} ${summary.organizationName}`, 5);
  const content = summary.summaryMarkdown + formatRelatedSection(related);

  return {
    title: summary.title,
    organizationName: summary.organizationName,
    publishedAt: summary.publishedAt,
    content,
    category: summary.category,
  };
}

async function downloadPdfBuffer(filePath: string): Promise<Buffer> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage.from(REPORTS_BUCKET).download(filePath);
  if (error || !data) {
    logger.error({ err: error, filePath }, 'PDF 다운로드 실패');
    throw new Error('PDF 파일을 가져오지 못했습니다.');
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** 페이지 이미지를 같은 폴더 옆에 보관하기 위한 베이스 경로 추출 */
function deriveBaseFolder(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx > 0 ? filePath.slice(0, idx) : 'misc';
}

interface SummarizeOutput {
  title: string;
  organizationName: string;
  publishedAt: string | null;
  summaryMarkdown: string;
  category: string | null;
}

const REPORT_SYSTEM_PROMPT = `당신은 한국어로 작성하는 정책/리서치 큐레이터입니다.
주어진 PDF 보고서를 처음 보는 독자가 빠르게 이해할 수 있도록 충분한 분량으로 정리합니다.

규칙:
1. 출력은 반드시 단일 JSON 객체. 추가 설명 금지.
2. summaryMarkdown 은 Markdown — 헤딩(##, ###), 리스트, 인용을 적극 활용.
3. 본문 첫 부분에 한 줄 핵심 요약을 인용 블록(>)으로 제시한 뒤, 보고서 전체를 한 단락으로 압축한 "들어가며" 섹션을 둔다.
4. 배경/목적 → 주요 분석·주장(여러 섹션) → 시사점·제언 순으로 6~10개 섹션으로 풀어 씁니다.
5. **원본의 표와 그래프를 그대로 본문에 삽입**합니다 — mermaid 등으로 다시 그리지 마세요:
   - 사용자 메시지 끝에 "페이지 이미지 매니페스트" 가 주어집니다. 각 항목은 (페이지 번호, 공개 URL) 입니다.
   - 표/그래프/도식이 들어 있는 페이지는 본문 적절한 섹션에 \`![Page N](URL)\` 형태로 그대로 삽입하세요.
   - 모든 페이지를 다 넣을 필요 없음. 표·그래프·다이어그램이 있는 페이지를 골라 넣으세요. 텍스트만 있는 페이지는 굳이 이미지로 넣지 않습니다.
   - 페이지 이미지를 넣은 직후엔 1~2 단락의 해설을 덧붙입니다.
   - 페이지 이미지가 비어 있으면(매니페스트가 빈 배열이면) 이미지 삽입은 생략하고 텍스트로만 정리합니다.
6. 비교 가능한 수치는 Markdown 표로 함께 정리해도 좋습니다 (페이지 이미지 + 핵심 수치 표).
7. 중요한 수치/주장은 **굵게**, 통계는 단위·기준연도를 함께 명시.
8. 마지막에 ## 핵심 정리 섹션으로 5~8개 불릿 요약. 각 불릿은 1~2문장.
9. organizationName 은 발행 기관/저자, publishedAt 은 yyyy-mm-dd. 모르면 null.
10. category: 다음 목록 중 가장 적합한 것 선택 → ["로봇", "기술", "부품사", "전기차", "자율주행", "시장", "OEM"]. 해당 없으면 짧은 새 키워드 1개.

분량: summaryMarkdown 은 한국어 최소 2,500자 이상. 너무 짧게 끝내지 마세요.`;

async function summarizePdf(pdfBase64: string, pageImages: PageImage[]): Promise<SummarizeOutput> {
  const client = getAnthropicClient();

  const manifest =
    pageImages.length > 0
      ? pageImages.map((p) => `- 페이지 ${p.pageNumber}: ${p.publicUrl}`).join('\n')
      : '(페이지 이미지가 생성되지 않았습니다. 본문을 텍스트로만 정리하세요.)';

  const userText = `이 PDF 보고서를 한국어로 정리해 주세요.

페이지 이미지 매니페스트 (필요한 페이지만 본문에 ![Page N](URL) 으로 삽입):
${manifest}

다음 JSON 스키마에 맞춰 응답:
{
  "title": string,
  "organizationName": string,
  "publishedAt": string|null,
  "summaryMarkdown": string,
  "category": string
}`;

  const response = await client.messages.create({
    model: CLAUDE_SUMMARY_MODEL,
    max_tokens: 16000,
    system: REPORT_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          { type: 'text', text: userText },
        ],
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');

  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as SummarizeOutput;
    return {
      title: parsed.title,
      organizationName: parsed.organizationName,
      publishedAt: parsed.publishedAt ?? null,
      summaryMarkdown: parsed.summaryMarkdown,
      category: parsed.category ?? null,
    };
  } catch (err) {
    logger.error({ err, cleaned }, 'Claude PDF 응답 JSON 파싱 실패');
    throw new Error('Claude PDF 응답을 JSON 으로 파싱할 수 없습니다.');
  }
}

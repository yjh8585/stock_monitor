import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

import logger from '@/lib/logger';
import { CLAUDE_SUMMARY_MODEL, getAnthropicClient } from '@/lib/reports/anthropic';
import { formatRelatedSection, searchRelated } from '@/lib/reports/search.service';

export interface ReportWebSummaryResult {
  title: string;
  organizationName: string;
  publishedAt: string | null;
  content: string;
  reportFileUrl: string | null;
  category: string | null;
}

/**
 * 보고서 웹페이지를 가져와 본문(표·이미지 포함) 을 Markdown 으로 보존하고
 * Claude 가 그 위에 한국어 해설을 입혀 본문을 생성한다.
 */
export async function analyzeReportWebpage(url: string): Promise<ReportWebSummaryResult> {
  logger.info({ url }, '보고서 웹페이지 다운로드');

  const html = await fetchHtml(url);
  const { article, pdfLink, baseUrl } = extractArticle(html, url);

  if (!article || article.bodyMarkdown.trim().length < 100) {
    throw new Error('웹페이지에서 본문을 추출하지 못했습니다.');
  }

  const summary = await summarizeWithClaude({
    sourceUrl: url,
    title: article.title ?? '',
    siteName: article.siteName ?? '',
    byline: article.byline ?? '',
    excerpt: article.excerpt ?? '',
    bodyMarkdown: article.bodyMarkdown.slice(0, 80000),
  });

  const related = await searchRelated(`${summary.title} ${summary.organizationName}`, 5);
  const content = summary.summaryMarkdown + formatRelatedSection(related);

  return {
    title: summary.title,
    organizationName: summary.organizationName,
    publishedAt: summary.publishedAt,
    content,
    reportFileUrl: pdfLink ? new URL(pdfLink, baseUrl).toString() : null,
    category: summary.category,
  };
}

async function fetchHtml(url: string): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://www.marklines.com/en/',
  };

  if (url.includes('marklines.com') && process.env.MARKLINES_COOKIE) {
    headers['Cookie'] = process.env.MARKLINES_COOKIE;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`보고서 페이지 다운로드 실패 (${res.status})`);
  }
  return res.text();
}

interface ArticleResult {
  title: string | null | undefined;
  byline: string | null | undefined;
  siteName: string | null | undefined;
  /** Readability 본문을 Markdown 으로 변환한 결과 (표/이미지 보존) */
  bodyMarkdown: string;
  excerpt: string | null | undefined;
}

function extractArticle(
  html: string,
  baseUrl: string
): { article: ArticleResult | null; pdfLink: string | null; baseUrl: string } {
  let dom: InstanceType<typeof JSDOM>;
  try {
    dom = new JSDOM(html, { url: baseUrl });
  } catch {
    // inline style 속성에 잘못된 CSS(calc 등)가 있을 때 JSDOM이 throw — 제거 후 재시도
    const sanitized = html.replace(/\sstyle="[^"]*"/gi, '');
    dom = new JSDOM(sanitized, { url: baseUrl });
  }
  const document = dom.window.document;

  const pdfLink = findPdfLink(document);

  const reader = new Readability(document, { keepClasses: false });
  const parsed = reader.parse();

  if (!parsed) {
    return { article: null, pdfLink, baseUrl };
  }

  const bodyMarkdown = htmlToMarkdown(parsed.content ?? '', baseUrl);

  return {
    article: {
      title: parsed.title,
      byline: parsed.byline,
      siteName: parsed.siteName,
      bodyMarkdown,
      excerpt: parsed.excerpt,
    },
    pdfLink,
    baseUrl,
  };
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
});
turndown.use(gfm);

/**
 * 본문 HTML 을 Markdown 으로 변환하면서 상대경로 이미지 src 를 절대경로로 보정.
 */
function htmlToMarkdown(html: string, baseUrl: string): string {
  if (!html.trim()) return '';

  const dom = new JSDOM(html, { url: baseUrl });
  const doc = dom.window.document;

  const ensureAbsolute = (raw: string | null) => {
    if (!raw) return null;
    try {
      return new URL(raw, baseUrl).toString();
    } catch {
      return null;
    }
  };

  doc.querySelectorAll('img').forEach((img) => {
    const abs = ensureAbsolute(img.getAttribute('src'));
    if (abs) img.setAttribute('src', abs);
  });
  doc.querySelectorAll('a').forEach((a) => {
    const abs = ensureAbsolute(a.getAttribute('href'));
    if (abs) a.setAttribute('href', abs);
  });

  return turndown.turndown(doc.body.innerHTML);
}

function findPdfLink(document: Document): string | null {
  const candidates = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  for (const a of candidates) {
    const href = a.getAttribute('href') ?? '';
    if (/\.pdf(\?|$)/i.test(href)) return href;
  }
  return null;
}

interface SummarizeInput {
  sourceUrl: string;
  title: string;
  siteName: string;
  byline: string;
  excerpt: string;
  bodyMarkdown: string;
}

interface SummarizeOutput {
  title: string;
  organizationName: string;
  publishedAt: string | null;
  summaryMarkdown: string;
  category: string | null;
}

const REPORT_SYSTEM_PROMPT = `당신은 한국어로 작성하는 정책/리서치 큐레이터입니다.
주어진 보고서 페이지를 처음 보는 독자가 빠르게 이해할 수 있도록 충분한 분량으로 정리합니다.

규칙:
1. 출력은 반드시 단일 JSON 객체. 추가 설명 금지.
2. summaryMarkdown 은 Markdown — 헤딩(##, ###), 리스트, 인용을 적극 활용.
3. 본문 첫 부분에 한 줄 핵심 요약을 인용 블록(>)으로 제시한 뒤, 전체를 한 단락으로 압축한 "들어가며" 섹션을 둔다.
4. 배경/목적 → 주요 분석·주장(여러 섹션) → 시사점·제언 순으로 6~10개 섹션으로 풀어 씁니다.
5. **원본의 표와 이미지를 그대로 본문에 삽입**합니다 — 다시 그리거나 mermaid 로 재구성하지 마세요:
   - 입력으로 주어진 본문 Markdown 안의 \`![alt](URL)\` 이미지는 적절한 위치에 그대로 옮겨 넣습니다.
   - 입력의 Markdown 표(\`| ... |\`) 도 그대로 옮겨 넣습니다.
   - 표/이미지 직후에 1~2 단락의 해설을 덧붙여 의미를 풀어 씁니다.
   - 원본에 표/이미지가 없을 때만, 비교가 필요한 부분에 한해 새 Markdown 표를 작성할 수 있습니다.
6. 중요한 수치/주장은 **굵게**, 통계는 단위·기준연도를 함께 명시.
7. 마지막에 ## 핵심 정리 섹션으로 5~8개 불릿 요약. 각 불릿은 1~2문장.
8. organizationName 은 발행 기관/저자, publishedAt 은 yyyy-mm-dd. 모르면 null.
9. category: 다음 목록 중 가장 적합한 것 선택 → ["로봇", "기술", "부품사", "전기차", "자율주행", "시장", "OEM"]. 해당 없으면 짧은 새 키워드 1개.

분량: summaryMarkdown 은 한국어 최소 2,500자 이상. 너무 짧게 끝내지 마세요.`;

async function summarizeWithClaude(input: SummarizeInput): Promise<SummarizeOutput> {
  const client = getAnthropicClient();

  const userMessage = `다음은 보고서 페이지의 메타정보와 본문(Markdown — 표/이미지 보존)입니다.

원본 URL: ${input.sourceUrl}
페이지 제목: ${input.title}
사이트: ${input.siteName}
저자/바이라인: ${input.byline}
요약: ${input.excerpt}

본문 Markdown:
"""
${input.bodyMarkdown}
"""

요구사항:
- 본문에 등장하는 ![alt](URL) 이미지와 Markdown 표는 적절한 섹션에 **그대로 옮겨 넣어** 사용하세요.
- JSON 스키마:
{
  "title": string,            // 한국어 제목
  "organizationName": string, // 발행기관/저자
  "publishedAt": string|null, // yyyy-mm-dd
  "summaryMarkdown": string,  // Markdown 본문 (원본 표/이미지 포함)
  "category": string          // 카테고리
}`;

  // max_tokens > 약 21000 이면 Anthropic SDK가 스트리밍을 강제하므로 stream() 사용
  const stream = client.messages.stream({
    model: CLAUDE_SUMMARY_MODEL,
    max_tokens: 32000,
    system: REPORT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });
  const response = await stream.finalMessage();

  const text = collectText(response.content);
  return parseJsonOutput(text);
}

interface ContentBlock {
  type: string;
  text?: string;
}

function collectText(content: ContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

function parseJsonOutput(text: string): SummarizeOutput {
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
    logger.warn({ err }, 'Claude 응답 JSON 파싱 실패 — 필드 직접 추출 시도');

    // JSON 잘림 등 파싱 실패 시 정규식으로 핵심 필드 추출
    const title = cleaned.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? '보고서';
    const org = cleaned.match(/"organizationName"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? '';
    const pub = cleaned.match(/"publishedAt"\s*:\s*"([0-9]{4}-[0-9]{2}-[0-9]{2})"/)?.[1] ?? null;

    // summaryMarkdown 값: 키 이후 내용을 전부 사용 (JSON이 잘렸어도 최대한 보존)
    const mdKeyIdx = cleaned.indexOf('"summaryMarkdown"');
    const mdRaw = mdKeyIdx >= 0 ? cleaned.slice(mdKeyIdx + '"summaryMarkdown"'.length) : cleaned;
    const mdContent = mdRaw.replace(/^\s*:\s*"?/, '').replace(/"?\s*\}?\s*$/, '');

    if (!mdContent.trim()) {
      logger.error({ err, cleaned }, 'Claude 응답에서 summaryMarkdown 추출 불가');
      throw new Error('Claude 응답을 파싱할 수 없습니다.');
    }

    const category = cleaned.match(/"category"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? null;
    return {
      title: title.replace(/\\"/g, '"'),
      organizationName: org.replace(/\\"/g, '"'),
      publishedAt: pub,
      summaryMarkdown: mdContent.replace(/\\n/g, '\n').replace(/\\"/g, '"'),
      category: category?.replace(/\\"/g, '"') ?? null,
    };
  }
}

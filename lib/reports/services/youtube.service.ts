import { YoutubeTranscript } from 'youtube-transcript';

import logger from '@/lib/logger';
import { GEMINI_VIDEO_MODEL, getGeminiClient } from '@/lib/reports/gemini';
import { formatRelatedSection, searchRelated } from '@/lib/reports/search.service';
import type { KeyScene } from '@/lib/reports/types';
import { extractYoutubeId } from '@/lib/reports/utils';

const RETRY_DELAY_MS = 32_000;

interface GeminiErrorPayload {
  error?: { code?: number; status?: string; message?: string };
  status?: number;
}

function getErrorPayload(err: unknown): GeminiErrorPayload | null {
  if (!err || typeof err !== 'object') return null;
  const anyErr = err as Record<string, unknown>;
  const status = typeof anyErr.status === 'number' ? (anyErr.status as number) : undefined;
  const errorField = anyErr.error;
  if (errorField && typeof errorField === 'object') {
    return { ...(anyErr as GeminiErrorPayload), status };
  }
  // SDK 가 message 안에 JSON 을 묻혀 던지는 경우
  if (typeof anyErr.message === 'string') {
    try {
      const json = JSON.parse(anyErr.message);
      if (json && typeof json === 'object') {
        return { ...(json as GeminiErrorPayload), status };
      }
    } catch {
      // ignore
    }
  }
  return { status };
}

function isQuotaError(err: unknown): boolean {
  const payload = getErrorPayload(err);
  if (!payload) return false;
  if (payload.error?.code === 429) return true;
  if (payload.status === 429) return true;
  if (payload.error?.status === 'RESOURCE_EXHAUSTED') return true;
  return false;
}

/**
 * Gemini 호출 시 quota(429) 에러를 1회 자동 재시도하고,
 * 그래도 실패하면 사용자 친화적 메시지로 변환한다.
 */
async function callGeminiWithRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isQuotaError(err)) throw err;

    logger.warn({ err, label, retryAfterMs: RETRY_DELAY_MS }, 'Gemini quota 초과 — 잠시 후 재시도');
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

    try {
      return await fn();
    } catch (retryErr) {
      if (isQuotaError(retryErr)) {
        throw new Error(
          'Gemini API 한도가 초과되었습니다. 잠시 후 다시 시도하거나, 더 짧은 영상으로 시도해 주세요. (무료 티어는 분당 입력 토큰 한도가 있어 긴 영상은 처리하지 못할 수 있습니다.)'
        );
      }
      throw retryErr;
    }
  }
}

export interface YoutubeSummaryResult {
  title: string;
  channelName: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  content: string;
  keyScenes: KeyScene[];
}

interface YoutubeMetadata {
  title: string;
  channelName: string;
  thumbnailUrl: string | null;
}

const META_FALLBACK: YoutubeMetadata = {
  title: '제목을 가져오지 못한 영상',
  channelName: '알 수 없음',
  thumbnailUrl: null,
};

const GEMINI_TEXT_MODEL = 'gemini-2.5-flash';

/**
 * 유튜브 영상의 본문을 hybrid 로 생성한다.
 *  1) youtube-transcript 로 무료 자막 추출 시도 (한국어 → 영어 → auto)
 *  2) 실패 시 Gemini Video 로 폴백 (비용/한도 부담)
 *  3) 추출된 스크립트를 Gemini Text 가 한국어 해설 글로 정리
 */
export async function analyzeYoutubeVideo(videoUrl: string): Promise<YoutubeSummaryResult> {
  const youtubeId = extractYoutubeId(videoUrl);
  logger.info({ videoUrl, youtubeId }, '유튜브 처리 시작');

  const meta = await fetchOEmbedMetadata(videoUrl);
  const { text: transcript, source } = await extractTranscriptHybrid(videoUrl);

  if (!transcript || transcript.trim().length < 50) {
    throw new Error('영상에서 스크립트를 추출하지 못했습니다.');
  }

  logger.info({ videoUrl, source, chars: transcript.length }, '스크립트 추출 완료');

  const summaryMarkdown = await rewriteAsArticle({ meta, transcript });

  const related = await searchRelated(`${meta.title} ${meta.channelName}`, 5);
  const content = summaryMarkdown + formatRelatedSection(related);

  return {
    title: meta.title,
    channelName: meta.channelName,
    publishedAt: null,
    thumbnailUrl:
      meta.thumbnailUrl ??
      (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : null),
    content,
    keyScenes: [],
  };
}

/**
 * oEmbed 로 영상 제목/채널/썸네일을 가져온다. 실패해도 흐름을 막지 않도록 fallback.
 */
async function fetchOEmbedMetadata(videoUrl: string): Promise<YoutubeMetadata> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn({ status: res.status, videoUrl }, 'oEmbed 응답 실패');
      return META_FALLBACK;
    }
    const json = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      title: json.title ?? META_FALLBACK.title,
      channelName: json.author_name ?? META_FALLBACK.channelName,
      thumbnailUrl: json.thumbnail_url ?? null,
    };
  } catch (err) {
    logger.warn({ err, videoUrl }, 'oEmbed 호출 오류');
    return META_FALLBACK;
  }
}

const TRANSCRIPT_PROMPT = `이 영상에서 들리는 발화/내레이션을 시간 순서대로 가능한 한 그대로 옮겨 적으세요.
- 요약, 해석, 추가 설명은 하지 말고 자막처럼 들리는 그대로만 작성합니다.
- 한국어 발화는 한국어 그대로, 외국어 발화는 원문을 그대로 적은 뒤 줄바꿈하여 한국어 번역을 덧붙입니다.
- 발화가 없는 구간은 [무음] 또는 짧은 장면 묘사([영상: 동물원 우리 앞]) 정도로만 표시합니다.
- 출력은 plain text 만 사용 — Markdown, 머리말, 번호 매기기 금지.`;

type TranscriptSource = 'captions' | 'gemini';

interface TranscriptResult {
  text: string;
  source: TranscriptSource;
}

/**
 * 1차로 youtube-transcript 의 자막을 시도하고, 실패 시 Gemini Video 로 폴백.
 */
async function extractTranscriptHybrid(videoUrl: string): Promise<TranscriptResult> {
  const captions = await fetchCaptionsText(videoUrl);
  if (captions && captions.length >= 80) {
    return { text: captions, source: 'captions' };
  }

  logger.info({ videoUrl }, '자막을 가져오지 못해 Gemini Video 로 폴백');
  const text = await extractTranscriptViaGemini(videoUrl);
  return { text, source: 'gemini' };
}

/**
 * 한국어 → 영어 → 자동 감지 순으로 자막 추출. 모두 실패하면 빈 문자열.
 */
async function fetchCaptionsText(videoUrl: string): Promise<string> {
  const attempts: Array<{ lang?: string }> = [{ lang: 'ko' }, { lang: 'en' }, {}];
  for (const opts of attempts) {
    try {
      const items = await YoutubeTranscript.fetchTranscript(videoUrl, opts);
      const text = items
        .map((i) => i.text.replace(/\s+/g, ' '))
        .join(' ')
        .trim();
      if (text.length >= 80) {
        logger.debug({ videoUrl, lang: opts.lang ?? 'auto', chars: text.length }, '자막 추출 성공');
        return text;
      }
    } catch (err) {
      logger.debug(
        { err, videoUrl, lang: opts.lang ?? 'auto' },
        '자막 추출 시도 실패, 다음 언어로'
      );
    }
  }
  return '';
}

async function extractTranscriptViaGemini(videoUrl: string): Promise<string> {
  const client = getGeminiClient();
  const response = await callGeminiWithRetry('extractTranscriptViaGemini', () =>
    client.models.generateContent({
      model: GEMINI_VIDEO_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              fileData: {
                fileUri: videoUrl,
                mimeType: 'video/*',
              },
            },
            { text: TRANSCRIPT_PROMPT },
          ],
        },
      ],
      config: {
        temperature: 0,
      },
    })
  );

  return response.text?.trim() ?? '';
}

interface ArticleTarget {
  minChars: number;
  sectionRange: string;
  summaryBullets: string;
  description: string;
}

/**
 * 스크립트 분량(글자 수)에 따라 본문 목표 분량을 동적으로 결정.
 * 짧은 영상엔 짧은 글, 긴 영상엔 긴 글이 자연스러우므로 비례시킨다.
 */
function pickArticleTarget(transcriptChars: number): ArticleTarget {
  if (transcriptChars < 800) {
    return {
      minChars: 1200,
      sectionRange: '4~6개',
      summaryBullets: '3~5개',
      description: '짧은 영상 (대략 1~3분 분량)',
    };
  }
  if (transcriptChars < 3000) {
    return {
      minChars: 2500,
      sectionRange: '6~8개',
      summaryBullets: '5~7개',
      description: '보통 길이 영상 (대략 4~10분 분량)',
    };
  }
  if (transcriptChars < 8000) {
    return {
      minChars: 5000,
      sectionRange: '8~12개',
      summaryBullets: '6~9개',
      description: '긴 영상 (대략 10~25분 분량)',
    };
  }
  return {
    minChars: 8000,
    sectionRange: '10~15개',
    summaryBullets: '7~10개',
    description: '매우 긴 영상 (25분 이상)',
  };
}

function buildArticleSystemPrompt(target: ArticleTarget): string {
  return `당신은 한국어로 작성하는 심층 콘텐츠 큐레이터입니다.
주어진 유튜브 영상 스크립트를 바탕으로, 영상을 보지 않은 독자도 핵심을 완전히 이해할 수 있는 깊이 있는 해설 글을 작성합니다.

분량 규칙 (가장 중요):
- 영상 분량 추정: ${target.description}.
- **본문 길이는 최소 한국어 ${target.minChars.toLocaleString()}자 이상.**
- 영상에서 다룬 양에 비례해 충분히 풀어 씁니다. 짧은 영상을 억지로 늘리거나, 긴 영상을 너무 짧게 압축하지 않습니다.
- "더 알고 싶다면", "이상으로", "이 정도면 충분" 같은 자기 검열·축약 표현 금지.
- 분량을 채우기 위한 의미 없는 반복 금지. 같은 주제의 다른 측면을 충분히 다룹니다.

구성 규칙:
1. 출력은 Markdown 본문만. 머리말, 메타 설명, "이 글은…" 같은 자기소개 금지.
2. 본문 첫 부분에 한 줄 핵심 요약을 인용 블록(>)으로 제시한 뒤, 영상 전체를 한 단락(150~250자)으로 압축한 "들어가며" 섹션을 둔다.
3. 영상의 흐름을 따라 **본문 섹션 ${target.sectionRange}**로 나눕니다. 각 섹션은 ## 헤딩 + 본문 2~4개 단락(또는 5~10개 불릿) + 필요 시 ### 하위 헤딩으로 구성.
4. 각 섹션은 다음 흐름으로 자세히 풉니다:
   (a) 영상에서 어떤 맥락에서 등장한 이야기인지
   (b) 화자가 한 말/제시한 사례/근거를 그대로 인용 또는 풀어쓰기
   (c) 그 의미·시사점, 그리고 일반 독자가 알아야 할 배경 지식 보강
5. 중요한 수치/주장/인용은 **굵게** 표시. 통계나 인용은 반드시 출처(영상 화자)를 함께 명시.
6. 영상에 직접 등장하지 않은 배경 정보(개념 설명, 관련 사건, 산업 맥락 등)는 일반 상식을 동원해 적극 보강합니다. 다만 영상에서 한 말과 보강 정보는 명확히 구분해 서술합니다 (예: "영상에서는 ~라고 설명한다", "참고로 ~").
7. 영어/외래어 고유명사는 한국어 발음 + (영문) 으로 표기.
8. 마지막에 ## 핵심 정리 섹션을 두고 ${target.summaryBullets}의 불릿으로 정리. 각 불릿은 한 문장이 아니라 1~2문장으로 충분히 풉니다.
9. 그 뒤에 ## 더 깊이 생각해볼 점 섹션을 두고 영상이 던지는 질문 또는 후속 논의거리를 3~5개 불릿으로 제시합니다.

스타일:
- 단조로운 "~합니다" 반복 대신 다양한 어미 사용. 단호한 결론은 단정형, 해석은 추정형으로.
- 단락은 너무 짧지 않게. 한 단락은 보통 3~6문장.

표·다이어그램 활용:
- 비교, 통계, 항목 나열은 Markdown 표(\`| 헤더 | 헤더 |\`)로 정리하면 이해가 쉬워집니다.
- 절차/관계/구조/시계열 등은 \`\`\`mermaid\`\`\` 코드 블록으로 표현 가능합니다 (flowchart, sequenceDiagram, pie, xychart-beta, timeline 등).
- 표나 다이어그램을 사용했으면, 그 바로 뒤에 1~2 단락의 해설을 덧붙이세요.`;
}

async function rewriteAsArticle(input: {
  meta: YoutubeMetadata;
  transcript: string;
}): Promise<string> {
  const client = getGeminiClient();
  const target = pickArticleTarget(input.transcript.length);
  const systemPrompt = buildArticleSystemPrompt(target);

  logger.info(
    {
      transcriptChars: input.transcript.length,
      minChars: target.minChars,
      description: target.description,
    },
    '본문 분량 가이드 결정'
  );

  const userPrompt = `영상 제목: ${input.meta.title}
채널: ${input.meta.channelName}

스크립트(${input.transcript.length.toLocaleString()}자):
"""
${input.transcript}
"""

위 스크립트를 바탕으로 본문을 작성하세요.`;

  // 출력 토큰은 목표 글자 수의 약 2배(한국어 1자 ≈ 0.7~1 토큰) + 여유로 잡는다
  const maxOutputTokens = Math.min(65535, Math.max(8192, target.minChars * 3));

  const response = await callGeminiWithRetry('rewriteAsArticle', () =>
    client.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.55,
        maxOutputTokens,
      },
    })
  );

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Gemini 가 본문을 생성하지 못했습니다.');
  }
  return text;
}

/**
 * 네이버 종목토론 글의 LLM 감성 분류 (Claude Sonnet 4.6).
 *
 * - 글 N개를 묶어 1회 호출. tool_use로 JSON 형식 강제.
 * - 시스템 프롬프트에 cache_control 적용해 후속 호출 재사용.
 * - 욕설/광고/스팸은 'neutral'로 분류해 노이즈 격리.
 */
import { getAnthropicClient } from '@/lib/reports/anthropic';
import logger from '@/lib/logger';

export const SENTIMENT_MODEL = 'claude-sonnet-4-6';

export interface PostForAnalysis {
  postId: string;
  title: string;
  body?: string | null;
}

export interface SentimentResult {
  postId: string;
  label: 'positive' | 'negative' | 'neutral';
  score: number;
  reason: string;
}

const SYSTEM_PROMPT = `당신은 한국 주식 개인투자자 게시판(네이버 금융 종목토론) 글의 감성을 분류하는 분석가입니다.

각 글에 대해 다음 규칙으로 분류합니다.
- positive: 주가 상승/실적 호조/긍정적 모멘텀에 대한 기대, 매수 신호 언급
- negative: 주가 하락/실적 부진 우려, 손절/매도 의도, 부정적 사건 언급
- neutral: 정보 공유/질문/잡담/시세 단순 언급/욕설/광고/스팸/판단 불가

score는 -1.0(매우 부정) ~ +1.0(매우 긍정). 욕설·광고·의미 없는 글은 0.
reason은 한 문장 내(50자 이내), 분류 근거를 한국어로.

반드시 classify_sentiments 도구를 1회 호출해 결과를 반환하세요.`;

const TOOL = {
  name: 'classify_sentiments',
  description: '입력 글마다 감성 라벨/점수/근거를 반환',
  input_schema: {
    type: 'object' as const,
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            post_id: { type: 'string' },
            label: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
            score: { type: 'number', minimum: -1, maximum: 1 },
            reason: { type: 'string', maxLength: 100 },
          },
          required: ['post_id', 'label', 'score', 'reason'],
        },
      },
    },
    required: ['results'],
  },
};

function buildUserContent(posts: PostForAnalysis[]): string {
  return posts
    .map(
      (p, i) =>
        `[${i + 1}] post_id=${p.postId}\n제목: ${p.title}\n본문: ${(p.body ?? '').slice(0, 800)}`
    )
    .join('\n\n---\n\n');
}

/**
 * 글 배열을 1회 LLM 호출로 분류. 호출 실패 시 빈 배열 반환 (cron이 다음 회차에 재시도).
 */
export async function classifyPosts(posts: PostForAnalysis[]): Promise<SentimentResult[]> {
  if (posts.length === 0) return [];
  const client = getAnthropicClient();
  try {
    const resp = await client.messages.create({
      model: SENTIMENT_MODEL,
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'classify_sentiments' },
      messages: [
        {
          role: 'user',
          content: buildUserContent(posts),
        },
      ],
    });
    const block = resp.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      logger.warn({ posts: posts.length }, '감성 분석 응답에 tool_use 없음');
      return [];
    }
    const input = block.input as { results?: unknown };
    if (!Array.isArray(input?.results)) return [];
    const validated: SentimentResult[] = [];
    for (const r of input.results) {
      if (
        r &&
        typeof r === 'object' &&
        'post_id' in r &&
        'label' in r &&
        'score' in r &&
        'reason' in r &&
        ['positive', 'negative', 'neutral'].includes((r as { label: string }).label)
      ) {
        const rec = r as { post_id: string; label: string; score: number; reason: string };
        validated.push({
          postId: rec.post_id,
          label: rec.label as SentimentResult['label'],
          score: Math.max(-1, Math.min(1, Number(rec.score))),
          reason: String(rec.reason).slice(0, 200),
        });
      }
    }
    return validated;
  } catch (err) {
    logger.error({ err, postsCount: posts.length }, '감성 분석 호출 실패');
    return [];
  }
}

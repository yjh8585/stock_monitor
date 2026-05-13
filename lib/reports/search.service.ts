import logger from '@/lib/logger';
import { serverEnv } from '@/lib/reports/env';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

/** Tavily 검색 API 호출. API key 미설정 시 빈 배열 반환 (옵션 기능). */
export async function searchRelated(query: string, maxResults = 5): Promise<TavilyResult[]> {
  const apiKey = serverEnv.tavilyApiKey();
  if (!apiKey) {
    logger.debug({ query }, 'Tavily API key 미설정 — 검색 건너뜀');
    return [];
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: 'basic',
        topic: 'general',
        include_answer: false,
      }),
    });

    if (!res.ok) {
      logger.warn({ status: res.status, query }, 'Tavily 검색 실패');
      return [];
    }

    const json = (await res.json()) as TavilyResponse;
    return json.results ?? [];
  } catch (err) {
    logger.warn({ err, query }, 'Tavily 검색 오류');
    return [];
  }
}

/** Tavily 검색 결과를 Markdown 섹션으로 변환. */
export function formatRelatedSection(results: TavilyResult[]): string {
  if (results.length === 0) return '';
  const lines = ['', '---', '', '## 관련 자료', ''];
  for (const r of results) {
    const snippet = r.content.length > 150 ? `${r.content.slice(0, 150)}…` : r.content;
    lines.push(`- [${r.title}](${r.url}) — ${snippet}`);
  }
  return lines.join('\n');
}

// 공식 문서·뉴스 요약 조회 순수 함수 시험(B-7) — 가짜 회사 · 숫자는 임의.
import { describe, expect, it } from 'vitest';
import {
  parseLines,
  parseLinks,
  parsePages,
  pickRecentImportant,
  toDocSummary,
  toNewsWeek,
  type DocSummary,
} from './summaries';

function doc(p: Partial<DocSummary>): DocSummary {
  return {
    docId: 1,
    docType: 'presentation',
    title: '가나자동차 3분기 발표 자료',
    url: 'https://example.com/a.pdf',
    publishedAt: '2026-11-01',
    importance: 'high',
    importanceReason: '전망 상향',
    lines: ['한 줄'],
    pages: [],
    ...p,
  };
}

describe('pickRecentImportant', () => {
  const today = '2026-11-12';

  it('30일 안의 high 만 — 30일 밖 high 와 mid 는 무시', () => {
    const docs = [
      doc({ docId: 1, publishedAt: '2026-10-12', importance: 'high' }), // 31일 전
      doc({ docId: 2, publishedAt: '2026-11-10', importance: 'mid' }),
      doc({ docId: 3, publishedAt: '2026-10-13', importance: 'high' }), // 30일 전 — 포함
    ];
    expect(pickRecentImportant(docs, today)?.docId).toBe(3);
    expect(pickRecentImportant(docs.slice(0, 2), today)).toBeNull();
  });

  it('가장 최근 · 같은 날이면 docId 큰 것', () => {
    const docs = [
      doc({ docId: 5, publishedAt: '2026-11-05' }),
      doc({ docId: 9, publishedAt: '2026-11-08' }),
      doc({ docId: 7, publishedAt: '2026-11-08' }),
    ];
    expect(pickRecentImportant(docs, today)?.docId).toBe(9);
  });

  it('미래 날짜·빈 목록은 고르지 않는다 · days 인자', () => {
    expect(pickRecentImportant([doc({ publishedAt: '2026-11-13' })], today)).toBeNull();
    expect(pickRecentImportant([], today)).toBeNull();
    expect(pickRecentImportant([doc({ publishedAt: '2026-11-01' })], today, 7)).toBeNull();
  });
});

describe('parse 방어', () => {
  it('parseLines — 배열 안 문자열만 · 빈 줄 제외 · 배열 아니면 빈 배열', () => {
    expect(parseLines(['가', '', 3, ' 나 ', null])).toEqual(['가', '나']);
    expect(parseLines('가')).toEqual([]);
    expect(parseLines(null)).toEqual([]);
  });

  it('parsePages — page 정수·caption 문자열만 · key 는 버린다 · 쪽 순서', () => {
    const got = parsePages([
      { page: 11, caption: '연간 전망', key: 'x/1/11.png' },
      { page: 3, caption: '분기 요약', key: 'x/1/3.png' },
      { page: '4', caption: '문자 쪽' },
      { page: 0, caption: '0쪽' },
      { page: 5 },
      'bad',
    ]);
    expect(got).toEqual([
      { page: 3, caption: '분기 요약' },
      { page: 11, caption: '연간 전망' },
    ]);
    expect(JSON.stringify(got)).not.toContain('key');
    expect(parsePages({ page: 1 })).toEqual([]);
  });

  it('parseLinks — http(s) url·제목이 있는 것만 · news_id 는 버린다', () => {
    expect(
      parseLinks([
        { news_id: 'uuid-a', title: '기사 A', url: 'https://a', source: '매체' },
        { title: '기사 B', url: 'javascript:alert(1)', source: null },
        { title: '', url: 'https://c' },
        { title: '기사 D', url: 'http://d' },
      ])
    ).toEqual([
      { title: '기사 A', url: 'https://a', source: '매체' },
      { title: '기사 D', url: 'http://d', source: null },
    ]);
    expect(parseLinks(undefined)).toEqual([]);
  });
});

describe('행 → 화면 형', () => {
  it('toDocSummary — 문서 메타가 없거나 줄이 없으면 null · 중요도 밖 값은 low', () => {
    const meta = {
      doc_type: 'presentation',
      title: 'T',
      url: 'https://u',
      published_at: '2026-11-01',
    };
    const base = {
      doc_id: 4,
      importance: 'high',
      importance_reason: '이유',
      lines: ['한 줄'],
      pages: [{ page: 2, caption: 'c', key: 'k' }],
    };
    expect(toDocSummary({ ...base, customer_documents: meta })).toEqual({
      docId: 4,
      docType: 'presentation',
      title: 'T',
      url: 'https://u',
      publishedAt: '2026-11-01',
      importance: 'high',
      importanceReason: '이유',
      lines: ['한 줄'],
      pages: [{ page: 2, caption: 'c' }],
    });
    expect(toDocSummary({ ...base, customer_documents: null })).toBeNull();
    expect(toDocSummary({ ...base, lines: [], customer_documents: meta })).toBeNull();
    expect(
      toDocSummary({ ...base, importance: 'urgent', customer_documents: meta })?.importance
    ).toBe('low');
  });

  it('toNewsWeek — 줄이 없으면 null', () => {
    expect(toNewsWeek({ week_start: '2026-11-02', lines: ['가'], links: [] })).toEqual({
      weekStart: '2026-11-02',
      lines: ['가'],
      links: [],
    });
    expect(toNewsWeek({ week_start: '2026-11-02', lines: [], links: [] })).toBeNull();
  });
});

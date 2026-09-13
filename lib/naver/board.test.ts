import { describe, expect, it } from 'vitest';

import { parseListPayload, parseReactionsPayload, parseWrittenAt } from './board';

/**
 * 2026-09-12 네이버 개편으로 옛 HTML 파서가 **조용히 0건**을 내고 나흘을 잃었다.
 * 새 JSON 경로에서 같은 종류의 침묵이 되풀이되지 않도록 못 박는다.
 *
 * 픽스처는 실물 응답에서 뽑았다(한세엠케이 069640, 2026-09-13 채취).
 * 본문 JSON(`contentJsonSwReplaced`)은 글 하나에 2KB 넘게 붙어 오므로 뺐다 —
 * 파서가 안 쓰는 필드다.
 */
const LIST_PAYLOAD = {
  offset: '-9223372036854775807',
  pageSize: 3,
  lastOffset: '-429108744',
  posts: [
    {
      id: '429293678',
      orderNo: '-429293678',
      discussionType: 'domesticStock',
      itemCode: '069640',
      itemName: '한세엠케이',
      postType: 'normal',
      writtenAt: '2026-09-11T15:18:37',
      title: '이런주식을  왜 상장시켜놓는거지?',
      contentSwReplacedButImg:
        '오너들 왜이걸 상장폐지 안시키려고 바락하냐 유통주식도 거래량도없는데',
      // 🔴 목록은 이 셋이 늘 0 이다. 진짜 값은 reactions 에만 있다.
      viewCount: 0,
      recommendCount: 0,
      notRecommendCount: 0,
      commentCount: 0,
      replyDepth: 0,
      parentId: null,
    },
    {
      id: '429084008',
      orderNo: '-429084008',
      postType: 'itemNewsPrice',
      writtenAt: '2026-09-08T12:08:11',
      title: '5% 이상 하락했어요 😞',
      contentSwReplacedButImg: '',
      viewCount: 0,
      recommendCount: 0,
      notRecommendCount: 0,
    },
    {
      id: '429108744',
      orderNo: '-429108744',
      postType: 'normal',
      writtenAt: '2026-09-08T16:39:55',
      title: 'AI로 떠들썩한데 한심한 사람들',
      contentSwReplacedButImg: '본문',
      viewCount: 0,
      recommendCount: 0,
      notRecommendCount: 0,
    },
  ],
};

const REACTIONS_PAYLOAD = [
  {
    postId: '429293678',
    recommendCount: 3,
    notRecommendCount: 1,
    recommended: false,
    notRecommended: false,
    viewCount: 18,
    reactionId: null,
  },
  {
    postId: '429108744',
    recommendCount: 2,
    notRecommendCount: 1,
    viewCount: 82,
    reactionId: null,
  },
];

describe('parseWrittenAt', () => {
  it('표준시가 안 붙은 작성시각을 KST 로 읽는다', () => {
    // 🔴 KST 15:18 은 UTC 06:18 이다. +09:00 을 안 붙이면 GHA(UTC)에서 9시간 밀린다.
    expect(parseWrittenAt('2026-09-11T15:18:37')?.toISOString()).toBe('2026-09-11T06:18:37.000Z');
  });

  it('초가 없어도 읽는다', () => {
    expect(parseWrittenAt('2026-09-11T15:18')?.toISOString()).toBe('2026-09-11T06:18:00.000Z');
  });

  it('형식이 어긋나거나 문자열이 아니면 null', () => {
    expect(parseWrittenAt('2026.09.11 15:18')).toBeNull();
    expect(parseWrittenAt(null)).toBeNull();
    expect(parseWrittenAt(undefined)).toBeNull();
  });
});

describe('parseListPayload', () => {
  it('사람이 쓴 글만 남기고 네이버 자동 글은 거른다', () => {
    const { items, rawCount } = parseListPayload(LIST_PAYLOAD);
    expect(rawCount).toBe(3);
    expect(items.map((p) => p.postId)).toEqual(['429293678', '429108744']);
    // 🔴 itemNews* 는 `excludesItemNews=true` 로도 안 걸러진다(실측) — 여기서 막는다.
    expect(items.some((p) => p.title.includes('5% 이상'))).toBe(false);
  });

  it('itemNews 종류가 늘어도 막는다 — normal 만 통과', () => {
    const { items } = parseListPayload({
      posts: [{ ...LIST_PAYLOAD.posts[0], postType: 'itemNewsSomethingNew' }],
    });
    expect(items).toHaveLength(0);
  });

  it('rawCount 는 거르기 전 건수라 「자동 글뿐」과 「API 가 비었다」를 가른다', () => {
    const onlyBots = { ...LIST_PAYLOAD, posts: [LIST_PAYLOAD.posts[1]] };
    const bots = parseListPayload(onlyBots);
    expect(bots.items).toHaveLength(0);
    expect(bots.rawCount).toBe(1); // 구조는 멀쩡하다 — exit 3 대상이 아니다

    const empty = parseListPayload({ ...LIST_PAYLOAD, posts: [] });
    expect(empty.rawCount).toBe(0); // 이쪽이 구조 변경 의심 — 호출부가 exit 3 을 낸다
  });

  it('목록의 조회수·공감은 0 으로 둔다(reactions 가 채운다)', () => {
    const { items } = parseListPayload(LIST_PAYLOAD);
    expect(items[0]).toMatchObject({ views: 0, likes: 0, dislikes: 0 });
  });

  it('본문과 제목을 담는다', () => {
    const { items } = parseListPayload(LIST_PAYLOAD);
    expect(items[0].title).toBe('이런주식을  왜 상장시켜놓는거지?');
    expect(items[0].body).toContain('상장폐지');
  });

  it('본문이 비면 body 는 null', () => {
    const { items } = parseListPayload({
      posts: [{ ...LIST_PAYLOAD.posts[0], contentSwReplacedButImg: '   ' }],
    });
    expect(items[0].body).toBeNull();
  });

  it('다음 쪽 커서는 lastOffset 을 쓰고, 없으면 마지막 글의 orderNo 로 떨어진다', () => {
    expect(parseListPayload(LIST_PAYLOAD).nextOffset).toBe('-429108744');
    const noLast = { posts: LIST_PAYLOAD.posts };
    expect(parseListPayload(noLast).nextOffset).toBe('-429108744');
  });

  it('빈 목록은 커서 없이 0건', () => {
    const { items, rawCount, nextOffset } = parseListPayload({ posts: [], lastOffset: '' });
    expect(items).toHaveLength(0);
    expect(rawCount).toBe(0);
    expect(nextOffset).toBeNull();
  });

  it('작성시각이 깨진 글은 버린다', () => {
    const { items } = parseListPayload({
      posts: [{ ...LIST_PAYLOAD.posts[0], writtenAt: '어제' }],
    });
    expect(items).toHaveLength(0);
  });

  // 🔴 구조가 또 바뀌면 0건이 아니라 예외여야 한다 — 그래야 exit 3 으로 드러난다.
  it('posts 배열이 없으면 던진다', () => {
    expect(() => parseListPayload({})).toThrow(/구조 변경/);
    expect(() => parseListPayload(null)).toThrow(/구조 변경/);
    expect(() => parseListPayload('<!DOCTYPE html>')).toThrow(/구조 변경/);
  });
});

describe('parseReactionsPayload', () => {
  it('postId 로 조회수·공감·비공감을 편다', () => {
    const m = parseReactionsPayload(REACTIONS_PAYLOAD);
    expect(m.get('429293678')).toEqual({ views: 18, likes: 3, dislikes: 1 });
    expect(m.get('429108744')).toEqual({ views: 82, likes: 2, dislikes: 1 });
  });

  it('reactions 로 감싼 형태도 읽는다', () => {
    const m = parseReactionsPayload({ reactions: REACTIONS_PAYLOAD });
    expect(m.get('429293678')?.views).toBe(18);
  });

  it('값이 없거나 숫자가 아니면 0', () => {
    const m = parseReactionsPayload([{ postId: '1', viewCount: null }]);
    expect(m.get('1')).toEqual({ views: 0, likes: 0, dislikes: 0 });
  });

  it('모양이 어긋나면 빈 Map(반응은 부가 정보라 글을 죽이지 않는다)', () => {
    expect(parseReactionsPayload(null).size).toBe(0);
    expect(parseReactionsPayload({ oops: 1 }).size).toBe(0);
  });
});

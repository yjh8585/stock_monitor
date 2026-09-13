/**
 * 네이버 종목토론 수집기.
 *
 * 2026-09-12 네이버 금융이 Next.js 로 개편되면서 옛 HTML 목록
 * (`finance.naver.com/item/board.naver`)이 사라졌다 — 같은 URL 이 HTTP 200 에
 * `_next/static` 만 든 껍데기를 돌려주므로 cheerio 파서가 **조용히 0건**을 냈다.
 * 개편 뒤의 실제 데이터 경로는 `stock.naver.com` 의 JSON API 다.
 *
 *  - 목록: /api/community/discussion/posts/by-item?discussionType=domesticStock&itemCode=<코드>
 *  - 반응: /api/community/discussion/posts/reactions?postIds=<쉼표 구분>
 *
 * 실측으로 확인한 주의점 두 가지:
 *  1. **목록의 `viewCount`·`recommendCount`·`notRecommendCount` 는 전부 0 이다.**
 *     진짜 값은 `reactions` 에만 있어서, 안 부르면 조회수·공감이 통째로 0 으로 적재된다.
 *  2. **네이버가 만든 자동 글(`itemNews*`)이 섞여 온다**("5% 이상 하락했어요 😞").
 *     최근 100건 기준 15~30% 다. 투자자 심리가 아니라 주가를 기계적으로 따라가는 글이라
 *     감성 분석 입력으로 부적절하다 → **수집 단계에서 거른다**(사용자 결정 2026-09-14).
 *     🔴 `excludesItemNews=true` 파라미터는 **무시되므로**(실측 차이 0건) `postType` 으로
 *     직접 걸러야 한다.
 *     ⚠️ 옛 HTML 게시판은 이 글을 함께 실었고 **DB 에 109건이 남아 있다**(2026-03~09).
 *     그 구간만 범위가 다르다는 뜻이다 — 시계열을 견줄 때 감안할 것.
 *
 * 정책: 페이지 요청 사이 1.5초 sleep. 종목당 cutoff(기본 7일) 또는 maxPages 중
 * 먼저 도달하는 쪽까지 수집.
 */
const API_BASE = 'https://stock.naver.com/api/community/discussion';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  Accept: 'application/json',
  Referer: 'https://stock.naver.com/',
} as const;

/** 목록 한 번에 받을 글 수. 200 은 400 Bad Request 라 100 이 상한이다. */
const PAGE_SIZE = 100;
/** 반응 조회 한 번에 넣을 postId 개수(네이버 화면 자신이 30개씩 묶어 부른다). */
const REACTION_CHUNK = 30;
const SLEEP_MS = 1_500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface NaverBoardPost {
  postId: string;
  postedAt: Date;
  title: string;
  body: string | null;
  views: number;
  likes: number;
  dislikes: number;
}

interface ListItem extends NaverBoardPost {
  /** 다음 쪽 요청에 쓰는 커서. 네이버가 내려준 문자열을 그대로 쓴다. */
  orderNo: string;
}

interface RawPost {
  id?: unknown;
  orderNo?: unknown;
  postType?: unknown;
  title?: unknown;
  writtenAt?: unknown;
  contentSwReplacedButImg?: unknown;
}

interface RawReaction {
  postId?: unknown;
  viewCount?: unknown;
  recommendCount?: unknown;
  notRecommendCount?: unknown;
}

/**
 * 사람이 쓴 글인가. 네이버 자동 글은 `itemNewsPrice`·`itemNewsDisclosure`·`itemNewsResearch`
 * 처럼 `itemNews` 로 시작한다 — 종류가 더 늘 수 있어 `normal` 만 통과시킨다.
 */
function isUserPost(postType: unknown): boolean {
  return postType === 'normal';
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * `2026-09-11T15:18:37` 처럼 표준시가 안 붙어 오는 작성시각을 KST 로 읽는다.
 * 🔴 `+09:00` 을 안 붙이면 Node 가 서버 지역시로 해석해 9시간이 밀린다(GHA 는 UTC).
 */
export function parseWrittenAt(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 목록 응답을 글 배열 + 다음 쪽 커서로 바꾼다.
 * @throws 응답에 `posts` 배열이 없으면 — 구조가 또 바뀐 것이라 조용히 넘기지 않는다.
 */
export function parseListPayload(payload: unknown): {
  items: ListItem[];
  rawCount: number;
  nextOffset: string | null;
} {
  const obj = payload as { posts?: unknown; lastOffset?: unknown } | null;
  if (!obj || !Array.isArray(obj.posts)) {
    throw new Error('네이버 종목토론 목록 응답에 posts 배열이 없다 — 구조 변경 의심');
  }
  const raw = obj.posts as RawPost[];
  const items: ListItem[] = [];
  for (const p of raw) {
    if (!isUserPost(p.postType)) continue;
    const postId = typeof p.id === 'string' ? p.id : String(p.id ?? '');
    const postedAt = parseWrittenAt(p.writtenAt);
    if (!postId || !postedAt) continue;
    const content = typeof p.contentSwReplacedButImg === 'string' ? p.contentSwReplacedButImg : '';
    items.push({
      postId,
      orderNo: String(p.orderNo ?? ''),
      postedAt,
      title: typeof p.title === 'string' ? p.title.trim() : '',
      body: content.trim().slice(0, 2000) || null,
      // 목록은 이 셋이 늘 0 이다 — reactions 로 덮어쓴다.
      views: 0,
      likes: 0,
      dislikes: 0,
    });
  }
  const last = raw.length > 0 ? raw[raw.length - 1] : null;
  const nextOffset =
    typeof obj.lastOffset === 'string' && obj.lastOffset
      ? obj.lastOffset
      : last && last.orderNo != null
        ? String(last.orderNo)
        : null;
  return { items, rawCount: raw.length, nextOffset };
}

/** 반응 응답을 postId → {views, likes, dislikes} 로 편다. */
export function parseReactionsPayload(
  payload: unknown
): Map<string, { views: number; likes: number; dislikes: number }> {
  const arr = Array.isArray(payload)
    ? (payload as RawReaction[])
    : Array.isArray((payload as { reactions?: unknown })?.reactions)
      ? ((payload as { reactions: unknown[] }).reactions as RawReaction[])
      : [];
  const out = new Map<string, { views: number; likes: number; dislikes: number }>();
  for (const r of arr) {
    const id = typeof r.postId === 'string' ? r.postId : String(r.postId ?? '');
    if (!id) continue;
    out.set(id, {
      views: toNumber(r.viewCount),
      likes: toNumber(r.recommendCount),
      dislikes: toNumber(r.notRecommendCount),
    });
  }
  return out;
}

function listUrl(code: string, offset: string | null): string {
  const q = new URLSearchParams({
    discussionType: 'domesticStock',
    itemCode: code,
    isHolderOnly: 'false',
    excludesItemNews: 'false',
    isItemNewsOnly: 'false',
    isCleanbotPassedOnly: 'false',
    pageSize: String(PAGE_SIZE),
  });
  if (offset) q.set('offset', offset);
  return `${API_BASE}/posts/by-item?${q.toString()}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: HEADERS, cache: 'no-store' });
  if (!r.ok) throw new Error(`네이버 ${r.status} ${url}`);
  return r.json();
}

/** 조회수·공감·비공감을 채운다(목록엔 0 으로 오므로 이 단계가 없으면 통째로 0 이다). */
async function fillReactions(items: ListItem[]): Promise<void> {
  for (let i = 0; i < items.length; i += REACTION_CHUNK) {
    const chunk = items.slice(i, i + REACTION_CHUNK);
    const url = `${API_BASE}/posts/reactions?postIds=${chunk.map((p) => p.postId).join('%2C')}`;
    let map: Map<string, { views: number; likes: number; dislikes: number }>;
    try {
      map = parseReactionsPayload(await fetchJson(url));
    } catch {
      // 반응 조회는 부가 정보다 — 실패해도 글 자체는 살린다(값은 0 으로 남는다).
      continue;
    }
    for (const p of chunk) {
      const hit = map.get(p.postId);
      if (!hit) continue;
      p.views = hit.views;
      p.likes = hit.likes;
      p.dislikes = hit.dislikes;
    }
  }
}

/**
 * 종목 코드의 종목토론 글을 수집한다.
 * @param code 6자리 종목코드
 * @param sinceDays 최근 N일치만 수집 (기본 7)
 * @param maxPages 목록 요청 횟수 cap (기본 10 · 한 번에 100건)
 * @param fetchBody true면 본문도 담는다. 개편 뒤엔 본문이 목록 응답에 함께 오므로
 *   **추가 요청이 없다**(옛 구조에선 글당 1회 더 받아야 해서 기본으로 껐었다).
 * @returns `posts` 는 사람이 쓴 cutoff 안쪽 글만(네이버 자동 글 `itemNews*` 제외).
 *   `rawCount` 는 **거르기 전** 네이버가 내려준 글 수다 — 호출부가 「글이 없다」와
 *   「API 가 빈 배열을 준다(=또 개편)」를 가르는 데 쓴다. 🔴 이 구분이 없어서
 *   2026-09-12 개편 때 종목토론 수집이 나흘 동안 조용히 멈춰 있었다.
 */
export async function fetchNaverBoardPosts(
  code: string,
  sinceDays = 7,
  maxPages = 10,
  fetchBody = false
): Promise<{ posts: NaverBoardPost[]; rawCount: number }> {
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60_000);
  const collected: NaverBoardPost[] = [];
  let offset: string | null = null;
  let rawTotal = 0;

  for (let page = 0; page < maxPages; page++) {
    const { items, rawCount, nextOffset } = parseListPayload(
      await fetchJson(listUrl(code, offset))
    );
    rawTotal += rawCount;
    if (rawCount === 0) break;

    const fresh = items.filter((it) => it.postedAt >= cutoff);
    await fillReactions(fresh);
    for (const it of fresh) {
      collected.push({
        postId: it.postId,
        postedAt: it.postedAt,
        title: it.title,
        body: fetchBody ? it.body : null,
        views: it.views,
        likes: it.likes,
        dislikes: it.dislikes,
      });
    }

    // 이 쪽에 cutoff 보다 오래된 글이 있으면 더 볼 필요가 없다(최신순 정렬).
    if (fresh.length < items.length || !nextOffset) break;
    offset = nextOffset;
    await sleep(SLEEP_MS);
  }
  return { posts: collected, rawCount: rawTotal };
}

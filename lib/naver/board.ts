/**
 * 네이버 금융 종목토론실 스크래퍼.
 *
 * URL 패턴:
 *  - 목록: https://finance.naver.com/item/board.naver?code=069640&page=1
 *  - 본문: https://finance.naver.com/item/board_read.naver?code=069640&nid=<id>
 *
 * 정책:
 *  - User-Agent + Referer 필수, 페이지 요청 사이 1.5초 sleep.
 *  - 종목당 cutoff(기본 7일) 또는 maxPages(기본 10) 중 먼저 도달하는 쪽까지 수집.
 *  - 글이 cutoff 안쪽이면 본문도 fetch (본문 fetch 사이도 sleep).
 */
import * as cheerio from 'cheerio';
import * as iconv from 'iconv-lite';

const BASE = 'https://finance.naver.com';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  Referer: 'https://finance.naver.com/',
} as const;

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

interface ListItem {
  postId: string;
  postedAt: Date;
  title: string;
  views: number;
  likes: number;
  dislikes: number;
}

function parseKoreanDateTime(s: string): Date | null {
  // 네이버 표시: '2026.05.15 10:23' (KST)
  const m = s.trim().match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseInt0(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s.replace(/[^0-9-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: HEADERS, cache: 'no-store' });
  if (!r.ok) throw new Error(`네이버 ${r.status} ${url}`);
  const buf = await r.arrayBuffer();
  // Content-Type charset 기반 동적 디코딩. 네이버 금융은 과거 EUC-KR이었지만 현재는
  // UTF-8(2026-05 확인). 향후 다시 바뀔 수 있으니 응답 헤더를 우선 신뢰.
  const ct = r.headers.get('content-type') ?? '';
  const m = ct.match(/charset=([^;\s]+)/i);
  const charset = (m ? m[1] : 'utf-8').toLowerCase();
  if (charset === 'utf-8' || charset === 'utf8') {
    return Buffer.from(buf).toString('utf-8');
  }
  // euc-kr/cp949 등 비-UTF-8은 iconv-lite로 디코딩 (Node small ICU 의존성 회피).
  return iconv.decode(Buffer.from(buf), charset);
}

function parseListPage(html: string): ListItem[] {
  // fetchText가 이미 cp949 → UTF-8 디코딩한 string이라 cheerio가 정상 처리.
  const $ = cheerio.load(html, { xml: false });
  const items: ListItem[] = [];
  $('table.type2 tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 6) return;
    const titleA = $(tds[1]).find('a');
    const href = titleA.attr('href') ?? '';
    const m = href.match(/nid=(\d+)/);
    if (!m) return;
    const postId = m[1];
    const dateRaw = $(tds[0]).text();
    const titleRaw = titleA.text();
    const postedAt = parseKoreanDateTime(dateRaw);
    if (!postedAt) return;
    items.push({
      postId,
      postedAt,
      title: titleRaw.trim(),
      views: parseInt0($(tds[3]).text()),
      likes: parseInt0($(tds[4]).text()),
      dislikes: parseInt0($(tds[5]).text()),
    });
  });
  return items;
}

function parseBodyPage(html: string): string | null {
  const $ = cheerio.load(html);
  const body = $('#body, .view_se, table.view_box td.view_se').first();
  if (body.length === 0) {
    return $('body').text().trim().slice(0, 2000) || null;
  }
  return body.text().trim().slice(0, 2000) || null;
}

/**
 * 종목 코드의 종목토론 글을 수집.
 * @param code 6자리 종목코드
 * @param sinceDays 최근 N일치만 수집 (기본 7)
 * @param maxPages 페이지 cap (기본 10)
 * @param fetchBody true면 본문도 가져옴 (false면 제목·메타만). 기본 false:
 *   현 네이버 board_read 구조에서 parseBodyPage 선택자가 본문을 못 잡고 페이지
 *   인라인 JS를 긁어와, 감성 분석은 제목만 사용한다(본문 불필요). 본문 fetch는
 *   글당 추가 요청·sleep만 유발하므로 끈다.
 */
export async function fetchNaverBoardPosts(
  code: string,
  sinceDays = 7,
  maxPages = 10,
  fetchBody = false
): Promise<NaverBoardPost[]> {
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60_000);
  const collected: NaverBoardPost[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/item/board.naver?code=${code}&page=${page}`;
    const html = await fetchText(url);
    const items = parseListPage(html);
    if (items.length === 0) break;

    let stopAfterThisPage = false;
    for (const it of items) {
      if (it.postedAt < cutoff) {
        stopAfterThisPage = true;
        continue;
      }
      let body: string | null = null;
      if (fetchBody) {
        await sleep(SLEEP_MS);
        const readUrl = `${BASE}/item/board_read.naver?code=${code}&nid=${it.postId}`;
        try {
          const detail = await fetchText(readUrl);
          body = parseBodyPage(detail);
        } catch {
          body = null;
        }
      }
      collected.push({ ...it, body });
    }

    if (stopAfterThisPage) break;
    await sleep(SLEEP_MS);
  }
  return collected;
}

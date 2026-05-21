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
  // 네이버는 EUC-KR/CP949 사용 — Buffer로 받아 cheerio에서 자동 감지
  const buf = await r.arrayBuffer();
  // 한국어 페이지는 메타 charset이 cp949이지만 fetch는 기본 UTF-8 해석 → 직접 디코딩
  // Node 22+에서 TextDecoder('euc-kr') 미지원이라 cheerio가 메타로 감지하도록 latin1 디코딩 후 byte 보존
  return Buffer.from(buf).toString('latin1');
}

function parseListPage(html: string): ListItem[] {
  const $ = cheerio.load(html, { xml: false });
  // EUC-KR로 받은 byte를 latin1로 디코딩했으므로 본문은 그대로 byte 보존
  // cheerio는 attr 추출만 하기에 한글 깨짐 영향 없음
  const items: ListItem[] = [];
  $('table.type2 tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 6) return;
    const titleA = $(tds[1]).find('a');
    const href = titleA.attr('href') ?? '';
    const m = href.match(/nid=(\d+)/);
    if (!m) return;
    const postId = m[1];
    const dateRaw = decodeLatinToUtf8($(tds[0]).text());
    const titleRaw = decodeLatinToUtf8(titleA.text());
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

/** latin1로 디코딩한 byte 문자열을 EUC-KR(CP949)로 재해석 → UTF-8 문자열.
 *  Node 기본 ICU(small)는 'euc-kr' 미지원이라 TextDecoder가 throw하고 fallback에서
 *  원본 byte를 그대로 반환 → 한글 깨짐(U+FFFD). iconv-lite는 ICU와 무관하게 작동.
 *  CP949는 EUC-KR 상위호환이라 네이버 응답도 안전하게 디코딩 가능. */
function decodeLatinToUtf8(s: string): string {
  const bytes = Buffer.alloc(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return iconv.decode(bytes, 'cp949');
}

function parseBodyPage(html: string): string | null {
  const $ = cheerio.load(html);
  const body = $('#body, .view_se, table.view_box td.view_se').first();
  if (body.length === 0) {
    return decodeLatinToUtf8($('body').text()).trim().slice(0, 2000) || null;
  }
  return decodeLatinToUtf8(body.text()).trim().slice(0, 2000) || null;
}

/**
 * 종목 코드의 종목토론 글을 수집.
 * @param code 6자리 종목코드
 * @param sinceDays 최근 N일치만 수집 (기본 7)
 * @param maxPages 페이지 cap (기본 10)
 * @param fetchBody true면 본문도 가져옴 (false면 제목·메타만 — cron 빈도 줄일 때)
 */
export async function fetchNaverBoardPosts(
  code: string,
  sinceDays = 7,
  maxPages = 10,
  fetchBody = true
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

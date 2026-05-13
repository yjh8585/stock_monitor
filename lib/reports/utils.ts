/**
 * 보고서 페이지 전용 유틸. shadcn cn() 은 `@/lib/utils` 사용.
 */

/** 초 단위 시간을 mm:ss 또는 hh:mm:ss 로 포맷. */
export function formatTimestamp(totalSec: number): string {
  const seconds = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const YT_PATTERNS = [
  /[?&]v=([\w-]{11})/,
  /youtu\.be\/([\w-]{11})/,
  /youtube\.com\/embed\/([\w-]{11})/,
  /youtube\.com\/shorts\/([\w-]{11})/,
];

/** 다양한 형태의 유튜브 URL 에서 video ID 추출. */
export function extractYoutubeId(url: string): string | null {
  for (const pattern of YT_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

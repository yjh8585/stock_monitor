import { promises as dnsPromises } from 'node:dns';
import { isIP } from 'node:net';

/**
 * 외부 보고서 URL에 대한 SSRF·쿠키 유출 가드.
 * - http(s) 스킴만 허용
 * - 사설망/loopback/메타데이터 IP 차단 (DNS 해석 결과까지 검사)
 * - MarkLines 쿠키는 hostname 정확 매칭일 때만 첨부
 */

const MARKLINES_HOST = 'www.marklines.com';

export class UnsafeReportUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeReportUrlError';
  }
}

/** URL을 파싱하고 안전성을 검증한 뒤 반환한다. 실패 시 한국어 에러 throw. */
export async function assertSafeReportUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeReportUrlError('유효하지 않은 URL 형식입니다.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeReportUrlError(`허용되지 않은 프로토콜: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw new UnsafeReportUrlError('호스트명이 비어 있습니다.');
  }

  // 1) 호스트명이 곧 IP literal이면 즉시 검사
  const ipKind = isIP(hostname);
  if (ipKind !== 0) {
    if (isBlockedIp(hostname, ipKind)) {
      throw new UnsafeReportUrlError(`내부망/예약 IP 호출은 차단됩니다: ${hostname}`);
    }
    return parsed;
  }

  // 2) localhost/0.0.0.0 같은 알려진 위험 호스트명 차단
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UnsafeReportUrlError(`내부 호스트 호출은 차단됩니다: ${hostname}`);
  }

  // 3) DNS 해석 결과의 모든 IP가 공인 범위인지 확인
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new UnsafeReportUrlError(`호스트명을 확인할 수 없습니다: ${hostname} (${message})`);
  }

  for (const { address, family } of addresses) {
    if (isBlockedIp(address, family)) {
      throw new UnsafeReportUrlError(
        `호스트 ${hostname}가 내부망 IP(${address})로 해석됩니다.`
      );
    }
  }

  return parsed;
}

/** MarkLines 도메인일 때만 쿠키를 첨부해야 한다. (path/query에 문자열만 들어가도 통과하는 includes 회피) */
export function shouldAttachMarklinesCookie(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === MARKLINES_HOST || host.endsWith(`.${MARKLINES_HOST.replace(/^www\./, '')}`);
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  '0',
  '0.0.0.0',
]);

function isBlockedIp(address: string, family: number | string): boolean {
  const fam = typeof family === 'string' ? Number(family) : family;
  if (fam === 4 || isIP(address) === 4) {
    return isBlockedIpv4(address);
  }
  if (fam === 6 || isIP(address) === 6) {
    return isBlockedIpv6(address);
  }
  return false;
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast / reserved (224.0.0.0/4, 240.0.0.0/4)
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;

  // IPv4-mapped (::ffff:1.2.3.4) → IPv4 검사로 위임
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  // fc00::/7 (unique local), fe80::/10 (link-local) — prefix 검사
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true; // fe80::/10
  if (normalized.startsWith('ff')) return true; // multicast ff00::/8

  return false;
}

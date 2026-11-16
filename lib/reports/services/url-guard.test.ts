import { describe, expect, it } from 'vitest';

import { assertSafeReportUrl, isMarklinesHost, UnsafeReportUrlError } from './url-guard';

describe('MarkLines 주소 차단 (2026-11-16 약관 7조 9항 확약)', () => {
  it.each([
    'marklines.com',
    'www.marklines.com',
    'WWW.MarkLines.com',
    'data.marklines.com',
    'www.marklines.com.',
  ])('%s 는 MarkLines 호스트다', (host) => {
    expect(isMarklinesHost(host)).toBe(true);
  });

  it.each(['notmarklines.com', 'marklines.com.evil.example', 'example.com'])(
    '%s 는 아니다',
    (host) => {
      expect(isMarklinesHost(host)).toBe(false);
    }
  );

  it('보고서 URL 검사가 DNS 조회 전에 거절한다', async () => {
    await expect(
      assertSafeReportUrl('https://www.marklines.com/en/report/123')
    ).rejects.toBeInstanceOf(UnsafeReportUrlError);
    await expect(assertSafeReportUrl('http://marklines.com/')).rejects.toThrow(/MarkLines/);
  });
});

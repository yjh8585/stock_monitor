/**
 * companies 입력 스키마 단위 테스트 — pure 함수, mocking 없음.
 */
import { describe, expect, it } from 'vitest';
import { createCompanyInputSchema } from './schemas';

const validInput = {
  ticker: '005380',
  name: 'Hyundai Mobis',
  name_kr: '현대모비스',
  country: 'KR',
  currency: 'KRW',
  data_source: 'fnguide',
  market: 'kospi',
} as const;

describe('createCompanyInputSchema', () => {
  it('필수 필드 통과 + company_type/status DEFAULT', () => {
    const parsed = createCompanyInputSchema.safeParse(validInput);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.company_type).toBe('부품사');
      expect(parsed.data.status).toBe('active');
    }
  });

  it('ticker 누락 → 실패', () => {
    const { ticker: _ticker, ...rest } = validInput;
    void _ticker;
    const parsed = createCompanyInputSchema.safeParse(rest);
    expect(parsed.success).toBe(false);
  });

  it('country enum 외 값 → 실패', () => {
    const parsed = createCompanyInputSchema.safeParse({ ...validInput, country: 'ZZ' });
    expect(parsed.success).toBe(false);
  });

  it('data_source enum 외 값 → 실패', () => {
    const parsed = createCompanyInputSchema.safeParse({ ...validInput, data_source: 'random' });
    expect(parsed.success).toBe(false);
  });

  it('market null 허용 (비상장)', () => {
    const parsed = createCompanyInputSchema.safeParse({ ...validInput, market: null });
    expect(parsed.success).toBe(true);
  });

  it('market 미지정 (optional) → 통과', () => {
    const { market: _market, ...rest } = validInput;
    void _market;
    const parsed = createCompanyInputSchema.safeParse(rest);
    expect(parsed.success).toBe(true);
  });

  it('ticker trim 적용', () => {
    const parsed = createCompanyInputSchema.safeParse({ ...validInput, ticker: '  005380  ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.ticker).toBe('005380');
  });

  it('company_type OEM 명시 → 그대로 통과', () => {
    const parsed = createCompanyInputSchema.safeParse({ ...validInput, company_type: 'OEM' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.company_type).toBe('OEM');
  });

  it('status는 active만 허용', () => {
    const parsed = createCompanyInputSchema.safeParse({ ...validInput, status: 'hidden' });
    expect(parsed.success).toBe(false);
  });
});

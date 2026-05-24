/**
 * companies 마스터 테이블 입력 검증 — Zod SSOT.
 *
 * `/management/companies` 폼과 `/api/companies` POST 핸들러가 모두 본 스키마로 검증.
 * 트리거(`companies_auto_page_mapping`, `companies_normalize_*`)가 INSERT 후 자동
 * 처리하므로, products/customers/homepage_url 등은 enrich_company에 위임 — 폼에서 받지 않음.
 */
import { z } from 'zod';

/** 지원 국가 — companies.country (NOT NULL). 추가 시 enum 확장. */
export const COUNTRIES = [
  'KR', 'US', 'JP', 'CN', 'DE', 'GB', 'HK', 'FR', 'IT', 'SE', 'IN', 'MX', 'TW', 'TH', 'VN',
] as const;

/** 지원 통화 — companies.currency (NOT NULL). */
export const CURRENCIES = [
  'KRW', 'USD', 'EUR', 'JPY', 'HKD', 'GBP', 'CNY', 'SEK', 'INR', 'MXN', 'TWD', 'THB', 'VND',
] as const;

/**
 * 수집 소스 — companies.data_source (NOT NULL).
 * 트리거가 이걸로 page 자동 매핑:
 *   yfinance/marklines → parts-top100
 *   fnguide/dart/pykrx+dart → domestic
 *   ELSE → 매핑 없음 (사용자 수동)
 */
export const DATA_SOURCES = ['yfinance', 'fnguide', 'dart', 'marklines', 'pykrx+dart'] as const;

/** companies.company_type — OEM/부품사. DB default '부품사'. */
export const COMPANY_TYPES = ['OEM', '부품사'] as const;

/**
 * companies.market 자유 입력 — 비상장은 NULL.
 * 자주 쓰는 값: kospi, kosdaq, nasdaq, nyse, xetra, tse, hkex, lse, sse, szse, twse, set, ...
 */

export const createCompanyInputSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, 'ticker 필수')
    .max(50)
    .describe('6자리 KR 코드, 글로벌 ticker, 또는 비상장 식별자 (예: "한국지엠")'),
  name: z.string().trim().min(1, '영문 회사명 필수').max(100),
  name_kr: z.string().trim().min(1, '한국어 회사명 필수').max(100),
  country: z.enum(COUNTRIES, { message: '국가 enum 외 값' }),
  currency: z.enum(CURRENCIES, { message: '통화 enum 외 값' }),
  data_source: z.enum(DATA_SOURCES, { message: 'data_source enum 외 값' }),
  market: z
    .string()
    .trim()
    .max(20)
    .nullable()
    .optional()
    .describe('상장 시장 (소문자). 비상장은 비워두면 NULL.'),
  company_type: z.enum(COMPANY_TYPES).default('부품사'),
  region: z.string().trim().max(50).optional().describe('Asia, North America 등'),
  group_name: z.string().trim().max(50).optional().describe('현대차, 삼성, 도요타 등'),
  status: z.literal('active').default('active'),
});

export type CreateCompanyInput = z.infer<typeof createCompanyInputSchema>;

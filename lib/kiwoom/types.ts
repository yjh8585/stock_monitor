/**
 * 키움 REST API 응답 zod 스키마 + 도메인 타입.
 * 실제 키움 REST 응답 필드명(stck_prpr 등)은 발급 후 문서 기준으로 fromKiwoomQuote에서 매핑.
 */
import { z } from 'zod';

export interface KiwoomQuote {
  ticker: string;
  price: number;
  changePct: number | null;
  volume: number | null;
  ts: Date;
}

export interface KiwoomInvestorTrend {
  ticker: string;
  tradeDate: string;
  foreignNet: number | null;
  institutionNet: number | null;
  individualNet: number | null;
  programNet: number | null;
}

export interface KiwoomClient {
  getQuote(ticker: string): Promise<KiwoomQuote>;
  getInvestorTrend(ticker: string, tradeDate: string): Promise<KiwoomInvestorTrend>;
}

export const KiwoomTokenResponse = z.object({
  token: z.string().min(10),
  token_type: z.string().default('Bearer'),
  expires_dt: z.string().min(8),
});

export type KiwoomTokenResponseT = z.infer<typeof KiwoomTokenResponse>;

export const KiwoomQuoteRawSchema = z.object({
  stk_cd: z.string().optional(),
  stck_prpr: z.union([z.string(), z.number()]).optional(),
  prdy_ctrt: z.union([z.string(), z.number()]).optional(),
  acml_vol: z.union([z.string(), z.number()]).optional(),
});

export const KiwoomInvestorTrendRawSchema = z.object({
  stk_cd: z.string().optional(),
  date: z.string().optional(),
  frgn_ntby_qty: z.union([z.string(), z.number()]).optional(),
  orgn_ntby_qty: z.union([z.string(), z.number()]).optional(),
  prsn_ntby_qty: z.union([z.string(), z.number()]).optional(),
  pgm_ntby_qty: z.union([z.string(), z.number()]).optional(),
});

export function toNumberOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[+,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

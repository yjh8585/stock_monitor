/**
 * 키움 REST API 클라이언트 (한세 대시보드용).
 *
 * - getKiwoomClient(): KIWOOM_USE_MOCK 환경변수로 Mock/Real 분기.
 * - access_token은 Supabase kiwoom_tokens 테이블에 캐싱(만료 5분 전 갱신).
 * - 토큰버킷 1초 5건 + 5xx 재시도 1회.
 *
 * NOTE: 실제 키움 REST 엔드포인트(api-id, 응답 필드명)는 https://openapi.kiwoom.com 발급 후
 * 안내된 문서에 따라 fetchQuote / fetchInvestorTrend 내부를 채워야 한다.
 * 현재 구현은 OAuth + 일반적인 호출 패턴까지만 잡아두었고, TR 호출 부분은 명시적 TODO.
 */
import { z } from 'zod';
import logger from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  KiwoomInvestorTrendRawSchema,
  KiwoomQuoteRawSchema,
  KiwoomTokenResponse,
  toNumberOrNull,
  type KiwoomClient,
  type KiwoomInvestorTrend,
  type KiwoomQuote,
} from '@/lib/kiwoom/types';
import { MockKiwoomClient } from '@/lib/kiwoom/mock';

const TOKEN_REFRESH_BEFORE_MS = 5 * 60_000;
const BUCKET_WINDOW_MS = 1_000;
const BUCKET_MAX = 5;

class TokenBucket {
  private timestamps: number[] = [];
  async take(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < BUCKET_WINDOW_MS);
    if (this.timestamps.length >= BUCKET_MAX) {
      const wait = BUCKET_WINDOW_MS - (now - this.timestamps[0]) + 10;
      await new Promise((r) => setTimeout(r, wait));
      return this.take();
    }
    this.timestamps.push(Date.now());
  }
}

function parseKiwoomExpiry(expiresDt: string): Date {
  // 키움 토큰 만료 형식: 'YYYYMMDDHHmmss' (KST)
  const m = expiresDt.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) {
    logger.warn({ expiresDt }, 'kiwoom expires_dt 파싱 실패, 23시간 후로 가정');
    return new Date(Date.now() + 23 * 60 * 60_000);
  }
  // KST(UTC+9)로 해석
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`;
  return new Date(iso);
}

class RealKiwoomClient implements KiwoomClient {
  private bucket = new TokenBucket();
  private memToken: { token: string; expiresAt: Date } | null = null;

  private get baseUrl(): string {
    return process.env.KIWOOM_BASE_URL ?? 'https://api.kiwoom.com';
  }
  private get appKey(): string {
    const v = process.env.KIWOOM_APP_KEY;
    if (!v) throw new Error('KIWOOM_APP_KEY 미설정');
    return v;
  }
  private get appSecret(): string {
    const v = process.env.KIWOOM_APP_SECRET;
    if (!v) throw new Error('KIWOOM_APP_SECRET 미설정');
    return v;
  }

  /** 캐시 우선 토큰 조회. DB → 메모리 → 신규 발급 순. */
  private async getAccessToken(): Promise<string> {
    const now = new Date();
    if (
      this.memToken &&
      this.memToken.expiresAt.getTime() - now.getTime() > TOKEN_REFRESH_BEFORE_MS
    ) {
      return this.memToken.token;
    }

    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from('kiwoom_tokens')
      .select('access_token,expires_at')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      logger.error({ err: error }, 'kiwoom_tokens 조회 실패');
    } else if (
      data &&
      new Date(data.expires_at as string).getTime() - now.getTime() > TOKEN_REFRESH_BEFORE_MS
    ) {
      this.memToken = {
        token: data.access_token as string,
        expiresAt: new Date(data.expires_at as string),
      };
      return this.memToken.token;
    }

    return this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<string> {
    await this.bucket.take();
    const r = await fetch(`${this.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: this.appKey,
        secretkey: this.appSecret,
      }),
      cache: 'no-store',
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      logger.error({ status: r.status, text }, 'kiwoom OAuth 토큰 발급 실패');
      throw new Error(`Kiwoom OAuth ${r.status}`);
    }
    const json = await r.json();
    const parsed = KiwoomTokenResponse.safeParse(json);
    if (!parsed.success) {
      logger.error({ err: parsed.error, json }, 'kiwoom OAuth 응답 스키마 불일치');
      throw new Error('Kiwoom OAuth schema mismatch');
    }
    const expiresAt = parseKiwoomExpiry(parsed.data.expires_dt);
    this.memToken = { token: parsed.data.token, expiresAt };

    const sb = createSupabaseAdminClient();
    const { error } = await sb
      .from('kiwoom_tokens')
      .upsert({ id: 1, access_token: parsed.data.token, expires_at: expiresAt.toISOString() });
    if (error) logger.error({ err: error }, 'kiwoom_tokens upsert 실패');
    return parsed.data.token;
  }

  /** 5xx 1회 재시도 + 지수 백오프. 4xx는 즉시 throw. */
  private async fetchWithRetry(path: string, init: RequestInit, apiId: string): Promise<unknown> {
    await this.bucket.take();
    const token = await this.getAccessToken();
    const headers = {
      ...(init.headers as Record<string, string>),
      authorization: `Bearer ${token}`,
      appkey: this.appKey,
      secretkey: this.appSecret,
      'api-id': apiId,
      'content-type': 'application/json;charset=UTF-8',
    };

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`${this.baseUrl}${path}`, { ...init, headers, cache: 'no-store' });
        if (r.ok) return r.json();
        if (r.status >= 500 && attempt === 0) {
          await new Promise((res) => setTimeout(res, 250 * Math.pow(2, attempt)));
          continue;
        }
        const text = await r.text().catch(() => '');
        throw new Error(`Kiwoom ${apiId} ${r.status}: ${text.slice(0, 200)}`);
      } catch (e) {
        lastErr = e;
        if (attempt === 0) {
          await new Promise((res) => setTimeout(res, 250));
          continue;
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Kiwoom unknown error');
  }

  async getQuote(ticker: string): Promise<KiwoomQuote> {
    // TODO: 키움 REST 문서에서 현재가 조회 api-id와 path/body를 확인 후 채우기.
    //  예: api-id 'ka10001' (주식기본정보), POST /api/dostk/stkinfo, body { stk_cd }
    const raw = await this.fetchWithRetry(
      '/api/dostk/stkinfo',
      { method: 'POST', body: JSON.stringify({ stk_cd: ticker }) },
      'ka10001'
    );
    const data = extractKiwoomData(raw, KiwoomQuoteRawSchema);
    return {
      ticker,
      price: toNumberOrNull(data.stck_prpr) ?? 0,
      changePct: toNumberOrNull(data.prdy_ctrt),
      volume: toNumberOrNull(data.acml_vol),
      ts: new Date(),
    };
  }

  async getInvestorTrend(ticker: string, tradeDate: string): Promise<KiwoomInvestorTrend> {
    // TODO: 키움 REST 문서에서 투자자별 매매동향 api-id 확인 후 채우기.
    const raw = await this.fetchWithRetry(
      '/api/dostk/inv',
      { method: 'POST', body: JSON.stringify({ stk_cd: ticker, date: tradeDate }) },
      'ka10059'
    );
    const data = extractKiwoomData(raw, KiwoomInvestorTrendRawSchema);
    return {
      ticker,
      tradeDate,
      foreignNet: toNumberOrNull(data.frgn_ntby_qty),
      institutionNet: toNumberOrNull(data.orgn_ntby_qty),
      individualNet: toNumberOrNull(data.prsn_ntby_qty),
      programNet: toNumberOrNull(data.pgm_ntby_qty),
    };
  }
}

/** 키움 응답 wrapper에서 본문 필드를 꺼내 zod 검증. 응답 구조 변형에 유연하게 대응. */
function extractKiwoomData<T extends z.ZodTypeAny>(raw: unknown, schema: T): z.infer<T> {
  const candidates: unknown[] = [];
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    candidates.push(obj);
    if (Array.isArray(obj.output)) candidates.push(obj.output[0]);
    if (obj.output && typeof obj.output === 'object') candidates.push(obj.output);
  }
  for (const c of candidates) {
    const r = schema.safeParse(c);
    if (r.success) return r.data;
  }
  logger.warn({ raw }, 'kiwoom 응답 파싱 실패 — 빈 객체 반환');
  return schema.parse({});
}

let _client: KiwoomClient | null = null;

/** 환경변수에 따라 Mock/Real 클라이언트를 반환. 싱글턴. */
export function getKiwoomClient(): KiwoomClient {
  if (_client) return _client;
  if (process.env.KIWOOM_USE_MOCK === 'true') {
    logger.info('KIWOOM_USE_MOCK=true → Mock 클라이언트 사용');
    _client = new MockKiwoomClient();
  } else {
    _client = new RealKiwoomClient();
  }
  return _client;
}

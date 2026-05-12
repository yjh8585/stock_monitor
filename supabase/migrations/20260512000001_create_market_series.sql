-- 기타 섹션(환율 확장·원자재·경제·운임) 일봉 시계열 + 메타 + 미국경제 전망 메모
-- 1) market_series_daily : 일봉 시계열
-- 2) market_series       : 차트 메타(라벨·단위·출처·yf_symbol·카테고리)
-- 3) macro_outlook_notes : 미국 경제 전망 수동 메모

CREATE TABLE IF NOT EXISTS market_series_daily (
  series_code text NOT NULL,
  trade_date  date NOT NULL,
  close       numeric NOT NULL,
  PRIMARY KEY (series_code, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_market_series_daily_code_date
  ON market_series_daily (series_code, trade_date DESC);

ALTER TABLE market_series_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_market_series_daily"
  ON market_series_daily FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_market_series_daily"
  ON market_series_daily FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS market_series (
  series_code text PRIMARY KEY,
  label       text NOT NULL,
  unit        text NOT NULL,             -- 'USD', 'USD/MT', '%', 'pt', 'KRW' 등
  source      text NOT NULL,             -- 'Yahoo Finance', 'placeholder' 등
  yf_symbol   text,                      -- NULL이면 수집 대상 아님 (placeholder)
  category    text NOT NULL,             -- 'fx_extra' | 'commodity' | 'economy' | 'shipping'
  sort_order  int  NOT NULL DEFAULT 0
);

ALTER TABLE market_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_market_series"
  ON market_series FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_market_series"
  ON market_series FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS macro_outlook_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_date  date NOT NULL,
  source     text NOT NULL,              -- 'WMT', 'TGT', 'FOMC', 'JPM' 등
  summary    text NOT NULL,
  sentiment  text,                       -- 'bullish' | 'neutral' | 'bearish' (nullable)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_macro_outlook_notes_date
  ON macro_outlook_notes (note_date DESC);

ALTER TABLE macro_outlook_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_macro_outlook_notes"
  ON macro_outlook_notes FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_macro_outlook_notes"
  ON macro_outlook_notes FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- market_series 시드 (23행)
-- UST2Y는 yfinance에 정확한 2년물 시계열이 없어 ^IRX(13주물)로 대용. 후속 PR에서 FRED DGS2 등으로 교체 예정.
-- ============================================================
INSERT INTO market_series (series_code, label, unit, source, yf_symbol, category, sort_order) VALUES
  ('DXY',       '달러 인덱스 (DXY)',         'pt',            'Yahoo Finance', 'DX-Y.NYB', 'fx_extra',  10),
  ('EURUSD',    'EUR/USD',                   'USD',           'Yahoo Finance', 'EURUSD=X', 'fx_extra',  20),

  ('ALU',       '알루미늄 (LME 3M)',         'USD/MT',        'Yahoo Finance', 'ALI=F',    'commodity', 10),
  ('COPPER',    '구리 (COMEX High Grade)',   'USD/lb',        'Yahoo Finance', 'HG=F',     'commodity', 20),
  ('STEEL_KR',  '국내 철강 (열연)',          'KRW/MT',        'placeholder',   NULL,       'commodity', 30),
  ('HRC',       'Steel HRC (미국)',          'USD/short ton', 'Yahoo Finance', 'HRC=F',    'commodity', 40),
  ('LIT',       '리튬 ETF (LIT)',            'USD',           'Yahoo Finance', 'LIT',      'commodity', 50),
  ('WTI',       '원유 WTI',                  'USD/bbl',       'Yahoo Finance', 'CL=F',     'commodity', 60),
  ('BRENT',     '원유 Brent',                'USD/bbl',       'Yahoo Finance', 'BZ=F',     'commodity', 70),
  ('DUBAI',     '원유 Dubai',                'USD/bbl',       'placeholder',   NULL,       'commodity', 80),

  ('UST10Y',    '미국 국채 10년',            '%',             'Yahoo Finance', '^TNX',     'economy',   10),
  ('UST2Y',     '미국 국채 2년 (대용: 13주)','%',             'Yahoo Finance', '^IRX',     'economy',   11),
  ('KOSPI',     '코스피',                    'pt',            'Yahoo Finance', '^KS11',    'economy',   20),
  ('KOSDAQ',    '코스닥',                    'pt',            'Yahoo Finance', '^KQ11',    'economy',   30),
  ('SPX',       'S&P 500',                  'pt',            'Yahoo Finance', '^GSPC',    'economy',   40),
  ('IXIC',      '나스닥',                    'pt',            'Yahoo Finance', '^IXIC',    'economy',   50),
  ('GOLD',      '금',                       'USD/oz',        'Yahoo Finance', 'GC=F',     'economy',   60),
  ('SILVER',    '은',                       'USD/oz',        'Yahoo Finance', 'SI=F',     'economy',   70),

  ('SCFI',      'SCFI (Shanghai Containerized Freight Index)', 'pt', 'placeholder', NULL, 'shipping',  10),
  ('KCCI',      'KCCI (Korea Container Index)',                'pt', 'placeholder', NULL, 'shipping',  20),
  ('KUWI',      'KUWI (KCCI 미주서안 세부)',                   'pt', 'placeholder', NULL, 'shipping',  30)
ON CONFLICT (series_code) DO UPDATE SET
  label      = EXCLUDED.label,
  unit       = EXCLUDED.unit,
  source     = EXCLUDED.source,
  yf_symbol  = EXCLUDED.yf_symbol,
  category   = EXCLUDED.category,
  sort_order = EXCLUDED.sort_order;

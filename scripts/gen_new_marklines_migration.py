"""31개 신규 회사 마이그레이션 SQL 자동 생성."""
import json
from pathlib import Path

data = json.load(open(Path(__file__).parent / '_new_marklines_classified.json', encoding='utf-8'))
EXCLUDED_RANKS = {27, 80}  # Hanon Systems(우리 018880), SL Corporation(우리 005850)
new = [c for c in data if c['ml_rank'] not in EXCLUDED_RANKS]

def esc(s):
  return (s or '').replace("'", "''")

lines = [
  '-- marklines top100 신규 회사 31개 + parts-top100 매핑',
  '-- LLM 분류 결과 기반 (scripts/_new_marklines_classified.json)',
  '-- false positive 제외: Hanon Systems (우리 018880), SL Corporation (우리 005850)',
  'BEGIN;',
  '',
  '-- 31개 신규 회사 INSERT',
]

for c in new:
  ticker = esc(c['ticker'])
  name = esc(c['name'])
  name_kr = esc(c['name_kr'])
  country = esc(c['country'])
  currency = esc(c['currency'])
  market_v = 'NULL' if not c.get('market') else f"'{esc(c['market'])}'"
  ds = esc(c['data_source'])
  ct = esc(c['company_type'])
  lines.append(
    f"INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) "
    f"VALUES ('{ticker}', '{name}', '{name_kr}', '{country}', '{currency}', {market_v}, '{ds}', 'active', '{ct}') "
    f"ON CONFLICT (ticker) DO NOTHING;"
  )

lines += [
  '',
  '-- parts-top100 페이지 매핑 (신규 31개)',
]
ticker_list = ','.join(f"'{esc(c['ticker'])}'" for c in new)
lines.append(
  f"INSERT INTO company_pages (company_id, page) "
  f"SELECT id, 'parts-top100' FROM companies WHERE ticker IN ({ticker_list}) "
  f"ON CONFLICT DO NOTHING;"
)

lines += [
  '',
  '-- 기존 회사 (한온/에스엘) parts-top100 매핑 보강 (이미 있을 수 있음)',
  "INSERT INTO company_pages (company_id, page) "
  "SELECT id, 'parts-top100' FROM companies WHERE ticker IN ('018880','005850') "
  "ON CONFLICT DO NOTHING;",
  '',
  'COMMIT;',
]

out = Path(__file__).parent.parent / 'supabase' / 'migrations' / '20260509000003_seed_marklines_top100_new.sql'
out.write_text('\n'.join(lines), encoding='utf-8')
print(f'마이그레이션 → {out}')
print(f'신규 회사 {len(new)}개')
print()
print('=== 마이그레이션 미리보기 (첫 25행) ===')
for ln in lines[:25]:
  print(ln)

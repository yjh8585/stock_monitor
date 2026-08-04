-- financials.source 백필 (2026-08-04)
--
-- 배경: collect_uzauto_financials.py를 뺀 모든 재무 수집기가 `source`를 넣지 않아,
-- 어느 시점부터 신규 적재 행이 전부 NULL이었다. 수집기 코드는 같은 커밋에서
-- scripts/lib/financial_sources.py 상수를 쓰도록 고쳤고, fnguide·yfinance 경로는
-- 재수집으로 이미 채워졌다. 이 마이그레이션은 재수집으로 덮이지 않는 잔여분 중
-- **출처가 명백한 것만** 채운다.
--
-- 판정 근거(추측 아님):
--   * companies.data_source='dart' 인 회사는 비상장이라 fnguide/yfinance 대상이 아니고,
--     annual 재무는 collect_dart_audit.py / collect_dart_private.py 만 기록한다.
--     (collect_dart_domestic.py 가 담당하는 /domestic 5사는 상장사라 data_source='fnguide')
--   * companies.data_source='yfinance' 인 회사의 재무는 collect_financials.py ·
--     collect_global_snapshot.py · quick_yfinance_new.py · enrich_company.py 가 쓰며
--     모두 yfinance 출처다. web_search 폴백은 marklines 회사에만 적용됐다(실측 확인).
--
-- 일부러 손대지 않는 것(출처를 특정할 수 없어 NULL 유지가 정직하다):
--   * data_source='marklines' 회사 — marklines 직접 수집분과 web_search 폴백분이 섞여 있다.
--   * data_source='pykrx' (hidden 회사) — 과거 'pykrx+dart' 조합 출처와 구분 불가.
--   * data_source='fnguide' 회사의 annual — fnguide 수집분과 dart_domestic 수집분이 섞인다.

-- 1) DART 비상장사 연간 재무
update financials f
set source = 'dart'
from companies c
where c.id = f.company_id
  and f.source is null
  and f.period_type = 'annual'
  and c.data_source = 'dart';

-- 2) 해외 상장사 (yfinance)
update financials f
set source = 'yfinance'
from companies c
where c.id = f.company_id
  and f.source is null
  and c.data_source = 'yfinance';

-- 3) KR 상장사 분기 — 분기 재무는 fnguide 경로만 기록한다
--    (dart_domestic 은 annual 만 쓰므로 혼입 여지가 없다)
update financials f
set source = 'fnguide'
from companies c
where c.id = f.company_id
  and f.source is null
  and f.period_type = 'quarterly'
  and c.data_source = 'fnguide';

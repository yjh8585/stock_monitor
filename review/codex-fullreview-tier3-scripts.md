# Tier 3 Python Scripts 리뷰

## Critical
- [scripts/collect_dart_domestic.py:260](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/collect_dart_domestic.py:260) DART 매칭 실패나 감사보고서 미발견을 `status='delisted'`로 저장합니다. [line 205](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/collect_dart_domestic.py:205) 이후 `status='active'`만 처리하므로, 일시 실패/비상장 공시 누락 회사가 화면과 재수집 대상에서 영구 제외될 수 있습니다.  
  개선: 상장폐지와 수집 실패를 분리해 `dart_collection_status`, `last_collect_error`, `retry_after` 같은 필드로 기록하고, 실제 delisted는 명시적 상장폐지 신호에서만 변경하세요.

- [scripts/rematch_dart_unmatched.py:106](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/rematch_dart_unmatched.py:106) ticker 충돌 시 기존 unmatched `companies` row를 바로 삭제합니다. [line 118](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/rematch_dart_unmatched.py:118) `companies` FK가 cascade인 테이블이 있으면 financials/news/pages 등 이력 데이터가 같이 사라질 수 있고, 현재는 `company_pages` domestic 하나만 이동합니다.  
  개선: 삭제 금지. 트랜잭션 안에서 모든 종속 테이블을 target company로 재매핑한 뒤 old row는 `merged_into_company_id`/`status='merged'`로 soft delete 처리하세요.

## High
- [supabase/migrations/20260428000003_create_financials.sql:46](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/supabase/migrations/20260428000003_create_financials.sql:46) `financials` unique key가 `company_id,period_type,fiscal_year,fiscal_quarter`뿐입니다. 그런데 DART는 `consolidation`을 저장하고 [scripts/collect_dart_audit.py:665](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/collect_dart_audit.py:665), upsert는 같은 conflict key를 씁니다 [line 923](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/collect_dart_audit.py:923). 연결/별도, yfinance/marklines/web_search가 같은 연도 row를 덮어쓸 수 있습니다.  
  개선: canonical row 정책을 명확히 두거나, `statement_type/consolidation/source`를 포함한 별도 raw 테이블을 두고 view에서 우선순위를 정하세요.

- [scripts/enrich_company.py:239](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/enrich_company.py:239) `business_summary/products/customers` 중 하나만 비어도 전체 메타를 재수집하고, [line 474](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/enrich_company.py:474)-[476](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/enrich_company.py:476)에서 기존 products/customers를 overwrite합니다. [scripts/enrich_customers_websearch.py:113](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/enrich_customers_websearch.py:113)도 append-only가 아니라 replace입니다.  
  개선: 기존 배열을 읽어 normalize+dedup 후 append/merge만 하고, 수동/검증 출처 필드는 보호하세요.

- [scripts/collect_financials.py:692](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/collect_financials.py:692) 기존 key가 있으면 최근 2년/4분기 외 과거 데이터는 스킵합니다. [line 727](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/collect_financials.py:727)-[734](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/collect_financials.py:734) 때문에 과거 restatement, 단위 보정, source 개선이 자동 반영되지 않습니다.  
  개선: `--force-years`, `source_version`, row checksum 비교를 추가하고, 스킵 기준을 “존재 여부”가 아니라 “동일성”으로 바꾸세요.

## Medium
- [scripts/collect_marklines_direct.py:107](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/collect_marklines_direct.py:107), [scripts/sync_oem_excel.py:59](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/sync_oem_excel.py:59) MarkLines cookie 전체를 env로 받아 `Cookie` header에 직접 넣습니다. `_marklines_state.json`도 저장됩니다 [scripts/marklines_login_once.py:33](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/marklines_login_once.py:33). 유출 시 계정 세션 탈취 위험이 큽니다.  
  개선: `.gitignore` 확인, secret scan, cookie 만료 검증, 파일 권한 제한, 가능한 storage_state 단일 방식으로 통일하세요.

- [scripts/collect_dart_domestic.py:230](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/collect_dart_domestic.py:230) annual financials가 하나라도 있으면 회사 전체를 pending에서 제외합니다. 최신 연도 누락, 이름 변경, DART 코드 보정이 있어도 재처리되지 않습니다.  
  개선: 회사 단위 skip이 아니라 target years별 누락/오래된 row 기준으로 수집하세요.

## Low / Nit
- [scripts/lib/db.py:27](/C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/scripts/lib/db.py:27) 공통 `upsert_rows`에 dry-run, row count 검증, nullable field 보호 옵션이 없습니다. 데이터 수집 스크립트가 많아질수록 실수 영향이 커집니다.

## 영역별 요약
- 가격/재무: 과거 row 스킵과 동일 conflict key overwrite가 가장 큽니다.
- DART: “수집 실패 = delisted”가 위험합니다.
- Marklines/OEM: 인증 쿠키 취급과 직접 DB overwrite를 정리해야 합니다.
- enrich: customers/products append-only 정책이 지켜지지 않습니다.
- seed/sync/debug: 운영 스크립트와 일회성 스크립트가 섞여 있어 destructive 동작에 guard가 부족합니다.

## 우선 조치
1. `collect_dart_domestic.py`의 delisted 변경을 중단하고 별도 수집 상태 필드로 전환.
2. `rematch_dart_unmatched.py`의 hard delete 제거.
3. `financials` source/consolidation overwrite 정책 정리.
4. enrich 계열 customers/products merge-only로 변경.
5. MarkLines cookie/state 파일 보호와 secret scan 추가.
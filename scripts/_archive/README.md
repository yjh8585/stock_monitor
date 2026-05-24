# scripts/_archive

일회성 스크립트·백업 보관소. 일상 운영에서 호출 안 함.

## 보관 분류

- **시드** (`seed_*.py`) — 회사·고객·요약 초기 시드 (5~6월 1회). 향후 비슷한 데이터 작업 시 패턴 참고용.
- **변환·통합** (`sync_*.py`) — PnL 엑셀·DB 변환 일회성. `/management/pnl` UI로 대체됨. `sync_oem_excel.py`와 `import_oem_sales.py`는 `scripts/`에 남아 워크플로가 호출(전자가 후자를 import).
- **마이그레이션** (`gen_new_marklines_migration.py`, `normalize_*.py`) — SQL 마이그레이션 + 트리거로 대체.
- **진단·복원** (`analyze_*.py`, `recheck_*.py`, `recollect_*.py`, `find_*.py`, `inspect_*.py`) — 데이터 감사 결과 보관.
- **디버그** (`debug_*.py`) — 외부 사이트(marklines/oem) 일회성 디버깅.
- **삭제 백업** (`_hard_delete_backup_*.json`) — companies hard-delete 직전 스냅샷.
- **디버그 HTML 덤프** (`_debug_*.html`) — 외부 페이지 일회성 캡처.

## 정책

- `.gitignore`로 `*.json`, `*.log`, `*.html` 새 산출물은 자동 무시.
- 기존 history는 보존 (`git log scripts/_archive/<file>`로 검색 가능).
- 향후 진짜 dead가 확실해지면 자연 삭제 (이번 정리는 위치 이동만).

## 추가

`scripts/`에 새 일회성 스크립트를 만들면 작업 종료 후 본 폴더로 이동.

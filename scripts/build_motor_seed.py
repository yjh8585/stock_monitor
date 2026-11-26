"""휴머노이드 「모터」 탭 명단 정본 검사기 겸 시드 생성기.

명단 정본은 git 밖 JSON(`참고/모터회사/motor_companies.json`)이다. 이 스크립트가
그 JSON 을 검사하고, 통과하면 시드 SQL 마이그레이션을 만든다.

- 유형(`motor_types`)은 4값만: auto_motor · robot_motor · actuator · control
- 공급 이력(`supply_history`) 등급은 한글 그대로 「확인」·「추정」, 분야는 auto · robot · industrial
- 「확인」 항목은 원문 링크(`source_url`)가 있어야 한다 — 화면에 근거 링크로 나간다
- 국내자동차(/domestic) 동시 노출은 자동차 모터 유형이거나 자동차 「확인」 납품이 있을 때만

설계 = docs/superpowers/specs/2026-11-26-motor-tab-design.md

사용:
  scripts/venv/Scripts/python.exe scripts/build_motor_seed.py validate <json>
  scripts/venv/Scripts/python.exe scripts/build_motor_seed.py emit <json> <out.sql>   # 검사 통과 때만 씀
  scripts/venv/Scripts/python.exe scripts/build_motor_seed.py targets                 # 재무 대상 ticker(콤마)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MOTOR_TYPES = ('auto_motor', 'robot_motor', 'actuator', 'control')
GRADES = ('확인', '추정')
FIELDS = ('auto', 'robot', 'industrial')
MARKETS = ('KOSPI', 'KOSDAQ', 'KONEX')

_TICKER_RE = re.compile(r'^\d{6}$')
_URL_RE = re.compile(r'^https?://')
_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)


def load_master(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding='utf-8'))


def _validate_supply(name: str, i: int, rec: dict) -> list[str]:
    errs: list[str] = []
    where = f'{name} · 공급 이력 {i + 1}번'
    if not str(rec.get('customer') or '').strip():
        errs.append(f'{where}: customer 가 비었다')
    if rec.get('field') not in FIELDS:
        errs.append(f'{where}: field {rec.get("field")!r} 는 {FIELDS} 밖이다')
    grade = rec.get('grade')
    if grade not in GRADES:
        errs.append(f'{where}: grade {grade!r} 는 {GRADES} 밖이다')
    elif grade == '확인' and not _URL_RE.match(str(rec.get('source_url') or '')):
        errs.append(f'{where}: 「확인」 인데 source_url(http/https)이 없다')
    return errs


def validate(master: dict) -> list[str]:
    """명단 정본의 위반 목록을 돌려준다. 빈 목록이면 통과."""
    errs: list[str] = []
    seen: set[str] = set()
    for c in master.get('companies', []):
        name = str(c.get('name_kr') or '').strip()
        if not name:
            errs.append(f'name_kr 가 빈 회사가 있다: {c!r}')
            continue
        if name in seen:
            errs.append(f'{name}: 같은 name_kr 가 두 번 나온다')
            continue
        seen.add(name)

        types = c.get('motor_types')
        if not isinstance(types, list) or not types:
            errs.append(f'{name}: motor_types 가 비었다')
        else:
            unknown = [t for t in types if t not in MOTOR_TYPES]
            if unknown:
                errs.append(f'{name}: 모르는 motor_types {unknown}')

        products = c.get('products')
        if not isinstance(products, list):
            errs.append(f'{name}: products 가 목록이 아니다')
        elif any(not isinstance(p, dict) or not str(p.get('name') or '').strip() for p in products):
            errs.append(f'{name}: products 에 name 이 빈 항목이 있다')

        cid = c.get('existing_company_id')
        if cid is not None and not _UUID_RE.match(str(cid)):
            errs.append(f'{name}: existing_company_id {cid!r} 가 uuid 형식이 아니다')

        supply = c.get('supply_history')
        if not isinstance(supply, list):
            errs.append(f'{name}: supply_history 가 목록이 아니다')
        else:
            for i, rec in enumerate(supply):
                errs.extend(_validate_supply(name, i, rec))

        if not isinstance(c.get('listed'), bool):
            errs.append(f'{name}: listed 가 true/false 가 아니다')
        elif c['listed']:
            if not _TICKER_RE.match(str(c.get('ticker') or '')):
                errs.append(f'{name}: 상장사인데 ticker {c.get("ticker")!r} 가 6자리 숫자가 아니다')
            if c.get('market') not in MARKETS:
                errs.append(f'{name}: 상장사인데 market {c.get("market")!r} 가 {MARKETS} 밖이다')
    return errs


def include_domestic(c: dict) -> bool:
    """국내자동차(/domestic) 탭에도 함께 보일 회사인가 — 자동차 납품사만."""
    if 'auto_motor' in (c.get('motor_types') or []):
        return True
    return any(
        rec.get('field') == 'auto' and rec.get('grade') == '확인'
        for rec in (c.get('supply_history') or [])
    )


FINANCIAL_SOURCES = ('fnguide', 'dart')


def financial_targets(rows: list[dict]) -> list[str]:
    """재무 수집 대상 ticker — fnguide·dart 경로만. web_search 비상장은 재무를 받지 않는다."""
    return [r['ticker'] for r in rows if r.get('data_source') in FINANCIAL_SOURCES and r.get('ticker')]


# ── 시드 SQL ────────────────────────────────────────────────────────────────

def _q(v) -> str:
    """SQL 리터럴 — 작은따옴표는 두 번 쓴다. None 은 NULL."""
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def _text_array(values: list[str]) -> str:
    return 'ARRAY[' + ', '.join(_q(v) for v in values) + ']::text[]'


def _jsonb(obj) -> str:
    return _q(json.dumps(obj, ensure_ascii=False)) + '::jsonb'


def _confirmed_supply(c: dict) -> list[dict]:
    """DB 에 싣는 공급 이력 — 「확인」만.

    companies 는 anon 이 직접 읽는 표(anon_read_companies)라, 다른 등급을 넣으면 화면(뷰)에는
    안 나와도 공개 키로 조회된다. 나머지 등급은 덱이 명단 JSON 에서 직접 읽는다.
    """
    keys = ('customer', 'product', 'field', 'grade', 'source_url', 'as_of')
    return [
        {k: rec.get(k) for k in keys}
        for rec in (c.get('supply_history') or [])
        if rec.get('grade') == '확인'
    ]


def _products(c: dict) -> list[dict]:
    out = []
    for p in c.get('products') or []:
        item = {'name': p['name']}
        if p.get('category'):
            item['category'] = p['category']
        out.append(item)
    return out


def _new_company_values(c: dict) -> tuple[str | None, str | None, str]:
    """새 회사의 (ticker, market, data_source).

    - 상장 → fnguide · 6자리 ticker
    - 비상장 + DART 고유번호 → dart · ticker 는 name_kr(효성전기·퓨트로닉 선례)
    - 비상장 + 코드 없음 → web_search · ticker NULL(휴머노이드 비상장 선례 — data_source NOT NULL)
    """
    if c.get('listed'):
        return c['ticker'], c['market'], 'fnguide'
    if c.get('dart_corp_code'):
        return c['name_kr'], None, 'dart'
    return None, None, 'web_search'


_INSERT_COLS = (
    'name, name_kr, ticker, market, country, currency, status, data_source, dart_corp_code, '
    'homepage_url, group_name, company_type, products, motor_types, supply_history, '
    'fiscal_year_end_month'
)


def _render_new(c: dict) -> list[str]:
    ticker, market, source = _new_company_values(c)
    name = c['name_kr']
    values = ', '.join([
        _q(name), _q(name), _q(ticker), _q(market), _q('KR'), _q('KRW'), _q('active'),
        _q(source), _q(c.get('dart_corp_code')), _q(c.get('homepage_url')), _q(c.get('group_name')),
        # 로봇 전용사는 company_type NULL — 20260824000001 주석(자동차 화면이 부품사로 집계하지 않게)
        _q('부품사' if include_domestic(c) else None),
        _jsonb(_products(c)), _text_array(c['motor_types']), _jsonb(_confirmed_supply(c)),
        _q(int(c.get('fiscal_year_end_month') or 12)),
    ])
    # 페이지 매핑은 AFTER INSERT 트리거(trg_auto_page_mapping)가 motor_types 를 보고 한다.
    return [
        f'INSERT INTO companies ({_INSERT_COLS}) SELECT {values} '
        f'WHERE NOT EXISTS (SELECT 1 FROM companies x WHERE x.name_kr = {_q(name)});'
    ]


def _render_existing(c: dict) -> list[str]:
    cid = _q(c['existing_company_id'])
    stmts = [
        f'UPDATE companies SET motor_types = {_text_array(c["motor_types"])}, '
        f'supply_history = {_jsonb(_confirmed_supply(c))} WHERE id = {cid};'
    ]
    # AFTER INSERT 트리거는 UPDATE 에 발동하지 않으므로 페이지 매핑을 직접 넣는다.
    pages = ['motor'] + (['domestic'] if include_domestic(c) else [])
    for page in pages:
        stmts.append(
            f'INSERT INTO company_pages (company_id, page) VALUES ({cid}, {_q(page)}) '
            'ON CONFLICT (company_id, page) DO NOTHING;'
        )
    return stmts


def render_seed_sql(master: dict) -> str:
    """명단 정본 → 시드 SQL. 멱등(새 회사는 name_kr 로 중복을 건너뛰고, 매핑은 ON CONFLICT)."""
    companies = master.get('companies', [])
    existing = [c for c in companies if c.get('existing_company_id')]
    new = [c for c in companies if not c.get('existing_company_id')]
    lines = [
        f'-- 휴머노이드 「모터」 탭 회사 시드 — 총 {len(companies)}사 · 신규 {len(new)} · 기존 {len(existing)}',
        '-- 생성: scripts/build_motor_seed.py emit (명단 정본 = 참고/모터회사/motor_companies.json, git 밖)',
        '-- 공급 이력은 「확인」 등급만 싣는다(companies 는 anon 이 직접 읽는 표).',
        '-- 손으로 고치지 말 것 — 명단 JSON 을 고치고 다시 생성한다.',
        '',
        '-- [1] 기존 회사: 모터 유형·공급 이력 + 페이지 매핑',
    ]
    for c in existing:
        lines.append(f'-- {c["name_kr"]}')
        lines.extend(_render_existing(c))
    lines += ['', '-- [2] 신규 회사: 트리거가 motor(+자동차 납품사는 domestic) 페이지에 매핑']
    for c in new:
        lines.append(f'-- {c["name_kr"]}')
        lines.extend(_render_new(c))
    return '\n'.join(lines) + '\n'


def _cmd_validate(path: str) -> int:
    errs = validate(load_master(Path(path)))
    for e in errs:
        print(e)
    print(f'위반 {len(errs)}건')
    return 1 if errs else 0


def _cmd_emit(path: str, out: str) -> int:
    master = load_master(Path(path))
    errs = validate(master)
    if errs:
        for e in errs:
            print(e)
        print(f'위반 {len(errs)}건 — SQL 을 쓰지 않았다')
        return 1
    Path(out).write_text(render_seed_sql(master), encoding='utf-8', newline='\n')
    print(f'{out} 작성 — {len(master.get("companies", []))}사')
    return 0


def _cmd_targets() -> int:
    """운영 DB 의 page='motor' 회사 중 재무 수집 대상 ticker 를 콤마로 출력한다(enrich 의 TARGET_TICKERS)."""
    from lib.bootstrap import init_script
    from lib.db import get_client

    init_script(__file__)
    client = get_client()
    ids = [
        r['company_id']
        for r in client.table('company_pages').select('company_id').eq('page', 'motor').execute().data
    ]
    if not ids:
        print('page=motor 회사가 없다', file=sys.stderr)
        return 1
    rows = (
        client.table('companies').select('ticker,data_source').in_('id', ids).execute().data
    )
    tickers = financial_targets(rows)
    print(f'motor {len(ids)}사 중 재무 대상 {len(tickers)}사', file=sys.stderr)
    print(','.join(tickers))
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == 'validate':
        return _cmd_validate(argv[1])
    if len(argv) == 3 and argv[0] == 'emit':
        return _cmd_emit(argv[1], argv[2])
    if argv == ['targets']:
        return _cmd_targets()
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

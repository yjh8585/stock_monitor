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

        if not isinstance(c.get('products'), list):
            errs.append(f'{name}: products 가 목록이 아니다')

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


def _cmd_validate(path: str) -> int:
    errs = validate(load_master(Path(path)))
    for e in errs:
        print(e)
    print(f'위반 {len(errs)}건')
    return 1 if errs else 0


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == 'validate':
        return _cmd_validate(argv[1])
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

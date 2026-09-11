#!/usr/bin/env python3
"""수집기 사이의 «호출 계약»이 어긋났는지 기계로 잡는다. **exit 0 이 정상이다.**

왜 있나 (2026-09-11 실사고로 신설):
  공용 헬퍼 `_get_main_doc_url` 의 반환형을 `str` 에서 `(str, bool)` 튜플로 바꾸면서
  **부르는 쪽 세 곳**(`collect_dart_domestic` · `collect_dart_summary` ·
  `collect_dart_labor`)이 튜플을 URL 로 쓰게 됐다. 셋 다 `try/except` 안이라
  **예외가 먹히고 조용히 폴백**했다 — 「결산감사 HTML 우선」 경로가 통째로 죽었는데
  로그는 `logger.debug` 였고, lint·타입·테스트 어디에도 안 걸렸다.

  🔴 **`except` 로 감싼 경로의 회귀는 «실패» 가 아니라 «침묵» 으로 나타난다.**
  그래서 런타임을 기다리지 말고 **정적으로** 계약을 본다.

무엇을 보나:
  1. **호출 시그니처 불일치** — 위치 인자 초과 · 모르는 키워드 · 필수 인자 누락.
     런타임에 `TypeError` 가 날 자리인데, 그 자리가 `except` 안이면 조용히 넘어간다.
  2. **튜플 반환을 «스칼라처럼» 받아 씀** — 언제나 N-튜플을 돌려주는 함수를 단일
     이름으로 받고, 그 이름을 스코프 안에서 **한 번도 첨자·언팩·순회하지 않는** 경우.
     쌍을 «쌍으로» 쓰는 정상 코드(`key = delta_group_key(row)` 같은 정렬키·딕셔너리 키)와
     가르기 위한 조건이다. 그래도 남는 정상 사례는 `ALLOWED_SCALAR_TUPLE` 에 근거와 함께 적는다.

한계 (일부러 안 하는 것):
  - 동적 호출(`getattr`·`*args`·`**kwargs`)·데코레이터·클래스 메서드는 건너뛴다.
  - 모듈은 `scripts/` 기준 상대 경로로 식별한다. 🔴 **파일 이름(stem)으로 하면 안 된다** —
    `yt_report/finalize.py` 와 `_yt_report/finalize.py` 가 충돌해 **오탐 2건**이 났다.
  - `_` 로 시작하는 폴더(`_archive`·`_tmp`·`_yt_report`)는 임시 산출물이라 제외한다.

사용:
  python scripts/verify_call_contracts.py
  python scripts/verify_call_contracts.py --list   # 허용된 것까지 전부 출력
"""
import argparse
import ast
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SCRIPTS = Path(__file__).resolve().parent
SKIP_DIRS = {'venv', '__pycache__', 'node_modules', '.venv'}

# 튜플을 «쌍 그대로» 쓰는 것이 맞는 자리. 키 = (모듈, 함수). 값 = 왜 정상인가.
# 🔴 근거 없이 추가하지 말 것 — 그러면 이 검사기가 무력해진다.
ALLOWED_SCALAR_TUPLE: dict[tuple[str, str], str] = {
  ('collect_dart_audit', '_score_report'): '(등급, 접수일) 쌍을 «정렬 키» 로 통째로 쓴다',
  ('lib.naver_research', 'delta_group_key'): '묶음 키를 딕셔너리 키로 통째로 쓴다',
  ('lib.pdf_figures', 'clip_to_page'): '(x0, y0, x1, y1) 사각형을 통째로 넘긴다',
}


def _modname(path: Path) -> str:
  return path.relative_to(SCRIPTS).with_suffix('').as_posix().replace('/', '.')


def _iter_files() -> list[Path]:
  out = []
  for p in SCRIPTS.rglob('*.py'):
    parts = p.relative_to(SCRIPTS).parts[:-1]
    if any(d in SKIP_DIRS or d.startswith('_') for d in parts):
      continue
    out.append(p)
  return sorted(out)


def _signatures(files: list[Path]) -> dict[tuple[str, str], dict]:
  """`{(module, func): 시그니처}` — 모듈 최상위 함수만."""
  sig: dict[tuple[str, str], dict] = {}
  for f in files:
    try:
      tree = ast.parse(f.read_text(encoding='utf-8'))
    except Exception:
      continue
    mod = _modname(f)
    for n in tree.body:
      if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
        continue
      if n.decorator_list:  # 데코레이터가 시그니처를 바꿀 수 있다
        continue
      a = n.args
      pos = [x.arg for x in a.posonlyargs] + [x.arg for x in a.args]
      sig[(mod, n.name)] = {
        'pos': pos,
        'req_pos': pos[: len(pos) - len(a.defaults)],
        'kwonly': [x.arg for x in a.kwonlyargs],
        'req_kw': [x.arg for i, x in enumerate(a.kwonlyargs) if a.kw_defaults[i] is None],
        'vararg': bool(a.vararg),
        'kwarg': bool(a.kwarg),
        'where': f'{mod}:{n.lineno}',
      }
  return sig


def _tuple_arities(files: list[Path]) -> dict[tuple[str, str], int]:
  """«값을 돌려줄 때는 언제나 같은 길이의 튜플» 인 함수만 골라 그 길이를 준다."""
  out: dict[tuple[str, str], int] = {}
  for f in files:
    try:
      tree = ast.parse(f.read_text(encoding='utf-8'))
    except Exception:
      continue
    mod = _modname(f)
    for n in ast.walk(tree):
      if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
        continue
      sizes, other = set(), False
      for r in ast.walk(n):
        if not isinstance(r, ast.Return) or r.value is None:
          continue
        if isinstance(r.value, ast.Tuple):
          sizes.add(len(r.value.elts))
        elif isinstance(r.value, ast.Constant) and r.value.value is None:
          pass  # 이른 종료 — 튜플 계약 자체는 유지된다
        else:
          other = True
      if len(sizes) == 1 and not other:
        size = sizes.pop()
        if size > 1:
          out[(mod, n.name)] = size
  return out


def _alias_map(tree: ast.AST, mod: str, known_mods: set[str]) -> dict[str, tuple[str, str]]:
  """`from X import f` · `import X as M` 를 (모듈, 이름) 으로 푼다."""
  alias: dict[str, tuple[str, str]] = {}
  for n in ast.walk(tree):
    if isinstance(n, ast.ImportFrom) and n.module:
      target = n.module if n.module in known_mods else None
      if target is None:
        # `from lib.db import x` 처럼 접두가 붙거나 빠진 형태를 접미로 맞춘다
        cands = [m for m in known_mods if m == n.module or m.endswith('.' + n.module)]
        target = cands[0] if len(cands) == 1 else None
      if target:
        for a in n.names:
          alias[a.asname or a.name] = (target, a.name)
    elif isinstance(n, ast.Import):
      for a in n.names:
        cands = [m for m in known_mods if m == a.name or m.endswith('.' + a.name)]
        if len(cands) == 1:
          alias.setdefault(a.asname or a.name.split('.')[0], (cands[0], ''))
  return alias


def _resolve(call: ast.Call, mod: str, alias: dict) -> tuple[str, str] | None:
  fn = call.func
  if isinstance(fn, ast.Name):
    return alias.get(fn.id, (mod, fn.id))
  if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name):
    hit = alias.get(fn.value.id)
    if hit and not hit[1]:
      return (hit[0], fn.attr)
    return None
  return None


def _check_signature(call: ast.Call, s: dict) -> str | None:
  if any(isinstance(a, ast.Starred) for a in call.args):
    return None
  if any(k.arg is None for k in call.keywords):
    return None
  kwnames = [k.arg for k in call.keywords]
  npos = len(call.args)
  if not s['vararg'] and npos > len(s['pos']):
    return f"위치 인자 {npos}개인데 파라미터는 {len(s['pos'])}개다"
  if not s['kwarg']:
    unknown = [k for k in kwnames if k not in s['pos'] and k not in s['kwonly']]
    if unknown:
      return f'모르는 키워드 {unknown}'
  filled = set(s['pos'][:npos]) | set(kwnames)
  missing = [p for p in s['req_pos'] if p not in filled]
  missing += [p for p in s['req_kw'] if p not in filled]
  if missing and not (s['pos'] and s['pos'][0] in ('self', 'cls')):
    return f'필수 인자 누락 {missing}'
  return None


def _used_as_tuple(scope: ast.AST, var: str) -> bool:
  for u in ast.walk(scope):
    if isinstance(u, ast.Subscript) and isinstance(u.value, ast.Name) and u.value.id == var:
      return True
    if isinstance(u, ast.Starred) and isinstance(u.value, ast.Name) and u.value.id == var:
      return True
    if isinstance(u, ast.For) and isinstance(u.iter, ast.Name) and u.iter.id == var:
      return True
    if (
      isinstance(u, ast.Assign)
      and isinstance(u.value, ast.Name)
      and u.value.id == var
      and isinstance(u.targets[0], (ast.Tuple, ast.List))
    ):
      return True
  return False


def main() -> None:
  ap = argparse.ArgumentParser()
  ap.add_argument('--list', action='store_true', help='허용된 것까지 전부 출력')
  args = ap.parse_args()

  files = _iter_files()
  sig = _signatures(files)
  arity = _tuple_arities(files)
  known_mods = {_modname(f) for f in files}

  violations: list[str] = []
  allowed: list[str] = []
  seen: set[tuple] = set()

  for f in files:
    try:
      src = f.read_text(encoding='utf-8')
      tree = ast.parse(src)
    except Exception:
      continue
    mod = _modname(f)
    alias = _alias_map(tree, mod, known_mods)
    lines = src.split('\n')
    rel = f.relative_to(SCRIPTS.parent).as_posix()

    # 1. 시그니처
    for n in ast.walk(tree):
      if not isinstance(n, ast.Call):
        continue
      key = _resolve(n, mod, alias)
      s = sig.get(key) if key else None
      if not s:
        continue
      why = _check_signature(n, s)
      if why:
        violations.append(
          f'[시그니처] {rel}:{n.lineno}  {key[0]}.{key[1]} — {why}\n'
          f'            정의 {s["where"]} · {lines[n.lineno - 1].strip()[:80]}'
        )

    # 2. 튜플을 스칼라처럼
    scopes = [x for x in ast.walk(tree) if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef))]
    scopes.append(tree)
    for scope in scopes:
      for n in ast.iter_child_nodes(scope) if scope is tree else ast.walk(scope):
        if not isinstance(n, ast.Assign) or not isinstance(n.value, ast.Call):
          continue
        key = _resolve(n.value, mod, alias)
        if key not in arity:
          continue
        t = n.targets[0]
        if not isinstance(t, ast.Name):
          continue
        mark = (rel, n.lineno, t.id)
        if mark in seen:
          continue
        seen.add(mark)
        if _used_as_tuple(scope, t.id):
          continue
        line = f'{rel}:{n.lineno}  {key[0]}.{key[1]} → {arity[key]}-튜플인데 `{t.id}` 하나로 받는다'
        why = ALLOWED_SCALAR_TUPLE.get(key)
        if why:
          allowed.append(f'  (확인됨) {line} — {why}')
        else:
          violations.append(f'[튜플/스칼라] {line}\n            {lines[n.lineno - 1].strip()[:80]}')

  if args.list:
    print(f'확인된 «쌍 그대로» 사용 {len(allowed)}건')
    for a in allowed:
      print(a)
    print()

  if violations:
    print(f'위반 {len(violations)}건')
    for v in violations:
      print(f'  {v}')
    sys.exit(1)

  print(
    f'위반 0건 (검사 파일 {len(files)} · 튜플 반환 함수 {len(arity)} · '
    f'확인된 쌍 사용 {len(allowed)}건은 허용목록)'
  )


if __name__ == '__main__':
  main()

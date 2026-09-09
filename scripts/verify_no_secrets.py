"""저장소 추적 파일에 `.env.local` 의 값이 평문으로 들어갔는지 검사한다(토큰 0).

사용: scripts/venv/Scripts/python.exe scripts/verify_no_secrets.py
      scripts/venv/Scripts/python.exe scripts/verify_no_secrets.py --self-test
      exit 0 = 정상 · exit 1 = 유출 발견

🔴 **왜 만들었나**(2026-09-09): 설계 문서 한 줄에 관리자 아이디·비밀번호가 **평문으로**
적혀 있었다. 넉 달간 아무도 몰랐고, 이 저장소는 **공개** 라 인터넷에 그대로 노출돼 있었다.
문서에서 지우는 것만으로는 재발을 못 막는다 — 대화에 나온 값을 문서에 옮겨 적는 것은
악의 없이 매번 다시 일어난다. 그래서 기계로 막는다.

🔴 **이 검사기는 값을 절대 출력하지 않는다.** 유출을 확인하려다 확인 결과에 유출을
남기는 것이 가장 흔한 2차 사고다. 어느 파일 몇 행에 어느 «키» 가 걸렸는지만 알린다.

## 값의 길이에 따라 «찾는 법» 을 바꾼다 — 여기가 이 검사기의 핵심이다

첫 판에서는 짧은 값을 통째로 건너뛰었다. 그랬더니 **정작 유출된 `ADMIN_PW`(5자)가
검사 밖으로 빠져** 이 검사기가 만들어진 바로 그 사고를 못 잡았다. 「위반 0건」이
「대상에서 빠진 것」이었던 전형이다. 그래서 두 갈래로 나눈다:

- **긴 값**(`_MIN_LEN` 이상, 흔한 낱말 아님) → 파일 어디에 있든 잡는다.
  실제 사고 중 하나가 `someloginid(=admin)` 처럼 **키 이름 없이** 아이디만 적은 것이었다.
  ⚠️ 이 예시는 **가짜 값**이다. 첫 판에서 여기에 진짜 아이디를 적었다가 과거 기록 정리 때
  함께 치환됐다 — 검사기를 설명하면서 검사 대상을 만든 셈이었다. 예시는 늘 가짜로 적는다.
- **짧거나 흔한 값** → **`키 = 값` 꼴로 «붙어 있을 때만»** 잡는다.
  짧은 값을 아무 데서나 찾으면 온 파일이 걸리고(첫 감사에서 오탐 44건),
  「같은 줄에 키가 있으면」으로 완화해도 부족했다 — `process.env.HMOBILITY_ID` 처럼
  **환경변수를 읽는 정상 코드**가 키 이름과 역할 이름을 한 줄에 갖고 있어 오탐 4건이 났다.
  값이 키 «뒤» 에 붙어야 유출이다. 앞에 있으면 그것은 참조하는 코드다.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / '.env.local'

# 이 접미사로 끝나는 키만 본다 — URL·모델명 같은 공개 설정까지 훑으면 오탐만 는다.
SUFFIXES = ('_ID', '_PW', '_KEY', '_SECRET', '_TOKEN', '_PASSWORD', '_COOKIE')

_MIN_LEN = 8
COMMON = {'admin', 'guest', 'mobility', 'hmobility', 'holdings', 'holding',
          'true', 'false', 'localhost', 'development', 'production'}

# 이진 파일은 안 읽는다 — 텍스트로 새는 경우만 본다.
SKIP_SUFFIX = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.xlsx',
               '.zip', '.woff', '.woff2', '.ttf', '.mp4', '.svg'}

# 확인을 마친 오탐만 «파일+키+이유» 로 좁혀 적는다.
# 🔴 통째로 파일을 빼지 않는다 — 그 파일에 «다른» 값이 새면 그것도 함께 놓친다.
ALLOW: dict[tuple[str, str], str] = {
    ('scripts/lib/companies.json', 'MOBILITY_ID'):
        '회사 홈페이지 주소다. 그 계정의 아이디가 회사 이름이라 우연히 겹친다(2026-09-09 육안 확인).',
}


def scanText(text: str, longVals: dict[str, str], shortVals: dict[str, str]) -> list[tuple[str, int]]:
    """한 파일의 본문에서 유출을 찾는다 — (키, 행번호) 목록. 순수 함수라 시험할 수 있다.

    ⚠️ **먼저 파일 전체를 한 번 훑어 후보를 거른다.** 줄 단위로 바로 들어가면
    파일 1,792개 × 줄 × 값 29개가 되어 3분을 넘겼다. 값이 파일 어디에도 없으면
    그 파일은 줄을 볼 필요가 없다 — 대부분이 여기서 끝난다.
    """
    cand = {k: v for k, v in longVals.items() if v in text}
    candShort = {k: v for k, v in shortVals.items() if v in text and k in text}
    if not cand and not candShort:
        return []

    pats = {k: re.compile(rf'{re.escape(k)}\s*[=:]\s*[\'"`]?{re.escape(v)}')
            for k, v in candShort.items()}
    hits: list[tuple[str, int]] = []
    for i, line in enumerate(text.splitlines(), 1):
        for key, val in cand.items():
            if val in line:
                hits.append((key, i))
        for key, pat in pats.items():
            # 짧은 값은 «키 = 값» 꼴로 붙어 있을 때만 유출로 본다(위 docstring 참조).
            if pat.search(line):
                hits.append((key, i))
    return hits


def loadSecrets() -> tuple[dict[str, str], dict[str, str]]:
    """(긴 값, 짧거나 흔한 값) — 어느 쪽도 «버리지» 않는다. 찾는 법만 달라진다."""
    longVals: dict[str, str] = {}
    shortVals: dict[str, str] = {}
    if not ENV.exists():
        return longVals, shortVals
    for line in ENV.read_text(encoding='utf-8', errors='replace').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if not v or not k.endswith(SUFFIXES):
            continue
        if len(v) < _MIN_LEN or v.lower() in COMMON:
            shortVals[k] = v
        else:
            longVals[k] = v
    return longVals, shortVals


def selfTest() -> int:
    """이 검사기가 «실패할 수 있는가» — 합성 문장으로 양방향을 확인한다.

    🔴 실물 파일이 깨끗하면 잡는 코드는 한 번도 안 돌아 본 것이 된다. 그래서 따로 시험한다.
    """
    longVals = {'ADMIN_ID': 'verylongsecretid'}
    shortVals = {'ADMIN_PW': 'pw12!'}
    cases: list[tuple[str, bool]] = []

    def hitKeys(text: str) -> set[str]:
        return {k for k, _ in scanText(text, longVals, shortVals)}

    cases.append(('긴 값은 키 이름 없이 적혀 있어도 잡는다',
                  hitKeys('열람 역할: verylongsecretid(=admin)') == {'ADMIN_ID'}))
    cases.append(('짧은 값은 자기 키와 함께 있으면 잡는다',
                  hitKeys('`ADMIN_PW=pw12!` 를 추가했다') == {'ADMIN_PW'}))
    cases.append(('짧은 값이 우연히 스친 자리는 안 잡는다',
                  hitKeys('버전 pw12! 는 무관한 글자다') == set()))
    cases.append(('깨끗한 본문은 아무것도 안 잡는다',
                  hitKeys('여기엔 자격증명이 없다') == set()))
    cases.append(('둘이 한 줄에 있으면 둘 다 잡는다',
                  hitKeys('ADMIN_ID=verylongsecretid, ADMIN_PW=pw12!') == {'ADMIN_ID', 'ADMIN_PW'}))
    # 아래 둘은 2026-09-09 실물에서 오탐으로 나온 형태다 — 다시 나지 않게 못 박는다.
    cases.append(('환경변수를 읽는 코드는 오탐이 아니다(값이 키 앞에 있다)',
                  hitKeys('const adminPw = process.env.ADMIN_PW; // pw12! 아님') == set()))
    cases.append(('키·값이 같은 줄에 있어도 «키=값» 꼴이 아니면 안 잡는다',
                  hitKeys("'pw12!': ('ADMIN_PW', 'X')") == set()))

    bad = [n for n, ok in cases if not ok]
    for n, ok in cases:
        print(f"  [{'OK  ' if ok else 'FAIL'}] {n}")
    print(f'자기시험 {len(cases) - len(bad)}/{len(cases)}')
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--self-test', action='store_true',
                    help='검사기가 실패할 수 있는지만 확인하고 끝낸다')
    args = ap.parse_args()
    if args.self_test:
        return selfTest()

    longVals, shortVals = loadSecrets()
    if not longVals and not shortVals:
        print('[정보] .env.local 이 없다 — 검사할 값이 없어 통과로 본다(CI 환경)')
        return 0

    out = subprocess.run(['git', 'ls-files'], cwd=REPO, capture_output=True,
                         text=True, encoding='utf-8').stdout
    files = [f.strip() for f in out.splitlines() if f.strip()]

    hits: list[str] = []
    allowed = 0
    for rel in files:
        p = REPO / rel
        if p.suffix.lower() in SKIP_SUFFIX or not p.is_file():
            continue
        try:
            text = p.read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        for key, lineNo in scanText(text, longVals, shortVals):
            if (rel, key) in ALLOW:
                allowed += 1
                continue
            hits.append(f'{rel}:{lineNo} ← {key}')

    print(f'검사한 값 {len(longVals) + len(shortVals)}개'
          f'(전문 검색 {len(longVals)} · 키 옆에서만 {len(shortVals)}) · 추적 파일 {len(files)}개')
    if allowed:
        print(f'확인 끝난 오탐 {allowed}건은 제외했다(목록 = 이 파일의 ALLOW)')

    if hits:
        print(f'\n[FAIL] 자격증명이 저장소 파일에 평문으로 있다 — {len(hits)}건')
        for h in hits:
            print(f'  {h}')
        print('\n  값은 일부러 출력하지 않는다. 해당 줄을 열어 값을 걷어내고,')
        print('  🔴 이미 원격에 올라갔다면 «그 자격증명을 새 값으로 바꾸는 것»이 먼저다')
        print('  (문서에서 지워도 git 과거 기록에는 남는다).')
        return 1

    print('[OK] 평문 자격증명 없음')
    return 0


if __name__ == '__main__':
    sys.exit(main())

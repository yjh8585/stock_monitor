#!/usr/bin/env python3
"""보고서 본문의 «번역투» 를 기계로 본다. **exit 0 이 정상이다.**

왜 있나 (2026-09-15 사용자 지적으로 신설):
  리포트 136(ABB·엔비디아 백서 정리)에서 영어 `cover` 를 **「덮다」로 한 단어씩 치환**한
  문장이 5곳 나갔다. 「어떤 시각 변수·엣지 케이스·실패 모드를 조기에 **덮어야** 하는가?」
  한국어에서 「덮다」는 «가린다» 는 뜻이라 **의미가 반대로도 읽힌다**. 여기서 coverage 는
  「데이터가 어디까지 포괄하는가」이므로 「다루다·포괄하다」가 맞다.

  🔴 **이 결함은 lint·타입·표 검사 어디에도 안 걸린다.** 문법이 틀린 것이 아니라
  «한국어로 안 읽히는» 것이라, 사람이 소리 내어 읽기 전에는 드러나지 않는다.
  사용자가 읽고 지적해서야 알았다. 그래서 기계가 먼저 보게 한다.

무엇을 보나 (원칙 = **정밀도 우선**):
  넓게 잡으면 경고가 일상이 되어 진짜를 묻는다(전역 훅 실측: 경고 하나가 전체의 80%를
  차지하자 같은 화면의 진짜 경고까지 묻혔다). 그래서 **오탐이 거의 없는 6종만** 본다.
  후보를 넓게 던져 실물을 먼저 쟀고(114편 전수), 아래 판정은 그 결과로 좁힌 것이다.

    실측에서 «떨어뜨린» 후보와 이유:
      케이스(13건) = 악기 케이스·피니언 케이스·케이스 스터디 — 전부 정상
      가진다(2건)  = 발화 인용문 안 — 원문을 고칠 수 없다
      수행한다(2건)= 「작업을 수행한다」 — 굳은 한국어다
      ~에 의해     = 한국어에도 흔하다(법에 의해 규정된) — 오탐 기계가 된다

한계 (일부러 안 하는 것):
  - **번역투 전반을 잡지 못한다.** 이 검사기가 통과했다고 문장이 좋다는 뜻이 아니다.
    사람이 읽는 일을 대신하지 않고, «되풀이된 형태» 만 막는다.
  - 인용문·코드 블록도 함께 본다. 원문 인용이라 고칠 수 없으면 `ALLOWED` 에 근거와 함께 적는다.

🔴 자가 시험이 함께 돈다 — 검사기 자신을 먼저 의심하기 위해서다:
  위반이 0건인 것과 검사기가 죽은 것은 **화면에서 똑같아 보인다.** 그래서 매 실행마다
  「걸려야 하는 표본」(136 의 실제 문장 5개 포함)과 「걸리면 안 되는 표본」을 양방향으로
  돌리고, 하나라도 어긋나면 본 검사 전에 exit 2 로 멈춘다.

사용:
  python scripts/verify_translationese.py                 # 게시된 글 전수
  python scripts/verify_translationese.py --run <파일>    # 게시 전 원고 1개
  python scripts/verify_translationese.py --selftest      # 자가 시험만
"""
import argparse
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path(__file__).resolve().parent))

# 판정 = (이름, 정규식, 어떻게 고치나)
RULES: list[tuple[str, str, str]] = [
  # 🔴 조사(을/를)를 앞에 요구하지 않는다 — 「모드를 «조기에» 덮어야」처럼 사이에 말이 낀다.
  #    대신 «어미» 로 가린다: 「눈에 덮인 산」·「이불을 덮고」는 이 어미 목록에 없다.
  ('cover→덮다',
   r'덮(?:어야|는가|였는가|이는가|인다|고 있는가)',
   '「다루다·포괄하다」로. coverage 는 «가린다» 가 아니라 «어디까지 미치는가» 다'),
  # 🔴 한글은 음절이 합쳐져 「나뉘어진」 안에 「나뉘어지」가 없다 — 어형을 낱낱이 적는다.
  #    붙여 쓴 형태만 잡으므로 「~이 되어 진행된다」(띄어쓰기)는 안 걸린다.
  ('이중 피동',
   r'(?:되어졌|되어진|되어지|보여졌|보여진|보여지|나뉘어졌|나뉘어진|나뉘어지'
   r'|쓰여졌|쓰여진|쓰여지|불려졌|불려진|불려지|잊혀졌|잊혀진|잊혀지)',
   '피동을 두 번 겹쳤다 — 「됐다·보인다·나뉜다」로'),
  ('require→필요로 한다',
   r'[을를]\s*필요로\s*한',
   '「~가 필요하다」 또는 「~해야 한다」로'),
  ('allow→것을 허용한다',
   r'것을\s*허용한',
   '「~할 수 있게 한다」로'),
  ('located→위치해 있다',
   r'에\s*위치(?:해|하고)\s*있',
   '「~에 있다」로 — 「위치해 있다」는 영어 located 의 직역이다'),
  ('possible→것이 가능하다',
   r'것이\s*가능하',
   '「~할 수 있다」로'),
]

# 고칠 수 없는 자리(원문 인용 등). 값 = 왜 정상인가.
# 🔴 근거 없이 추가하지 말 것 — 그러면 이 검사기가 무력해진다.
ALLOWED: dict[str, str] = {}

# 자가 시험 — 걸려야 하는 표본. 앞 5개는 리포트 136 에 실제로 나갔던 문장이다.
MUST_HIT: list[tuple[str, str]] = [
  ('cover→덮다', '어떤 시각 변수·엣지 케이스·실패 모드를 조기에 덮어야 하는가?'),
  ('cover→덮다', '그 데이터가 과제와 연관된 변수를 덮는가, 그리고 모델 검증을'),
  ('cover→덮다', '엣지 케이스가 덮였는가, 데이터 자산이 재사용 가능한가'),
  ('cover→덮다', '실패 샘플, 재검 메커니즘이 덮이는가'),
  ('cover→덮다', '핵심 변수·엣지 케이스·실패 샘플을 덮는가?'),
  ('이중 피동', '그 결과는 표에 잘 보여지고 있다'),
  ('이중 피동', '두 갈래로 나뉘어진 구조다'),
  ('require→필요로 한다', '이 방식은 별도의 검증을 필요로 한다'),
  ('allow→것을 허용한다', '사양을 손쉽게 바꾸는 것을 허용한다'),
  ('located→위치해 있다', '이 공장은 독일 슈투트가르트에 위치해 있다'),
  ('possible→것이 가능하다', '초안을 AI 가 만드는 것이 가능하다'),
]

# 자가 시험 — 걸리면 안 되는 표본(실측에서 정상으로 확인한 것들).
MUST_MISS: list[str] = [
  '엔진룸 피니언 케이스에 설치된다',
  'CARIAD 는 왜 어려운지를 보여주는 케이스 스터디다',
  '원격 발레 파킹을 수행한다',
  '보쉬 공장은 독일에 있다',
  '눈에 덮인 산을 지나',
  '이불을 덮고 잤다',
  '합성 데이터가 변수를 빠짐없이 포괄하는가?',
  '엣지 케이스를 초기에 다뤄야 하는가?',
  '모델이 인식을 지원할 수 있는가?',
  '이 결정은 사용자 승인이 필요하다',
  # 🔴 「되어 진행」·「모여 진행」은 띄어 쓰므로 이중 피동에 안 걸려야 한다.
  '계약이 체결되어 진행된다',
  '관계자들이 모여 진행한 회의였다',
  '기준이 마련되어 진행 중이다',
]


def scan(text: str) -> list[tuple[str, str, str]]:
  """(판정 이름, 걸린 조각, 처방) 목록을 돌려준다."""
  out = []
  for name, pat, fix in RULES:
    for m in re.finditer(pat, text):
      s = max(0, m.start() - 40)
      frag = re.sub(r'\s+', ' ', text[s:m.end() + 20]).strip()
      if any(k in frag for k in ALLOWED):
        continue
      out.append((name, frag, fix))
  return out


def selftest() -> bool:
  """검사기가 살아 있는지 양방향으로 확인한다. 하나라도 어긋나면 False."""
  ok = True
  for want, sample in MUST_HIT:
    names = [n for n, _, _ in scan(sample)]
    if want not in names:
      print(f'  ✗ 걸려야 하는데 안 걸림 [{want}] {sample}')
      ok = False
  for sample in MUST_MISS:
    hit = scan(sample)
    if hit:
      print(f'  ✗ 걸리면 안 되는데 걸림 [{hit[0][0]}] {sample}')
      ok = False
  print(f'  자가 시험: 걸려야 하는 표본 {len(MUST_HIT)}개 · 걸리면 안 되는 표본 '
        f'{len(MUST_MISS)}개 → {"통과" if ok else "실패"}')
  return ok


def main() -> None:
  ap = argparse.ArgumentParser()
  ap.add_argument('--run', help='게시 전 원고 파일 1개를 검사')
  ap.add_argument('--selftest', action='store_true', help='자가 시험만 돌린다')
  args = ap.parse_args()

  print('■ 자가 시험')
  if not selftest():
    print('\n🔴 검사기 자신이 고장났다 — 판정을 믿을 수 없어 멈춘다.')
    sys.exit(2)
  if args.selftest:
    return

  targets: list[tuple[str, str]] = []
  if args.run:
    p = Path(args.run)
    targets.append((p.name, p.read_text(encoding='utf-8')))
  else:
    from lib.bootstrap import init_script  # noqa: E402
    init_script(__file__)
    from lib.db import get_client  # noqa: E402
    rows = get_client().table('posts').select('id,title,content').order('id').execute().data
    targets = [(f"#{r['id']} {r['title'][:40]}", r['content'] or '') for r in rows]

  print(f'\n■ 본 검사 — 대상 {len(targets)}건')
  total = 0
  for label, text in targets:
    hits = scan(text)
    if not hits:
      continue
    total += len(hits)
    print(f'\n  {label}')
    for name, frag, fix in hits:
      print(f'    [{name}] …{frag}…')
      print(f'      → {fix}')

  if total:
    print(f'\n🔴 번역투 {total}건 — 고친 뒤 게시한다.')
    sys.exit(1)
  print('  위반 0건')


if __name__ == '__main__':
  main()

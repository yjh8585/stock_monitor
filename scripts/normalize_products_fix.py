#!/usr/bin/env python3
"""normalize_products.py 1차 정규화 후 잔여 영문/약어/단편 토큰 보강."""
import sys
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

from lib.db import get_client

# 1차 정규화 후 깨진 토큰들의 정정 매핑 (전체 토큰 단위)
FIX_MAP: dict[str, str] = {
  # E,G,R 분리 잔재 처리
  'E': '',  # 단일 문자 무의미 → 삭제
  'G': '',
  'R COOLER': 'EGR 쿨러',
  'R VALVE': 'EGR 밸브',

  # & 분리 보강
  'WIPER ARM': '와이퍼 암',
  'BLADE': '블레이드',
  'BRAKE LINING': '브레이크 라이닝',
  'PAD': '패드',
  'TAPER BEARING': '테이퍼 베어링',
  'BALL': '볼',
  'TIE ROD': '타이로드',
  'END': '엔드',
  'STEERING GEAR': '스티어링 기어',
  'LINKAGE': '링크',
  'GLASS': '글래스',
  'SEALINGS': '씰링',
  'PIPE': '파이프',
  'HEATER PIPE': '히터 파이프',
  'SMART AUDIO': '스마트 오디오',
  'SPRING': '스프링',
  'DISC': '디스크',

  # 단독 토큰
  'WATER': '워터',
  'AL': '알루미늄',
  'WHEEL DISC': '휠 디스크',
  'HOOD': '후드',

  # 복합 표현 직접 정리
  'FR/RR SUSPENSION': '전/후 서스펜션',
  'DOOR TRIM(TRUCK)': '트럭 도어 트림',
  'WIPER SYSTEM< POWER WINDOW MOTOR': '와이퍼 시스템',
}


def fix_name(name: str) -> str | None:
  """name을 FIX_MAP으로 정정. 빈 문자열 반환 시 None(=삭제) 반환."""
  s = (name or '').strip()
  if not s:
    return None
  if s in FIX_MAP:
    fixed = FIX_MAP[s]
    return fixed if fixed else None
  return s


def main() -> None:
  client = get_client()
  rows = client.table('companies').select('id,name_kr,products').execute().data
  applied = 0
  for r in rows:
    products = r.get('products') or []
    if not products:
      continue
    new_products: list[dict] = []
    seen: set[str] = set()
    changed = False
    for p in products:
      name = p.get('name', '')
      fixed = fix_name(name)
      if fixed is None:
        changed = True
        continue
      if fixed != name:
        changed = True
      if fixed in seen:
        continue
      seen.add(fixed)
      entry = {'name': fixed}
      if 'share_pct' in p:
        entry['share_pct'] = p['share_pct']
      new_products.append(entry)
    if changed:
      client.table('companies').update({'products': new_products}).eq('id', r['id']).execute()
      logger.info(f"✓ {r['name_kr']}: → {[p['name'] for p in new_products]}")
      applied += 1
  logger.info(f'정정 적용: {applied}개 회사')


if __name__ == '__main__':
  try:
    main()
  except Exception as e:
    logger.error(f'정정 실패: {e}')
    sys.exit(1)

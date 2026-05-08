"""KAICA 주생산품목을 companies.products 로 매핑.

회사명 정규화(㈜/(주)/(유)/공백 제거) 후 일치하는 회사에 product 부여.
이미 products 가 비어있지 않으면 덮어쓰지 않음(/related-stocks 25개 보호).
"""
import json
import re
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

from lib.db import get_client

KAICA_PATH = ROOT.parent / '참고' / 'domestic_sources' / 'kaica_all.json'


def normalize(s: str | None) -> str:
  if not s:
    return ''
  s = re.sub(r'주식회사|㈜|\(주\)|\(유\)|\(재\)|\(株\)|\s+', '', s)
  return s.strip().lower()


def main() -> None:
  client = get_client()
  kaica = json.loads(KAICA_PATH.read_text(encoding='utf-8'))

  # KAICA 회사명 → product 룩업
  kaica_lookup: dict[str, str] = {}
  for k in kaica:
    n = normalize(k['name'])
    if n and k['product']:
      kaica_lookup[n] = k['product']

  # /domestic 페이지의 active 회사 (products 비어있는 것만)
  rows = (
    client.table('companies')
    .select('id,name_kr,products,company_pages!inner(page)')
    .eq('status', 'active')
    .eq('company_pages.page', 'domestic')
    .execute()
    .data
  )

  applied = 0
  for r in rows:
    if r['products'] and len(r['products']) > 0:
      continue
    n = normalize(r['name_kr'])
    prod = kaica_lookup.get(n)
    if not prod:
      continue
    products = [{'name': prod}]
    client.table('companies').update({'products': products}).eq('id', r['id']).execute()
    applied += 1

  print(f'products 자동 매핑: {applied}건 적용')
  print(f'대상 회사 수: {len(rows)}, KAICA 룩업 키: {len(kaica_lookup)}')


if __name__ == '__main__':
  main()

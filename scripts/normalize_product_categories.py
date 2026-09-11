#!/usr/bin/env python3
"""기존 `companies.products[].category` 를 «회사 맥락과 함께» 재분류한다 (일회성).

왜 필요한가 (2026-09-11 실측):
  - 수집기 5개 중 4개가 category 를 **아예 안 넣었고**, 넣는 하나도 LLM 에 목록을 주지
    않아 자유 문자열이 나왔다. 트리거는 `product_category_map` **완전일치** 룩업이라
    목록 밖 값은 조용히 `'기타'` 가 된다 → **`'기타'` 1,860건(전체의 44%)**.
  - 거꾸로 가전·서비스가 자동차 칸을 받기도 했다(LG전자 TV → 구동계 · 의류관리기 → 제동 ·
    Jabil 공급망관리 → 조향). 트리거는 값이 목록에 «있기만» 하면 통과시키므로 못 막는다.

🔴 **map 확장으로는 못 고친다.** `'기타'` 1,860건의 제품명이 거의 전부 고유하다
   (최다가 「금형」 9건). 사전에 다 넣을 수 없어서 의미 판정(LLM)이 필요하다.

🔴 **회사 맥락 없이 제품명만 보면 안 된다.** 같은 「밸브」라도 부품사면 엔진, 화학회사면
   기타다. 그래서 회사 단위로 묶어 회사명·업종·설명과 함께 묻는다.

안전장치:
  - **기본이 dry-run** 이다. 실제 반영은 `--apply` 를 줘야 한다.
  - 바뀌는 항목만 UPDATE 한다(같으면 건너뛴다 — 무의미한 쓰기가 WAL 을 불린다).
  - 카테고리 목록은 DB 정본(`lib/product_categories.py`)이고, 21개 정규화값이 전부
    raw 키로도 등록돼 있어 **직접 UPDATE 해도 트리거 왕복에서 살아남는다**(확인함).
  - 결과를 `scripts/_product_category_diff.json` 에 남긴다(진단용 임시 산출물).

사용:
  python scripts/normalize_product_categories.py                    # dry-run 전체
  python scripts/normalize_product_categories.py --limit 20         # 앞 20개사만
  TARGET_NAMES="LG Electronics Inc,모베이스" python scripts/normalize_product_categories.py
  python scripts/normalize_product_categories.py --apply            # 실제 반영
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

import anthropic  # noqa: E402

from lib.db import WriteSession  # noqa: E402
from lib.product_categories import (  # noqa: E402
  category_guide,
  fetch_category_examples,
  fetch_product_categories,
  split_domains,
  violates_boundary,
)

DEFAULT_MODEL = os.environ.get('MODEL', 'claude-haiku-4-5-20251001')
DIFF_PATH = Path(__file__).parent / '_product_category_diff.json'

TOOL = {
  'name': 'submit_categories',
  'description': '각 제품을 정해진 카테고리 중 하나로 분류한다.',
  'input_schema': {
    'type': 'object',
    'properties': {
      'items': {
        'type': 'array',
        'items': {
          'type': 'object',
          'properties': {
            'index': {'type': 'integer', 'description': '입력 목록의 번호(0부터)'},
            'category': {'type': 'string'},
          },
          'required': ['index', 'category'],
        },
      },
    },
    'required': ['items'],
  },
  'cache_control': {'type': 'ephemeral'},
}


def _build_tool(categories: list[str], examples: dict[str, list[str]]) -> dict:
  import copy

  tool = copy.deepcopy(TOOL)
  prop = tool['input_schema']['properties']['items']['items']['properties']['category']
  prop['enum'] = categories
  # 🔴 예시(raw 키)를 «반드시» 함께 준다 — 이름만 주면 범위를 못 짚어 맞던 값까지 망가진다.
  prop['description'] = category_guide(categories, examples)
  return tool


def _classify(llm, tool: dict, company: dict, names: list[str]) -> dict[int, str]:
  """제품명 목록 → {index: category}. 실패하면 빈 dict(그 회사는 건너뛴다)."""
  listing = '\n'.join(f'{i}. {n}' for i, n in enumerate(names))
  summary = (company.get('business_summary') or '')[:400]
  prompt = (
    f"회사: {company.get('name_kr') or company.get('name')}"
    f" (분류: {company.get('company_type') or '미상'})\n"
    f"회사 설명: {summary or '(없음)'}\n\n"
    f"아래 제품들을 각각 분류하세요. 번호를 그대로 쓰세요.\n{listing}\n\n"
    "🔴 이 데이터베이스는 «자동차 부품·로봇 부품» 을 분류하기 위한 것입니다. "
    "가전·휴대폰·화학·금융·의류·식품처럼 자동차도 로봇도 아닌 제품은 억지로 끼워 맞추지 말고 "
    "반드시 '기타' 로 하세요. 회사가 부품사라도 그 제품 자체가 자동차·로봇 부품이 아니면 '기타' 입니다.\n"
    "submit_categories 도구를 호출하세요."
  )
  try:
    resp = llm.messages.create(
      model=DEFAULT_MODEL,
      max_tokens=2048,
      tools=[tool],
      tool_choice={'type': 'tool', 'name': 'submit_categories'},
      messages=[{'role': 'user', 'content': prompt}],
    )
  except Exception as e:
    logger.warning(f'  LLM 실패 — {e}')
    return {}
  for block in resp.content:
    if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_categories':
      out: dict[int, str] = {}
      for item in (dict(block.input).get('items') or []):
        idx, cat = item.get('index'), item.get('category')
        if isinstance(idx, int) and 0 <= idx < len(names) and cat:
          out[idx] = cat
      return out
  return {}


def _apply_saved_diff(w) -> None:
  """dry-run 이 남긴 diff 를 «그대로» DB 에 반영한다 (LLM 재호출 없음).

  🔴 **적용 시점에 LLM 을 다시 부르면 안 된다.** 모델은 비결정적이라 사용자가 검토한
  것과 다른 결과가 들어간다 — 「본 것과 적용된 것이 다른」 가장 나쁜 실패다.
  그래서 apply 는 저장된 diff 만 읽는다.
  """
  if not DIFF_PATH.exists():
    sys.exit(f'{DIFF_PATH.name} 이 없다 — 먼저 dry-run 을 돌려 검토할 것.')
  saved = json.loads(DIFF_PATH.read_text(encoding='utf-8'))
  if saved.get('applied'):
    logger.warning('이 diff 는 이미 반영된 기록이다 — 다시 돌리면 같은 값을 덮어쓴다(무해).')

  by_company = {c['company']: c['items'] for c in saved.get('changes', [])}
  rows = (
    w.table('companies').select('id,name,name_kr,products')
    .eq('status', 'active').execute().data or []
  )
  index = {(r.get('name_kr') or r.get('name')): r for r in rows}

  applied = skipped_guard = missing = 0
  guard_log: list[str] = []
  for label, items in by_company.items():
    row = index.get(label)
    if not row or not isinstance(row.get('products'), list):
      missing += 1
      continue
    wanted = {}
    for it in items:
      reason = violates_boundary(it['product'] or '', it['to'])
      if reason:
        skipped_guard += 1
        guard_log.append(f"  {label} · {it['product']}: {reason} → 기존 값 유지")
        continue
      wanted[it['product']] = it['to']
    if not wanted:
      continue

    new_products, changed = [], 0
    for p in row['products']:
      item = dict(p or {})
      target = wanted.get(item.get('name'))
      # 🔴 dry-run 이후 값이 이미 바뀌었으면 건드리지 않는다(남의 수집이 지나갔을 수 있다).
      if target and item.get('category') != target:
        item['category'] = target
        changed += 1
      new_products.append(item)
    if changed:
      w.table('companies').update({'products': new_products}).eq('id', row['id']).execute()
      applied += changed

  if guard_log:
    logger.info(f'경계 규칙 위반 {skipped_guard}건을 걸렀다:')
    for line in guard_log[:20]:
      logger.info(line)
  logger.info(f'반영 {applied}건 · 경계 가드로 제외 {skipped_guard}건 · 회사 못 찾음 {missing}개사')
  saved['applied'] = True
  DIFF_PATH.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding='utf-8')


def _main_in_session(w, args) -> None:
  if args.apply:
    _apply_saved_diff(w)
    return

  categories = fetch_product_categories(w)
  examples = fetch_category_examples(w)
  auto_cats, robot_cats = split_domains(categories)
  # 🔴 도구를 «두 벌만» 만든다 — 회사마다 새로 만들면 프롬프트 캐시가 매번 깨진다.
  tools = {
    'auto': _build_tool(auto_cats, examples),
    'robot': _build_tool(robot_cats, examples),
  }
  allowed = {'auto': set(auto_cats), 'robot': set(robot_cats)}
  logger.info(f'자동차 {len(auto_cats)}종 · 로봇 {len(robot_cats)}종 (회사 성격에 따라 가려 쓴다)')

  # 로봇·휴머노이드 회사 판정 — company_pages 의 humanoid 매핑이 기준이다.
  robot_ids = {
    r['company_id'] for r in
    (w.table('company_pages').select('company_id,page').eq('page', 'humanoid').execute().data or [])
  }
  logger.info(f'휴머노이드 매핑 {len(robot_ids)}개사 — 이들에게만 로봇 카테고리를 제시한다')

  api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
  if not api_key:
    sys.exit('ANTHROPIC_API_KEY 미설정')
  llm = anthropic.Anthropic(api_key=api_key)

  raw = os.environ.get('TARGET_NAMES', '').strip()
  target = {t.strip() for t in raw.split(',') if t.strip()}

  rows = (
    w.table('companies')
    .select('id,name,name_kr,company_type,business_summary,products')
    .eq('status', 'active').execute().data or []
  )
  rows = [r for r in rows if isinstance(r.get('products'), list) and r['products']]

  # 🔴 OEM 은 «차종» 을 products 에 담는다(AGENTS.md). 「3시리즈 세단」을 '차체' 로 넣는 것은
  #    의미 왜곡이고, 애초에 제품군 필터도 OEM 은 항상 통과시킨다 → 재분류 대상이 아니다.
  oem = [r for r in rows if r.get('company_type') == 'OEM']
  rows = [r for r in rows if r.get('company_type') != 'OEM']
  if oem:
    logger.info(f'OEM {len(oem)}개사 제외 (products 가 차종이라 부품 카테고리를 매기지 않는다)')
  if target:
    rows = [r for r in rows if r.get('name') in target or r.get('name_kr') in target]
  rows.sort(key=lambda r: (r.get('name_kr') or r.get('name') or ''))
  if args.limit:
    rows = rows[: args.limit]

  logger.info(f'대상 {len(rows)}개사 · {"APPLY" if args.apply else "DRY-RUN"}')

  changes: list[dict] = []
  changed_companies = 0
  for i, c in enumerate(rows, 1):
    products = c['products']
    names = [(p or {}).get('name') or '' for p in products]
    if not any(names):
      continue
    label = c.get('name_kr') or c.get('name')
    domain = 'robot' if c['id'] in robot_ids else 'auto'
    verdict = _classify(llm, tools[domain], c, names)
    if not verdict:
      continue
    domain_allowed = allowed[domain]

    new_products = []
    company_changes = []
    for idx, p in enumerate(products):
      item = dict(p or {})
      old = item.get('category')
      new = verdict.get(idx)
      # 목록 밖 값은 무시한다 — 넣어 봐야 트리거가 '기타' 로 떨어뜨리고, 그러면
      # 「고쳤다고 생각했는데 기타가 된」 가장 헷갈리는 상태가 된다.
      if new in domain_allowed and new != old:
        item['category'] = new
        company_changes.append({'product': item.get('name'), 'from': old, 'to': new})
      new_products.append(item)

    if not company_changes:
      continue
    changed_companies += 1
    changes.append({'company': label, 'items': company_changes})
    logger.info(f'[{i}/{len(rows)}] {label} — {len(company_changes)}건 변경')
    for ch in company_changes[:4]:
      logger.info(f"    {ch['product']}: {ch['from']} → {ch['to']}")

  DIFF_PATH.write_text(
    json.dumps(
      {'applied': bool(args.apply), 'companies': changed_companies, 'changes': changes},
      ensure_ascii=False, indent=2,
    ),
    encoding='utf-8',
  )
  total = sum(len(c['items']) for c in changes)
  logger.info(f'{"반영" if args.apply else "예상"} — {changed_companies}개사 {total}건 · 상세 {DIFF_PATH.name}')
  if not args.apply:
    logger.info('실제 반영은 --apply 를 붙여 다시 실행하십시오.')


def main() -> None:
  ap = argparse.ArgumentParser()
  ap.add_argument(
    '--apply', action='store_true',
    help='저장된 _product_category_diff.json 을 그대로 DB 에 반영 (LLM 재호출 없음)',
  )
  ap.add_argument('--limit', type=int, default=0, help='앞 N개사만')
  args = ap.parse_args()

  # 🔴 신규 mutating 스크립트는 WriteSession 필수 — 종료 시 캐시 태그가 자동 무효화된다.
  with WriteSession() as w:
    _main_in_session(w, args)


if __name__ == '__main__':
  main()

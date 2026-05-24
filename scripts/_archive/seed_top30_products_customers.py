"""매출 TOP 30 회사들의 주요 제품/고객사를 일괄 등록.

데이터 출처: 회사 IR 자료/홈페이지/사업보고서 공개 정보 정리.
이미 customers 가 비어있지 않은 회사는 보존(/related-stocks 25개 보호).
"""
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

from lib.db import get_client

# ticker → (products, customers)
DATA: dict[str, tuple[list[dict], list[dict]]] = {
  '096770': (
    [{'name': '배터리'}, {'name': '윤활유'}, {'name': '석유화학'}],
    [{'name': '현대차'}, {'name': '기아'}, {'name': '폭스바겐'}, {'name': '포드'}],
  ),
  '373220': (
    [{'name': 'EV용 배터리'}, {'name': 'ESS용 배터리'}],
    [{'name': '현대차'}, {'name': '기아'}, {'name': '폭스바겐'}, {'name': '포드'}, {'name': 'GM'}, {'name': '르노'}],
  ),
  '161390': (
    [{'name': '승용차 타이어'}, {'name': '트럭/버스 타이어'}],
    [{'name': '현대차'}, {'name': '기아'}, {'name': 'BMW'}, {'name': '메르세데스-벤츠'}, {'name': '포드'}, {'name': 'GM'}],
  ),
  '현대트랜시스': (
    [{'name': '변속기'}, {'name': '액슬'}, {'name': '시트'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '006400': (
    [{'name': 'EV용 배터리'}, {'name': '소형 IT 배터리'}],
    [{'name': 'BMW'}, {'name': '폭스바겐'}, {'name': '스텔란티스'}, {'name': '포드'}, {'name': '리비안'}],
  ),
  '007860': (
    [{'name': '도어트림'}, {'name': '콘솔'}, {'name': '범퍼'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '073240': (
    [{'name': '승용차 타이어'}, {'name': 'OE 타이어'}],
    [{'name': '현대차'}, {'name': '기아'}, {'name': 'GM'}, {'name': '포드'}],
  ),
  '200880': (
    [{'name': '도어트림'}, {'name': '시트'}, {'name': '콘솔'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '015750': (
    [{'name': '차체부품'}, {'name': '범퍼레일'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '007340': (
    [{'name': '산업용 배터리'}, {'name': '엔진마운팅'}, {'name': '진동제어'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '002350': (
    [{'name': '승용차 타이어'}, {'name': 'UHP 타이어'}],
    [{'name': '현대차'}, {'name': '기아'}, {'name': '폭스바겐'}, {'name': '포드'}],
  ),
  '현대케피코': (
    [{'name': '엔진제어장치'}, {'name': '연료분사장치'}, {'name': 'TCU'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '038110': (
    [{'name': '범퍼 모듈'}, {'name': '플라스틱 외장부품'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '247540': (
    [{'name': '2차전지 양극재'}],
    [{'name': '삼성SDI'}, {'name': 'SK온'}],
  ),
  '유라코퍼레이션': (
    [{'name': '와이어링 하네스'}, {'name': 'CMS'}],
    [{'name': '현대차'}, {'name': '기아'}, {'name': 'GM'}],
  ),
  '036530': (
    [{'name': '지주회사'}],
    [],
  ),
  '004490': (
    [{'name': '자동차 배터리'}, {'name': '산업용 배터리'}],
    [{'name': '현대차'}, {'name': '기아'}, {'name': 'GM'}],
  ),
  '일진글로벌': (
    [{'name': '휠 베어링'}, {'name': '드라이브 샤프트'}],
    [{'name': '현대차'}, {'name': '기아'}, {'name': 'GM'}, {'name': '포드'}],
  ),
  '033530': (
    [{'name': '머플러'}, {'name': '배기시스템'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '123040': (
    [{'name': '차체부품'}, {'name': '사이드 멤버'}, {'name': '핫스탬핑'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '024900': (
    [{'name': '콕핏 모듈'}, {'name': '도어트림'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '013520': (
    [{'name': '고무호스'}, {'name': '웨더스트립'}, {'name': '씰링'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '053700': (
    [{'name': '변속기 부품'}, {'name': '오일 스크린'}, {'name': '워터 파이프'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '067570': (
    [{'name': '헤드라이닝'}, {'name': '플로어 카펫'}, {'name': 'NVH 부품'}],
    [{'name': '현대차'}, {'name': '기아'}],
  ),
  '000430': (
    [{'name': '서스펜션 스프링'}, {'name': '안정바'}],
    [{'name': '현대차'}, {'name': '기아'}, {'name': 'GM'}],
  ),
}


def main() -> None:
  client = get_client()
  applied_p, applied_c = 0, 0
  for ticker, (products, customers) in DATA.items():
    rows = client.table('companies').select('id,products,customers').eq('ticker', ticker).execute().data
    if not rows:
      print(f'⚠ {ticker}: 회사 없음')
      continue
    r = rows[0]
    update: dict = {}
    if products and (not r.get('products') or len(r['products']) == 0):
      update['products'] = products
      applied_p += 1
    if customers and (not r.get('customers') or len(r['customers']) == 0):
      update['customers'] = customers
      applied_c += 1
    if update:
      client.table('companies').update(update).eq('id', r['id']).execute()
      print(f'✓ {ticker}: products={len(update.get("products") or [])} customers={len(update.get("customers") or [])}')

  print(f'\n총 적용: products {applied_p}건 / customers {applied_c}건')


if __name__ == '__main__':
  main()

"""기존 customers 데이터 정규화 — OEM만 남기고 비-OEM 제거.
- 기존 데이터 유지 (덮어쓰지 않음, 잘못된 항목만 제거)
- 별칭 → 표준 OEM명으로 정규화 (예: '현대자동차' → '현대차')
- 일관된 형식: string array (CustomerBadges는 둘 다 지원하지만 표준화)
- OEM 화이트리스트에 없는 회사는 제거

용도: 사용자 지시 "기존 정보 유지 + 보완"
"""
import sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')
load_dotenv(Path(__file__).parent.parent.parent / '.env.local')

sys.path.insert(0, str(Path(__file__).parent.parent))
from lib.db import get_client

# OEM 화이트리스트 + 별칭 매핑
# 키: 별칭 (lowercased), 값: 표준 OEM명
ALIAS_TO_STANDARD = {}

OEM_STANDARD_NAMES = {
    # 한국
    # 제네시스는 현대차 럭셔리 브랜드 — 현대차로 통합 (사용자 정책 2026-05-12)
    '현대차': ['현대자동차', '현대', 'Hyundai', 'Hyundai Motor', 'HKMC', '현대차그룹', '현대차증권', '현대기아', '현대기아자동차', '현대기아차', '현대·기아차', '현대자동차그룹', '현대그룹', 'Hyundai Motor Group', '제네시스', 'Genesis'],
    '기아': ['기아자동차', '기아차', '기아모터스', 'Kia', 'Kia Motor', 'Kia Motors'],
    'KG모빌리티': ['KGM', 'KG Mobility', '쌍용', '쌍용자동차', '쌍용차'],
    '한국GM': ['한국지엠', 'GM코리아', 'GM대우', '대우차', '대우자동차', '한국 GM'],
    '르노코리아': ['르노삼성', '르노삼성자동차', '르노삼', 'RKM', '르노코리아자동차', 'Renault Korea'],
    # 미국
    'GM': ['General Motors', '제너럴모터스', '지엠', 'GMC', 'GM (General Motors)', '상하이 GM', '상하이GM'],
    '포드': ['Ford', 'Ford Motor', 'Ford Motor Company'],
    '스텔란티스': ['Stellantis', 'FCA', 'Chrysler', '크라이슬러', 'Fiat', 'Jeep', 'Dodge', 'Ram', 'Dodge Ram', 'Maserati', '마세라티', '알파로메오', 'Alfa Romeo', 'PSA', 'PSA Group'],
    '테슬라': ['Tesla', 'Tesla Inc', 'Tesla Shanghai'],
    '리비안': ['Rivian'],
    '폴라리스': ['Polaris'],
    '루시드': ['Lucid', 'Lucid Motors'],
    '니콜라': ['Nikola'],
    'Scout Motors': ['스카우트모터스'],
    'PACCAR': ['Paccar', 'PACCAR Inc', 'Kenworth', 'Peterbilt'],
    'Navistar': ['International'],
    '다임러트럭': ['Daimler Trucks', 'Daimler Truck', 'Freightliner', 'Western Star', '다임러 트럭'],
    # 일본
    '도요타': ['Toyota', '토요타', 'Toyota Motor', 'Toyota Group', '도요타 그룹', '도요타 자동차', '도요타 모터', '도요타 산업', '도요타자동차'],
    '혼다': ['Honda', 'Honda Motor', 'Honda Motor Co'],
    '닛산': ['Nissan', 'Nissan Motor', 'NISMO'],
    '마쓰다': ['Mazda', 'Mazda Motor', '마쯔다'],
    '미쓰비시': ['Mitsubishi', 'Mitsubishi Motors', '미쓰비시자동차'],
    '스바루': ['Subaru'],
    '스즈키': ['Suzuki', 'Suzuki Motor'],
    '다이하쓰': ['Daihatsu'],
    '이스즈': ['Isuzu'],
    '히노': ['Hino', 'Hino Motors'],
    '미쓰비시후소': ['Mitsubishi Fuso', 'Fuso'],
    '야마하': ['Yamaha'],
    # 독일
    '폭스바겐': ['Volkswagen', 'VW', 'Volkswagen Group', 'FAW Volkswagen', '폴크스바겐', '폭스바겐 중국'],
    'BMW': ['BMW Group', 'BMW 그룹', 'BMW Brilliance', 'BMW group'],
    '메르세데스-벤츠': ['Mercedes-Benz', 'Mercedes', '메르세데스벤츠', '벤츠', 'Daimler', '다임러', 'DaimlerChrysler'],
    '아우디': ['Audi'],
    '포르쉐': ['Porsche'],
    '람보르기니': ['Lamborghini', '람보르기니 우루스 SE'],
    '벤틀리': ['Bentley'],
    '부가티': ['Bugatti'],
    'MAN': ['MAN Trucks'],
    # 영국/이탈리아/프랑스
    '재규어 랜드로버': ['Jaguar Land Rover', 'JLR', '재규어랜드로버', '재규어', 'Jaguar', 'Land Rover'],
    '페라리': ['Ferrari'],
    '르노': ['Renault'],
    '푸조': ['Peugeot'],
    '시트로엥': ['Citroen', 'Citroën'],
    # 스웨덴/체코
    '볼보': ['Volvo', 'Volvo Cars', '볼보코리아'],
    '볼보트럭': ['Volvo Group', 'Volvo Trucks'],
    '스카니아': ['Scania'],
    'DAF': ['DAF Trucks'],
    '스코다': ['Skoda', 'Škoda'],
    '세아트': ['SEAT', 'Seat'],
    'CUPRA': ['Cupra'],
    # 중국
    'BYD': ['비야디'],
    '지리': ['Geely', '지리자동차'],
    '창안': ['Changan', '창안자동차', 'Changan Auto'],
    '그레이트월모터스': ['Great Wall Motor', 'GWM', '그레이트월모터'],
    'SAIC': ['SAIC Motor', '상하이자동차', '상하이 상용차'],
    'BAIC': ['Beijing Automotive'],
    '체리': ['Chery'],
    '베이징현대': ['Beijing Hyundai', '베이징 현대'],
    '리샹': ['Li Auto', 'Li Xiang'],
    'NIO': ['Nio', '니오'],
    'XPeng': ['Xpeng', '샤오펑', '小鹏汽车'],
    'JAC': ['JAC Group', '江铃集团'],
    '리프모터': ['Leapmotor'],
    '세레스': ['Seres', 'AITO'],
    '동펑자동차': ['Dongfeng', 'Dongfeng Motor'],
    '광저우자동차': ['GAC', 'GAC Motor', '广汽集团'],
    'FAW': ['First Auto Works'],
    '화웨이': ['Huawei', 'AITO/HIMA'],
    '샤오미': ['Xiaomi'],
    '우링자동차': ['Wuling', '우링 자동차', '上汽通用五菱'],
    'Jiyue Auto': ['지웨'],
    # 베트남/인도/러시아 등
    '빈패스트': ['VinFast', 'VINFAST'],
    '마힌드라': ['Mahindra'],
    '타타': ['Tata', 'TATA모터스', 'Tata Motors', '타타대우', '타타대우상용차', 'TATA DAEWOO'],
    '바자즈': ['Bajaj'],
    '히어로': ['Hero'],
    '아쇼크레이랜드': ['Ashok Leyland'],
    '카마즈': ['KAMAZ'],
    '시노트럭': ['Sinotruk'],
    '샨시중트럭': ['Shaanxi Heavy Truck'],
    '포톤': ['Foton'],
    '에디슨모터스': ['Edison Motors'],
}

for std, aliases in OEM_STANDARD_NAMES.items():
    ALIAS_TO_STANDARD[std.lower()] = std  # 자기 자신
    for a in aliases:
        ALIAS_TO_STANDARD[a.lower()] = std


def _extract_name(item):
    """jsonb 항목에서 customer name 추출 (string 또는 {name})"""
    if isinstance(item, str):
        return item.strip()
    if isinstance(item, dict):
        return (item.get('name') or '').strip()
    return ''


def _normalize_one(name: str) -> str | None:
    """OEM 이름으로 정규화. OEM이 아니면 None 반환."""
    if not name:
        return None
    # 매칭 시도 (lowercase)
    standardized = ALIAS_TO_STANDARD.get(name.lower())
    if standardized:
        return standardized
    # 매칭 안 됨 — OEM 아닌 회사
    return None


def main():
    client = get_client()
    rows = client.table('companies').select('id,name_kr,customers').execute().data
    total_companies = 0
    cleared = 0
    kept_some = 0
    total_removed = 0
    samples_removed = []

    for c in rows:
        cur = c.get('customers')
        if not cur or not isinstance(cur, list):
            continue
        normalized: list[str] = []
        for item in cur:
            name = _extract_name(item)
            std = _normalize_one(name)
            if std:
                if std not in normalized:
                    normalized.append(std)
            elif name:
                total_removed += 1
                if len(samples_removed) < 30:
                    samples_removed.append((c['name_kr'], name))

        # UPDATE only if changed
        old_jsonable = json.dumps(cur, ensure_ascii=False, sort_keys=True)
        new_jsonable = json.dumps(normalized, ensure_ascii=False, sort_keys=True)
        if old_jsonable != new_jsonable:
            client.table('companies').update({'customers': normalized}).eq('id', c['id']).execute()
            total_companies += 1
            if not normalized:
                cleared += 1
            else:
                kept_some += 1

    print(f'정규화 완료')
    print(f'  업데이트된 회사: {total_companies}')
    print(f'  완전히 비워진 회사: {cleared}')
    print(f'  일부 유지된 회사: {kept_some}')
    print(f'  제거된 항목 수: {total_removed}')
    print(f'\n제거된 항목 샘플 (30개):')
    for cname, item in samples_removed:
        print(f'  {cname} ← "{item}"')


if __name__ == '__main__':
    main()

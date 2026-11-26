-- 휴머노이드 「모터」 탭 회사 시드 — 총 2사 · 신규 0 · 기존 2
-- 생성: scripts/build_motor_seed.py emit (명단 정본 = 참고/모터회사/motor_companies.json, git 밖)
-- 공급 이력은 「확인」 등급만 싣는다(companies 는 anon 이 직접 읽는 표).
-- 손으로 고치지 말 것 — 명단 JSON 을 고치고 다시 생성한다.

-- [1] 기존 회사: 모터 유형·공급 이력 + 페이지 매핑
-- 삼현
UPDATE companies SET motor_types = ARRAY['auto_motor', 'actuator', 'control']::text[], supply_history = '[{"customer": "북미 휴머노이드 완성형 로봇 고객사(비공개)", "product": "AXLON 관절 액추에이터 — 초도 양산 수주", "field": "robot", "grade": "확인", "source_url": "https://www.etoday.co.kr/news/view/2627838", "as_of": "2026-09"}, {"customer": "현대자동차 그룹 및 관련 협력사(주요 고객사)", "product": "CVVD(연속 가변 밸브 듀레이션) 개발·양산", "field": "auto", "grade": "확인", "source_url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260319000680", "as_of": "2026-03"}]'::jsonb WHERE id = 'f695707e-02e2-4105-8f7b-cb73946d0350';
INSERT INTO company_pages (company_id, page) VALUES ('f695707e-02e2-4105-8f7b-cb73946d0350', 'motor') ON CONFLICT (company_id, page) DO NOTHING;
INSERT INTO company_pages (company_id, page) VALUES ('f695707e-02e2-4105-8f7b-cb73946d0350', 'domestic') ON CONFLICT (company_id, page) DO NOTHING;
-- 현대모비스
UPDATE companies SET motor_types = ARRAY['actuator']::text[], supply_history = '[{"customer": "보스턴다이나믹스", "product": "아틀라스 휴머노이드 액추에이터 — 양산 시점 공급 합의", "field": "robot", "grade": "확인", "source_url": "https://www.mobis.com/kr/aboutus/press.do?category=press&idx=6158", "as_of": "2026-01"}, {"customer": "현대자동차·기아(각 종속회사 포함 · 주요 매출처)", "product": "모듈·핵심부품", "field": "auto", "grade": "확인", "source_url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260309001878", "as_of": "2026-03"}]'::jsonb WHERE id = '53bbe83c-56a6-4884-a3be-f94d1cd46ab6';
INSERT INTO company_pages (company_id, page) VALUES ('53bbe83c-56a6-4884-a3be-f94d1cd46ab6', 'motor') ON CONFLICT (company_id, page) DO NOTHING;
INSERT INTO company_pages (company_id, page) VALUES ('53bbe83c-56a6-4884-a3be-f94d1cd46ab6', 'domestic') ON CONFLICT (company_id, page) DO NOTHING;

-- [2] 신규 회사: 트리거가 motor(+자동차 납품사는 domestic) 페이지에 매핑

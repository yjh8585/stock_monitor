# `/oem/suppliers` — 협력사(소싱 후보) 페이지 신설 계획 (2026-11-13)

- 사용자 지시 원문·선택 답 = [`2026-11-13-suppliers-page_최초지시.md`](./2026-11-13-suppliers-page_최초지시.md)
- 상태: **설계 확정(2026-11-13)** → 1단계 세부 구현 계획 작성. 구현은 단계마다 끊고 화면 확인 후 다음 단계(결정 12).
- 가장 가까운 선례 = [`2026-11-09-customers-page.md`](./2026-11-09-customers-page.md)(「우리가 파는 상대」). 이 계획은 「우리가 사 올 상대」라 산출물이 달라 새로 냈다. 공개 레포 보안 원칙은 그쪽을 따른다.

## 확정된 결정 (전부 2026-11-13 사용자 선택)

| #   | 결정                                                                               |
| --- | ---------------------------------------------------------------------------------- |
| 1   | 계획서를 새로 만든다                                                               |
| 2   | 1차 범위 = 하프샤프트 + 얼터네이터. 나머지 제품군은 이후 데이터만 추가             |
| 3   | 사외비 역할만 접근. 부품 구성·경쟁사·검색어·결과는 사외비 표에만(코드에 적지 않음) |
| 4   | 우선순위 = 코드 고정 점수표 + 업체 상세 화면 필수                                  |
| 5   | 지역 9탭(전체·한국·중국·일본·북미·인도·동남아·유럽·기타) · 지역은 점수에 안 넣음   |
| 6   | MarkLines 1차 + 웹 조사 보충(부족 지역 · MarkLines 에 없는 국내 경쟁사 협력사)     |
| 7   | 이 PC 수동 실행(분기 1회 정도) · GitHub Actions 미사용                             |
| 8   | 점수 배점(아래 「점수표」) — 화면을 본 뒤 조정 가능                                |
| 9   | 원자료만 저장, 점수는 화면(서버)에서 계산                                          |
| 10  | 경쟁사 본인은 후보에서 자동 제외 · 계열사는 「계열 가능성」 배지만                 |
| 11  | 1단계는 보기만(상태·메모 저장 없음)                                                |
| 12  | 1단계(MarkLines + 목록·상세) → 화면 확인 → 2단계(웹 보충) → 이후 제품군 확대       |

#### 상세

- 결정 4 원문: 「1번으로 하는데, 업체 정보도 볼 수 있게 페이지 구성해. 결국 어떤 회사인지 보고 컨택 대상으로 최종 결정할 거 아냐.」
- 결정 5 원문: 「북미, 동남아, 유럽, 일본, 인도, 기타 이런식으로 조금 더 상세 구분이 낫지 않아?」 — 한국·중국은 최초 지시에 있어 함께 둔다(2026-11-13 사용자 확인 「한국, 중국 협력사도 조사하는 거 맞지?」). 멕시코는 업계 관행대로 북미에 넣는다.
- 결정 6 의 국내 경쟁사 보충은 grill 1번 답(「웹 조사로 보충」).
- 결정 8 의 품목 3단계는 grill 2번 답(실측상 납품 품목 칸이 비어 「확인」 등급이 성립하지 않아 재정의).

## 실측 (2026-11-13 · MarkLines 서플라이어 DB 를 로컬 쿠키로 직접 받아 봄)

| 항목                         | 결과                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| 접근                         | `scripts/.env` 의 `MARKLINES_COOKIE` 로 로그인 상태 응답(유료 벽 아님)              |
| 검색                         | `GET /en/supplier_db/result` — `opt_delName`(납품처)·`partsName`(부품명) 조합 동작  |
| id 목록                      | 결과 HTML 의 숨은 칸 `supplier_ids`·`suppliers_code_list`(JSON)                     |
| 목록 데이터                  | `POST /en/supplier_db/get_supplier_data` (`supplier_ids`·`sort`·`page`) — 20건/쪽   |
| 상세 데이터                  | `GET /en/supplier_db/{rand_code}/?is_modal=true` → JSON                             |
| 상세 칸                      | 프로필(국가·주소·매출·종업원·홈페이지·인증) · 제품 분류 · 품목 설명 · 공정 · 납품처 |
| 납품 품목(`delivery_status`) | **20곳 중 0곳** 채워짐 → 「경쟁사에 무엇을 납품」은 추정만 가능                     |
| 조합 검색 효과               | 경쟁사+부품 = 수~수십 곳(부품 단독은 수백~수천 곳)                                  |
| 국내 경쟁사 2곳              | MarkLines 에 공급사로는 있으나 **납품처로 적은 공급사 0곳** → 웹 보충(결정 6)       |
| 거점 이름                    | 같은 경쟁사가 본사·국가별 법인 이름으로 갈려 잡힌다 → 별칭(부분일치) 필요           |

- 경쟁사별 공급사 수 실측값은 원본 「실측」 절(`참고/협력사/`)에 둔다.
- ⚠ 로그인 판정을 HTTP 200 으로 하지 말 것 — [`docs/oem-collection.md`](../oem-collection.md) 「쿠키가 «두 곳»에 있다」. 상세 JSON 이 파싱되고 `profile` 이 있는지로 판정한다.

## 설계

### 공개 레포 보안 원칙 (고객사 계획서와 같다)

1. 우리 제품·품목군·경쟁사·검색어는 **사외비 표에만** 둔다. 시드는 마이그레이션이 아니라 **로컬에서 service_role 로 1회 INSERT**(입력 파일은 `참고/협력사/` — gitignore).
2. 수집 스크립트·로그·시험 데이터·커밋 메시지에 실제 경쟁사·품목을 박지 않는다(시험은 가짜 이름).
3. MarkLines 원자료(유료 콘텐츠)도 사외비 표에 둔다 — anon 에게 재배포하지 않는다.

### DB (모두 RLS on · 정책 없음 · `CONFIDENTIAL_TABLES` 등록 · Architecture §7-G 5-step)

| 표                        | 성격                                      |
| ------------------------- | ----------------------------------------- |
| `sourcing_products`       | 우리 제품(하프샤프트·얼터네이터)          |
| `sourcing_part_groups`    | 제품별 품목군과 MarkLines 검색어          |
| `sourcing_competitors`    | 제품별 경쟁사와 납품처 별칭               |
| `sourcing_suppliers`      | 공급사 원자료(MarkLines·웹)               |
| `sourcing_supplier_links` | 공급사 × 품목군 × 경쟁사 연결과 일치 단계 |

#### 상세

- `sourcing_products`: `id`·`slug`·`name_ko`·`display_order`.
- `sourcing_part_groups`: `id`·`product_id`·`name_ko`·`bom_parts`(text[])·`ml_part_names`(text[])·`ml_processes`(text[])·`keywords`(text[]).
- `sourcing_competitors`: `id`·`product_id`·`name`·`aliases`(text[] — MarkLines 납품처 부분일치용).
- `sourcing_suppliers`: `id`·`source`(`marklines`·`web`)·`ml_supplier_id`·`ml_rand_code`·`name`·`country`·`region`·`location`·`homepage`·`established`·`sales_text`·`employees`·`certifications`·`product_categories`(jsonb)·`parts_comments`(text[])·`processes`(text[])·`delivers_oem`(text[])·`delivers_supplier`(text[])·`remarks`·`source_url`·`fetched_at`.
- `sourcing_supplier_links`: `supplier_id`·`part_group_id`·`competitor_id`(null = 경쟁사 무관 후보)·`match_level`(`named`·`category`·`process`)·`evidence`.
- `region` 은 수집기가 국가 → 지역 표(코드 상수 — 지역 구분은 전략이 아니라 지리라 공개 무방)로 채운다.
- 수집 표에 `trg_skip_identical_update` 부착(AGENTS 「신규 수집 테이블」).

### 점수표 (결정 8 · `lib/sourcing/score.ts` 순수 함수 + 시험)

| 항목        | 배점                                                                    |
| ----------- | ----------------------------------------------------------------------- |
| 경쟁사 납품 | 서로 다른 경쟁사 1곳당 15, 최대 45                                      |
| 품목 일치   | 품목 명시 30 / 분류 일치 20 / 공정만 10 (그 업체의 가장 높은 단계 하나) |
| 품질 인증   | IATF16949 10 / ISO9001 만 5                                             |
| 규모        | 종업원 기준 0~15 (구간은 1단계 계획에서 실측 분포를 보고 정한다)        |
| 지역        | 점수 없음 — 탭으로만                                                    |

- 「품목 명시」 = `parts_comments` 에 품목군 `keywords` 가 직접 들어 있음 · 「분류 일치」 = `product_categories` 에 `ml_part_names` · 「공정만」 = `processes` 에 `ml_processes`.
- 결정 10: 이름이 경쟁사 `aliases` 와 일치하면 후보에서 뺀다. 비고·이름에 경쟁사 그룹명이 보이면 「계열 가능성」 배지.

### 화면

- 라우트 `/oem/suppliers`(목록) · `/oem/suppliers/[id]`(상세). `app/oem/layout.tsx` 의 `OEM_TABS` 끝에 「협력사」 — **사외비 역할에게만 탭 노출**(레이아웃이 클라이언트 컴포넌트라 역할 전달 방법은 1단계 계획에서 사이드바 방식을 보고 정한다).
- 권한: `lib/auth/permissions.ts` 에 `canAccessSuppliers`(admin·holdings·mobility — `canAccessCustomers` 와 명단이 같아도 의미가 달라 따로 둔다) · `canAccess` 에 `/oem/suppliers` 분기 · `permissions.test.ts` · Architecture §5 함께.
- 캐시: 새 `cacheTag` 는 세 곳 함께(`verify_revalidate_tags.py`) · `cacheLife('days')` · `exchange_rates_live` 금지.
- 상단 고지 한 줄: 「경쟁사에 어떤 품목을 납품하는지는 MarkLines 에 없어, 납품처와 생산 품목을 겹쳐 추정한 결과입니다.」

#### 목록 `/oem/suppliers`

1. 제품 고르기(하프샤프트 / 얼터네이터) · 지역 탭 9개 · 지역별 업체 수 카드
2. 품목군 필터
3. 순위표 — 순위 · 업체명 · 국가 · 점수 · 경쟁사 배지 · 일치 품목(단계 표시) · 규모 · 인증 · 출처 · 계열 가능성

#### 상세 `/oem/suppliers/[id]`

1. 개요 — 국가·주소·홈페이지·설립·매출·종업원·인증
2. 생산 품목·공정 · 품목 설명 원문
3. 납품처 전체(완성차 / 부품사) — 경쟁사 강조
4. 점수 내역(항목별)
5. 같은 그룹의 다른 거점 · MarkLines 원문 링크

#### 재사용 짝짓기 (전역 규칙 「같은 종류의 과거 작업부터」)

| 화면 요소        | 짝(기존)                                     | 판정                          |
| ---------------- | -------------------------------------------- | ----------------------------- |
| 탭 줄            | `app/oem/layout.tsx` `OEM_TABS`              | 선택 인자(역할) 추가 재사용   |
| 지역 탭          | `components/customers/CustomersTabs.tsx`     | 1단계 계획에서 열어 보고 판정 |
| 순위표·행 강조   | `CustomersOverviewTable` · `useRowHighlight` | 1단계 계획에서 판정 / 그대로  |
| 지역별 수 카드   | `CompanyKpiCards`                            | 1단계 계획에서 판정           |
| 상세 페이지 골격 | `app/customers/[slug]/page.tsx`              | 1단계 계획에서 판정           |
| 점수 내역 표     | 없음                                         | 신규                          |

### 수집 (1단계 — `scripts/collect_sourcing_suppliers.py` · 로컬 수동 · LLM 없음)

1. 사외비 표에서 제품·품목군·경쟁사를 읽는다.
2. 품목군 × 경쟁사 별칭: `opt_delName`+`partsName` 조합 검색 → id 모음(경쟁사 연결).
3. 품목군: `partsName` 단독 검색 → id 모음(경쟁사 무관 후보). 결과가 지나치게 많으면 상한·정렬 기준은 1단계 계획에서 실측 후 정한다.
4. 모은 업체의 상세를 1초 간격으로 받아 `sourcing_suppliers` upsert · 연결은 `sourcing_supplier_links`.
5. `WriteSession` 경유(캐시 무효화) · stdout 에 경쟁사·품목명 대신 id·건수만.
6. 지역별 건수를 출력 → 2단계 웹 보충 대상 판단.

### 2단계 (웹 보충) — 1단계 화면 확인 뒤 별도 계획

- 대상: 1단계 지역별 건수가 적은 지역 + MarkLines 에 납품처 기록이 없는 국내 경쟁사의 협력사.
- 도구: `research-pplx`(퍼플렉시티 1차 · Parallel 보조). `source='web'` · `source_url` 필수.

## 1단계에서 사용자 확인받을 것

- PPT 5개를 바탕으로 만든 「품목군 ↔ MarkLines 검색어」 대응표 초안(`참고/협력사/` — gitignore). 수집 전에 보여 드린다.

## 문서 공개 범위 (2026-11-13 사용자 선택 「그렇게 해」)

- 레포 판은 경쟁사 이름·사내 자료 경로를 가린다. 원본·실측 수치·품목군 대응표 = `참고/협력사/`(gitignore).

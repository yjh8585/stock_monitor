# 관리자 권한 시스템 설계

**작성일:** 2026-05-28
**상태:** Draft → 즉시 구현
**관련:** 사외비 sync Phase 1 prerequisite (`/management/companies` 가드)

---

## 1. 배경

현재 사용자 Role은 `'mobility' | 'holdings'` 두 가지. 사용자가 `.env.local`에 `ADMIN_ID=hansaeadmin`, `ADMIN_PW=1357!` 관리자 자격증명 추가. 다음 기능은 관리자만 가능해야:

1. `/management/companies` 페이지 접근 (신규 회사 등록 + 향후 사외비 엑셀 업로드).
2. 보고서 게시물 삭제 (`DELETE /api/posts/:id`).

비관리자(mobility, holdings)는 기존 기능 모두 유지:

- 보고서 등록 (`POST /api/posts`, `POST /api/uploads/report`).
- 보고서 조회 / 다운로드 / YouTube 분석 등.
- `/management/pnl`, `/management/plan`, `/management/inventory`, `/management/production` 탭 (사외비 손익 조회는 기존 권한 그대로).

## 2. 현재 상태 검토

| 위치                                        | 현재 동작                                             | 갱신 후 동작                                                 |
| ------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| `lib/auth/users.ts`                         | `Role = 'mobility' \| 'holdings'`. ADMIN_ID/PW 매핑 ✖ | `'admin'` 추가, 3번째 사용자 매핑                            |
| `lib/auth/session.ts`                       | `decodeSession`이 `'mobility' \| 'holdings'`만 허용   | `'admin'`도 허용                                             |
| `lib/auth/permissions.ts`                   | path-based `canAccess`, mobility의 `/hansae` 차단만   | `/management/companies` 비관리자 차단 + `isAdmin(role)` 헬퍼 |
| `app/api/posts/[id]/route.ts` DELETE        | 세션 검증 ✖, role 검증 ✖                              | `getCurrentUser()` + `isAdmin(role)` 가드, 비관리자 403      |
| `components/reports/post-delete-button.tsx` | 항상 렌더                                             | 부모가 isAdmin 판별 후 조건부 마운트                         |
| `app/reports/[id]/page.tsx`                 | `PostDeleteButton` 무조건 렌더                        | `getCurrentUser()` 호출, admin만 렌더                        |
| `app/management/layout.tsx`                 | client component, 회사 탭 무조건 표시                 | server로 변환 + ManagementTabs(client)에 isAdmin prop        |

## 3. 변경 매트릭스

### 3.1 `lib/auth/users.ts`

- `Role` union에 `'admin'` 추가.
- `getUsersFromEnv()`에 `ADMIN_ID`/`ADMIN_PW` 읽기 + 3번째 user 객체 추가 (`role: 'admin'`, `displayName: '관리자'`).
- `getDisplayNameByRole`에 `'admin' → '관리자'` 추가.

### 3.2 `lib/auth/session.ts`

- `decodeSession`의 role 검증에 `'admin'` 허용 추가.

### 3.3 `lib/auth/permissions.ts`

```typescript
import type { Role } from './users';

const ADMIN_ONLY_PATHS = ['/management/companies'];

export function isAdmin(role: Role): boolean {
  return role === 'admin';
}

export function canAccess(pathname: string, role: Role): boolean {
  if (role === 'mobility' && pathname.startsWith('/hansae')) return false;
  if (
    !isAdmin(role) &&
    ADMIN_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return false;
  }
  return true;
}
```

`proxy.ts`의 `canAccess` 호출은 그대로 동작 — `/management/companies`에 비관리자 접근 시 `/`로 redirect.

### 3.4 `app/api/posts/[id]/route.ts` DELETE handler

handler 시작부에:

```typescript
const user = await getCurrentUser();
if (!user || !isAdmin(user.role)) {
  return NextResponse.json(fail('FORBIDDEN', '삭제 권한이 없습니다.'), { status: 403 });
}
```

GET handler는 변경 ✖ (모든 인증 사용자 조회 가능).

### 3.5 `app/reports/[id]/page.tsx`

`ReportDetailBody`에서 `getCurrentUser()` 호출 → admin이면 `PostDeleteButton` 렌더, 아니면 ✖.

`'use cache'` 격리: getCurrentUser는 cookies()를 쓰므로 cached function에서 호출 불가. detail body 자체는 cached, delete button 렌더 결정은 외부 wrapper에서.

### 3.6 `app/management/layout.tsx` (server 변환 + 탭 분해)

- 현재 `'use client'` → server component로.
- `getCurrentUser()`로 role 조회.
- 탭 nav 부분은 별도 client component `components/management/management-tabs.tsx`로 추출.
- `<ManagementTabs isAdmin={isAdmin(user.role)} />` — 회사 탭은 isAdmin 조건부.

```typescript
// components/management/management-tabs.tsx (신규)
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const BASE_TABS = [
  { label: '손익', href: '/management/pnl' },
  { label: '계획', href: '/management/plan' },
  { label: '재고', href: '/management/inventory' },
  { label: '생산', href: '/management/production' },
] as const;
const ADMIN_TABS = [{ label: '회사', href: '/management/companies' }] as const;

export function ManagementTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = isAdmin ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS;
  return (
    <nav className="mt-3 flex items-center gap-1">
      {tabs.map(tab => { /* 기존 active 판정·className 그대로 */ })}
    </nav>
  );
}
```

## 4. 보안 약속

- **이중 가드** — UI 가드와 API/페이지 가드는 둘 다 필수.
  - 탭 가림 / 삭제 버튼 가림 = UI 가드 (사용자 편의)
  - `proxy.ts` redirect / DELETE 403 = 백엔드 가드 (직접 fetch 우회 차단)
- UI만 가리면 `curl -X DELETE /api/posts/N`으로 우회 가능.
- 페이지 가드는 `proxy.ts`의 기존 `canAccess` 호출에 위임 — `permissions.ts`만 수정해 자동 반영.

## 5. 권한 매트릭스 (변경 후)

| 기능                                                 | mobility        | holdings     | admin       |
| ---------------------------------------------------- | --------------- | ------------ | ----------- |
| `/management/pnl` `/plan` `/inventory` `/production` | ✓               | ✓            | ✓           |
| `/management/companies`                              | ✖ (redirect)    | ✖ (redirect) | ✓           |
| `/reports` 목록 / 상세 / 조회                        | ✓               | ✓            | ✓           |
| `POST /api/posts` (등록)                             | ✓               | ✓            | ✓           |
| `POST /api/uploads/report` (파일 업로드)             | ✓               | ✓            | ✓           |
| `DELETE /api/posts/:id` (삭제)                       | ✖ (403)         | ✖ (403)      | ✓           |
| `/hansae`                                            | ✖ (기존 그대로) | ✓            | ✓           |
| 기타 페이지                                          | 기존 그대로     | 기존 그대로  | 기존 그대로 |

## 6. 검증 (수동)

1. **mobility 로그인:**
   - `/management` 진입 → 탭에 "회사" 없음.
   - `/management/companies` URL 직접 → `/`로 redirect.
   - `/reports/<id>` 진입 → "삭제" 버튼 없음.
   - DevTools에서 `fetch('/api/posts/N', {method:'DELETE'})` → 403.
   - 보고서 등록 → 정상.

2. **holdings 로그인:** mobility와 동일 결과(+ `/hansae` 접근 가능).

3. **admin 로그인:**
   - "회사" 탭 표시, `/management/companies` 접근 OK.
   - "삭제" 버튼 표시, DELETE 정상 동작.

## 7. 변경 / 변경 ✖

**변경:** lib/auth 3개 파일, app/api/posts/[id]/route.ts, app/reports/[id]/page.tsx, app/management/layout.tsx, components/management/management-tabs.tsx (신규).

**변경 ✖:** `proxy.ts` 본체 (permissions.ts만 수정), `app/api/posts/route.ts` POST (등록은 기존 권한 유지), `app/api/uploads/report` 등 업로드 API, `app/management/companies/page.tsx` (페이지 접근은 proxy.ts가 차단), 다른 권한 매트릭스(`/hansae` 등).

## 8. Open questions

없음.

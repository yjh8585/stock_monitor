'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 라이트 ↔ 다크 전환 버튼 (사이드바·모바일 메뉴 하단).
 *
 * 아이콘·문구는 `dark:` 클래스로 갈라 그린다 — 서버 렌더 시점엔 테마를 모르므로
 * `resolvedTheme` 으로 분기하면 hydration 불일치가 난다.
 */
export default function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      title="화면 테마 전환"
      aria-label="화면 테마 전환"
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
        collapsed && 'justify-center'
      )}
    >
      <Moon size={15} className="shrink-0 dark:hidden" />
      <Sun size={15} className="hidden shrink-0 dark:block" />
      {!collapsed && (
        <>
          <span className="dark:hidden">다크 모드</span>
          <span className="hidden dark:inline">라이트 모드</span>
        </>
      )}
    </button>
  );
}

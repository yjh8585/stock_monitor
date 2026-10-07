import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import AppShell from '@/components/layout/AppShell';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from 'next-themes';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000'
  ),
  title: '한세모빌리티 BI',
  description: '자동차 산업 주요 기업 실적 및 주가 모니터링',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: next-themes 가 렌더 전에 <html> 에 'dark' 클래스를 붙이므로 필요
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="h-dvh overflow-hidden bg-background text-foreground antialiased">
        {/* 기본은 라이트 고정 — 시스템 설정을 따르지 않는다(사용자 선택 2026-10-07) */}
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <Suspense fallback={null}>
            <AppShell>{children}</AppShell>
          </Suspense>
          {/* toast() 알림 표시 영역. 우하단은 챗봇 버튼(fixed bottom-5 right-5), 상단 중앙은
              경영관리 탭 네비게이션과 겹쳐 클릭을 가로막으므로 우측 상단. */}
          <Toaster position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}

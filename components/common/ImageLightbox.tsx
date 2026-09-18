'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 그림 전체화면 확대 팝업 — 조직도 뷰어(`OrgChartViewer`)의 구현을 공용화한 것.
 *
 * - 기본은 **원본 해상도**로 스크롤(차트의 작은 글씨도 또렷) · '화면 맞춤'으로 전체를 한눈에
 * - 원본 크기일 때는 마우스로 잡고 끌어 이동(grab-to-pan)
 * - Esc 또는 배경 클릭으로 닫기 · 열려 있는 동안 배경 스크롤 잠금
 *
 * 🔴 `next/image`를 쓰지 않는다 — 인증 프록시(조직도)·외부 Storage(리포트 그림)라
 *    크기가 제각각이고 최적화 대상이 아니다.
 */
interface ImageLightboxProps {
  src: string;
  alt: string;
  /** 팝업 상단에 표시할 설명 (없으면 alt) */
  label?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, label, onClose }: ImageLightboxProps) {
  const [fitToScreen, setFitToScreen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pan = useRef({ active: false, startX: 0, startY: 0, left: 0, top: 0 });

  const onPanStart = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    pan.current = {
      active: true,
      startX: e.pageX,
      startY: e.pageY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    el.style.cursor = 'grabbing';
  };
  const onPanMove = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el || !pan.current.active) return;
    el.scrollLeft = pan.current.left - (e.pageX - pan.current.startX);
    el.scrollTop = pan.current.top - (e.pageY - pan.current.startY);
  };
  const onPanEnd = () => {
    pan.current.active = false;
    if (scrollRef.current) scrollRef.current.style.cursor = '';
  };

  // Esc로 닫기 + 배경 스크롤 잠금.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const caption = label ?? alt;

  // 배경 불투명도 — 조직도는 뒤가 검은 화면이라 90%로 충분했지만, 보고서 본문(흰 배경)
  // 위에서는 뒤 글씨가 비쳐 상단 바의 제목과 겹쳐 읽힌다 → 95% + 상단 바 자체 배경.
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={`그림 확대 ${caption}`}
      onClick={onClose}
    >
      <div
        className="flex shrink-0 items-center justify-between gap-2 bg-black/70 px-4 py-2 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* min-w-0 이 없으면 flex 자식이 안 줄어들어 truncate 가 동작하지 않는다. */}
        <span className="min-w-0 truncate text-sm font-medium">{caption}</span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setFitToScreen((v) => !v)}
            className="rounded-md border border-white/30 px-3 py-1 text-sm hover:bg-white/10"
          >
            {fitToScreen ? '원본 크기' : '화면 맞춤'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/30 px-3 py-1 text-sm hover:bg-white/10"
          >
            닫기 ✕
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className={
          fitToScreen
            ? 'flex flex-1 items-center justify-center overflow-hidden p-2'
            : 'flex-1 cursor-grab select-none overflow-auto p-2'
        }
        onClick={(e) => e.stopPropagation()}
        onMouseDown={fitToScreen ? undefined : onPanStart}
        onMouseMove={fitToScreen ? undefined : onPanMove}
        onMouseUp={onPanEnd}
        onMouseLeave={onPanEnd}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={fitToScreen ? 'max-h-full max-w-full object-contain' : 'max-w-none bg-white'}
        />
      </div>
    </div>
  );
}

interface ZoomableImageProps {
  src: string;
  alt: string;
  /** 팝업 상단 설명 (없으면 alt) */
  label?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}

/**
 * 클릭하면 `ImageLightbox`로 확대되는 그림.
 *
 * 보고서 본문(`MarkdownView`)·증권사 리포트 하단 갤러리처럼 "그림이 여러 장 흩어져 있고
 * 각각을 크게 보고 싶은" 자리에 쓴다. 조직도처럼 팝업 열림을 바깥에서 제어해야 하면
 * `ImageLightbox`를 직접 쓴다.
 */
export function ZoomableImage({ src, alt, label, className, loading }: ZoomableImageProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={loading}
        role="button"
        tabIndex={0}
        title="클릭하면 크게 봅니다"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`cursor-zoom-in ${className ?? ''}`.trim()}
      />
      {open && <ImageLightbox src={src} alt={alt} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}

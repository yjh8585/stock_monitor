'use client';

import { ZoomableImage } from '@/components/common/ImageLightbox';

interface Props {
  docId: number;
  pages: { page: number; caption: string }[];
}

/**
 * 공식 문서 요약의 근거 쪽 캡처 — 썸네일을 누르면 전체화면으로 확대(research-figure-gallery 와 같은 ZoomableImage).
 * 이미지는 비공개 버킷이라 인증 프록시 /api/customers/doc-page/<docId>/<page> 로만 받는다(Storage 키는 화면에 없다).
 * 카드마다 최대 5장(2026-11-13 3→5)이라 접지 않고 lazy 로만 늦춘다.
 */
export default function CustomerDocPageGallery({ docId, pages }: Props) {
  if (pages.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {pages.map((p) => {
        const label = `${p.page}쪽 · ${p.caption}`;
        return (
          <figure key={p.page} className="w-44 space-y-1">
            {/* next/image 를 쓰지 않는다 — 프록시가 매번 권한을 다시 보는 사외비 이미지라 최적화·캐시 대상이 아니다. */}
            <ZoomableImage
              src={`/api/customers/doc-page/${docId}/${p.page}`}
              alt={label}
              label={label}
              loading="lazy"
              className="w-full rounded border border-border bg-white"
            />
            <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

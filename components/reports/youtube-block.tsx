'use client';

import { useState, type ReactNode } from 'react';

interface Scene {
  /** 재생 시작 초 */
  t: number;
  /** 화면에 표시할 라벨 (예: "1:44") */
  label: string;
  desc: string;
  /** 원문에서 ★ 로 표시된 중요 장면 */
  star?: boolean;
}

interface YoutubeSpec {
  /** 유튜브 영상 ID */
  id: string;
  /** 원문의 영상 번호 (①②③…) */
  no?: string;
  title: string;
  /** 채널 · 길이 · 업로드일 · 조회수 */
  meta?: string;
  /** 말·해설이 없는 영상 */
  silent?: boolean;
  /** 영상 해설(원문 vnote). 서식은 `**굵게**` 뿐이라 renderInline 으로 충분하다. */
  note?: string;
  scenes?: Scene[];
}

interface Props {
  /** ```youtube 코드펜스 안의 JSON 원문 */
  spec: string;
}

function parseSpec(raw: string): YoutubeSpec | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.title !== 'string') return null;
    return parsed as YoutubeSpec;
  } catch {
    return null;
  }
}

/**
 * 장면 설명의 `**굵게**` 만 처리하는 최소 인라인 렌더.
 * 이 블록은 마크다운 파서 바깥이라 강조가 그대로 노출되는 것을 막는다.
 * (원문 장면 설명 296건 중 72곳이 굵게를 쓴다. 전체 마크다운 파서는 과하다.)
 */
function renderInline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      )
    );
}

/**
 * Markdown 의 ```youtube 코드 블록을 유튜브 플레이어 + 주요 장면 표로 렌더링한다.
 *
 * 원본 HTML 보고서(전략개발실 덱)의 동작을 그대로 옮긴 것 —
 * **시각을 누르면 새 탭이 아니라 위 플레이어가 그 지점으로 이동**한다.
 * iframe 의 `key` 에 시작 초를 넣어 재마운트시키는 방식이라 별도 플레이어 API 가 필요 없다.
 *
 * 처음에는 썸네일만 띄운다 — 영상이 30편 넘는 글에서 iframe 을 전부 미리 만들면
 * 유튜브 플레이어 스크립트가 그만큼 로드돼 페이지가 느려진다.
 */
export function YoutubeBlock({ spec }: Props) {
  const [startSec, setStartSec] = useState<number | null>(null);

  const data = parseSpec(spec);
  if (!data) {
    // 조용히 삼키지 않는다 — 원본을 그대로 보여줘 본문 손실을 눈에 띄게 한다.
    return (
      <div className="not-prose my-4 rounded-md border border-dashed p-3 text-sm">
        <p className="text-muted-foreground mb-2">영상 블록을 해석하지 못했습니다.</p>
        <pre className="overflow-x-auto text-xs">
          <code>{spec}</code>
        </pre>
      </div>
    );
  }

  const playing = startSec !== null;

  return (
    // whitespace-normal: 이 블록은 마크다운의 <pre> 안에 렌더되므로 white-space: pre 가
    // 상속된다. 명시하지 않으면 장면 설명이 줄바꿈 없이 옆으로 늘어난다.
    <section className="not-prose my-6 overflow-hidden rounded-lg border whitespace-normal">
      <header className="bg-muted/40 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b px-4 py-3">
        {data.no ? <span className="text-primary font-bold">{data.no}</span> : null}
        <span className="font-semibold">{data.title}</span>
        {data.silent ? (
          <span className="text-muted-foreground rounded border px-1.5 py-0.5 text-xs">
            말·해설 없음
          </span>
        ) : null}
        {data.meta ? (
          <span className="text-muted-foreground w-full text-xs sm:w-auto">{data.meta}</span>
        ) : null}
      </header>

      <div className="relative aspect-video w-full bg-black">
        {playing ? (
          <iframe
            key={startSec}
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${data.id}?start=${startSec}&autoplay=1&rel=0`}
            title={data.title}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setStartSec(0)}
            className="group absolute inset-0 h-full w-full cursor-pointer"
            aria-label={`${data.title} 재생`}
          >
            {/* 유튜브 CDN 썸네일 — next/image 로 최적화할 이유가 없고(이미 적정 크기),
                최적화를 태우면 배포 환경의 이미지 변환 비용만 늘어난다. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`}
              alt=""
              className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
              loading="lazy"
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-20 items-center justify-center rounded-xl bg-black/70 text-2xl text-white transition group-hover:bg-red-600">
                ▶
              </span>
            </span>
          </button>
        )}
      </div>

      {data.note ? (
        <div className="border-b px-4 py-3 text-sm leading-relaxed">{renderInline(data.note)}</div>
      ) : null}

      {data.scenes?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40 text-left">
                <th className="w-20 px-3 py-2 font-medium whitespace-nowrap">시각</th>
                <th className="px-3 py-2 font-medium">주요 장면 — 누르면 그 지점부터 재생됩니다</th>
              </tr>
            </thead>
            <tbody>
              {data.scenes.map((scene, i) => (
                <tr
                  key={`${scene.t}-${i}`}
                  className={scene.star ? 'bg-amber-50/70 dark:bg-amber-950/20' : undefined}
                >
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      onClick={() => setStartSec(scene.t)}
                      className="text-primary cursor-pointer rounded border px-2 py-0.5 font-mono text-xs hover:underline"
                      aria-label={`${scene.label} 부터 재생`}
                    >
                      {scene.label}
                    </button>
                  </td>
                  <td className="px-3 py-2 align-top leading-relaxed">
                    {renderInline(scene.desc)}
                    {scene.star ? <span className="ml-1 text-amber-600">★</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

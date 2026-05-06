'use client';

interface IframePanelProps {
  src: string;
  title: string;
}

/** 주식 정보 사이트 iframe 패널 */
export default function IframePanel({ src, title }: IframePanelProps) {
  return (
    <iframe
      src={src}
      title={title}
      className="w-full h-full border-0"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
    />
  );
}

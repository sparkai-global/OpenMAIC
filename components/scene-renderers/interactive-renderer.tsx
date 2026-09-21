'use client';

import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import type { InteractiveContent } from '@/lib/types/stage';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';
import { INTERACTIVE_PAD_VIEWPORT, patchHtmlForIframe } from '@/lib/utils/iframe';

interface InteractiveRendererProps {
  readonly content: InteractiveContent;
  readonly sceneId: string;
}

export function InteractiveRenderer({ content, sceneId }: InteractiveRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [containerSize, setContainerSize] = useState({
    width: INTERACTIVE_PAD_VIEWPORT.width,
    height: INTERACTIVE_PAD_VIEWPORT.height,
  });
  const registerIframe = useWidgetIframeStore((state) => state.registerIframe);
  const setActiveScene = useWidgetIframeStore((state) => state.setActiveScene);

  const patchedHtml = useMemo(
    () => (content.html ? patchHtmlForIframe(content.html) : undefined),
    [content.html],
  );

  // Create iframe messaging callback
  const sendMessageToIframe = useCallback((type: string, payload: Record<string, unknown>) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type, ...payload }, '*');
    }
  }, []);

  // Register iframe messaging callback on mount, unregister on unmount
  // Key by sceneId to prevent race conditions on scene switch
  useEffect(() => {
    registerIframe(sceneId, sendMessageToIframe);
    setActiveScene(sceneId);
    return () => {
      registerIframe(sceneId, null);
    };
  }, [sceneId, registerIframe, sendMessageToIframe, setActiveScene]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      setContainerSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  const frameLayout = useMemo(() => {
    const scale = Math.min(
      containerSize.width / INTERACTIVE_PAD_VIEWPORT.width,
      containerSize.height / INTERACTIVE_PAD_VIEWPORT.height,
    );
    const safeScale = Math.max(0.1, scale);
    const scaledWidth = INTERACTIVE_PAD_VIEWPORT.width * safeScale;
    const scaledHeight = INTERACTIVE_PAD_VIEWPORT.height * safeScale;

    return {
      scale: safeScale,
      left: Math.max(0, (containerSize.width - scaledWidth) / 2),
      top: Math.max(0, (containerSize.height - scaledHeight) / 2),
    };
  }, [containerSize]);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-white">
      <iframe
        ref={iframeRef}
        srcDoc={patchedHtml}
        src={patchedHtml ? undefined : content.url}
        className="absolute border-0"
        style={{
          width: `${INTERACTIVE_PAD_VIEWPORT.width}px`,
          height: `${INTERACTIVE_PAD_VIEWPORT.height}px`,
          left: `${frameLayout.left}px`,
          top: `${frameLayout.top}px`,
          transform: `scale(${frameLayout.scale})`,
          transformOrigin: 'top left',
        }}
        title={`Interactive Scene ${sceneId}`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}

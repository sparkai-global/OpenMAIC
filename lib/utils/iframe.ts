export const INTERACTIVE_PAD_VIEWPORT = {
  width: 1024,
  height: 576,
} as const;

function injectIntoHead(html: string, injection: string): string {
  const headOpenMatch = html.match(/<head(?:\s[^>]*)?>/i);
  if (headOpenMatch?.index !== undefined) {
    const insertPos = headOpenMatch.index + headOpenMatch[0].length;
    return html.substring(0, insertPos) + '\n' + injection + html.substring(insertPos);
  }

  return injection + html;
}

function upsertViewportMeta(html: string): string {
  const viewportMeta = `<meta name="viewport" content="width=${INTERACTIVE_PAD_VIEWPORT.width}, initial-scale=1.0">`;
  const viewportMetaPattern = /<meta\b(?=[^>]*\bname=["']viewport["'])[^>]*>/i;

  if (viewportMetaPattern.test(html)) {
    return html.replace(viewportMetaPattern, viewportMeta);
  }

  return injectIntoHead(html, viewportMeta);
}

/**
 * Patch embedded HTML to display correctly inside an iframe.
 *
 * The interactive classroom runs primarily on tablets. Keep generated widgets
 * on a tablet-sized layout viewport and let the outer renderer scale the full
 * iframe when the available stage area is smaller.
 */
export function patchHtmlForIframe(html: string): string {
  const htmlWithViewport = upsertViewportMeta(html);

  if (htmlWithViewport.includes('data-iframe-patch')) {
    return htmlWithViewport;
  }

  const iframeCss = `<style data-iframe-patch>
  html, body {
    width: 100%;
    min-width: ${INTERACTIVE_PAD_VIEWPORT.width}px;
    height: 100%;
    min-height: ${INTERACTIVE_PAD_VIEWPORT.height}px;
    margin: 0;
    padding: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }
  *, *::before, *::after {
    box-sizing: border-box;
  }
  /* Fix min-h-screen: in iframes 100vh is the iframe height, which is correct,
     but ensure body actually fills it */
  body {
    min-height: 100vh;
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
  }
</style>`;

  return injectIntoHead(htmlWithViewport, iframeCss);
}

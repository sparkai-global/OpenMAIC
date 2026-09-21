import { describe, expect, test } from 'vitest';
import { INTERACTIVE_PAD_VIEWPORT, patchHtmlForIframe } from '@/lib/utils/iframe';

describe('patchHtmlForIframe', () => {
  test('forces embedded pages to use the tablet viewport', () => {
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>`;

    const patched = patchHtmlForIframe(html);

    expect(patched).toContain(
      `<meta name="viewport" content="width=${INTERACTIVE_PAD_VIEWPORT.width}, initial-scale=1.0">`,
    );
    expect(patched).toContain(`min-width: ${INTERACTIVE_PAD_VIEWPORT.width}px`);
    expect(patched).toContain(`min-height: ${INTERACTIVE_PAD_VIEWPORT.height}px`);
    expect(patched.match(/data-iframe-patch/g)).toHaveLength(1);
  });

  test('adds viewport metadata when the generated HTML omits it', () => {
    const html = `<!doctype html><html><head><title>Widget</title></head><body></body></html>`;

    const patched = patchHtmlForIframe(html);

    expect(patched).toContain(
      `<meta name="viewport" content="width=${INTERACTIVE_PAD_VIEWPORT.width}, initial-scale=1.0">`,
    );
  });
});

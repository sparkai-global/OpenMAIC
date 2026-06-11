/**
 * HTML Validator — Layer 2 (Runtime DOM + axe-core checks)
 *
 * Renders generated widget HTML in a headless Chromium and inspects the live
 * DOM. Catches bugs that Layer 1 (regex) cannot see:
 *   - JavaScript errors during load
 *   - Failed CDN / resource fetches
 *   - Computed CSS that breaks interaction (e.g., pointer-events: none
 *     inherited from a parent container — silently un-clickable)
 *   - Zero-sized or off-viewport interactive elements
 *   - Mobile-viewport layout breakage
 *   - Accessibility issues (button without name, low contrast, etc.) via
 *     axe-core (the industry-standard a11y scanner used by Microsoft / Google)
 *
 * Each error message is concrete and actionable so the retry LLM call has
 * enough specifics to fix it.
 */

import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createLogger } from '@/lib/logger';
import type { ValidationResult } from './html-validator';

const log = createLogger('html-validator-runtime');

/**
 * axe-core rules that are designed for full-page documents and do not apply
 * to OpenMAIC widget HTML (which is embedded inside iframes and is not a
 * standalone page). Suppress to avoid noise.
 */
const AXE_DISABLED_RULES = [
  'landmark-one-main', // widget is not a full page
  'page-has-heading-one', // widget does not need <h1>
  'region', // widget content does not need landmark wrappers
  'document-title', // widget may have no <title>
  'html-has-lang', // widget HTML root may omit lang
];

/** Cap on how many axe violations get surfaced to the LLM (avoid prompt bloat). */
const MAX_AXE_VIOLATIONS = 5;

// Module-level browser cache — launching Chromium takes ~1s, so reuse across calls.
let cachedBrowser: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (!cachedBrowser || !cachedBrowser.isConnected()) {
    // Use system chromium when PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is set
    // (Alpine-based images install via apk; Playwright's bundled Chromium does
    // not run on musl). On macOS / Debian dev environments the env var is
    // unset and Playwright falls back to its own bundled Chromium.
    // --no-sandbox is required in Docker containers (no user namespaces).
    // --disable-dev-shm-usage avoids "Page crashed!" when /dev/shm is small
    // (Docker default is 64MB; complex WebGL widgets can exhaust it).
    // Both flags are harmless on local dev where the bundled Chromium ignores them.
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    cachedBrowser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return cachedBrowser;
}

/**
 * Run all Layer 2 checks against the rendered HTML.
 * Returns passed=true if no issues are found.
 */
export async function validateGeneratedHtmlRuntime(
  html: string,
  widgetType?: string,
): Promise<ValidationResult> {
  const errors: string[] = [];
  let context: BrowserContext | null = null;

  try {
    const browser = await getBrowser();
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    // ─── 1. Capture runtime errors during page load ────────────────────────
    page.on('pageerror', (err) => {
      errors.push(`JavaScript error during page load: ${err.message}`);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`Console error during load: ${msg.text().substring(0, 200)}`);
      }
    });

    // Resources that browsers auto-request and are not part of widget HTML —
    // their 404s are noise, not real bugs.
    const isBrowserAutoRequest = (url: string) =>
      /\/favicon\.ico(\?|$)/.test(url) ||
      /\.(js|css)\.map(\?|$)/.test(url) ||
      /\/robots\.txt(\?|$)/.test(url) ||
      /\/apple-touch-icon[^/]*\.png(\?|$)/.test(url) ||
      /\/manifest\.json(\?|$)/.test(url);

    page.on('response', (resp) => {
      if (resp.status() < 400) return;
      const url = resp.url();
      if (isBrowserAutoRequest(url)) return;
      errors.push(`Resource failed to load (HTTP ${resp.status()}): ${url.substring(0, 100)}`);
    });

    // ─── 2. Load the HTML ──────────────────────────────────────────────────
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 });

    // ─── 3. CRITICAL: pointer-events: none breaking interaction ────────────
    // Two checks:
    //   (a) Currently-visible interactive elements with pointer-events: none.
    //   (b) Large containers (e.g., #playfield) with pointer-events: none —
    //       will silently break tiles / buttons that get added later by JS
    //       (this is today's Sentence Builder bug pattern).
    const pointerEventsIssues = await page.evaluate(() => {
      const offenders: Array<{ kind: 'interactive' | 'container'; info: string; html: string }> = [];

      // (a) Currently rendered interactive elements
      const interactiveSelectors = [
        'button',
        '.tile',
        '.draggable',
        '[draggable="true"]',
        '.slot',
        '.dropzone',
        '.word',
        '[data-word]',
        '[onclick]',
        'input',
        'select',
        'textarea',
      ];
      for (const sel of interactiveSelectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (getComputedStyle(el).pointerEvents === 'none') {
            offenders.push({
              kind: 'interactive',
              info: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
              html: el.outerHTML.substring(0, 150),
            });
            if (offenders.length >= 3) return offenders;
          }
        }
      }

      // (b) Large containers blocking future-rendered children
      // Heuristic: an element with pointer-events: none whose tag is a typical
      // container, with bounding box width > 200 AND height > 100, AND has at
      // least one child (so it's likely a non-decorative container).
      const containerTags = new Set(['div', 'main', 'section', 'article', 'form']);
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (!containerTags.has(el.tagName.toLowerCase())) continue;
        if (getComputedStyle(el).pointerEvents !== 'none') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 200 || rect.height < 100) continue;
        if (el.children.length === 0) continue; // empty decoration, skip
        offenders.push({
          kind: 'container',
          info: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ` (${rect.width.toFixed(0)}x${rect.height.toFixed(0)})`,
          html: el.outerHTML.substring(0, 150).replace(/\s+/g, ' '),
        });
        if (offenders.length >= 3) return offenders;
      }

      return offenders;
    });

    const containerOffenders = pointerEventsIssues.filter((o) => o.kind === 'container');
    const interactiveOffenders = pointerEventsIssues.filter((o) => o.kind === 'interactive');

    if (containerOffenders.length > 0) {
      errors.push(
        `CRITICAL: ${containerOffenders.length} large container(s) have CSS pointer-events: none, which will silently block interaction for ALL descendants (including buttons, tiles, and elements added later by JavaScript). Remove pointer-events: none from these containers — only use it on purely decorative elements (overlays, particles). Offending container: ${containerOffenders[0].info}. CSS snippet: ${containerOffenders[0].html}`,
      );
    }
    if (interactiveOffenders.length > 0) {
      errors.push(
        `CRITICAL: ${interactiveOffenders.length} interactive element(s) have computed pointer-events: none — they cannot be clicked or touched. Check ancestors for pointer-events: none and remove it. First offender: ${interactiveOffenders[0].info}: ${interactiveOffenders[0].html}`,
      );
    }

    // ─── Touch-action: tablet drag requires touch-action: none ────────────
    const touchActionMissing = await page.evaluate(() => {
      for (const el of document.querySelectorAll('.tile, .draggable, [draggable="true"]')) {
        if (getComputedStyle(el).touchAction !== 'none') {
          return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ': ' + el.outerHTML.substring(0, 80);
        }
      }
      return null;
    });
    if (touchActionMissing) {
      errors.push(
        `Draggable element missing CSS \`touch-action: none\`. On touchscreens (iPad), finger-drag will be hijacked as page scroll instead of moving the tile. Add \`touch-action: none\` to all draggables. Offender: ${touchActionMissing}`,
      );
    }

    // ─── Content clipped inside overflow:hidden ancestor ─────────────────
    const overflowOffenders = await page.evaluate(() => {
      const out: Array<{ container: string; child: string; by: number }> = [];
      for (const el of document.querySelectorAll('*')) {
        if (getComputedStyle(el).overflow !== 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.height < 200) continue;
        for (const child of el.querySelectorAll('*')) {
          const cr = child.getBoundingClientRect();
          if (cr.bottom > rect.bottom + 1 && cr.width > 0 && cr.height > 0) {
            out.push({
              container: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
              child: child.tagName.toLowerCase() + (child.id ? '#' + child.id : ''),
              by: Math.round(cr.bottom - rect.bottom),
            });
            break;
          }
        }
        if (out.length >= 3) break;
      }
      return out;
    });
    if (overflowOffenders.length > 0) {
      const o = overflowOffenders[0];
      errors.push(
        `Content clipped by overflow:hidden: <${o.child}> extends ${o.by}px below <${o.container}> and is invisible. Either remove \`overflow: hidden\` from <${o.container}>, increase its height, or shrink the inner content.`,
      );
    }

    // ─── 4. Button position & size (desktop viewport) ──────────────────────
    // Only check buttons that ARE meant to be visible right now. Skip ones
    // hidden by display:none on an ancestor (e.g., buttons inside a hidden
    // pause/end screen) — those are intentionally hidden, not broken.
    const buttons = await page.$$('button');
    for (const btn of buttons.slice(0, 10)) {
      const isCurrentlyHidden = await btn.evaluate((el) => {
        const html = el as HTMLElement;
        return html.offsetParent === null && getComputedStyle(html).position !== 'fixed';
      });
      if (isCurrentlyHidden) continue;

      const box = await btn.boundingBox();
      const text = ((await btn.textContent()) || '').trim().substring(0, 30) || '(no text)';
      if (!box) {
        errors.push(`<button>"${text}"</button> is rendered but not visible (no boundingBox)`);
        continue;
      }
      if (box.width === 0 || box.height === 0) {
        errors.push(
          `<button>"${text}"</button> has zero size (width=${box.width.toFixed(0)}, height=${box.height.toFixed(0)})`,
        );
      }
      if (box.x + box.width > 1280 || box.y + box.height > 720) {
        errors.push(
          `<button>"${text}"</button> outside 1280x720 viewport at (${box.x.toFixed(0)}, ${box.y.toFixed(0)})`,
        );
      }
    }

    // ─── Click Start → catch runtime errors + state-change failure ──────
    // Use explicit class names and exact onclick targets to avoid matching
    // restart / startEngine / startTimer etc.
    const startBtn = await page.$(
      '.start-btn, .startBtn, .start-button, [data-action="start"], [onclick^="startGame("], [onclick="startGame()"]',
    );
    if (startBtn) {
      const tilesBefore = await page.evaluate(() =>
        document.querySelectorAll('.tile, .draggable, .token, [draggable="true"]').length,
      );
      const errsBeforeStart = errors.length;
      try {
        await startBtn.click({ timeout: 2000 });
        await page.waitForTimeout(800);
      } catch {}
      const tilesAfter = await page.evaluate(() =>
        document.querySelectorAll('.tile, .draggable, .token, [draggable="true"]').length,
      );
      const startBtnHidden = await startBtn.evaluate(
        (el) => (el as HTMLElement).offsetParent === null,
      );
      if (errors.length === errsBeforeStart && tilesAfter === tilesBefore && !startBtnHidden) {
        errors.push(
          `Start button clicked but produced no observable state change (no JS error, no new tile/draggable elements). The start handler may not be wired up — verify it sets the gameStarted flag and hides the start screen.`,
        );
      }
    }

    // ─── Drag-and-drop smoke test ────────────────────────────────────────
    // Explicit drop zone class names to avoid matching dropdown / drop-shadow /
    // builder-tab / build-status etc.
    // Explicit, semantically-specific drop zone class names only. Avoid generic
    // layout names like .category / .column that appear in non-drag widgets.
    const DROP_ZONE_SELECTOR =
      '#buildZone, .build-zone, .buildZone, .slots, .slot, .bin, .dropzone, .drop-zone, .dropbox';
    const dragTarget = await page.evaluate((dropSel) => {
      const tile = Array.from(
        document.querySelectorAll('.tile, .draggable, [draggable="true"]'),
      ).find((el) => !el.closest(dropSel));
      const drop = document.querySelector(dropSel);
      if (!tile || !drop) return null;
      const t = tile.getBoundingClientRect();
      const d = drop.getBoundingClientRect();
      return {
        fromX: t.x + t.width / 2,
        fromY: t.y + t.height / 2,
        toX: d.x + d.width / 2,
        toY: d.y + d.height / 2,
      };
    }, DROP_ZONE_SELECTOR);
    if (dragTarget) {
      const errsBeforeDrag = errors.length;
      await page.mouse.move(dragTarget.fromX, dragTarget.fromY);
      await page.mouse.down();
      await page.mouse.move(dragTarget.toX, dragTarget.toY, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const dropOccupied = await page.evaluate(
        (dropSel) => {
          for (const zone of document.querySelectorAll(dropSel)) {
            if (zone.querySelector('.tile, .draggable, .token, [draggable="true"]')) return true;
          }
          return false;
        },
        DROP_ZONE_SELECTOR,
      );
      if (!dropOccupied && errors.length === errsBeforeDrag) {
        errors.push(
          `Drag-and-drop smoke test failed: simulated dragging a tile to the drop zone, but no tile ended up inside the drop zone afterwards. Likely causes: pointerdown handler not attached to tiles, drop detection logic broken, or game state (gameStarted flag) prevented drag.`,
        );
      }
    }

    // ─── 5. Mobile viewport check (iPhone) ─────────────────────────────────
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);

    const mobileBtns = await page.$$('button');
    for (const btn of mobileBtns.slice(0, 5)) {
      const box = await btn.boundingBox();
      if (box && box.x + box.width > 375) {
        const text = ((await btn.textContent()) || '').trim().substring(0, 30) || '(no text)';
        errors.push(`Mobile viewport (iPhone 375px): <button>"${text}"</button> overflows`);
      }
    }

    // Switch back to desktop viewport for axe-core scan
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);

    // ─── 6. axe-core accessibility scan ────────────────────────────────────
    try {
      const axeResults = await new AxeBuilder({ page })
        .disableRules(AXE_DISABLED_RULES)
        .analyze();

      for (const v of axeResults.violations.slice(0, MAX_AXE_VIOLATIONS)) {
        const sample = v.nodes[0]?.html?.substring(0, 100) ?? '';
        errors.push(
          `Accessibility (${v.id}): ${v.help} — ${v.nodes.length} element(s) affected. Sample: ${sample}`,
        );
      }
    } catch (axeErr) {
      log.warn(`axe-core scan failed (non-fatal): ${(axeErr as Error).message}`);
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.toLowerCase().includes('timeout')) {
      errors.push(
        `Page took too long to load (>30s). This may indicate broken CDN URLs, infinite JavaScript loop, or unresponsive resource.`,
      );
    } else {
      log.warn(`Layer 2 validation crashed: ${msg}`);
      // Crash should not block widget delivery — fall through with whatever errors collected.
    }
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {
        // Ignore close errors.
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors: errors.slice(0, 8),
    totalErrorCount: errors.length,
  };
}

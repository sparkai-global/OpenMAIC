/**
 * HTML Validator — Layer 2 (Runtime DOM checks)
 *
 * Renders generated widget HTML in a headless Chromium and inspects the live
 * DOM. Catches bugs that Layer 1 (regex) cannot see:
 *   - JavaScript errors during load
 *   - Failed CDN / resource fetches
 *   - Computed CSS that breaks interaction (e.g., pointer-events: none
 *     inherited from a parent container — silently un-clickable)
 *   - Zero-sized or off-viewport interactive elements
 *   - Mobile-viewport layout breakage
 *
 * Each error message is concrete and actionable so the retry LLM call has
 * enough specifics to fix it.
 */

import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { createLogger } from '@/lib/logger';
import type { ValidationResult } from './html-validator';

const log = createLogger('html-validator-runtime');

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
    // Filter errors specific to the about:blank context Playwright uses for
    // setContent — localStorage/sessionStorage access fails here but works
    // in real iframe deployment. Match only browser-specific phrases for this
    // failure mode so real "null reference" bugs that happen to mention
    // localStorage are still reported.
    const isLayer2EnvironmentArtifact = (msg: string) =>
      /(localStorage|sessionStorage)/i.test(msg) &&
      /(SecurityError|Access is denied for this document|operation is insecure)/i.test(msg);

    // When init code crashes on an env artifact, downstream checks (Start
    // click, drag smoke test) get misleading results because the game state
    // is half-initialized. Track this so we can skip those checks.
    let envArtifactCount = 0;

    page.on('pageerror', (err) => {
      if (isLayer2EnvironmentArtifact(err.message)) {
        envArtifactCount++;
        return;
      }
      errors.push(`JavaScript error during page load: ${err.message}`);
    });

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isLayer2EnvironmentArtifact(text)) {
        envArtifactCount++;
        return;
      }
      errors.push(`Console error during load: ${text.substring(0, 200)}`);
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

    // Pages that allow scrolling can legitimately have content outside the
    // initial viewport; viewport-overflow checks would be false positives.
    const pageScrollable = await page.evaluate(() => {
      const htmlOv = getComputedStyle(document.documentElement).overflow;
      const bodyOv = getComputedStyle(document.body).overflow;
      return htmlOv !== 'hidden' && bodyOv !== 'hidden';
    });

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
          // Skip SVG descendants — their "overflow" is by design (viewBox/pan/zoom),
          // and Canvas content lives in its own coordinate system.
          if (child.closest('svg') || child.tagName === 'CANVAS') continue;
          const cr = child.getBoundingClientRect();
          // 50px threshold avoids sub-pixel rounding, decorative border/shadow
          // bleed, and minor CSS noise that LLM cannot meaningfully fix.
          if (cr.bottom > rect.bottom + 50 && cr.width > 0 && cr.height > 0) {
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
      if (!pageScrollable && (box.x + box.width > 1280 || box.y + box.height > 720)) {
        errors.push(
          `<button>"${text}"</button> outside 1280x720 viewport at (${box.x.toFixed(0)}, ${box.y.toFixed(0)}) on a non-scrollable page (html/body overflow:hidden)`,
        );
      }
    }

    // ─── Click Start → catch runtime errors + state-change failure ──────
    // Use explicit class names and exact onclick targets to avoid matching
    // restart / startEngine / startTimer etc.
    const startBtn = await page.$(
      '.start-btn, .startBtn, .start-button, [data-action="start"], [onclick^="startGame("], [onclick="startGame()"]',
    );
    // If no Start button exists, assume the game is interactive immediately.
    // If Start exists, gameStarted is true only after a successful click that
    // produced an observable state change.
    let gameStarted = !startBtn;
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
      gameStarted = startBtnHidden || tilesAfter > tilesBefore;
      // Skip "no state change" report when env artifact may have crashed init —
      // the game state is unreliable in that path.
      if (
        envArtifactCount === 0 &&
        errors.length === errsBeforeStart &&
        tilesAfter === tilesBefore &&
        !startBtnHidden
      ) {
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
      // Tag the specific tile we are about to drag so the post-drag check
      // can verify whether THIS tile (not some other tile that already
      // happened to overlap a drop zone) ended up inside a zone.
      tile.setAttribute('data-l2-tracking', '1');
      const t = tile.getBoundingClientRect();
      const d = drop.getBoundingClientRect();
      return {
        fromX: t.x + t.width / 2,
        fromY: t.y + t.height / 2,
        toX: d.x + d.width / 2,
        toY: d.y + d.height / 2,
      };
    }, DROP_ZONE_SELECTOR);
    // Skip drag test if game never started OR if env artifacts crashed init.
    // Drag handlers usually check game.active before processing, so a half-
    // initialized game would always report drag failure — but it's a cascade,
    // not a real bug.
    if (dragTarget && gameStarted && envArtifactCount === 0) {
      const errsBeforeDrag = errors.length;
      await page.mouse.move(dragTarget.fromX, dragTarget.fromY);
      await page.mouse.down();
      await page.mouse.move(dragTarget.toX, dragTarget.toY, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const dropOccupied = await page.evaluate(
        (dropSel) => {
          // Only the specific tile that was just dragged is checked — avoids
          // false-positive "success" caused by other tiles already sitting on
          // top of a drop zone (e.g., pre-placed hint tiles).
          const tracked = document.querySelector('[data-l2-tracking="1"]');
          if (!tracked) return false;
          // (a) Tile is now a DOM descendant of a drop zone.
          if (tracked.closest(dropSel)) return true;
          // (b) Tile's center now sits inside a drop zone's bounding box
          // (common pattern: tile stays at game-area level, repositioned to
          // visually overlay a slot).
          const tr = tracked.getBoundingClientRect();
          const cx = tr.left + tr.width / 2;
          const cy = tr.top + tr.height / 2;
          for (const zone of document.querySelectorAll(dropSel)) {
            const zr = zone.getBoundingClientRect();
            if (cx >= zr.left && cx <= zr.right && cy >= zr.top && cy <= zr.bottom) {
              return true;
            }
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
      if (box && box.x + box.width > 375 && !pageScrollable) {
        const text = ((await btn.textContent()) || '').trim().substring(0, 30) || '(no text)';
        errors.push(
          `Mobile viewport (iPhone 375px): <button>"${text}"</button> overflows on a non-scrollable page`,
        );
      }
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

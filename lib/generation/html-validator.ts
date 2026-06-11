/**
 * HTML Validator — Layer 1 (Regex-based static analysis)
 *
 * Scans generated widget HTML for common code-level bugs using regex patterns.
 * Does NOT render the HTML — pure string analysis, runs in milliseconds.
 *
 * Returns human-readable error messages intended to be fed back to the LLM
 * as part of a retry prompt.
 */

import { parse as parseJs } from 'acorn';
import { createLogger } from '@/lib/logger';

const log = createLogger('html-validator');

/**
 * Known typos that LLMs frequently produce. Each entry causes a runtime
 * "X is not defined" / "X is not a function" error, so the widget appears
 * broken at load time.
 */
const KNOWN_TYPOS: ReadonlyArray<{ wrong: RegExp; hint: string }> = [
  { wrong: /\bdocumnt\b/, hint: 'documnt → document' },
  { wrong: /\bdocumenet\b/, hint: 'documenet → document' },
  { wrong: /\bdocuemnt\b/, hint: 'docuemnt → document' },
  { wrong: /\baddEvenetListener\b/, hint: 'addEvenetListener → addEventListener' },
  { wrong: /\baddEventListner\b/, hint: 'addEventListner → addEventListener' },
  { wrong: /\baddEvetListener\b/, hint: 'addEvetListener → addEventListener' },
  { wrong: /\bgetElementByID\b/, hint: 'getElementByID → getElementById (lowercase d)' },
  { wrong: /\bquereySelector\b/, hint: 'quereySelector → querySelector' },
  { wrong: /\bqureySelector\b/, hint: 'qureySelector → querySelector' },
  { wrong: /\binnerHtml\b/, hint: 'innerHtml → innerHTML (all caps HTML)' },
];

/**
 * Cap on how many errors are reported back to the LLM in a single retry.
 * Prevents retry prompt bloat when LLM produces extremely broken HTML.
 */
export const MAX_ERRORS_REPORTED = 8;

export interface ValidationResult {
  passed: boolean;
  /** Errors actually included in the retry prompt (capped to MAX_ERRORS_REPORTED). */
  errors: string[];
  /** True count of issues found, possibly greater than errors.length when truncated. */
  totalErrorCount: number;
}

/**
 * Run all Layer 1 regex checks on HTML. Returns passed=true if no issues.
 *
 * This is the fast static-analysis layer — runs in milliseconds, no rendering.
 * Called by validateGeneratedHtml() below as the first step.
 *
 * @param widgetType Optional widget type. When provided, enables type-specific
 *   checks (e.g., Three.js completeness for visualization3d).
 */
function runLayer1Checks(html: string, widgetType?: string): ValidationResult {
  const errors: string[] = [];

  // Check #1: mouse events without pointer events — drag fails on touch devices
  if (/\bmousedown\b/.test(html) && !/\bpointerdown\b/.test(html)) {
    errors.push(
      'Uses mousedown but not pointerdown. Drag will not work on touch devices (tablets/phones). Use Pointer Events instead.',
    );
  }

  // Check #2: draggable elements missing touch-action: none — browser hijacks gesture as scroll
  // Note: \b treats - as a word boundary, so naive \bdraggable\b would falsely match
  // class names like "not-draggable" / "draggable-item" and attributes like data-draggable.
  // We tokenize class lists and use a stricter lookbehind for the attribute form.
  const hasDraggableClass = [...html.matchAll(/class=["']([^"']*)["']/g)].some(([, classes]) =>
    classes.split(/\s+/).includes('draggable'),
  );
  const hasDraggableAttr = /(?<![-\w])draggable=["']true["']/.test(html);
  const hasDraggable = hasDraggableClass || hasDraggableAttr;
  // HEURISTIC: we only check whether touch-action: none appears anywhere in the document,
  // not whether it actually applies to the draggable element. So a widget that sets
  // touch-action: none on .button but forgets it on the actually-draggable .canvas will
  // pass this check despite still having the bug. Strict checking would require a CSS
  // parser + selector matching, which is out of scope for Layer 1 (regex). This is best
  // effort: catches the "completely forgot touch-action" case, misses the "wrong selector"
  // case.
  const hasTouchActionNone = /touch-action\s*:\s*none/.test(html);
  if (hasDraggable && !hasTouchActionNone) {
    errors.push(
      'Has draggable elements but CSS is missing touch-action: none. Browser will hijack the gesture as scroll on tablets.',
    );
  }

  // Check #3: onclick references undefined function (most common "button does nothing" cause)
  // Strategy: count total occurrences vs occurrences inside onclick="..." attributes.
  // If they're equal, the function only appears in onclick and is never defined.
  // This approach is robust against mixed quote styles like onclick='foo("bar")'.
  const onclickMatches = [...html.matchAll(/onclick=["'](\w+)\s*\(/g)];
  const reportedFns = new Set<string>();
  for (const m of onclickMatches) {
    const funcName = m[1];
    if (reportedFns.has(funcName)) continue;

    const totalCount = (html.match(new RegExp(`\\b${funcName}\\b`, 'g')) || []).length;
    const inOnclickCount = (
      html.match(new RegExp(`onclick=["']${funcName}\\b`, 'g')) || []
    ).length;

    if (totalCount <= inOnclickCount) {
      errors.push(
        `onclick="${funcName}()" references undefined function "${funcName}". Clicking will silently do nothing. Define this function in a <script> block.`,
      );
      reportedFns.add(funcName);
    }
  }

  // Check #4: pointerdown without setPointerCapture — drag breaks at element bounds
  if (/\bpointerdown\b/.test(html) && !/setPointerCapture/.test(html)) {
    errors.push(
      'Uses pointerdown but missing setPointerCapture(). Drag will stop firing when finger moves outside element bounds.',
    );
  }

  // Check #5: mixing e.touches[] with pointer events — runtime crash
  if (/\bpointerdown\b/.test(html) && /\be\.touches\[/.test(html)) {
    errors.push(
      'Pointer events do not have e.touches property. Using e.touches[] alongside pointer events will throw a runtime error and crash the widget.',
    );
  }

  // Check #6: multiple DOCTYPE declarations (LLM duplicated output)
  const doctypeCount = (html.match(/<!DOCTYPE\s+html/gi) || []).length;
  if (doctypeCount > 1) {
    errors.push(
      `Output contains ${doctypeCount} <!DOCTYPE html> declarations. Should be exactly 1. Output the HTML document only once.`,
    );
  }

  // Check #7: malformed HTML structure
  const htmlOpenCount = (html.match(/<html[\s>]/gi) || []).length;
  const htmlCloseCount = (html.match(/<\/html>/gi) || []).length;
  const bodyOpenCount = (html.match(/<body[\s>]/gi) || []).length;
  const bodyCloseCount = (html.match(/<\/body>/gi) || []).length;
  if (htmlOpenCount !== 1 || htmlCloseCount !== 1) {
    errors.push(
      `<html> tag should appear exactly once. Got: ${htmlOpenCount} opening, ${htmlCloseCount} closing.`,
    );
  }
  if (bodyOpenCount !== 1 || bodyCloseCount !== 1) {
    errors.push(
      `<body> tag should appear exactly once. Got: ${bodyOpenCount} opening, ${bodyCloseCount} closing.`,
    );
  }

  // Check #8: parse all inline <script> blocks with acorn — catches syntax errors
  // that would crash the page on load (missing brackets, unclosed strings, etc.).
  // - Excludes external scripts (src=...)
  // - Excludes non-JS script blocks (application/json, importmap) at the regex level
  // - Parses modules and classic scripts using the right mode based on type attribute
  const scriptBlocks = [
    ...html.matchAll(
      /<script(?![^>]*\bsrc=)(?![^>]*\btype=["'](?:application\/json|importmap)["'])([^>]*)>([\s\S]*?)<\/script>/g,
    ),
  ];
  for (const [, attrs, code] of scriptBlocks) {
    const trimmed = code.trim();
    if (!trimmed) continue;
    const isModule = /\btype=["']module["']/.test(attrs);
    try {
      parseJs(trimmed, {
        ecmaVersion: 'latest',
        sourceType: isModule ? 'module' : 'script',
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
      });
    } catch (e) {
      const msg = (e as Error).message.split(/\s*\(/)[0].trim();
      errors.push(
        `JavaScript syntax error in <script> block: "${msg}". The widget will fail to load. Fix the syntax error.`,
      );
      break; // One syntax error is enough — don't spam multiple errors from the same root cause.
    }
  }

  // Check #9: known typos LLMs frequently make — cause runtime "X is not defined" errors.
  for (const { wrong, hint } of KNOWN_TYPOS) {
    if (wrong.test(html)) {
      errors.push(
        `Possible typo detected (${hint}). This will cause a runtime error and the widget will not work.`,
      );
    }
  }

  // Check #13: visualization3d widgets need a complete Three.js setup, otherwise
  // the scene renders as a black screen or a static frozen frame.
  if (widgetType === 'visualization3d') {
    if (!/new\s+THREE\.Scene\s*\(/.test(html)) {
      errors.push(
        'visualization3d widget is missing "new THREE.Scene()". The 3D scene will not be created.',
      );
    }
    if (!/new\s+THREE\.(Perspective|Orthographic)Camera/.test(html)) {
      errors.push(
        'visualization3d widget is missing a camera creation (new THREE.PerspectiveCamera or OrthographicCamera). Nothing will be visible.',
      );
    }
    if (!/renderer\.render\s*\(/.test(html)) {
      errors.push(
        'visualization3d widget is missing renderer.render() call. The scene will never be drawn.',
      );
    }
    if (!/requestAnimationFrame/.test(html)) {
      errors.push(
        'visualization3d widget is missing requestAnimationFrame. The 3D scene will be static and OrbitControls damping will not work.',
      );
    }
  }

  const totalErrorCount = errors.length;
  const reportedErrors = errors.slice(0, MAX_ERRORS_REPORTED);

  if (totalErrorCount > 0) {
    log.debug(`Validation found ${totalErrorCount} issue(s)`);
  }

  return {
    passed: totalErrorCount === 0,
    errors: reportedErrors,
    totalErrorCount,
  };
}

/**
 * Errors from Layer 1 that mean "the HTML is so broken that rendering it
 * won't tell us anything new". We skip Layer 2 when these are present.
 */
function hasCriticalLayer1Error(errors: string[]): boolean {
  return errors.some(
    (e) =>
      e.includes('JavaScript syntax error') ||
      e.includes('<html> tag should appear exactly once') ||
      e.includes('<body> tag should appear exactly once'),
  );
}

/**
 * Validate generated widget HTML using Layer 1 (regex, fast) then Layer 2
 * (headless Chromium + axe-core, slower but catches runtime/render bugs).
 *
 * Layer 2 is skipped when:
 *   - Layer 1 found a critical error that would prevent rendering
 *   - Environment variable VALIDATOR_LAYER2 is set to 'false'
 *   - Layer 2 throws (graceful degradation — Layer 1 result is still returned)
 *
 * The combined error list (capped to MAX_ERRORS_REPORTED) is fed back to the
 * LLM as part of the retry prompt by scene-generator.ts.
 *
 * @param widgetType Optional widget type. Enables type-specific checks.
 */
export async function validateGeneratedHtml(
  html: string,
  widgetType?: string,
): Promise<ValidationResult> {
  // Step 1: Layer 1 regex checks (always)
  const layer1 = runLayer1Checks(html, widgetType);

  // Skip Layer 2 when Layer 1 found a fatal structural issue or it is disabled.
  if (hasCriticalLayer1Error(layer1.errors) || process.env.VALIDATOR_LAYER2 === 'false') {
    log.info(
      `Layer 1 only: ${layer1.totalErrorCount} issue(s)${process.env.VALIDATOR_LAYER2 === 'false' ? ' (Layer 2 disabled)' : ' (skipping Layer 2 due to critical Layer 1 error)'}`,
    );
    return layer1;
  }

  // Step 2: Layer 2 runtime checks (Playwright + axe-core)
  try {
    const { validateGeneratedHtmlRuntime } = await import('./html-validator-runtime');
    const layer2 = await validateGeneratedHtmlRuntime(html, widgetType);

    const combinedErrors = [...layer1.errors, ...layer2.errors];
    const combinedTotal = layer1.totalErrorCount + layer2.totalErrorCount;

    log.info(
      `Layer 1 + Layer 2: ${layer1.totalErrorCount} structural + ${layer2.totalErrorCount} runtime issue(s)`,
    );

    return {
      passed: layer1.passed && layer2.passed,
      errors: combinedErrors.slice(0, MAX_ERRORS_REPORTED),
      totalErrorCount: combinedTotal,
    };
  } catch (err) {
    log.warn(
      `Layer 2 unavailable, falling back to Layer 1 only: ${(err as Error).message}`,
    );
    return layer1;
  }
}

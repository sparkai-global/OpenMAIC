/**
 * Prompt and context building utilities for the generation pipeline.
 */

import type { PdfImage, SceneOutline } from '@/lib/types/generation';
import type { AgentInfo, SceneGenerationContext } from './pipeline-types';

/** Build a course context string for injection into action prompts */
export function buildCourseContext(
  ctx?: SceneGenerationContext,
  sceneType?: 'slide' | 'quiz' | 'interactive' | 'pbl',
): string {
  if (!ctx) return '';

  const lines: string[] = [];

  // Course outline with position marker
  lines.push('Course Outline:');
  ctx.allTitles.forEach((t, i) => {
    const marker = i === ctx.pageIndex - 1 ? ' ← current' : '';
    lines.push(`  ${i + 1}. ${t}${marker}`);
  });

  // Position information
  lines.push('');
  lines.push(
    'IMPORTANT: All pages belong to the SAME class session. Do NOT greet again after the first page. When referencing content from earlier pages, say "we just covered" or "as mentioned on page N" — NEVER say "last class" or "previous session" because there is no previous session.',
  );
  lines.push('');
  if (ctx.pageIndex === 1) {
    lines.push('Position: This is the FIRST page. Open with a greeting and course introduction.');
  } else if (ctx.pageIndex === ctx.totalPages) {
    lines.push('Position: This is the LAST page. Conclude the course with a summary and closing.');
    lines.push(
      'Transition: Continue naturally from the previous page. Do NOT greet or re-introduce.',
    );
  } else {
    lines.push(`Position: Page ${ctx.pageIndex} of ${ctx.totalPages} (middle of the course).`);
    lines.push(
      'Transition: Continue naturally from the previous page. Do NOT greet or re-introduce.',
    );
  }

  // Previous page speech for transition reference
  if (ctx.previousSpeeches.length > 0) {
    lines.push('');
    lines.push('Previous page speech (for transition reference):');
    const lastSpeech = ctx.previousSpeeches[ctx.previousSpeeches.length - 1];
    lines.push(`  "...${lastSpeech.slice(-150)}"`);
  }

  // Slide-only inquiry-first pedagogy. Sits next to page-position cues so it
  // stays close to the model's attention. Skipped for quiz / interactive /
  // pbl — they have their own delivery shapes and inquiry-first hurts them.
  if (sceneType === 'slide') {
    lines.push('');
    lines.push('Pedagogy (Inquiry-First — CRITICAL, applies to THIS page):');
    lines.push(
      '- Open this page with a question / prediction / contrast / surprising fact — NOT with the conclusion. Even on the last page, lead with a recall prompt before any summary sentence.',
    );
    lines.push(
      '- For one or two of the most concept-heavy key points, use the rhythm: text(question or prediction) → optional pause cue → spotlight/laser → text(reveal & explain). Do NOT explain every key point as a one-shot conclusion.',
    );
    lines.push(
      '- Insert a short pause-cue text between question and reveal (a brief ellipsis line signalling a few seconds of thinking time). Phrase it in the course language specified by the Language Directive.',
    );
    lines.push(
      '- Hook patterns to adapt (write idiomatic phrasing in the course language; do NOT translate literally): "Before I show you, what would you guess?", "Compare this to page N — what changed?", "You might think it\'s X, but it\'s actually Y — why?"',
    );
    lines.push(
      '- Forbidden openers (in ANY language — they all announce the conclusion): "Now let\'s look at...", "In this slide we will discuss...", "The definition of X is...", or their equivalents in the course language. Replace with a question.',
    );
    lines.push(
      '- Voice: speak to the student in the second person (the equivalent of "you" in the course language) and anchor at least one explanation on this page in a concrete everyday object, scene, or action they already know. Avoid textbook connectors like "It is well known that...", "Furthermore...", "In summary...", and any equivalents in the course language — replace them with a concrete scenario or a rhetorical question.',
    );
  }

  return lines.join('\n');
}

/** Format agent list for injection into action prompts */
export function formatAgentsForPrompt(agents?: AgentInfo[]): string {
  if (!agents || agents.length === 0) return '';

  const lines = ['Classroom Agents:'];
  for (const a of agents) {
    const personaPart = a.persona ? ` — ${a.persona}` : '';
    lines.push(`- id: "${a.id}", name: "${a.name}", role: ${a.role}${personaPart}`);
  }
  return lines.join('\n');
}

/** Extract the teacher agent's persona for injection into outline/content prompts */
export function formatTeacherPersonaForPrompt(agents?: AgentInfo[]): string {
  if (!agents || agents.length === 0) return '';

  const teacher = agents.find((a) => a.role === 'teacher');
  if (!teacher?.persona) return '';

  return `Teacher Persona:\nName: ${teacher.name}\n${teacher.persona}\n\nAdapt the content style and tone to match this teacher's personality. IMPORTANT: The teacher's name and identity must NOT appear on the slides — no "Teacher ${teacher.name}'s tips", no "Teacher's message", etc. Slides should read as neutral, professional visual aids.`;
}

/**
 * Format a single PdfImage description for prompt inclusion.
 * Includes dimension/aspect-ratio info when available.
 */
export function formatImageDescription(img: PdfImage): string {
  let dimInfo = '';
  if (img.width && img.height) {
    const ratio = (img.width / img.height).toFixed(2);
    dimInfo = ` | size: ${img.width}×${img.height} (aspect ratio ${ratio})`;
  }
  const desc = img.description ? ` | ${img.description}` : '';
  return `- **${img.id}**: from PDF page ${img.pageNumber}${dimInfo}${desc}`;
}

/**
 * Format a short image placeholder for vision mode.
 * Only ID + page + dimensions + aspect ratio (no description), since the model can see the actual image.
 */
export function formatImagePlaceholder(img: PdfImage): string {
  let dimInfo = '';
  if (img.width && img.height) {
    const ratio = (img.width / img.height).toFixed(2);
    dimInfo = ` | size: ${img.width}×${img.height} (aspect ratio ${ratio})`;
  }
  return `- **${img.id}**: image from PDF page ${img.pageNumber}${dimInfo} [see attached]`;
}

/**
 * Build a multimodal user content array for the AI SDK.
 * Interleaves text and images so the model can associate img_id with actual image.
 * Each image label includes dimensions when available so the model knows the size
 * before seeing the image (important for layout decisions).
 */
export function buildVisionUserContent(
  userPrompt: string,
  images: Array<{ id: string; src: string; width?: number; height?: number }>,
): Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mimeType?: string }> {
  const parts: Array<
    { type: 'text'; text: string } | { type: 'image'; image: string; mimeType?: string }
  > = [{ type: 'text', text: userPrompt }];
  if (images.length > 0) {
    parts.push({ type: 'text', text: '\n\n--- Attached Images ---' });
    for (const img of images) {
      let dimInfo = '';
      if (img.width && img.height) {
        const ratio = (img.width / img.height).toFixed(2);
        dimInfo = ` (${img.width}×${img.height}, aspect ratio ${ratio})`;
      }
      parts.push({ type: 'text', text: `\n**${img.id}**${dimInfo}:` });
      // Strip data URI prefix — AI SDK only accepts http(s) URLs or raw base64
      const dataUriMatch = img.src.match(/^data:([^;]+);base64,(.+)$/);
      if (dataUriMatch) {
        parts.push({
          type: 'image',
          image: dataUriMatch[2],
          mimeType: dataUriMatch[1],
        });
      } else {
        parts.push({ type: 'image', image: img.src });
      }
    }
  }
  return parts;
}

/**
 * Build language instruction text from course-level directive and optional per-scene note.
 * Used by scene content and action generators to inject into prompt templates.
 */
export function buildLanguageText(directive?: string, sceneNote?: string): string {
  if (!directive && !sceneNote) return '';
  let text = directive || '';
  if (sceneNote) {
    text += (text ? '\n\n' : '') + `Additional language note for this scene: ${sceneNote}`;
  }
  return text;
}

/**
 * Build a "Previously Taught Content" block for quiz prompt injection.
 * Lists keyPoints from prior `slide`-type outlines so the quiz LLM can only
 * test concepts the student has already been taught. Returns empty string
 * when there is no prior slide content (e.g. quiz is the very first scene).
 */
export function formatLearnedContent(previousOutlines?: SceneOutline[]): string {
  if (!previousOutlines || previousOutlines.length === 0) return '';

  const slideOutlines = previousOutlines.filter((o) => o.type === 'slide');
  if (slideOutlines.length === 0) return '';

  const lines: string[] = [
    '## Previously Taught Content',
    '',
    'Questions MUST be grounded in the concepts below. Do NOT invent new concepts students have not seen.',
    '',
  ];

  for (const o of slideOutlines) {
    const orderLabel = typeof o.order === 'number' ? `Page ${o.order}` : 'Page';
    lines.push(`### ${orderLabel} — ${o.title}`);
    for (const kp of o.keyPoints || []) {
      lines.push(`- ${kp}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

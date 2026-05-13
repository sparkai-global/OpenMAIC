'use client';

import { Fragment, useMemo } from 'react';
import katex from 'katex';

interface ChatTextProps {
  text: string;
}

type Segment =
  | { type: 'text'; value: string }
  | { type: 'block'; latex: string }
  | { type: 'inline'; latex: string };

function splitInlineMath(input: string): Segment[] {
  const out: Segment[] = [];
  // $...$ —— 不跨行，内容非空且首尾不是空白（避免误匹配 "100$ 200$"）
  const re = /\$([^\s$][^\n$]*?[^\s$]|[^\s$])\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: input.slice(last, m.index) });
    out.push({ type: 'inline', latex: m[1] });
    last = m.index + m[0].length;
  }
  if (last < input.length) out.push({ type: 'text', value: input.slice(last) });
  return out;
}

function parseSegments(input: string): Segment[] {
  // 兼容 LaTeX 风格定界符：\[ \] / \( \)
  const normalized = input
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`);

  const out: Segment[] = [];
  const blockRe = /\$\$([\s\S]+?)\$\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(normalized)) !== null) {
    if (m.index > last) out.push(...splitInlineMath(normalized.slice(last, m.index)));
    out.push({ type: 'block', latex: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < normalized.length) out.push(...splitInlineMath(normalized.slice(last)));
  return out;
}

function renderMath(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex, {
    displayMode,
    throwOnError: false,
    strict: 'ignore',
    output: 'html',
  });
}

/**
 * Renders chat message text with KaTeX-rendered LaTeX segments.
 * Supports `$...$` (inline), `$$...$$` (block), and `\(...\)` / `\[...\]` aliases.
 * Falls back to raw text on parse errors (KaTeX's `throwOnError: false`).
 */
export function ChatText({ text }: ChatTextProps) {
  const segments = useMemo(() => parseSegments(text), [text]);
  return (
    <>
      {segments.map((s, i) => {
        if (s.type === 'text') return <Fragment key={i}>{s.value}</Fragment>;
        const html = renderMath(s.latex, s.type === 'block');
        return s.type === 'block' ? (
          <span
            key={i}
            className="block my-1 overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
        );
      })}
    </>
  );
}

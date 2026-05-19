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

/**
 * 兜底：模型有时输出裸括号包 LaTeX —— `(f'(x)=\lim_{h\to 0}\frac{...}{h})`，
 * 不带 $ 也不带反斜杠，正规协议下不会被识别。检测「括号内同时含
 * `\<latex-cmd>` 和 `{` / `_` / `^` 之一」就当数学公式 fence 起来。
 * 严格条件能避开 prose 误判（如 `(see Section \alpha)` 无花括号，不会被命中）。
 */
function autoFenceBareLatex(input: string): string {
  const looksLikeMath = (s: string) => /\\[a-zA-Z]+/.test(s) && /[{}_^]/.test(s);
  let out = '';
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '(' || ch === '[') {
      const close = ch === '(' ? ')' : ']';
      let depth = 1;
      let j = i + 1;
      while (j < input.length) {
        if (input[j] === ch) depth++;
        else if (input[j] === close) {
          depth--;
          if (depth === 0) break;
        }
        j++;
      }
      if (depth === 0 && j > i + 1) {
        const inner = input.slice(i + 1, j);
        if (looksLikeMath(inner)) {
          const fence = ch === '(' ? '$' : '$$';
          out += `${fence}${inner}${fence}`;
          i = j + 1;
          continue;
        }
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function parseSegments(input: string): Segment[] {
  // 1. 兼容 LaTeX 风格定界符：\[ \] / \( \)
  // 2. 兜底裸括号包 LaTeX（无 $、无反斜杠）
  const normalized = autoFenceBareLatex(
    input
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`),
  );

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

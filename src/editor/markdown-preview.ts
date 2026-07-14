import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { findInlineTags, MAX_TAG_LENGTH, normalizeTags } from "../lib/note-metadata";

export type MarkdownReplacement =
  | { kind: "bullet" }
  | { kind: "ordered"; label: string }
  | { kind: "task"; checked: boolean; checkFrom: number };

export type MarkdownDecoration =
  | { kind: "hide"; from: number; to: number }
  | { kind: "mark"; from: number; to: number; className: string }
  | { kind: "replace"; from: number; to: number; replacement: MarkdownReplacement };

export interface MarkdownLinePreview {
  className?: string;
  decorations: MarkdownDecoration[];
}

export type MarkdownCodeBlockLine = "fence" | "content";

export function markdownCodeBlockLines(state: EditorState) {
  const lines = new Map<number, MarkdownCodeBlockLine>();

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;

      const firstLine = state.doc.lineAt(node.from).number;
      const lastLine = state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
      for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
        lines.set(lineNumber, "content");
      }
      for (const marker of node.node.getChildren("CodeMark")) {
        lines.set(state.doc.lineAt(marker.from).number, "fence");
      }
      return false;
    },
  });

  return lines;
}

export function markdownTagDecorations(markdown: string, highlightedTags?: readonly string[]): MarkdownDecoration[] {
  const highlightedKeys = highlightedTags
    ? new Set(normalizeTags(highlightedTags).map((tag) => tag.toLowerCase()))
    : null;
  return findInlineTags(markdown).flatMap((tag) => {
    const normalized = normalizeTags([tag.tag])[0];
    if (!normalized || (highlightedKeys && !highlightedKeys.has(normalized.toLowerCase()))) return [];
    const highlightedText = Array.from(tag.tag).slice(0, MAX_TAG_LENGTH).join("");
    return [{
      kind: "mark" as const,
      from: tag.from,
      to: tag.from + 1 + highlightedText.length,
      className: "cm-md-tag",
    }];
  });
}

interface InlineCandidate {
  from: number;
  to: number;
  priority: number;
  contentFrom: number;
  contentTo: number;
  className: string;
  hiddenRanges: Array<[number, number]>;
}

interface InlinePattern {
  expression: RegExp;
  className: string;
  priority: number;
  contentGroup: number;
  underscoreDelimiter?: boolean;
}

const inlinePatterns: InlinePattern[] = [
  { expression: /`([^`\n]+)`/g, className: "cm-md-inline-code", priority: 0, contentGroup: 1 },
  { expression: /\[([^\]\n]+)\]\(([^)\n]+)\)/g, className: "cm-md-link", priority: 1, contentGroup: 1 },
  { expression: /\*\*([^*\n]+)\*\*/g, className: "cm-md-strong", priority: 2, contentGroup: 1 },
  {
    expression: /__([^_\n]+)__/g,
    className: "cm-md-strong",
    priority: 2,
    contentGroup: 1,
    underscoreDelimiter: true,
  },
  { expression: /~~([^~\n]+)~~/g, className: "cm-md-strike", priority: 2, contentGroup: 1 },
  { expression: /\*([^*\n]+)\*/g, className: "cm-md-emphasis", priority: 3, contentGroup: 1 },
  {
    expression: /_([^_\n]+)_/g,
    className: "cm-md-emphasis",
    priority: 3,
    contentGroup: 1,
    underscoreDelimiter: true,
  },
];

function isEscaped(text: string, position: number) {
  let slashCount = 0;
  for (let index = position - 1; index >= 0 && text[index] === "\\"; index -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function delimiterFlanking(text: string, from: number, to: number) {
  const before = from > 0 ? text[from - 1] : undefined;
  const after = to < text.length ? text[to] : undefined;
  const beforeWhitespace = before === undefined || /\s/u.test(before);
  const afterWhitespace = after === undefined || /\s/u.test(after);
  const beforePunctuation = before !== undefined && /[\p{P}\p{S}]/u.test(before);
  const afterPunctuation = after !== undefined && /[\p{P}\p{S}]/u.test(after);

  return {
    left: !afterWhitespace && (!afterPunctuation || beforeWhitespace || beforePunctuation),
    right: !beforeWhitespace && (!beforePunctuation || afterWhitespace || afterPunctuation),
    beforePunctuation,
    afterPunctuation,
  };
}

function isValidUnderscoreDelimiter(text: string, from: number, contentFrom: number, contentTo: number, to: number) {
  if (text[from - 1] === "_" || text[to] === "_") return false;

  const opening = delimiterFlanking(text, from, contentFrom);
  const closing = delimiterFlanking(text, contentTo, to);
  const canOpen = opening.left && (!opening.right || opening.beforePunctuation);
  const canClose = closing.right && (!closing.left || closing.afterPunctuation);
  return canOpen && canClose;
}

function collectInlineCandidates(text: string, bodyFrom: number) {
  const candidates: InlineCandidate[] = [];
  const body = text.slice(bodyFrom);

  for (const pattern of inlinePatterns) {
    pattern.expression.lastIndex = 0;
    for (const match of body.matchAll(pattern.expression)) {
      const matchFrom = bodyFrom + (match.index ?? 0);
      if (isEscaped(text, matchFrom)) continue;
      const content = match[pattern.contentGroup];
      const contentOffset = match[0].indexOf(content);
      const contentFrom = matchFrom + contentOffset;
      const contentTo = contentFrom + content.length;
      const matchTo = matchFrom + match[0].length;
      if (
        pattern.underscoreDelimiter
        && !isValidUnderscoreDelimiter(text, matchFrom, contentFrom, contentTo, matchTo)
      ) continue;
      candidates.push({
        from: matchFrom,
        to: matchTo,
        priority: pattern.priority,
        contentFrom,
        contentTo,
        className: pattern.className,
        hiddenRanges: [
          [matchFrom, contentFrom],
          [contentTo, matchFrom + match[0].length],
        ],
      });
    }
  }

  return candidates;
}

function inlineDecorations(text: string, bodyFrom: number, offset: number, active: boolean) {
  const accepted: InlineCandidate[] = [];
  const candidates = collectInlineCandidates(text, bodyFrom).sort(
    (left, right) => left.priority - right.priority || left.from - right.from || right.to - left.to,
  );

  for (const candidate of candidates) {
    const overlaps = accepted.some((item) => candidate.from < item.to && candidate.to > item.from);
    if (!overlaps) accepted.push(candidate);
  }

  const decorations: MarkdownDecoration[] = [];
  for (const candidate of accepted.sort((left, right) => left.from - right.from)) {
    decorations.push({
      kind: "mark",
      from: offset + candidate.contentFrom,
      to: offset + candidate.contentTo,
      className: candidate.className,
    });
    if (!active) {
      for (const [from, to] of candidate.hiddenRanges) {
        decorations.push({ kind: "hide", from: offset + from, to: offset + to });
      }
    }
  }
  return decorations;
}

export function markdownLinePreview(
  text: string,
  offset: number,
  active: boolean,
  codeBlockLine?: MarkdownCodeBlockLine,
): MarkdownLinePreview {
  if (codeBlockLine) {
    return {
      className: `cm-md-code-block cm-md-code-${codeBlockLine}`,
      decorations: [],
    };
  }

  const decorations: MarkdownDecoration[] = [];
  let className: string | undefined;
  let bodyFrom = 0;

  const heading = /^(#{1,3})[ \t]+/.exec(text);
  const task = /^(\s*)[-+*][ \t]+\[([ xX])\][ \t]/.exec(text);
  const unordered = /^(\s*)[-+*][ \t]+/.exec(text);
  const ordered = /^(\s*)(\d+)[.)][ \t]+/.exec(text);
  const quote = /^(\s*)>[ \t]?/.exec(text);

  if (heading) {
    bodyFrom = heading[0].length;
    className = `cm-md-heading cm-md-heading-${heading[1].length}`;
    if (!active) decorations.push({ kind: "hide", from: offset, to: offset + bodyFrom });
  } else if (task) {
    const markerFrom = task[1].length;
    const checked = task[2].toLowerCase() === "x";
    bodyFrom = task[0].length;
    className = `cm-md-list-line cm-md-task-line${checked ? " cm-md-task-complete" : ""}`;
    decorations.push({
      kind: "replace",
      from: offset + markerFrom,
      to: offset + bodyFrom,
      replacement: {
        kind: "task",
        checked,
        checkFrom: offset + task[0].indexOf("[") + 1,
      },
    });
  } else if (unordered) {
    const markerFrom = unordered[1].length;
    bodyFrom = unordered[0].length;
    className = "cm-md-list-line";
    if (!active) {
      decorations.push({
        kind: "replace",
        from: offset + markerFrom,
        to: offset + bodyFrom,
        replacement: { kind: "bullet" },
      });
    }
  } else if (ordered) {
    const markerFrom = ordered[1].length;
    bodyFrom = ordered[0].length;
    className = "cm-md-list-line";
    if (!active) {
      decorations.push({
        kind: "replace",
        from: offset + markerFrom,
        to: offset + bodyFrom,
        replacement: { kind: "ordered", label: `${ordered[2]}.` },
      });
    }
  } else if (quote) {
    const markerFrom = quote[1].length;
    bodyFrom = quote[0].length;
    className = "cm-md-quote";
    if (!active) {
      decorations.push({ kind: "hide", from: offset + markerFrom, to: offset + bodyFrom });
    }
  }

  decorations.push(...inlineDecorations(text, bodyFrom, offset, active));
  return { className, decorations };
}

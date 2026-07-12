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
}

const inlinePatterns: InlinePattern[] = [
  { expression: /`([^`\n]+)`/g, className: "cm-md-inline-code", priority: 0, contentGroup: 1 },
  { expression: /\[([^\]\n]+)\]\(([^)\n]+)\)/g, className: "cm-md-link", priority: 1, contentGroup: 1 },
  { expression: /\*\*([^*\n]+)\*\*/g, className: "cm-md-strong", priority: 2, contentGroup: 1 },
  { expression: /__([^_\n]+)__/g, className: "cm-md-strong", priority: 2, contentGroup: 1 },
  { expression: /~~([^~\n]+)~~/g, className: "cm-md-strike", priority: 2, contentGroup: 1 },
  { expression: /\*([^*\n]+)\*/g, className: "cm-md-emphasis", priority: 3, contentGroup: 1 },
  { expression: /_([^_\n]+)_/g, className: "cm-md-emphasis", priority: 3, contentGroup: 1 },
];

function isEscaped(text: string, position: number) {
  let slashCount = 0;
  for (let index = position - 1; index >= 0 && text[index] === "\\"; index -= 1) slashCount += 1;
  return slashCount % 2 === 1;
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
      candidates.push({
        from: matchFrom,
        to: matchFrom + match[0].length,
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

export function markdownLinePreview(text: string, offset: number, active: boolean): MarkdownLinePreview {
  const decorations: MarkdownDecoration[] = [];
  let className: string | undefined;
  let bodyFrom = 0;

  const heading = /^(#{1,3})[ \t]+/.exec(text);
  const task = /^(\s*)[-+*][ \t]+\[([ xX])\][ \t]+/.exec(text);
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

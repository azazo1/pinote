export const MAX_GROUP_NAME_LENGTH = 80;
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS = 16;

export interface InlineTagRange {
  from: number;
  to: number;
  tag: string;
}

export interface ReconciledTags {
  manualTags: string[];
  inlineTags: string[];
  tags: string[];
}

export function normalizeGroupName(value: string) {
  return truncate(value.trim(), MAX_GROUP_NAME_LENGTH).trim();
}

export function normalizeTags(values: readonly string[]) {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = normalizeTag(value);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length === MAX_TAGS) break;
  }
  return tags;
}

export function addTag(tags: readonly string[], value: string) {
  return normalizeTags([...tags, value]);
}

export function findInlineTags(markdown: string) {
  const ranges: InlineTagRange[] = [];
  const lines = markdown.split("\n");
  let offset = 0;
  let fence: { marker: string; length: number } | null = null;

  for (const line of lines) {
    const fenceRun = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (fenceRun && fenceRun[0] === fence.marker && fenceRun.length >= fence.length && isFenceClose(line, fenceRun)) {
        fence = null;
      }
      offset += line.length + 1;
      continue;
    }
    if (fenceRun) {
      fence = { marker: fenceRun[0], length: fenceRun.length };
      offset += line.length + 1;
      continue;
    }

    const protectedRanges = findProtectedRanges(line);
    const expression = /(^|[^\p{L}\p{N}_/#=])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu;
    for (const match of line.matchAll(expression)) {
      const prefix = match[1];
      const localFrom = (match.index ?? 0) + prefix.length;
      const localTo = localFrom + match[0].length - prefix.length;
      if (isEscaped(line, localFrom) || /^\p{N}+$/u.test(match[2]) || line[localTo] === "/") continue;
      if (protectedRanges.some(([from, to]) => localFrom < to && localTo > from)) continue;
      ranges.push({ from: offset + localFrom, to: offset + localTo, tag: match[2] });
    }
    offset += line.length + 1;
  }
  return ranges;
}

export function extractInlineTags(markdown: string) {
  return normalizeTags(findInlineTags(markdown).map((range) => range.tag));
}

export function combineTagSources(
  manualValues: readonly string[],
  inlineValues: readonly string[],
): ReconciledTags {
  const manualTags = normalizeTags(manualValues);
  const inlineCandidates = normalizeTags(inlineValues);
  const tags = normalizeTags([...manualTags, ...inlineCandidates]);
  const tagKeys = new Set(tags.map((tag) => tag.toLowerCase()));
  const inlineTags = inlineCandidates.filter((tag) => tagKeys.has(tag.toLowerCase()));
  return { manualTags, inlineTags, tags };
}

export function reconcileInlineTags(
  tags: readonly string[],
  sourceInlineTags: readonly string[],
  markdown: string,
): ReconciledTags {
  const sourceKeys = new Set(sourceInlineTags.map((tag) => tag.toLowerCase()));
  const manualTags = normalizeTags(tags.filter((tag) => !sourceKeys.has(tag.toLowerCase())));
  return combineTagSources(manualTags, extractInlineTags(markdown));
}

function normalizeTag(value: string) {
  return truncate(value.trim().replace(/^#+/, "").trim(), MAX_TAG_LENGTH).trim();
}

function truncate(value: string, length: number) {
  return Array.from(value).slice(0, length).join("");
}

function isEscaped(text: string, position: number) {
  let slashCount = 0;
  for (let index = position - 1; index >= 0 && text[index] === "\\"; index -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function isFenceClose(line: string, run: string) {
  return line.slice(line.indexOf(run) + run.length).trim().length === 0;
}

function findProtectedRanges(line: string): Array<[number, number]> {
  return [...findCodeSpanRanges(line), ...findLinkRanges(line)];
}

function findCodeSpanRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  while (cursor < line.length) {
    if (line[cursor] !== "`" || isEscaped(line, cursor)) {
      cursor += 1;
      continue;
    }
    const openingEnd = endOfRun(line, cursor, "`");
    const runLength = openingEnd - cursor;
    let closingFrom = openingEnd;
    let closingEnd = -1;
    while (closingFrom < line.length) {
      if (line[closingFrom] !== "`" || isEscaped(line, closingFrom)) {
        closingFrom += 1;
        continue;
      }
      const candidateEnd = endOfRun(line, closingFrom, "`");
      if (candidateEnd - closingFrom === runLength) {
        closingEnd = candidateEnd;
        break;
      }
      closingFrom = candidateEnd;
    }
    if (closingEnd < 0) {
      cursor = openingEnd;
      continue;
    }
    ranges.push([cursor, closingEnd]);
    cursor = closingEnd;
  }
  return ranges;
}

function findLinkRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const expression = /!?\[[^\]\n]*\]\((?:\\.|[^)\n])*\)/g;
  for (const match of line.matchAll(expression)) {
    const from = match.index ?? 0;
    ranges.push([from, from + match[0].length]);
  }
  return ranges;
}

function endOfRun(text: string, from: number, character: string) {
  let end = from + 1;
  while (text[end] === character) end += 1;
  return end;
}

// Pure helpers behind `textSegments` on get_node / get_selection. They know
// nothing about the Figma API: serializer.ts turns each StyledTextSegment into a
// plain `SegmentStyle`, and this module merges, diffs and truncates them.

/** Normalized style of one run of characters. Every key is always present (null when unset). */
export type SegmentStyle = Record<string, unknown>;

export type RawSegment = {
  start: number;
  end: number;
  characters: string;
  style: SegmentStyle;
};

export type TextSegmentOptions = {
  /** Only emit runs whose style differs from the node's dominant (baseline) style. */
  onlyDiffering?: boolean;
  /** Max characters of text echoed per run. 0 drops `characters`. Default 60. */
  maxSegmentChars?: number;
};

export type OutputSegment = {
  start: number;
  end: number;
  characters?: string;
  charactersTruncated?: true;
  [key: string]: unknown;
};

export type TextSegmentsResult = {
  /** Runs, after merging neighbours with identical style (and filtering when onlyDiffering). */
  textSegments: OutputSegment[];
  /** Run count after merging, before any filtering. */
  textSegmentCount: number;
  /** Dominant style by character coverage. Only present when onlyDiffering. */
  textSegmentsBaseline?: SegmentStyle;
};

export const DEFAULT_MAX_SEGMENT_CHARS = 60;

const keyOf = (style: SegmentStyle): string => JSON.stringify(style);

/** Adjacent runs with identical normalized style become one (the API may split on fields we drop). */
export const mergeSegments = (segments: readonly RawSegment[]): RawSegment[] => {
  const out: RawSegment[] = [];
  let lastKey = "";
  for (const seg of segments) {
    const key = keyOf(seg.style);
    const prev = out[out.length - 1];
    if (prev && prev.end === seg.start && key === lastKey) {
      prev.end = seg.end;
      prev.characters += seg.characters;
    } else {
      out.push({ ...seg });
    }
    lastKey = key;
  }
  return out;
};

/** The style covering the most characters. Ties go to the earliest run. */
export const dominantStyle = (segments: readonly RawSegment[]): SegmentStyle => {
  const coverage = new Map<string, { style: SegmentStyle; chars: number }>();
  for (const seg of segments) {
    const key = keyOf(seg.style);
    const entry = coverage.get(key) ?? { style: seg.style, chars: 0 };
    entry.chars += seg.end - seg.start;
    coverage.set(key, entry);
  }
  let best: { style: SegmentStyle; chars: number } | undefined;
  for (const entry of coverage.values()) if (!best || entry.chars > best.chars) best = entry;
  return best?.style ?? {};
};

/** Drops keys that are at their default (null / unset) so a full style stays small. */
const withoutNulls = (style: SegmentStyle): SegmentStyle =>
  Object.fromEntries(Object.entries(style).filter(([, v]) => v !== null && v !== undefined));

/** Keys whose value differs from the baseline, with null where the run unsets the baseline's value. */
const diffFromBaseline = (style: SegmentStyle, baseline: SegmentStyle): SegmentStyle => {
  const out: SegmentStyle = {};
  for (const key of new Set([...Object.keys(style), ...Object.keys(baseline)])) {
    const value = style[key] ?? null;
    if (JSON.stringify(value) !== JSON.stringify(baseline[key] ?? null)) out[key] = value;
  }
  return out;
};

const echoCharacters = (
  characters: string,
  max: number
): Pick<OutputSegment, "characters" | "charactersTruncated"> => {
  if (max <= 0) return {};
  if (characters.length <= max) return { characters };
  return { characters: `${characters.slice(0, max)}…`, charactersTruncated: true };
};

export const buildTextSegments = (
  raw: readonly RawSegment[],
  options: TextSegmentOptions = {}
): TextSegmentsResult => {
  const max = options.maxSegmentChars ?? DEFAULT_MAX_SEGMENT_CHARS;
  const merged = mergeSegments(raw);
  const baseline = options.onlyDiffering ? dominantStyle(merged) : undefined;
  const baselineKey = baseline ? keyOf(baseline) : undefined;

  const textSegments: OutputSegment[] = [];
  for (const seg of merged) {
    if (baseline && keyOf(seg.style) === baselineKey) continue;
    textSegments.push({
      start: seg.start,
      end: seg.end,
      ...echoCharacters(seg.characters, max),
      ...(baseline ? diffFromBaseline(seg.style, baseline) : withoutNulls(seg.style)),
    });
  }

  return {
    textSegments,
    textSegmentCount: merged.length,
    ...(baseline ? { textSegmentsBaseline: withoutNulls(baseline) } : {}),
  };
};

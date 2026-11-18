import { describe, expect, test } from "bun:test";
import { buildTextSegments, dominantStyle, mergeSegments } from "./textSegments";
import type { RawSegment, SegmentStyle } from "./textSegments";

const base: SegmentStyle = {
  fontFamily: "Inter",
  fontWeight: 400,
  fontSize: 16,
  textDecoration: null,
  hyperlink: null,
};

const seg = (start: number, text: string, style: Partial<SegmentStyle> = {}): RawSegment => ({
  start,
  end: start + text.length,
  characters: text,
  style: { ...base, ...style },
});

// "Plain " + underlined "linked" + " plain tail"
const sample = [
  seg(0, "Plain "),
  seg(6, "linked", {
    textDecoration: "UNDERLINE",
    hyperlink: { type: "URL", value: "https://example.com" },
  }),
  seg(12, " plain tail"),
];

describe("mergeSegments", () => {
  test("joins adjacent runs with identical style", () => {
    const merged = mergeSegments([seg(0, "ab"), seg(2, "cd"), seg(4, "ef", { fontWeight: 700 })]);
    expect(merged.map((s) => [s.start, s.end, s.characters])).toEqual([
      [0, 4, "abcd"],
      [4, 6, "ef"],
    ]);
  });

  test("does not mutate the input", () => {
    const input = [seg(0, "ab"), seg(2, "cd")];
    mergeSegments(input);
    expect(input[0].characters).toBe("ab");
  });
});

describe("dominantStyle", () => {
  test("picks the style covering the most characters", () => {
    expect(dominantStyle(sample)).toEqual(base);
  });
});

describe("buildTextSegments", () => {
  test("returns every run with null defaults stripped", () => {
    const out = buildTextSegments(sample);
    expect(out.textSegmentCount).toBe(3);
    expect(out.textSegmentsBaseline).toBeUndefined();
    expect(out.textSegments[0]).toEqual({
      start: 0,
      end: 6,
      characters: "Plain ",
      fontFamily: "Inter",
      fontWeight: 400,
      fontSize: 16,
    });
    expect(out.textSegments[1]).toMatchObject({
      start: 6,
      end: 12,
      textDecoration: "UNDERLINE",
      hyperlink: { type: "URL", value: "https://example.com" },
    });
  });

  test("onlyDiffering keeps just the differing runs and keys, with a baseline", () => {
    const out = buildTextSegments(sample, { onlyDiffering: true });
    expect(out.textSegmentCount).toBe(3);
    expect(out.textSegmentsBaseline).toEqual({
      fontFamily: "Inter",
      fontWeight: 400,
      fontSize: 16,
    });
    expect(out.textSegments).toEqual([
      {
        start: 6,
        end: 12,
        characters: "linked",
        textDecoration: "UNDERLINE",
        hyperlink: { type: "URL", value: "https://example.com" },
      },
    ]);
  });

  test("onlyDiffering reports null where a run unsets a baseline value", () => {
    const out = buildTextSegments(
      [seg(0, "long underlined body", { textDecoration: "UNDERLINE" }), seg(20, "x")],
      { onlyDiffering: true }
    );
    expect(out.textSegments).toEqual([
      { start: 20, end: 21, characters: "x", textDecoration: null },
    ]);
  });

  test("truncates long runs and drops text at 0", () => {
    const long = [seg(0, "a".repeat(100))];
    const cut = buildTextSegments(long, { maxSegmentChars: 10 }).textSegments[0];
    expect(cut.characters).toBe(`${"a".repeat(10)}…`);
    expect(cut.charactersTruncated).toBe(true);
    const none = buildTextSegments(long, { maxSegmentChars: 0 }).textSegments[0];
    expect("characters" in none).toBe(false);
    const dflt = buildTextSegments(long).textSegments[0];
    expect(dflt.characters).toBe(`${"a".repeat(60)}…`);
  });

  test("a uniform text yields no runs in onlyDiffering mode", () => {
    const out = buildTextSegments([seg(0, "hello")], { onlyDiffering: true });
    expect(out.textSegments).toEqual([]);
    expect(out.textSegmentCount).toBe(1);
  });
});

import type { Anchor, Evidence, Paper, Project, Section } from "./schema.js";

export const headings = ["研究概况", "证据对比", "局限与待核实问题"];
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
export function paragraphAnchors(
  paperKey: string,
  kind: Anchor["kind"],
  section: string,
  paragraph: number,
  text: string,
  sequence = paragraph,
): Anchor[] {
  const sentences = Array.from(segmenter.segment(text), (s) =>
    s.segment.trim(),
  ).filter(Boolean);
  return sentences.flatMap((quote, i) =>
    quote.length > 4000
      ? []
      : [
          {
            id: paperKey + "/" + kind + "/" + sequence + "/" + (i + 1),
            paperKey,
            kind,
            section,
            paragraph,
            sentence: i + 1,
            quote,
            before: (sentences[i - 1] || "").slice(-1200),
            after: (sentences[i + 1] || "").slice(0, 1200),
          },
        ],
  );
}
export function evidenceAnchors(e: Evidence, paper?: Paper): Anchor[] {
  if (e.anchors?.length) return e.anchors;
  if (!paper || !e.quote.trim()) return [];
  const hits = paragraphAnchors(
    paper.key,
    "abstract",
    "摘要",
    1,
    paper.abstract,
  ).filter((a) => a.quote === e.quote.trim());
  return hits.length === 1 ? hits : [];
}
export function location(a: Anchor) {
  return a.kind === "abstract"
    ? "摘要 › 第 " + a.sentence + " 句"
    : "全文 › " +
        a.section +
        " › 第 " +
        a.paragraph +
        " 段 › 第 " +
        a.sentence +
        " 句";
}
export function anchorMap(p: Project) {
  return new Map([
    ...(p.reportAnchors || []).map((a) => [a.id, a] as const),
    ...p.evidence.flatMap((e) =>
      evidenceAnchors(
        e,
        p.papers.find((x) => x.key === e.paperKey),
      ).map((a) => [a.id, a] as const),
    ),
  ]);
}
export function referenceKeys(p: Project) {
  return [
    ...new Set([...p.sections.flatMap((s) => s.citations), ...p.selected]),
  ];
}
export function sectionFromClaims(
  heading: string,
  claims: NonNullable<Section["claims"]>,
  anchors: Map<string, Anchor>,
): Section {
  const citations = [
    ...new Set(
      claims.flatMap((c) =>
        c.refs
          .map((id) => anchors.get(id)?.paperKey)
          .filter((k): k is string => !!k),
      ),
    ),
  ];
  return {
    heading,
    claims,
    text: claims.map((c) => c.text).join("\n"),
    citations,
  };
}

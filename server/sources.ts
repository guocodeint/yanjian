import { SaxesParser } from "saxes";
import type { Anchor, Paper } from "../shared/schema.js";
import { paragraphAnchors } from "../shared/evidence.js";
export function fullTextAnchors(paper: Paper, xml: string): Anchor[] {
  const parser = new SaxesParser(),
    path: string[] = [],
    sections: { name: string; count: number }[] = [];
  let title = "",
    paragraph = "",
    titleDepth = 0,
    pDepth = 0,
    seq = 0,
    rootParagraph = 0;
  const result: Anchor[] = [];
  parser.on("opentag", (tag) => {
    const name = tag.name.split(":").at(-1)!;
    path.push(name);
    if (
      !path.includes("body") ||
      path.some((x) =>
        [
          "fig",
          "table-wrap",
          "boxed-text",
          "supplementary-material",
          "ref-list",
        ].includes(x),
      )
    )
      return;
    const parent = path.at(-2);
    if (name === "sec") sections.push({ name: "正文", count: 0 });
    if (name === "title" && parent === "sec") {
      title = "";
      titleDepth = path.length;
    }
    if (name === "p" && !pDepth && (parent === "sec" || parent === "body")) {
      paragraph = "";
      pDepth = path.length;
    }
  });
  function collect(s: string) {
    if (titleDepth) title += s;
    if (pDepth) paragraph += s;
  }
  parser.on("text", collect);
  parser.on("cdata", collect);
  parser.on("closetag", () => {
    const name = path.at(-1);
    if (titleDepth === path.length) {
      if (sections.length)
        sections.at(-1)!.name = title.trim().replace(/\s+/g, " ") || "正文";
      titleDepth = 0;
    }
    if (pDepth === path.length) {
      seq++;
      const sec = sections.at(-1),
        count = sec ? ++sec.count : ++rootParagraph;
      result.push(
        ...paragraphAnchors(
          paper.key,
          "full",
          sections
            .map((s) => s.name)
            .join(" › ")
            .slice(0, 500) || "正文",
          count,
          paragraph.replace(/\s+/g, " ").trim(),
          seq,
        ),
      );
      pDepth = 0;
    }
    if (
      name === "sec" &&
      path.includes("body") &&
      !path.some((x) =>
        [
          "fig",
          "table-wrap",
          "boxed-text",
          "supplementary-material",
          "ref-list",
        ].includes(x),
      )
    )
      sections.pop();
    path.pop();
  });
  parser.write(xml).close();
  return result;
}
export async function sourceCandidates(
  p: Paper,
  question: string,
  terms: string[],
): Promise<Anchor[]> {
  const abstract = paragraphAnchors(p.key, "abstract", "摘要", 1, p.abstract);
  if (!p.pmcid) return abstract;
  try {
    const response = await fetch(
      "https://www.ebi.ac.uk/europepmc/webservices/rest/" +
        p.pmcid +
        "/fullTextXML",
      { signal: AbortSignal.timeout(35000) },
    );
    if (!response.ok || !response.body) return abstract;
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      if (bytes > 6_000_000) return abstract;
      chunks.push(chunk);
    }
    const anchors = fullTextAnchors(p, Buffer.concat(chunks).toString("utf8"));
    const words = [
      ...new Set(
        (question + " " + terms.join(" ")).toLowerCase().match(/[a-z]{3,}/g) ||
          [],
      ),
    ].filter((t) => !["and", "the", "not", "with", "for"].includes(t));
    const scored = anchors
      .map((a, i) => ({
        a,
        i,
        score: words.reduce(
          (n, w) => n + Number(a.quote.toLowerCase().includes(w)),
          0,
        ),
      }))
      .filter((x) => x.a.quote.length >= 24);
    const selected = new Map<string, Anchor>();
    for (const pattern of [
      /result|finding/i,
      /method|participant/i,
      /limit|discussion/i,
      /conclusion/i,
    ]) {
      scored
        .filter((x) => pattern.test(x.a.section))
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .slice(0, 4)
        .forEach((x) => selected.set(x.a.id, x.a));
    }
    scored
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, 15)
      .forEach((x) => selected.set(x.a.id, x.a));
    return selected.size ? [...selected.values()] : abstract;
  } catch {
    return abstract;
  }
}

import { analysisSchema, type Analysis, type Paper } from "../shared/schema.js";
export const plain = (value: unknown): string =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
export function normalize(r: any): Paper {
  const source = String(r.source ?? "MED"),
    id = String(r.id);
  return {
    key: `${source}:${id}`,
    source,
    id,
    pmcid: /^PMC[0-9]+$/.test(r.pmcid || "") ? r.pmcid : undefined,
    subjects: [
      ...(r.keywordList?.keyword || []),
      ...(r.meshHeadingList?.meshHeading || []).map(
        (m: any) => m.descriptorName,
      ),
    ]
      .map(plain)
      .filter(Boolean)
      .slice(0, 100)
      .map((t) => t.slice(0, 400)),
    title: plain(r.title),
    authors: plain(r.authorString),
    year: String(r.pubYear ?? ""),
    journal: plain(r.journalInfo?.journal?.title ?? r.journalTitle),
    abstract: plain(r.abstractText),
    doi: plain(r.doi),
    url: `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}`,
    fetchedAt: new Date().toISOString(),
  };
}
export function validateAnalysis(raw: unknown, papers: Paper[]): Analysis {
  const result = analysisSchema.parse(raw);
  const available = new Map(
    papers.filter((p) => p.abstract).map((p) => [p.key, p]),
  );
  const seen = new Set<string>();
  for (const e of result.evidence) {
    const p = available.get(e.paperKey);
    if (!p || seen.has(e.paperKey))
      throw new Error("模型返回了未知或重复文献引用");
    seen.add(e.paperKey);
    if (!e.quote.trim() || !plain(p.abstract).includes(plain(e.quote)))
      throw new Error("模型依据无法在摘要中定位，请重试或手工整理");
  }
  if (seen.size !== available.size) throw new Error("模型未完整整理所选摘要");
  for (const s of result.sections) {
    if (s.citations.some((k) => !available.has(k)))
      throw new Error("简报含有无效引用，结果已拦截");
    if (/https?:\/\/|\bdoi\s*:/i.test(s.text))
      throw new Error("模型生成了未经验证的链接");
  }
  return result;
}

import type { Concept, Paper } from "./schema.js";

const ignore = new Set(
  "and or not the a an of for on with in to by at is are as versus vs".split(
    " ",
  ),
);
const bilingual: [string, string][] = [
  ["儿童", "child | children | pediatric | paediatric"],
  ["成人", "adult"],
  ["老年", "older adult | elderly | geriatric"],
  ["青少年", "adolescent | teenager"],
  ["孕妇", "pregnant | pregnancy"],
  ["睡眠", "sleep | insomnia"],
  ["失眠", "insomnia"],
  ["安慰剂", "placebo"],
  ["复发", "recurrence | relapse"],
  ["依从性", "adherence | compliance"],
  ["生物利用度", "bioavailability"],
  ["随机", "randomized | randomised"],
  ["血压", "blood pressure | hypertension"],
  ["运动", "exercise | physical activity"],
  ["咖啡因", "caffeine"],
  ["槲皮素", "quercetin"],
  ["纳米", "nanoparticle | nanoformulation"],
  ["疼痛", "pain"],
  ["骨折", "fracture"],
  ["生活质量", "quality of life"],
  ["睡眠质量", "sleep quality"],
];
export function inferConcepts(query: string, question = ""): Concept[] {
  const positive = query
    .replace(/\bNOT\s+(?:\([^()]*\)|"[^"]*"|\S+)/gi, "")
    .replace(/\b[A-Z_]+:/g, "");
  const parts = positive.split(/\s+AND\s+/i).flatMap((part) => {
    if (/\bAND\b/i.test(positive) || /\bOR\b/i.test(part) || /"/.test(part))
      return [part];
    return part.trim().split(/\s+/);
  });
  const groups = parts
    .map((p) =>
      p
        .replace(/[()*"]/g, "")
        .replace(/\s+OR\s+/gi, " | ")
        .trim(),
    )
    .filter((p) => p.length > 1 && !ignore.has(p.toLowerCase()));
  for (const [zh, en] of bilingual)
    if (
      question.includes(zh) &&
      !groups.some((g) =>
        en.split(" | ").some((term) => g.toLowerCase().includes(term)),
      )
    )
      groups.push(en);
  return [...new Set(groups)]
    .slice(0, 16)
    .map((terms) => ({ terms: terms.slice(0, 240), required: false }));
}
function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
function matches(text: string, term: string) {
  const phrase = normalize(term);
  if (!phrase) return false;
  return new RegExp(
    "\\b" + phrase.replaceAll(" ", "\\s+") + "(?:s|es)?\\b",
    "i",
  ).test(text);
}
export function rankPaper(
  p: Paper,
  concepts: Concept[],
  sourceRank: number,
): NonNullable<Paper["rank"]> {
  const title = normalize(p.title),
    abstract = normalize(p.abstract),
    subjects = normalize((p.subjects || []).join(" ; "));
  let weighted = 0,
    covered = 0,
    missingRequired = false;
  const reasons = concepts.map((g) => {
    const terms = g.terms
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const fields = [
      ["题名", title, 1],
      ["摘要", abstract, 0.82],
      ["索引", subjects, 0.45],
    ] as const;
    for (const [name, field, value] of fields) {
      const term = terms.find((t) => matches(field, t));
      if (term) {
        weighted += value;
        covered++;
        return name + "命中 · " + term;
      }
    }
    if (g.required) missingRequired = true;
    return (g.required ? "核心概念未命中" : "未提及") + " · " + terms[0];
  });
  const n = Math.max(1, concepts.length);
  const raw = Math.round(
    (65 * weighted) / n + (30 * covered) / n + 5 / Math.sqrt(sourceRank),
  );
  return {
    sourceRank,
    score: Math.min(missingRequired ? 39 : 100, raw),
    reasons,
  };
}
export const scoreOf = (p: Paper) =>
  p.rank?.review?.score ?? p.rank?.score ?? 0;
export function orderPapers(papers: Paper[]) {
  return [...papers].sort((a, b) =>
    !a.rank && !b.rank
      ? 0
      : scoreOf(b) - scoreOf(a) ||
        (a.rank?.sourceRank ?? Infinity) - (b.rank?.sourceRank ?? Infinity) ||
        a.key.localeCompare(b.key),
  );
}
export const level = (score: number) =>
  score >= 78 ? "高相关" : score >= 45 ? "部分相关" : "低相关";

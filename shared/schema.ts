import { evidenceAnchors } from "./evidence.js";
import { z } from "zod";
export const conceptSchema = z.object({
  terms: z.string().min(1).max(240),
  required: z.boolean(),
});
export type Concept = z.infer<typeof conceptSchema>;
export const rankSchema = z.object({
  score: z.number().min(0).max(100),
  sourceRank: z.number().int().positive(),
  reasons: z.array(z.string().max(560)).max(20),
  review: z
    .object({
      score: z.number().int().min(0).max(100),
      reason: z.string().max(600),
      quote: z.string().max(800),
    })
    .optional(),
});
const traceSchema = z.object({
  stage: z.number().int().min(0).max(4),
  detail: z.string().max(1200),
  at: z.string(),
});
export type Trace = z.infer<typeof traceSchema>;
export const anchorSchema = z.object({
  id: z.string().max(180),
  paperKey: z.string().max(100),
  kind: z.enum(["abstract", "full"]),
  section: z.string().max(500),
  paragraph: z.number().int().positive(),
  sentence: z.number().int().positive(),
  before: z.string().max(1200),
  quote: z.string().min(1).max(4000),
  after: z.string().max(1200),
});
export type Anchor = z.infer<typeof anchorSchema>;
const claimSchema = z.object({
  text: z.string().max(2000),
  refs: z.array(z.string().max(180)).max(20),
  highlight: z.string().max(200).optional(),
  pending: z.boolean().optional(),
});
export type Claim = z.infer<typeof claimSchema>;
export const paperSchema = z.object({
  key: z.string().max(100),
  source: z.string().max(20),
  id: z.string().max(80),
  title: z.string().max(3000),
  authors: z.string().max(20000),
  year: z.string().max(10),
  journal: z.string().max(1000),
  abstract: z.string().max(80000),
  doi: z.string().max(500),
  url: z
    .string()
    .url()
    .refine((v) => /^https:\/\/europepmc\.org\/article\//.test(v)),
  fetchedAt: z.string(),
  pmcid: z
    .string()
    .regex(/^PMC[0-9]+$/)
    .optional(),
  subjects: z.array(z.string().max(400)).max(100).optional(),
  rank: rankSchema.optional(),
  titleZh: z.string().max(24000).optional(),
  abstractZh: z.string().max(24000).optional(),
});
export const evidenceSchema = z.object({
  paperKey: z.string(),
  object: z.string().max(3000),
  method: z.string().max(3000),
  finding: z.string().max(5000),
  limitation: z.string().max(3000),
  anchors: z.array(anchorSchema).max(80).optional(),
  fields: z
    .record(
      z.enum(["object", "method", "finding", "limitation"]),
      z.string().max(180),
    )
    .optional(),
  quote: z.string().max(10000),
});
export const sectionSchema = z.object({
  claims: z.array(claimSchema).max(40).optional(),
  heading: z.string().max(200),
  text: z.string().max(10000),
  citations: z.array(z.string()).max(10),
});
export const analysisSchema = z.object({
  evidence: z.array(evidenceSchema).max(10),
  sections: z.array(sectionSchema).min(1).max(8),
});
export const projectSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative().default(0),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    question: z.string().max(1000),
    query: z.string().max(500),
    from: z.string().max(4),
    to: z.string().max(4),
    createdAt: z.string(),
    updatedAt: z.string(),
    papers: z.array(paperSchema).max(1000),
    selected: z.array(z.string()).max(10),
    decisions: z.record(z.enum(["纳入", "排除", "待定"])),
    notes: z.record(z.string().max(10000)),
    reportAnchors: z.array(anchorSchema).max(800).optional(),
    evidence: z.array(evidenceSchema).max(10),
    sections: z.array(sectionSchema).max(8),
    original: analysisSchema.nullable(),
    analyzedKeys: z.array(z.string()).max(10),
    analysisQuery: z.string(),
    analysisQuestion: z.string(),
    analysisAt: z.string(),
    total: z.number().nonnegative(),
    concepts: z.array(conceptSchema).max(16).optional(),
    searchRecord: z
      .object({
        events: z.array(traceSchema).max(12),
        question: z.string(),
        query: z.string(),
        concepts: z.array(conceptSchema).max(16),
        received: z.number(),
        from: z.string(),
        to: z.string(),
      })
      .optional(),
    nextCursor: z.string().nullable(),
    searchedQuery: z.string(),
    mode: z.enum(["live", "snapshot"]),
  })
  .superRefine((p, ctx) => {
    const keys = new Set(p.papers.map((x) => x.key));
    const bad = p.papers.some(
      (x) =>
        x.key !== `${x.source}:${x.id}` ||
        x.url !==
          `https://europepmc.org/article/${encodeURIComponent(x.source)}/${encodeURIComponent(x.id)}`,
    );
    for (const analysis of [p, p.original]) {
      if (!analysis) continue;
      const byId = new Map<string, string>();
      for (const e of analysis.evidence) {
        const anchors = evidenceAnchors(
          e,
          p.papers.find((paper) => paper.key === e.paperKey),
        );
        for (const a of anchors) {
          if (a.paperKey !== e.paperKey || byId.has(a.id))
            ctx.addIssue({
              code: "custom",
              message: "证据位置与文献不匹配或重复",
            });
          byId.set(a.id, e.paperKey);
        }
        if (
          Object.values(e.fields || {}).some(
            (id) => id && !anchors.some((a) => a.id === id),
          )
        )
          ctx.addIssue({ code: "custom", message: "字段原文位置不存在" });
      }
      if (analysis === p)
        for (const a of p.reportAnchors || []) {
          if (
            !keys.has(a.paperKey) ||
            (byId.has(a.id) && byId.get(a.id) !== a.paperKey)
          )
            ctx.addIssue({ code: "custom", message: "简报原文快照来源不符" });
          byId.set(a.id, a.paperKey);
        }
      for (const section of analysis.sections) {
        if (!section.claims) continue;
        const ids = section.claims.flatMap((c) => c.refs);
        const cited = [...new Set(ids.map((id) => byId.get(id)))];
        if (
          ids.some((id) => !byId.has(id)) ||
          cited.join("|") !== section.citations.join("|")
        )
          ctx.addIssue({ code: "custom", message: "简报句子与所引文献不匹配" });
      }
    }
    const refs = [
      ...p.selected,
      ...p.analyzedKeys,
      ...p.evidence.map((e) => e.paperKey),
      ...p.sections.flatMap((s) => s.citations),
      ...(p.original?.evidence.map((e) => e.paperKey) || []),
      ...(p.original?.sections.flatMap((s) => s.citations) || []),
    ];
    if (
      bad ||
      keys.size !== p.papers.length ||
      new Set(p.selected).size !== p.selected.length ||
      refs.some((k) => !keys.has(k))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "文献标识或引用关系不完整",
      });
  });
export type Paper = z.infer<typeof paperSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type Project = z.infer<typeof projectSchema>;
export const queryInput = z.object({
  question: z.string().trim().min(2).max(1000),
});
export const analyzeInput = queryInput.extend({
  terms: z.array(z.string().max(240)).max(16).optional(),
  papers: z
    .array(
      z.object({
        source: z.enum([
          "MED",
          "PMC",
          "PPR",
          "AGR",
          "CBA",
          "CTX",
          "ETH",
          "HIR",
          "NBK",
          "PAT",
        ]),
        id: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
      }),
    )
    .min(1)
    .max(10),
});
export function emptyProject(): Project {
  const now = new Date().toISOString();
  return {
    version: 1,
    revision: 0,
    id: crypto.randomUUID(),
    question: "",
    query: "",
    from: "2020",
    to: "",
    createdAt: now,
    updatedAt: now,
    papers: [],
    selected: [],
    decisions: {},
    notes: {},
    evidence: [],
    sections: [],
    original: null,
    analyzedKeys: [],
    analysisQuery: "",
    analysisQuestion: "",
    analysisAt: "",
    total: 0,
    nextCursor: null,
    searchedQuery: "",
    mode: "live",
  };
}

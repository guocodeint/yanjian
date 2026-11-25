import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../server/core.js";
import { fullTextAnchors, sourceCandidates } from "../server/sources.js";
import { orderPapers, rankPaper } from "../shared/ranking.js";
import { emptyProject, projectSchema } from "../shared/schema.js";
import {
  evidenceAnchors,
  referenceKeys,
  sectionFromClaims,
} from "../shared/evidence.js";
import { markdown } from "../src/export.js";
const p = normalize({
  id: "100",
  title: "A sleep study",
  abstractText: "The first sentence. Participants reported longer sleep.",
});
test("必选概念、英文同义词及跨页顺序", () => {
  const groups = [
    { terms: "sleep | insomnia", required: true },
    { terms: "student | adolescent", required: false },
  ];
  const raw = [
    { ...p, title: "Vitamin trials", abstract: "Benefits in students." },
    { ...p, title: "Students and insomnia" },
  ];
  const ranked = orderPapers(
    raw.map((p, i) => ({ ...p, rank: rankPaper(p, groups, i + 1) })),
  );
  assert.equal(ranked[0].title, raw[1].title);
  assert.ok(ranked[1].rank!.score <= 39);
});
test("JATS 嵌套章节、段内原句、旧摘要唯一匹配", () => {
  const xml =
    "<article><body><sec><title>Results</title><p>First sentence.</p><sec><title>Sleep</title><p>Earlier sentence. More <italic>sleep</italic> was observed. Next sentence.</p></sec></sec></body></article>";
  const anchors = fullTextAnchors(p, xml),
    a = anchors.find((s) => s.quote === "More sleep was observed.")!;
  assert.deepEqual(
    [a.section, a.paragraph, a.sentence, a.before, a.after],
    ["Results › Sleep", 1, 2, "Earlier sentence.", "Next sentence."],
  );
  const e = {
    paperKey: p.key,
    object: "",
    method: "",
    finding: "",
    limitation: "",
    quote: "The first sentence.",
  };
  assert.equal(evidenceAnchors(e, p)[0].sentence, 1);
  assert.deepEqual(
    evidenceAnchors(e, {
      ...p,
      abstract: "The first sentence. The first sentence.",
    }),
    [],
  );
});
test("全文不可访问退回摘要、缺少摘要保留空材料", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("", { status: 404 }),
  );
  const a = await sourceCandidates({ ...p, pmcid: "PMC1" }, "", []);
  assert.equal(a[1].kind, "abstract");
  assert.deepEqual(await sourceCandidates({ ...p, abstract: "" }, "", []), []);
});
test("段落旧版可读、逐句引用关系拦截、导出编号一致", () => {
  const a = fullTextAnchors(
    p,
    "<article><body><p>Verified text.</p></body></article>",
  )[0];
  const e = {
    paperKey: p.key,
    object: "",
    method: "",
    finding: "",
    limitation: "",
    quote: a.quote,
    anchors: [a],
  };
  const second = {
    ...p,
    key: "MED:111",
    id: "111",
    url: "https://europepmc.org/article/MED/111",
  };
  const section = sectionFromClaims(
    "研究概况",
    [{ text: "核对后的陈述。", refs: [a.id], highlight: "陈述" }],
    new Map([[a.id, a]]),
  );
  const project = {
    ...emptyProject(),
    papers: [second, p],
    selected: [second.key, p.key],
    evidence: [e],
    sections: [section],
  };
  assert.ok(projectSchema.safeParse(project).success);
  assert.equal(referenceKeys(project)[0], p.key);
  assert.match(markdown(project), /<sup>\[1\]<\/sup>/);
  assert.equal(
    projectSchema.safeParse({ ...project, evidence: [] }).success,
    false,
  );
  assert.ok(
    projectSchema.safeParse({
      ...project,
      sections: [{ heading: "旧简报", text: "旧内容", citations: [p.key] }],
    }).success,
  );
});

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { search } from "../server/services.js";
import { refine } from "../server/retrieval.js";
import { inferConcepts, rankPaper, orderPapers } from "../shared/ranking.js";
import type { Paper } from "../shared/schema.js";
const topics = [
  [
    "咖啡因摄入对运动员的睡眠有何影响？",
    "caffeine AND athletes",
    "sleep | insomnia",
  ],
  [
    "褪黑素对儿童失眠有何影响？",
    "melatonin AND children",
    "insomnia | sleep onset",
  ],
  [
    "老年人维生素 D 补充与骨折有何关系？",
    "vitamin D AND older adults",
    "fracture",
  ],
  [
    "运动对高血压成人的血压有何影响？",
    "exercise AND hypertension",
    "blood pressure",
  ],
  [
    "音乐干预与术后疼痛的关系如何？",
    "music AND surgery",
    "postoperative pain | post-operative pain",
  ],
  [
    "步行改善成人抑郁症状的证据如何？",
    "walking AND depression",
    "depressive symptoms | depression scores",
  ],
  [
    "正念训练与学生睡眠质量有关吗？",
    "mindfulness AND students",
    "sleep quality",
  ],
  [
    "太极训练能改善老年人的平衡能力吗？",
    "tai chi AND older adults",
    "balance | postural stability",
  ],
  [
    "益生菌与儿童抗生素相关腹泻是否相关？",
    "probiotics AND children",
    "antibiotic-associated diarrhea | antibiotic-associated diarrhoea",
  ],
  [
    "阻力训练与绝经后女性骨密度有何关系？",
    "resistance training AND postmenopausal women",
    "bone mineral density | bone density",
  ],
];
const path = "artifacts/relevance-v2";
await mkdir(path, { recursive: true });
async function save(name: string, data: unknown) {
  await writeFile(path + "/" + name + ".json", JSON.stringify(data, null, 2));
}
const mode = process.argv[2] || "collect";
if (mode === "collect") {
  const work = topics.map((_, i) => i);
  async function worker() {
    for (let i = work.shift(); i !== undefined; i = work.shift()) {
      const [question, query, extra] = topics[i];
      const cached = await readFile(
        path + "/pool-" + i + ".json",
        "utf8",
      ).catch(() => "");
      const pool: Paper[] = cached
        ? JSON.parse(cached)
        : (await search(query, "2020", "", "*", 12)).items;
      await save("pool-" + i, pool);
      const concepts = [
        ...inferConcepts(query, question),
        { terms: extra, required: true },
      ];
      const basic = orderPapers(
        pool.map((p, j) => ({ ...p, rank: rankPaper(p, concepts, j + 1) })),
      );
      const sorted = [...pool].sort((a, b) =>
        createHash("sha256")
          .update(a.key)
          .digest("hex")
          .localeCompare(createHash("sha256").update(b.key).digest("hex")),
      );
      await save("blind-" + i, {
        question,
        items: sorted.map((p) => ({
          key: p.key,
          title: p.title,
          abstract: p.abstract,
        })),
      });
      let ai: string[] | null = null,
        error = "";
      if (process.env.LIVE_AI === "1") {
        try {
          const reviews = await refine(
            {
              question,
              concepts,
              papers: basic.map((x) => ({
                key: x.key,
                title: x.title,
                abstract: x.abstract.slice(0, 6000),
              })),
            },
            {
              key: process.env.DEEPSEEK_API_KEY || "",
              model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
            },
          );
          ai = orderPapers(
            basic.map((p) => {
              const r = reviews.find((x) => x.key === p.key)!;
              return {
                ...p,
                rank: {
                  ...p.rank!,
                  review: {
                    ...r,
                    score: p.rank!.reasons.some((t) =>
                      t.startsWith("核心概念未命中"),
                    )
                      ? Math.min(39, r.score)
                      : r.score,
                  },
                },
              };
            }),
          ).map((x) => x.key);
        } catch (e) {
          error = e instanceof Error ? e.message : "精排失败";
        }
      }
      await save("order-" + i, {
        question,
        query,
        concepts,
        baseline: pool.map((p) => p.key),
        basic: basic.map((p) => p.key),
        ai,
        error,
      });
      console.log("候选集", i + 1, pool.length, ai ? "已精排" : error);
    }
  }
  await Promise.all([worker(), worker()]);
} else {
  const grades: Record<string, number>[] = JSON.parse(
    await readFile("tests/fixtures/relevance-grades.json", "utf8"),
  );
  const rows = [];
  for (let i = 0; i < topics.length; i++) {
    const blind = JSON.parse(
        await readFile(path + "/blind-" + i + ".json", "utf8"),
      ),
      o = JSON.parse(await readFile(path + "/order-" + i + ".json", "utf8"));
    const g: Map<string, number> = new Map(
      blind.items.map((p: Paper) => [p.key, grades[i][p.key]]),
    );
    if (
      g.size !== Object.keys(grades[i]).length ||
      [...g.values()].some((x) => ![0, 1, 2].includes(x))
    )
      throw Error("缺少盲评");
    function metric(order: string[]) {
      const v = order.map((k) => g.get(k)!);
      const dcg = (arr: number[]) =>
        arr
          .slice(0, 10)
          .reduce((n, x, j) => n + (2 ** x - 1) / Math.log2(j + 2), 0);
      return {
        p5: v.slice(0, 5).filter((n) => n === 2).length / 5,
        ndcg: dcg(v) / (dcg([...v].sort((a, b) => b - a)) || 1),
      };
    }
    rows.push({
      question: o.question,
      baseline: metric(o.baseline),
      basic: metric(o.basic),
      ai: o.ai ? metric(o.ai) : null,
      error: o.error,
      samples: blind.items.map((p: Paper) => ({
        key: p.key,
        title: p.title,
        grade: g.get(p.key),
      })),
      orders: { baseline: o.baseline, basic: o.basic, ai: o.ai },
    });
  }
  await save("evaluation", rows);
  console.table(rows.map(({ samples, orders, ...r }) => r));
}

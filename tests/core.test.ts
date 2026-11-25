import test from "node:test";
import assert from "node:assert/strict";
import { normalize, validateAnalysis } from "../server/core.js";
import { analyzeInput, emptyProject, projectSchema } from "../shared/schema.js";
import { csvCell, markdown } from "../src/export.js";
import { llm, analyze } from "../server/services.js";
const paper = normalize({
  source: "MED",
  id: "123",
  title: "A <i>study</i>",
  abstractText: "The experiment used mice. Results need further evaluation.",
  pubYear: "2023",
});
const valid = {
  evidence: [
    {
      paperKey: paper.key,
      object: "小鼠",
      method: "摘要未提供",
      finding: "仍需进一步评估",
      limitation: "摘要未提供",
      quote: "Results need further evaluation.",
    },
  ],
  sections: [
    { heading: "证据", text: "仍需进一步评估。", citations: [paper.key] },
  ],
};
test("清理题录 HTML，来源地址固定为 Europe PMC", () => {
  assert.equal(paper.title, "A study");
  assert.equal(paper.url, "https://europepmc.org/article/MED/123");
});
test("只接受摘要中存在的原句及已提供的文献引用", () => {
  assert.deepEqual(validateAnalysis(valid, [paper]), valid);
  assert.throws(() =>
    validateAnalysis(
      { ...valid, evidence: [{ ...valid.evidence[0], quote: "Not present" }] },
      [paper],
    ),
  );
  assert.throws(() =>
    validateAnalysis(
      {
        ...valid,
        sections: [{ ...valid.sections[0], citations: ["MED:999"] }],
      },
      [paper],
    ),
  );
});
test("不允许重复、遗漏文献或虚构来源链接", () => {
  assert.throws(() =>
    validateAnalysis(
      { ...valid, evidence: [valid.evidence[0], valid.evidence[0]] },
      [paper],
    ),
  );
  assert.throws(() => validateAnalysis({ ...valid, evidence: [] }, [paper]));
  assert.throws(() =>
    validateAnalysis(
      {
        ...valid,
        sections: [{ ...valid.sections[0], text: "https://fake.invalid" }],
      },
      [paper],
    ),
  );
});
test("分析接口拒绝任意 URL 与超出上限的文献数", () => {
  assert.equal(
    analyzeInput.safeParse({
      question: "test",
      papers: [{ source: "MED", id: "https://evil.invalid" }],
    }).success,
    false,
  );
  assert.equal(
    analyzeInput.safeParse({
      question: "test",
      papers: Array(11).fill({ source: "MED", id: "123" }),
    }).success,
    false,
  );
});
test("导入 schema 拒绝不受信任的来源 URL 与未知版本", () => {
  const p = emptyProject();
  assert.equal(projectSchema.safeParse({ ...p, version: 2 }).success, false);
  assert.equal(
    projectSchema.safeParse({
      ...p,
      papers: [{ ...paper, url: "javascript:alert(1)" }],
    }).success,
    false,
  );
});
test("CSV 转义公式和引号，简报保留来源", () => {
  assert.equal(csvCell("=SUM(A1)"), '"\'=SUM(A1)"');
  assert.equal(csvCell('a"b'), '"a""b"');
  const p = {
    ...emptyProject(),
    papers: [paper],
    selected: [paper.key],
    ...valid,
  };
  assert.match(markdown(p), /https:\/\/europepmc.org\/article\/MED\/123/);
});
test("无密钥和无摘要明确拒绝，不触发伪造生成", async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    await assert.rejects(() => llm("test", {}), /尚未配置/);
    await assert.rejects(
      () => analyze("test", [{ ...paper, abstract: "" }]),
      /均无摘要/,
    );
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});
test("模拟鉴权失败、余额不足和限流，返回明确错误且不暴露上游内容", async (t) => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "synthetic-test-only";
  try {
    for (const [status, message] of [
      [401, /鉴权失败/],
      [402, /余额不足/],
      [429, /限流/],
    ] as const) {
      const stub = t.mock.method(
        globalThis,
        "fetch",
        async () => new Response("untrusted upstream details", { status }),
      );
      await assert.rejects(
        () => llm("test", {}, { key: "synthetic-test-only", model: "test" }),
        message,
      );
      stub.mock.restore();
    }
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});
test("模拟网络异常和截断输出，禁止将部分文本作为成功简报", async (t) => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "synthetic-test-only";
  try {
    let stub = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("network");
    });
    await assert.rejects(
      () => llm("test", {}, { key: "synthetic-test-only", model: "test" }),
      /网络不可用/,
    );
    stub.mock.restore();
    stub = t.mock.method(globalThis, "fetch", async () =>
      Response.json({
        choices: [{ finish_reason: "length", message: { content: "{}" } }],
      }),
    );
    await assert.rejects(
      () => llm("test", {}, { key: "synthetic-test-only", model: "test" }),
      /未完成/,
    );
    stub.mock.restore();
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});

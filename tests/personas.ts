import { chromium, type Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.TEST_URL || "http://127.0.0.1:8790";
await mkdir("artifacts/personas", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const events: string[] = [],
  errors: string[] = [],
  audits: any[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const username = "persona_" + Date.now(),
  password = "Synthetic-User-2026!";
async function shot(name: string) {
  await page.screenshot({
    path: `artifacts/personas/${name}.png`,
    fullPage: true,
  });
}
async function audit(name: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  audits.push({
    name,
    violations: result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  });
}
async function login(target: Page) {
  await target.goto(base);
  await target.getByLabel("用户名", { exact: true }).fill(username);
  await target.getByLabel("密码", { exact: true }).fill(password);
  await target.getByRole("button", { name: "登录", exact: true }).click();
  await target.getByRole("button", { name: "开始研究", exact: true }).waitFor();
}
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "欢迎回到研究空间" }).waitFor();
  await audit("登录");
  await shot("01-login");
  await page.getByRole("button", { name: "还没有账号？创建账号" }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await page.getByRole("heading", { name: "开始研究" }).waitFor();
  await page.getByRole("button", { name: "开始检索", exact: true }).click();
  await page.getByText("请先填写至少两个字符的英文检索词。").waitFor();
  events.push("新手：空检索得到可理解的提示，未丢失页面");
  const fixture = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile("tests/fixtures/papers.json", "utf8"),
  );
  await page.route("**/api/search", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({
          result: {
            items: fixture.items,
            total: 2,
            received: 2,
            concepts: [],
            nextCursor: null,
            query: "quercetin",
          },
        }) + "\n",
    }),
  );
  await page.locator("#query").fill("quercetin");
  await page.getByRole("button", { name: "开始检索", exact: true }).click();
  await page.getByLabel("选择文献 1", { exact: true }).waitFor();
  await audit("文献列表");
  await page.getByRole("button", { name: "查看摘要与备注" }).first().click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByLabel("人工阅读备注")
    .fill("先读摘要，全文方法和统计仍需核实。");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  events.push("新手：打开摘要、输入备注、键盘 Escape 返回");
  await page.getByLabel("选择文献 1", { exact: true }).check();
  await page.getByLabel("选择文献 2", { exact: true }).check();
  await page.getByRole("button", { name: "手工整理", exact: true }).click();
  await page
    .getByLabel("主要发现", { exact: true })
    .first()
    .fill("场景模拟记录：等待全文核对，不作疗效判断。");
  await audit("证据表");
  await shot("02-evidence");
  await page.getByRole("button", { name: "查看研究简报" }).click();
  await page
    .getByRole("textbox", { name: "证据对比第1句", exact: true })
    .fill("本研究笔记仅整理公开摘要。后续需查阅全文，核对实验条件和研究局限。");
  await audit("简报");
  await shot("03-report");
  await page.pdf({
    path: "artifacts/personas/report.pdf",
    format: "A4",
    printBackground: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "项目 JSON", exact: true }).click();
  await (await download).saveAs("artifacts/personas/project.json");
  events.push("研究者：完成两篇手工证据整理、可编辑简报及文件下载");
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  await login(second);
  await second.getByRole("button", { name: "研究简报", exact: true }).click();
  assert.match(
    await second
      .getByRole("textbox", { name: "证据对比第1句", exact: true })
      .inputValue(),
    /本研究笔记/,
  );
  await second
    .getByRole("textbox", { name: "证据对比第1句", exact: true })
    .fill("另一设备已补充阅读笔记。");
  await second.getByText("已同步到账号", { exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: "证据对比第1句", exact: true })
    .fill("旧页面准备覆盖数据");
  await page.getByText(/另一设备已更新此研究/).waitFor();
  const backup = page.waitForEvent("download");
  await page.getByRole("button", { name: "本地备份", exact: true }).click();
  await (await backup).saveAs("artifacts/personas/conflict-backup.json");
  await page.reload();
  await page.getByRole("button", { name: "研究简报", exact: true }).click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "证据对比第1句", exact: true })
      .inputValue(),
    "另一设备已补充阅读笔记。",
  );
  events.push("换设备：恢复记录；并发冲突保留新版本，旧修改可独立下载");
  await secondContext.close();
  await page.getByRole("button", { name: /账号研究库/ }).click();
  await page.locator(".stored-files a").first().waitFor();
  await audit("研究库");
  await shot("04-library");
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{bad"),
  });
  await page.locator(".notice").waitFor();
  assert.ok((await page.locator(".history-list article").count()) > 0);
  events.push("误操作：损坏导入文件被拒绝，原研究保留");
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole("button", { name: "开始研究", exact: true }).click();
    await shot(`home-${width}`);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await audit(`首页-${width}`);
  }
  await page.getByRole("button", { name: /退出登录/ }).click();
  await page.getByRole("heading", { name: "欢迎回到研究空间" }).waitFor();
  assert.equal((await page.request.get(base + "/api/projects")).status(), 401);
  events.push("退出：撤销登录后无法访问私人研究接口");
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/personas/results.json",
    JSON.stringify(
      { type: "自动化拟人场景模拟，非真实用户访谈", events, errors, audits },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        events,
        violations: audits.map((a) => ({
          name: a.name,
          count: a.violations.length,
        })),
      },
      null,
      2,
    ),
  );
} catch (e) {
  await shot("failure");
  console.log((await page.locator("body").innerText()).slice(0, 2200));
  throw e;
} finally {
  await browser.close();
}

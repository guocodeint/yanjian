import { useState } from "react";
import type {
  Anchor,
  Concept,
  Paper,
  Project,
  Section,
  Trace,
} from "../shared/schema";
import {
  anchorMap,
  referenceKeys,
  sectionFromClaims,
  location,
} from "../shared/evidence";
import { level, scoreOf } from "../shared/ranking";

type SearchResult = {
  items: Paper[];
  total: number;
  received: number;
  nextCursor: string | null;
  query: string;
  concepts: Concept[];
};
export async function streamedSearch(
  body: unknown,
  onEvent: (e: Trace) => void,
) {
  const response = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body)
    throw Error((await response.json()).error || "检索请求失败");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    result: SearchResult | undefined;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines.filter(Boolean)) {
        const data = JSON.parse(line);
        if (data.error) throw Error(data.error);
        if (data.event) onEvent(data.event);
        if (data.result) result = data.result;
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!result) throw Error("连接提前结束，请重新检索。");
  return result;
}
const stages = [
  "确认条件",
  "请求文献库",
  "接收与去重",
  "计算相关性",
  "结果就绪",
];
export function Flow({
  events,
  live,
  error,
  retry,
}: {
  events: Trace[];
  live: boolean;
  error?: string;
  retry: () => void;
}) {
  if (!events.length && !live && !error) return null;
  const last = events.at(-1),
    ms = last && events[0] ? Date.parse(last.at) - Date.parse(events[0].at) : 0;
  return (
    <section className="flow" aria-label="检索流程">
      <div className="flow-head">
        <strong>
          {error ? "检索未完成" : live ? "本次检索" : "上次检索记录"}
        </strong>
        <small>
          {events[0] && new Date(events[0].at).toLocaleString("zh-CN")} ·{" "}
          {(ms / 1000).toFixed(1)} 秒
        </small>
      </div>
      <ol aria-label="检索阶段">
        {stages.map((s, i) => (
          <li
            key={s}
            className={last && i <= last.stage ? "reached" : ""}
            aria-current={last?.stage === i ? "step" : undefined}
          >
            <span>{last && i < last.stage ? "✓" : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <p role="status">{error || last?.detail || "正在提交条件…"}</p>
      {error && <button onClick={retry}>重试本次检索</button>}
      <details>
        <summary>查看检索记录</summary>
        {events.map((e) => (
          <p key={e.stage}>
            {new Date(e.at).toLocaleTimeString("zh-CN")} · {stages[e.stage]} ·{" "}
            {e.detail}
          </p>
        ))}
      </details>
    </section>
  );
}
export function ConceptEditor({
  groups,
  change,
}: {
  groups: Concept[];
  change: (groups: Concept[]) => void;
}) {
  return (
    <details className="concepts">
      <summary>排序概念 · {groups.length} 组</summary>
      <p>同义词用 | 分隔。缺少“核心”概念的文献会降低排序。</p>
      {groups.map((g, i) => (
        <div key={i}>
          <input
            aria-label={"概念 " + (i + 1)}
            value={g.terms === " " ? "" : g.terms}
            maxLength={240}
            onChange={(e) =>
              change(
                groups.map((x, j) =>
                  i === j ? { ...x, terms: e.target.value || " " } : x,
                ),
              )
            }
          />
          <label>
            <input
              type="checkbox"
              checked={g.required}
              onChange={(e) =>
                change(
                  groups.map((x, j) =>
                    i === j ? { ...x, required: e.target.checked } : x,
                  ),
                )
              }
            />
            核心
          </label>
          <button
            aria-label={"移除概念 " + (i + 1)}
            onClick={() => change(groups.filter((_, j) => i !== j))}
          >
            移除
          </button>
        </div>
      ))}
      {groups.length < 16 && (
        <button
          onClick={() => change([...groups, { terms: " ", required: false }])}
        >
          添加概念
        </button>
      )}
    </details>
  );
}
export function RankBadge({ paper }: { paper: Paper }) {
  if (!paper.rank) return <small>历史记录 · 尚未评估相关性</small>;
  const r = paper.rank,
    score = scoreOf(paper);
  return (
    <details className="rank-details">
      <summary>
        <b
          className={
            "rank rank-" + (score >= 78 ? "high" : score >= 45 ? "mid" : "low")
          }
        >
          {level(score)}
        </b>{" "}
        {r.review ? "模型精排" : "概念匹配"} · 查看依据
      </summary>
      {r.review && (
        <p>
          {r.review.reason}
          <br />
          <q>{r.review.quote}</q>
        </p>
      )}
      {r.reasons.map((line, i) => {
        const [label, term] = line.split(" · ");
        const content =
          label === "摘要命中"
            ? paper.abstract
            : label === "题名命中"
              ? paper.title
              : label === "索引命中"
                ? paper.subjects?.join("；")
                : "";
        const index = content?.toLowerCase().indexOf(term.toLowerCase()) ?? -1;
        return (
          <p key={i}>
            {line}
            {content && index >= 0 && (
              <small>
                …{content.slice(Math.max(0, index - 45), index)}
                <mark>{content.slice(index, index + term.length)}</mark>
                {content.slice(index + term.length, index + term.length + 70)}…
              </small>
            )}
          </p>
        );
      })}
      {!paper.abstract && <p>仅据题名与索引判断</p>}
    </details>
  );
}
export function Passage({ a }: { a: Anchor }) {
  return (
    <section
      className="passage"
      ref={(el) => {
        if (el) el.scrollIntoView({ block: "nearest" });
      }}
    >
      <strong>{location(a)}</strong>
      <blockquote>
        {a.before} <mark>{a.quote}</mark> {a.after}
      </blockquote>
    </section>
  );
}
export function BriefSection({
  section: s,
  index,
  p,
  open,
  change,
}: {
  section: Section;
  index: number;
  p: Project;
  open: (key: string, a?: Anchor, related?: Anchor[]) => void;
  change: (s: Section) => void;
}) {
  const [edit, setEdit] = useState(s.claims?.every((c) => c.pending) ?? false),
    map = anchorMap(p),
    keys = referenceKeys(p);
  const sources = (s.citations || []).map((k) => (
    <button key={k} onClick={() => open(k)}>
      [{keys.indexOf(k) + 1}] {p.papers.find((x) => x.key === k)?.title || k}
    </button>
  ));
  return (
    <section className="report-section">
      <h3>
        {String(index + 1).padStart(2, "0")} / {s.heading}
      </h3>
      {s.claims ? (
        <>
          <div className="claims">
            {s.claims.map((c, i) => {
              const where = c.highlight ? c.text.indexOf(c.highlight) : -1;
              const refs = c.refs
                .map((r) => map.get(r))
                .filter((a): a is Anchor => !!a);
              const grouped = [...new Set(refs.map((a) => a.paperKey))];
              const modify = (changes: Partial<typeof c>) =>
                change(
                  sectionFromClaims(
                    s.heading,
                    s.claims!.map((x, j) =>
                      i === j ? { ...x, ...changes } : x,
                    ),
                    map,
                  ),
                );
              return (
                <div key={i}>
                  <p>
                    {where >= 0 ? (
                      <>
                        {c.text.slice(0, where)}
                        <mark aria-label={"重点：" + c.highlight}>
                          {c.highlight}
                        </mark>
                        {c.text.slice(where + c.highlight!.length)}
                      </>
                    ) : (
                      c.text
                    )}
                    {grouped.map((k) => (
                      <sup key={k}>
                        <button
                          aria-label={
                            "查看文献 " + (keys.indexOf(k) + 1) + " 的原句"
                          }
                          onClick={() =>
                            open(
                              k,
                              refs.find((a) => a.paperKey === k),
                              refs.filter((a) => a.paperKey === k),
                            )
                          }
                        >
                          [{keys.indexOf(k) + 1}]
                        </button>
                      </sup>
                    ))}
                    {c.pending && <small> · 待复核</small>}
                  </p>
                  {edit && (
                    <div className="claim-edit">
                      <textarea
                        aria-label={s.heading + "第" + (i + 1) + "句"}
                        value={c.text}
                        maxLength={2000}
                        onChange={(e) =>
                          modify({
                            text: e.target.value,
                            pending: true,
                            highlight: undefined,
                          })
                        }
                      />
                      {Array.from(map.values()).map((a) => (
                        <label key={a.id}>
                          <input
                            type="checkbox"
                            checked={c.refs.includes(a.id)}
                            onChange={(e) =>
                              modify({
                                refs: e.target.checked
                                  ? [...c.refs, a.id]
                                  : c.refs.filter((id) => id !== a.id),
                                pending: true,
                              })
                            }
                          />
                          {location(a)} · {a.quote}
                        </label>
                      ))}
                      <button
                        disabled={!refs.length}
                        onClick={() => modify({ pending: false })}
                      >
                        已核对原句
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            className="text-button no-print"
            onClick={() => setEdit(!edit)}
          >
            {edit ? "收起编辑" : "编辑本节"}
          </button>
          {edit && (
            <button
              className="no-print"
              onClick={() =>
                change(
                  sectionFromClaims(
                    s.heading,
                    [...s.claims!, { text: "", refs: [], pending: true }],
                    map,
                  ),
                )
              }
            >
              添加陈述
            </button>
          )}
        </>
      ) : (
        <>
          <textarea
            aria-label={s.heading}
            value={s.text}
            maxLength={10000}
            onChange={(e) => change({ ...s, text: e.target.value })}
          />
          <div className="print-text">{s.text}</div>
        </>
      )}
      {sources.length > 0 && (
        <div className="section-sources">
          <small>本节文献</small>
          {sources}
        </div>
      )}
    </section>
  );
}

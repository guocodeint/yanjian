import {
  anchorMap,
  referenceKeys,
  evidenceAnchors,
  location,
} from "../shared/evidence.js";
import type { Project } from "../shared/schema";
export function download(
  name: string,
  body: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const csvCell = (v: string) =>
  '"' + (/^[\s]*[=+@-]/.test(v) ? "'" + v : v).replaceAll('"', '""') + '"';
export function csv(p: Project) {
  return (
    "\ufeff" +
    [
      [
        "文献",
        "年份",
        "研究对象",
        "方法",
        "主要发现",
        "局限",
        "证据原句",
        "位置与原文",
        "备注",
        "来源",
      ],
      ...p.selected.map((key) => {
        const paper = p.papers.find((x) => x.key === key)!;
        const e = p.evidence.find((x) => x.paperKey === key);
        return [
          paper.title,
          paper.year,
          e?.object || "",
          e?.method || "",
          e?.finding || "",
          e?.limitation || "",
          e?.quote || "",
          e
            ? evidenceAnchors(e, paper)
                .map((a) => location(a) + "：" + a.quote)
                .join("\n")
            : "",
          p.notes[key] || "",
          paper.url,
        ];
      }),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
  );
}
export function markdown(p: Project) {
  const keys = referenceKeys(p),
    anchors = anchorMap(p);
  const lines = [
    "# " + (p.analysisQuestion || p.question || "文献研究简报"),
    "检索式：" + (p.analysisQuery || p.searchedQuery || p.query),
    "依据范围见各条原文标识。",
  ];
  for (const s of p.sections) {
    lines.push("## " + s.heading);
    if (s.claims)
      for (const c of s.claims) {
        const refs = [
          ...new Set(
            c.refs
              .map((id) => anchors.get(id)?.paperKey)
              .filter((k): k is string => !!k),
          ),
        ];
        const text = c.highlight
          ? c.text.replace(c.highlight, "**" + c.highlight + "**")
          : c.text;
        lines.push(
          text +
            (refs.length
              ? "<sup>" +
                refs.map((k) => "[" + (keys.indexOf(k) + 1) + "]").join("") +
                "</sup>"
              : "") +
            (c.pending ? "（待复核）" : ""),
        );
      }
    else lines.push(s.text);
    if (s.citations.length)
      lines.push(
        "本节文献 " +
          s.citations.map((k) => "[" + (keys.indexOf(k) + 1) + "]").join(" "),
      );
  }
  lines.push("## 参考文献与原文依据");
  for (const [i, k] of keys.entries()) {
    const paper = p.papers.find((x) => x.key === k);
    if (!paper) continue;
    lines.push(
      "[" +
        (i + 1) +
        "] " +
        paper.title +
        (/[.!?]$/.test(paper.title) ? " " : ". ") +
        paper.year +
        ". " +
        paper.url,
      "获取时间：" + paper.fetchedAt,
    );
    const e = p.evidence.find((x) => x.paperKey === k);
    if (e) {
      lines.push(
        "研究对象：" + e.object,
        "方法：" + e.method,
        "主要发现：" + e.finding,
        "局限：" + e.limitation,
      );
      const found = [...anchors.values()].filter((a) => a.paperKey === k);
      for (const a of found) lines.push(location(a) + "\n> " + a.quote);
      if (!found.length && e.quote) lines.push("位置待核实：" + e.quote);
    }
    if (!e)
      for (const a of anchors.values())
        if (a.paperKey === k) lines.push(location(a) + "\n> " + a.quote);
    if (p.notes[k]) lines.push("人工备注：" + p.notes[k]);
  }
  return lines.join("\n\n") + "\n";
}

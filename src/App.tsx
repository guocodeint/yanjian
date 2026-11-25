import {
  Flow,
  ConceptEditor,
  RankBadge,
  BriefSection,
  Passage,
  streamedSearch,
} from "./Research";
import { inferConcepts, orderPapers } from "../shared/ranking";
import {
  evidenceAnchors,
  location,
  referenceKeys,
  headings,
  sectionFromClaims,
  anchorMap,
} from "../shared/evidence";
import type { Trace, Anchor } from "../shared/schema";
import Personal, { type Settings } from "./Personal";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowSquareOut,
  BookOpenText,
  Check,
  ClockCounterClockwise,
  DownloadSimple,
  FileText,
  Flask,
  MagnifyingGlass,
  Plus,
  Sparkle,
  Table,
  Trash,
  UserCircle,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  emptyProject,
  projectSchema,
  type Project,
  type Evidence,
  type Analysis,
  type Paper,
  type Section,
} from "../shared/schema";
import {
  deleteProject,
  listProjects,
  saveProject,
  storedExport,
  resetStorageSession,
} from "./storage";
import Auth, { type User } from "./Auth";
import { csv, download, markdown } from "./export";
type View = "home" | "papers" | "evidence" | "report" | "history" | "settings";
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "服务暂时不可用");
  return data;
}
export default function App() {
  const [p, setP] = useState<Project>(emptyProject),
    [view, setView] = useState<View>("home"),
    [history, setHistory] = useState<Project[]>([]),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [configured, setConfigured] = useState(false),
    [ready, setReady] = useState(false),
    [saved, setSaved] = useState(""),
    [detail, setDetail] = useState<string | null>(null),
    [showOriginal, setShowOriginal] = useState(false);
  const [user, setUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(false);
  const [files, setFiles] = useState<
    { id: string; filename: string; created_at: string }[]
  >([]);
  const [flow, setFlow] = useState<{
    id: string;
    events: Trace[];
    error?: string;
    more: boolean;
  } | null>(null);
  const [citedPassages, setCitedPassages] = useState<Anchor[]>([]);
  const [focusAnchor, setFocusAnchor] = useState<Anchor>();
  const openSource = (key: string, a?: Anchor, related: Anchor[] = []) => {
    setCitedPassages(related);
    setFocusAnchor(a);
    setDetail(key);
  };
  const [nickname, setNickname] = useState("");
  const applySettings = (v: Settings) => {
    setConfigured(v.aiConfigured);
    setNickname(v.nickname);
  };
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!detail) return;
    const previous = document.activeElement as HTMLElement;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
      if (e.key === "Tab") {
        const items = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".detail-panel button:not(:disabled),.detail-panel a,.detail-panel textarea:not(:disabled)",
          ),
        );
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [detail]);
  useEffect(() => {
    api<{ user: User | null }>("/api/auth/me")
      .then((d) => {
        setUser(d.user);
        setAuthReady(true);
      })
      .catch(() => {
        setAuthReady(true);
        setNotice("无法连接服务端。");
      });
  }, []);
  useEffect(() => {
    if (!user) return;
    setReady(false);
    resetStorageSession();
    let active = true;
    setConfigured(false);
    setNickname("");
    api<Settings>("/api/settings")
      .then((v) => {
        if (active) applySettings(v);
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      });
    listProjects()
      .then((items) => {
        setHistory(items);
        setP(items[0] || emptyProject());
        setReady(true);
      })
      .catch((e) => {
        setReady(true);
        setNotice(e.message);
      });
    return () => {
      active = false;
    };
  }, [user]);
  useEffect(() => {
    if (user && view === "history")
      api<typeof files>("/api/exports")
        .then(setFiles)
        .catch((e) => setNotice(e.message));
  }, [user, view]);
  useEffect(() => {
    if (!user || !ready || (!p.question && !p.papers.length)) return;
    setSaved("保存中");
    const timer = setTimeout(() => {
      saveProject(p)
        .then(() => {
          setSaved("已同步到账号");
          return listProjects();
        })
        .then(setHistory)
        .catch((e) => {
          setSaved("保存失败");
          setNotice(e.message);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [p, ready, user]);
  useEffect(() => {
    if (saved !== "保存中" && saved !== "保存失败") return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [saved]);
  const update = (changes: Partial<Project>) =>
    setP((current) => ({
      ...current,
      ...changes,
      updatedAt: new Date().toISOString(),
    }));
  const work = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作失败，请重试。");
    } finally {
      setBusy("");
    }
  };
  const selected = p.papers.filter((x) => p.selected.includes(x.key));
  const stale =
    !!p.original &&
    (p.analysisQuestion !== p.question ||
      p.analysisQuery !== p.searchedQuery ||
      [...p.analyzedKeys].sort().join() !== [...p.selected].sort().join());
  async function newProject() {
    if (p.question || p.papers.length) await saveProject(p);
    setP(emptyProject());
    setView("home");
    setNotice("");
    setDetail(null);
  }
  async function searchMore(more = false) {
    await work(more ? "加载下一页" : "检索文献", async () => {
      if (!more && p.query.trim().length < 2)
        throw new Error("请先填写至少两个字符的英文检索词。");
      if (!more && /[\u3400-\u9fff]/.test(p.query))
        throw new Error("请填写英文检索词，或使用 AI 建议英文检索式。");
      if (!more && p.papers.length) {
        await saveProject(p);
      }
      const record = more ? p.searchRecord : undefined;
      const query = record?.query || (more ? p.searchedQuery : p.query);
      const question = record?.question || p.question || query;
      const concepts = (
        record?.concepts ||
        p.concepts ||
        inferConcepts(query, question)
      ).filter((g) => g.terms.trim());
      const from = record?.from ?? (more ? "" : p.from),
        to = record?.to ?? (more ? "" : p.to);
      const events: Trace[] = [];
      setFlow({ id: p.id, events: [], more });
      try {
        const data = await streamedSearch(
          {
            question,
            query,
            from,
            to,
            concepts,
            cursor: more ? p.nextCursor : undefined,
            offset: more ? (record?.received ?? p.papers.length) : 0,
          },
          (e) => {
            events.push(e);
            setFlow({ id: p.id, events: [...events], more });
          },
        );
        const base = more
          ? p
          : {
              ...emptyProject(),
              ...(!p.searchRecord && !p.papers.length && !p.sections.length
                ? { id: p.id, revision: p.revision }
                : {}),
              question,
              query,
              from,
              to,
              concepts,
            };
        const unique = new Map(base.papers.map((x) => [x.key, x]));
        for (const paper of data.items)
          if (!unique.has(paper.key)) unique.set(paper.key, paper);
        const papers = orderPapers([...unique.values()]);
        const received =
          (more ? (record?.received ?? p.papers.length) : 0) + data.received;
        setP({
          ...base,
          papers,
          total: data.total,
          nextCursor: received < 1000 ? data.nextCursor : null,
          searchedQuery: data.query,
          mode: "live",
          updatedAt: new Date().toISOString(),
          searchRecord: {
            events,
            question,
            query,
            concepts,
            from,
            to,
            received,
          },
        });
        setFlow(null);
      } catch (e) {
        setFlow({
          id: p.id,
          events,
          error: e instanceof Error ? e.message : "连接失败",
          more,
        });
        throw e;
      }
      setView("papers");
      setDetail(null);
    });
  }
  async function rerank() {
    if (!configured) {
      setView("settings");
      return;
    }
    const candidates = orderPapers(
      p.papers.map((x) => ({
        ...x,
        rank: x.rank ? { ...x.rank, review: undefined } : undefined,
      })),
    ).slice(0, 20);
    await work(
      "正在按研究问题核对 " + candidates.length + " 篇候选",
      async () => {
        const data = await api<{
          items: {
            key: string;
            score: number;
            quote: string;
            reason: string;
          }[];
        }>("/api/rerank", {
          question: p.searchRecord?.question || p.question || p.query,
          concepts: p.searchRecord?.concepts || [],
          papers: candidates.map((x) => ({
            key: x.key,
            title: x.title,
            abstract: x.abstract.slice(0, 6000),
          })),
        });
        update({
          papers: orderPapers(
            p.papers.map((x) => {
              const review = data.items.find((i) => i.key === x.key);
              return review && x.rank
                ? {
                    ...x,
                    rank: {
                      ...x.rank,
                      review: {
                        ...review,
                        score: x.rank.reasons.some((r) =>
                          r.startsWith("核心概念未命中"),
                        )
                          ? Math.min(39, review.score)
                          : review.score,
                      },
                    },
                  }
                : x;
            }),
          ),
        });
      },
    );
  }
  const focusedQuery = () => {
    const record = p.searchRecord;
    if (!record) return "";
    const extra = record.concepts
      .filter((g) => g.required)
      .map((g) =>
        g.terms
          .split("|")
          .map((term) => term.trim().replace(/["\\]/g, ""))
          .filter(Boolean),
      )
      .filter(
        (a) =>
          a.length &&
          !a.some((t) => record.query.toLowerCase().includes(t.toLowerCase())),
      );
    if (!extra.length) return "";
    const value =
      "(" +
      record.query +
      ") AND " +
      extra
        .map(
          (terms) => "(" + terms.map((t) => '"' + t + '"').join(" OR ") + ")",
        )
        .join(" AND ");
    return value.length <= 500 ? value : "";
  };
  function choose(key: string) {
    if (p.selected.includes(key)) {
      update({
        selected: p.selected.filter((k) => k !== key),
        decisions: { ...p.decisions, [key]: "待定" },
      });
      return;
    }
    if (p.selected.length >= 10) {
      setNotice("每次最多选择 10 篇文献。");
      return;
    }
    update({
      selected: [...p.selected, key],
      decisions: { ...p.decisions, [key]: "纳入" },
    });
  }
  type TranslationItem = {
    key: string;
    field: "title" | "abstract";
    text: string;
  };
  const pendingTitles: TranslationItem[] = [];
  let titleLength = 0;
  for (const paper of p.papers) {
    if (paper.titleZh || !paper.title.trim()) continue;
    if (pendingTitles.length === 20 || titleLength + paper.title.length > 20000)
      break;
    pendingTitles.push({ key: paper.key, field: "title", text: paper.title });
    titleLength += paper.title.length;
  }
  function translateItems(items: TranslationItem[]) {
    if (!configured) {
      setDetail(null);
      setView("settings");
      return;
    }
    if (!items.length) return;
    const projectId = p.id;
    void work("正在翻译为简体中文", async () => {
      const data = await api<{
        items: { key: string; field: "title" | "abstract"; zh: string }[];
      }>("/api/translate", { items });
      setP((current) =>
        current.id !== projectId
          ? current
          : {
              ...current,
              updatedAt: new Date().toISOString(),
              papers: current.papers.map((paper) => {
                const next = { ...paper };
                for (const translated of data.items) {
                  if (
                    translated.key === paper.key &&
                    items.some(
                      (i) =>
                        i.key === paper.key &&
                        i.field === translated.field &&
                        i.text === paper[i.field],
                    )
                  ) {
                    next[
                      translated.field === "title" ? "titleZh" : "abstractZh"
                    ] = translated.zh;
                  }
                }
                return next;
              }),
            },
      );
    });
  }
  function manual() {
    const evidence = p.selected.map(
      (key) =>
        p.evidence.find((e) => e.paperKey === key) || {
          paperKey: key,
          object: "摘要未提供",
          method: "摘要未提供",
          finding: "待人工整理",
          limitation: "摘要未提供",
          quote: "",
        },
    );
    update({ evidence, reportAnchors: citedSnapshots() });
    setView("evidence");
  }
  async function generate() {
    await work("正在读取开放全文与摘要并整理证据", async () => {
      if (!selected.length) throw new Error("请至少选择一篇文献。");
      const data = await api<
        Analysis & { papers: Paper[]; analyzedAt: string }
      >("/api/analyze", {
        question: p.question || p.query,
        terms: p.searchRecord?.concepts.map((c) => c.terms),
        papers: selected.map(({ source, id }) => ({ source, id })),
      });
      update({
        reportAnchors: undefined,
        evidence: data.evidence,
        sections: data.sections,
        original: { evidence: data.evidence, sections: data.sections },
        papers: p.papers.map((x) => {
          const fresh = data.papers.find((y) => y.key === x.key);
          return fresh
            ? {
                ...fresh,
                rank: x.rank,
                titleZh: fresh.title === x.title ? x.titleZh : undefined,
                abstractZh:
                  fresh.abstract === x.abstract ? x.abstractZh : undefined,
              }
            : x;
        }),
        analyzedKeys: [...p.selected],
        analysisQuestion: p.question,
        analysisQuery: p.searchedQuery,
        analysisAt: data.analyzedAt,
      });
      setView("evidence");
    });
  }
  function citedSnapshots() {
    const refs = new Set(
      p.sections.flatMap((s) => s.claims?.flatMap((c) => c.refs) || []),
    );
    return [...anchorMap(p).values()].filter((a) => refs.has(a.id));
  }
  function editEvidence(key: string, field: keyof Evidence, value: string) {
    update({
      reportAnchors: citedSnapshots(),
      evidence: p.evidence.map((e) =>
        e.paperKey === key
          ? {
              ...e,
              [field]: value,
              fields: Object.fromEntries(
                Object.entries(e.fields || {}).filter(
                  ([name]) => name !== (field === "quote" ? "finding" : field),
                ),
              ),
            }
          : e,
      ),
    });
  }
  function template() {
    update({
      reportAnchors: undefined,
      sections: headings.map((heading, i) =>
        sectionFromClaims(
          heading,
          [
            {
              text: i === 0 ? p.question || p.query : "",
              refs: [],
              pending: true,
            },
          ],
          anchorMap(p),
        ),
      ),
    });
    setView("report");
  }
  function exportJson() {
    void work("保存导出文件", () => storedExport(p, "json"));
  }
  async function logout() {
    await work("退出登录", async () => {
      if (p.question || p.papers.length) await saveProject(p);
      await api("/api/auth/logout", {});
      setUser(null);
      setReady(false);
      setP(emptyProject());
      setHistory([]);
      setFiles([]);
      setView("home");
      setNotice("");
    });
  }
  async function importFile(file?: File) {
    if (!file) return;
    await work("导入研究项目", async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error("文件不得超过 8 MB。");
      let parsed: Project;
      try {
        parsed = projectSchema.parse(JSON.parse(await file.text()));
      } catch {
        throw new Error(
          "这个文件不是有效的研笺项目 JSON，请选择本应用导出的完整备份文件。",
        );
      }
      const keys = new Set(parsed.papers.map((x) => x.key));
      if (
        parsed.selected.some((k) => !keys.has(k)) ||
        parsed.evidence.some((e) => !keys.has(e.paperKey)) ||
        parsed.sections.some((s) => s.citations.some((k) => !keys.has(k)))
      )
        throw new Error("项目含有不存在的文献引用，无法导入。");
      if (p.question || p.papers.length) await saveProject(p);
      setP({
        ...parsed,
        id: crypto.randomUUID(),
        revision: 0,
        updatedAt: new Date().toISOString(),
      });
      setView("papers");
      setNotice("已导入为独立副本；导入内容未经本应用验证。");
    });
  }
  const tabs = [
    { id: "home" as View, label: "开始研究", icon: Flask },
    { id: "papers" as View, label: "文献工作台", icon: BookOpenText },
    { id: "evidence" as View, label: "证据矩阵", icon: Table },
    { id: "report" as View, label: "研究简报", icon: FileText },
    { id: "settings" as View, label: "个人设置", icon: UserCircle },
    { id: "history" as View, label: "账号研究库", icon: ClockCounterClockwise },
  ];
  const currentPaper = p.papers.find((x) => x.key === detail);
  if (!authReady) return <div className="boot">正在连接研究空间…</div>;
  if (!user) return <Auth onLogin={setUser} />;
  if (!ready) return <div className="boot">正在载入账号研究库…</div>;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("home");
          }}
        >
          <span className="brand-mark">
            <Flask size={25} />
          </span>
          <span>
            研笺<small>文献研究助手</small>
          </span>
        </a>
        <button
          className="new-button"
          disabled={!!busy}
          onClick={() => void work("新建研究", newProject)}
        >
          <Plus size={18} /> 新建研究
        </button>
        <span className="nav-label">研究空间</span>
        <nav>
          {tabs.map((t) => (
            <button
              key={t.id}
              className={view === t.id ? "active" : ""}
              onClick={() => {
                setView(t.id);
                setDetail(null);
              }}
            >
              <t.icon size={21} />
              {t.label}
              {t.id === "history" && (
                <span className="count">{history.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-dot" />
          记录保存到账号研究库
          <p>
            数据库保存研究记录，
            <br />
            导出文件存入服务端存储。
          </p>
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => void logout()}
          >
            退出登录 · {nickname || user.username}
          </button>
          <br />
          <span className="version">文献研究工作台 / 0.2</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            研究空间 <span className="slash">/</span>{" "}
            {tabs.find((t) => t.id === view)?.label}
          </span>
          <div className="top-status">
            <span className={"status-dot " + (configured ? "online" : "")} />
            {configured ? "AI 服务已配置" : "人工整理模式"}
            <span className="saved">{saved}</span>
          </div>
        </header>
        <main>
          <div aria-live="polite">
            {notice && (
              <div className="notice">
                <WarningCircle size={20} />
                <span>{notice}</span>
                <button aria-label="关闭提示" onClick={() => setNotice("")}>
                  ×
                </button>
              </div>
            )}
            {busy && (
              <div className="progress">
                <span className="spinner" />
                {busy}… 请保留当前页面。
              </div>
            )}
          </div>
          {(view === "home" || view === "papers") && (
            <Flow
              events={
                flow?.id === p.id ? flow.events : p.searchRecord?.events || []
              }
              live={!!busy && flow?.id === p.id}
              error={flow?.id === p.id ? flow.error : undefined}
              retry={() => void searchMore(flow?.more)}
            />
          )}
          <fieldset disabled={!!busy} className="content-fieldset">
            {view === "settings" && (
              <Personal username={user.username} onChange={applySettings} />
            )}
            {view === "home" && (
              <>
                <section className="page-title">
                  <h1>开始研究</h1>
                  <h2>使用说明</h2>
                  <ol className="guide">
                    <li>
                      填写自己的研究问题与英文检索词，选择发表年份后开始检索。
                    </li>
                    <li>
                      阅读摘要，选择需要整理的文献，记录纳入理由和原文依据。
                    </li>
                    <li>
                      需要 AI 辅助时，在
                      <button
                        className="text-button"
                        onClick={() => setView("settings")}
                      >
                        个人设置
                      </button>
                      中填写 API 密钥与模型。也可以直接手工整理。
                    </li>
                    <li>核对并导出简报，在账号研究库继续之前的工作。</li>
                  </ol>
                </section>
                <section className="search-card">
                  <div className="section-label">
                    <span className="step-tag">01</span> 今天，你想研究什么？
                  </div>
                  <label className="sr-only" htmlFor="question">
                    研究问题
                  </label>
                  <textarea
                    id="question"
                    className="question-input"
                    placeholder="填写你的研究问题"
                    value={p.question}
                    onChange={(e) => update({ question: e.target.value })}
                    maxLength={1000}
                  />
                  <div className="query-heading">
                    <label htmlFor="query">
                      英文检索式 <span>确认后用于 Europe PMC 检索</span>
                    </label>
                    <button
                      className="text-button"
                      disabled={!configured || p.question.length < 2}
                      onClick={() =>
                        void work("建议检索词", async () => {
                          const data = await api<{ query: string }>(
                            "/api/query",
                            { question: p.question },
                          );
                          update({ query: data.query, concepts: undefined });
                        })
                      }
                    >
                      <Sparkle size={16} /> AI 建议检索词
                    </button>
                  </div>
                  <input
                    id="query"
                    value={p.query}
                    onChange={(e) =>
                      update({ query: e.target.value, concepts: undefined })
                    }
                    placeholder="填写英文关键词或检索式"
                    maxLength={500}
                  />
                  <ConceptEditor
                    groups={p.concepts ?? inferConcepts(p.query, p.question)}
                    change={(concepts) => update({ concepts })}
                  />
                  <div className="search-footer">
                    <div className="years">
                      <span>发表年份</span>
                      <input
                        aria-label="开始年份"
                        type="number"
                        min="1800"
                        max="2100"
                        placeholder="不限"
                        value={p.from}
                        onChange={(e) => update({ from: e.target.value })}
                      />
                      <span>—</span>
                      <input
                        aria-label="结束年份"
                        type="number"
                        min="1800"
                        max="2100"
                        placeholder="至今"
                        value={p.to}
                        onChange={(e) => update({ to: e.target.value })}
                      />
                    </div>
                    <button
                      className="primary"
                      onClick={() => void searchMore()}
                    >
                      <MagnifyingGlass size={18} /> 开始检索{" "}
                      <ArrowRight size={18} />
                    </button>
                  </div>
                </section>
                <p className="footnote">
                  基于公开题录与摘要辅助学习科研。AI
                  内容需人工核实，不构成用药或临床建议。
                </p>
              </>
            )}
            {view === "papers" && (
              <>
                <PageTitle
                  eyebrow="LITERATURE WORKSPACE"
                  title="从文献中，找到线索。"
                  subtitle={p.question || "先建立研究问题，再开始筛选。"}
                />
                <div className="toolbar">
                  <div>
                    <strong>{p.total.toLocaleString()}</strong> 条检索结果{" "}
                    <span className="muted">/ 已加载 {p.papers.length} 篇</span>
                    <p className="query-display">
                      {p.searchedQuery || "尚未检索"}
                    </p>
                  </div>
                  <div>
                    {focusedQuery() && (
                      <button
                        onClick={() => {
                          update({ query: focusedQuery() });
                          setView("home");
                        }}
                      >
                        将缺少的核心概念加入检索式
                      </button>
                    )}
                    <button onClick={() => setView("home")}>修改检索</button>
                  </div>
                </div>
                {p.papers.length > 0 && (
                  <div className="language-tools">
                    <span>中文阅读 · 按需使用个人 AI 额度，译文随研究保存</span>
                    {p.searchRecord && (
                      <button onClick={() => void rerank()}>
                        {configured ? "按我的问题精排" : "配置个人模型精排"}（
                        {Math.min(20, p.papers.length)} 篇）
                      </button>
                    )}
                    {pendingTitles.length > 0 && (
                      <button onClick={() => translateItems(pendingTitles)}>
                        {configured
                          ? `翻译标题（${pendingTitles.length} 篇）`
                          : "配置 AI 翻译"}
                      </button>
                    )}
                  </div>
                )}
                <div className="selection-bar">
                  <span>
                    已选 <b>{p.selected.length}</b> / 10 篇
                  </span>
                  <div>
                    <button disabled={!selected.length} onClick={manual}>
                      手工整理
                    </button>
                    <button
                      className="primary"
                      disabled={
                        !configured ||
                        !selected.some((x) => x.abstract || x.pmcid)
                      }
                      onClick={() => void generate()}
                    >
                      <Sparkle size={17} /> 生成证据与简报
                    </button>
                  </div>
                </div>
                {!p.papers.length ? (
                  <Empty
                    title="这里还没有文献"
                    text="填写英文检索式开始研究；没有结果时尝试减少关键词。"
                    action={() => setView("home")}
                    label="开始研究"
                  />
                ) : (
                  <div className="paper-list">
                    {p.papers.map((paper, i) => (
                      <article
                        className={
                          "paper " +
                          (p.selected.includes(paper.key) ? "selected" : "")
                        }
                        key={paper.key}
                      >
                        <input
                          type="checkbox"
                          aria-label={`选择文献 ${i + 1}`}
                          checked={p.selected.includes(paper.key)}
                          onChange={() => choose(paper.key)}
                        />
                        <div className="paper-body">
                          <div className="paper-meta">
                            <span>{paper.year || "年份未知"}</span>
                            <span>{paper.journal || paper.source}</span>
                            {!paper.abstract && (
                              <span className="badge">无摘要</span>
                            )}
                            {p.decisions[paper.key] === "排除" && (
                              <span className="badge">已排除</span>
                            )}
                          </div>
                          <button
                            className="paper-title"
                            onClick={() => openSource(paper.key)}
                          >
                            {paper.titleZh || paper.title}
                          </button>
                          {paper.titleZh && (
                            <p className="translation-original">
                              AI 译题 · {paper.title}
                            </p>
                          )}
                          <RankBadge paper={paper} />
                          <p className="authors">{paper.authors}</p>
                          <p className="abstract-preview">
                            {paper.abstractZh
                              ? "AI 译文 · " + paper.abstractZh
                              : paper.abstract ||
                                "当前数据源未提供摘要，可以查看来源并人工记录。"}
                          </p>
                          <div className="paper-actions">
                            <button
                              className="text-button"
                              onClick={() => openSource(paper.key)}
                            >
                              查看摘要与备注
                            </button>
                            <a
                              href={paper.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              原文入口 <ArrowSquareOut size={14} />
                            </a>
                            <button
                              className="text-button muted"
                              onClick={() =>
                                update({
                                  selected: p.selected.filter(
                                    (k) => k !== paper.key,
                                  ),
                                  decisions: {
                                    ...p.decisions,
                                    [paper.key]:
                                      p.decisions[paper.key] === "排除"
                                        ? "待定"
                                        : "排除",
                                  },
                                })
                              }
                            >
                              {p.decisions[paper.key] === "排除"
                                ? "恢复待定"
                                : "排除"}
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {p.nextCursor && (
                  <button
                    className="load-more"
                    onClick={() => void searchMore(true)}
                  >
                    加载更多（最多 60 篇）
                  </button>
                )}
              </>
            )}
            {view === "evidence" && (
              <>
                <PageTitle
                  eyebrow="EVIDENCE MATRIX"
                  title="把发现放在一起。"
                  subtitle="比较研究对象、方法与结论，定位全文或摘要依据。点击位置即可查看原句和上下文。"
                />
                <div className="toolbar">
                  <span>{selected.length} 篇纳入文献 · 所有字段可人工编辑</span>
                  <div>
                    <button
                      disabled={!selected.length}
                      onClick={() =>
                        void work("保存导出文件", () => storedExport(p, "csv"))
                      }
                    >
                      <DownloadSimple size={17} /> CSV
                    </button>
                    <button
                      className="primary"
                      disabled={!selected.length}
                      onClick={() =>
                        p.sections.length ? setView("report") : template()
                      }
                    >
                      查看研究简报 <ArrowRight size={17} />
                    </button>
                  </div>
                </div>
                {stale && (
                  <div className="notice">
                    研究问题或所选文献已变化，已有 AI
                    结果可能过时；请重新生成并核对。
                  </div>
                )}
                {!p.evidence.length ? (
                  <Empty
                    title="证据还未整理"
                    text="纳入文献后，可以手工整理，也可以从开放全文或摘要提取证据。"
                    action={() => setView("papers")}
                    label="选择文献"
                  />
                ) : (
                  <div className="evidence-list">
                    {p.evidence
                      .filter((e) => p.selected.includes(e.paperKey))
                      .map((e, i) => {
                        const paper = p.papers.find(
                          (x) => x.key === e.paperKey,
                        );
                        return (
                          <section className="evidence-card" key={e.paperKey}>
                            <div className="evidence-title">
                              <span className="step-tag">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <h3>{paper?.title}</h3>
                              <button
                                className="text-button"
                                onClick={() =>
                                  openSource(
                                    e.paperKey,
                                    evidenceAnchors(e, paper)[0],
                                  )
                                }
                              >
                                查看来源
                              </button>
                            </div>
                            <div className="evidence-grid">
                              {(
                                [
                                  ["object", "研究对象"],
                                  ["method", "研究方法"],
                                  ["finding", "主要发现"],
                                  ["limitation", "局限性"],
                                  ["quote", "证据原句 · 请核对来源"],
                                ] as const
                              ).map(([field, label]) => (
                                <label
                                  key={field}
                                  className={field === "quote" ? "full" : ""}
                                >
                                  {label}
                                  <textarea
                                    aria-label={label}
                                    value={e[field]}
                                    maxLength={
                                      field === "quote"
                                        ? 10000
                                        : field === "finding"
                                          ? 5000
                                          : 3000
                                    }
                                    onChange={(ev) =>
                                      editEvidence(
                                        e.paperKey,
                                        field,
                                        ev.target.value,
                                      )
                                    }
                                  />
                                </label>
                              ))}
                            </div>
                            <div className="evidence-links">
                              {evidenceAnchors(e, paper).map((a) => (
                                <button
                                  key={a.id}
                                  onClick={() => openSource(e.paperKey, a)}
                                >
                                  {Object.entries(e.fields || {})
                                    .filter(([, id]) => id === a.id)
                                    .map(
                                      ([k]) =>
                                        ({
                                          object: "对象",
                                          method: "方法",
                                          finding: "发现",
                                          limitation: "局限",
                                        })[k],
                                    )
                                    .join("、") || "原文依据"}{" "}
                                  · {location(a)}
                                </button>
                              ))}
                              {!evidenceAnchors(e, paper).length && (
                                <small>
                                  原句位置待核实。可从摘要复制完整原句进行定位。
                                </small>
                              )}
                            </div>
                            <label>
                              人工备注
                              <textarea
                                value={p.notes[e.paperKey] || ""}
                                maxLength={10000}
                                onChange={(ev) =>
                                  update({
                                    notes: {
                                      ...p.notes,
                                      [e.paperKey]: ev.target.value,
                                    },
                                  })
                                }
                              />
                            </label>
                          </section>
                        );
                      })}
                  </div>
                )}
                {p.original && (
                  <button
                    className="load-more"
                    onClick={() => setShowOriginal(!showOriginal)}
                  >
                    {showOriginal ? "收起" : "查看"} AI
                    原始提取（保留未修改版本）
                  </button>
                )}
                {showOriginal && p.original && (
                  <pre className="original">
                    {JSON.stringify(p.original, null, 2)}
                  </pre>
                )}
              </>
            )}
            {view === "report" && (
              <>
                <PageTitle
                  eyebrow="RESEARCH BRIEF"
                  title="让研究有据可查。"
                  subtitle="这是一份可编辑的研究草稿。导出前，请逐条核对结论与来源。"
                />
                <div className="toolbar report-tools">
                  <span>
                    {p.original ? "AI 辅助草稿 · 待人工核实" : "人工研究草稿"}
                  </span>
                  <div>
                    <button
                      disabled={!p.sections.length}
                      onClick={() =>
                        void work("保存导出文件", () => storedExport(p, "md"))
                      }
                    >
                      <DownloadSimple size={16} /> Markdown
                    </button>
                    <button onClick={exportJson}>项目 JSON</button>
                    <button
                      onClick={() =>
                        download(
                          "研笺-本地备份.json",
                          JSON.stringify(p, null, 2),
                          "application/json",
                        )
                      }
                    >
                      本地备份
                    </button>
                    <button
                      disabled={!p.sections.length}
                      className="primary"
                      onClick={() => window.print()}
                    >
                      打印 / PDF
                    </button>
                  </div>
                </div>
                {stale && (
                  <div className="notice">
                    当前研究范围已变更，请重新生成或人工修订；导出会保留原分析检索式。
                  </div>
                )}
                {!p.sections.length ? (
                  <Empty
                    title="准备好写下你的发现了吗？"
                    text="生成 AI 简报，或先创建一份可编辑的人工模板。"
                    action={template}
                    label="创建人工模板"
                  />
                ) : (
                  <article className="report-sheet">
                    <div className="report-kicker">研笺 / RESEARCH NOTE</div>
                    <h2>
                      {p.analysisQuestion ||
                        p.question ||
                        p.query ||
                        "文献研究简报"}
                    </h2>
                    <div className="report-info">
                      检索范围：
                      {p.analysisQuery ||
                        p.searchedQuery ||
                        p.query ||
                        "未检索"}
                      <br />
                      依据：下列引用所标注的原文片段 ·{" "}
                      {p.mode === "snapshot" ? "预置快照" : "在线检索"}
                      <br />
                      生成时间：
                      {p.analysisAt
                        ? new Date(p.analysisAt).toLocaleString("zh-CN")
                        : "人工模板"}
                    </div>
                    {p.sections.map((s, i) => (
                      <BriefSection
                        key={p.id + i}
                        section={s}
                        index={i}
                        p={p}
                        open={openSource}
                        change={(next) =>
                          update({
                            sections: p.sections.map((prev, j) =>
                              i === j ? next : prev,
                            ),
                          })
                        }
                      />
                    ))}
                    <section className="report-references">
                      <h3>参考文献</h3>
                      {referenceKeys(p)
                        .map((key) => p.papers.find((x) => x.key === key)!)
                        .filter(Boolean)
                        .map((x, i) => (
                          <p key={x.key}>
                            [{i + 1}]{" "}
                            <a href={x.url} target="_blank" rel="noreferrer">
                              {x.title}
                            </a>{" "}
                            · {x.year}
                            <small>
                              {x.url} · 获取时间 {x.fetchedAt}
                            </small>
                          </p>
                        ))}
                    </section>
                    <p className="footnote">
                      各条证据标明开放全文或摘要来源。AI
                      提取与人工修订均不代表专业审核。
                    </p>
                  </article>
                )}
              </>
            )}
            {view === "history" && (
              <>
                <PageTitle
                  eyebrow="YOUR RESEARCH LIBRARY"
                  title="每一次探索，都有记录。"
                  subtitle="研究记录保存在服务端。换设备登录同一账号可继续研究，也可导出 JSON 备份。"
                />
                <div className="toolbar">
                  <span>{history.length} 个研究项目</span>
                  <div>
                    <button onClick={() => importRef.current?.click()}>
                      <UploadSimple size={17} /> 导入 JSON
                    </button>
                    <button
                      className="primary"
                      onClick={() => void work("新建研究", newProject)}
                    >
                      <Plus size={17} /> 新建研究
                    </button>
                  </div>
                </div>
                <input
                  hidden
                  type="file"
                  accept=".json,application/json"
                  ref={importRef}
                  onChange={(e) => {
                    void importFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {!history.length ? (
                  <Empty
                    title="第一份研究，从这里开始"
                    text="输入一个问题，建立你的文献记录。"
                    action={() => setView("home")}
                    label="开始研究"
                  />
                ) : (
                  <div className="history-list">
                    {history.map((item) => (
                      <article key={item.id}>
                        <span className="history-icon">
                          <FileText size={25} />
                        </span>
                        <div>
                          <button
                            className="paper-title"
                            onClick={() =>
                              void work("打开研究", async () => {
                                if (p.question || p.papers.length)
                                  await saveProject(p);
                                setP(item);
                                setView("papers");
                                setNotice("");
                              })
                            }
                          >
                            {item.question || item.query}
                          </button>
                          <p>
                            {item.selected.length} 篇纳入 ·{" "}
                            {item.sections.length ? "已有简报" : "整理中"} ·{" "}
                            {new Date(item.updatedAt).toLocaleString("zh-CN")}
                          </p>
                        </div>
                        <button
                          aria-label={`删除研究 ${item.question || item.query}`}
                          className="icon-button"
                          onClick={() => {
                            if (
                              window.confirm(
                                "删除这份账号研究记录和关联的导出文件？此操作无法撤销，请先备份。",
                              )
                            )
                              void work("删除记录", async () => {
                                await deleteProject(item.id);
                                if (p.id === item.id) setP(emptyProject());
                                setHistory(await listProjects());
                                setFiles(
                                  await api<typeof files>("/api/exports"),
                                );
                              });
                          }}
                        >
                          <Trash size={20} />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
            {view === "history" && files.length > 0 && (
              <section className="stored-files">
                <h2>已保存的导出文件</h2>
                <p className="muted">
                  独立文件快照，修改研究记录不会改变已导出的内容。
                </p>
                {files.map((file) => (
                  <a key={file.id} href={`/api/exports/${file.id}`} download>
                    <DownloadSimple size={17} />
                    <span>{file.filename}</span>
                    <small>
                      {new Date(file.created_at).toLocaleString("zh-CN")}
                    </small>
                  </a>
                ))}
              </section>
            )}
          </fieldset>
        </main>
        <footer>
          研笺 · 文献研究助手 <span>从问题出发，让证据说话。</span>
        </footer>
      </div>
      {currentPaper && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <section
            className="detail-panel"
            role="dialog"
            aria-modal="true"
            aria-label="文献摘要详情"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDetail(null);
            }}
          >
            <button
              autoFocus
              className="close"
              aria-label="关闭文献详情"
              onClick={() => setDetail(null)}
            >
              ×
            </button>
            <span className="eyebrow">ABSTRACT & NOTES</span>
            <h2>{currentPaper.titleZh || currentPaper.title}</h2>
            {currentPaper.titleZh && (
              <p className="translation-original">
                AI 译题 · 原题 {currentPaper.title}
              </p>
            )}
            <p className="muted">
              {currentPaper.authors} · {currentPaper.year}
            </p>
            <a href={currentPaper.url} target="_blank" rel="noreferrer">
              在 Europe PMC 查看 <ArrowSquareOut size={15} />
            </a>
            {(!currentPaper.titleZh ||
              (currentPaper.abstract && !currentPaper.abstractZh)) && (
              <div className="language-tools">
                <button
                  disabled={!!busy}
                  onClick={() => {
                    const items: TranslationItem[] = [];
                    if (!currentPaper.titleZh && currentPaper.title.trim())
                      items.push({
                        key: currentPaper.key,
                        field: "title",
                        text: currentPaper.title,
                      });
                    if (
                      currentPaper.abstract.trim() &&
                      !currentPaper.abstractZh
                    )
                      items.push({
                        key: currentPaper.key,
                        field: "abstract",
                        text: currentPaper.abstract,
                      });
                    translateItems(items);
                  }}
                >
                  {busy === "正在翻译为简体中文"
                    ? "翻译中…"
                    : configured
                      ? currentPaper.abstract
                        ? "翻译为简体中文"
                        : "翻译标题"
                      : "前往个人设置配置翻译"}
                </button>
                <small>使用个人 AI 额度</small>
              </div>
            )}
            {notice && <p role="status">{notice}</p>}
            {currentPaper.abstractZh && (
              <section className="translated-abstract">
                <h3>
                  中文摘要 <small>AI 译文</small>
                </h3>
                <p>{currentPaper.abstractZh}</p>
              </section>
            )}
            {focusAnchor?.kind === "full" && currentPaper.pmcid && (
              <p>
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={"https://europepmc.org/articles/" + currentPaper.pmcid}
                >
                  打开开放全文 <ArrowSquareOut size={15} />
                </a>
              </p>
            )}
            {citedPassages.length > 1 && (
              <div className="evidence-links">
                {citedPassages.map((a) => (
                  <button key={a.id} onClick={() => setFocusAnchor(a)}>
                    {location(a)}
                  </button>
                ))}
              </div>
            )}
            {focusAnchor?.paperKey === currentPaper.key && (
              <Passage a={focusAnchor} />
            )}
            <h3>摘要原文</h3>
            <p className="full-abstract">
              {currentPaper.abstract || "当前来源未提供摘要。"}
            </p>
            <p className="footnote">
              题录与摘要获取时间：
              {new Date(currentPaper.fetchedAt).toLocaleString("zh-CN")}
            </p>
            <label>
              人工阅读备注
              <textarea
                disabled={!!busy}
                value={p.notes[currentPaper.key] || ""}
                maxLength={10000}
                onChange={(e) =>
                  update({
                    notes: { ...p.notes, [currentPaper.key]: e.target.value },
                  })
                }
                placeholder="记录纳入理由、疑点或需要查阅全文的位置…"
              />
            </label>
            <button className="primary" onClick={() => setDetail(null)}>
              <Check size={17} /> 完成
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function PageTitle({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="page-title">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}
function Empty({
  title,
  text,
  action,
  label,
}: {
  title: string;
  text: string;
  action: () => void;
  label: string;
}) {
  return (
    <section className="empty">
      <BookOpenText size={42} weight="light" />
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="primary" onClick={action}>
        {label}
        <ArrowRight size={17} />
      </button>
    </section>
  );
}

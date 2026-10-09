import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type CSSProperties,
} from "react";
import {
  Database,
  Play,
  BookOpen,
  Sun,
  Moon,
  Monitor,
  Download,
  Upload,
  RotateCcw,
  ChevronDown,
  Check,
  CircleAlert,
  History,
  Terminal,
  PanelLeft,
  ArrowUpRight,
  Trash2,
  FileCode2,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { DatabaseClient, packBackup, unpackBackup } from "./db/client";
import { toSqlError } from "./db/utils";
import {
  loadData,
  saveData,
  newDatabaseId,
  readTheme,
  saveTheme,
  type Theme,
} from "./storage/store";
import type {
  AppData,
  Catalog,
  DbObject,
  Execution,
  HistoryItem,
  TransactionStatus,
} from "./types";
import { SqlEditor } from "./components/SqlEditor";
import { ObjectTree } from "./components/ObjectTree";
import { ObjectDetail } from "./components/ObjectDetail";
import { ResultGrid } from "./components/ResultGrid";
import { Modal } from "./components/Modal";
import { lessons } from "./examples/sql";

const emptyCatalog: Catalog = { schemas: [], objects: [], columns: [] };
const txnLabels = { I: "就绪", T: "事务中", E: "事务失败 · 需回滚" };
const themeOptions = [
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
  { value: "system", label: "跟随系统", Icon: Monitor },
] as const;
type Panel = "results" | "messages" | "detail" | "history";
type Dialog = "lessons" | "backup" | "reset" | "restart" | "help" | null;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const [data, setData] = useState<AppData>();
  const [theme, setTheme] = useState<Theme>("system");
  const [systemDark, setSystemDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const dark = theme === "dark" || (theme === "system" && systemDark);
  const [phase, setPhase] = useState("正在启动你的数据库…");
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState("");
  const [version, setVersion] = useState("");
  const [client, setClient] = useState<DatabaseClient>();
  const db = useRef<DatabaseClient | undefined>(undefined);
  const generation = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [engineFailed, setEngineFailed] = useState(false);
  const [transaction, setTransaction] = useState<TransactionStatus>("I");
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [system, setSystem] = useState(false);
  const [stale, setStale] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<DbObject>();
  const [selection, setSelection] = useState({ text: "", from: 0 });
  const [execution, setExecution] = useState<Execution>();
  const [executed, setExecuted] = useState<{
    sql: string;
    draft: string;
    from: number;
    duration: number;
  }>();
  const [resultIndex, setResultIndex] = useState(0);
  const [panel, setPanel] = useState<Panel>("results");
  const [focusPosition, setFocusPosition] = useState<{
    offset: number;
    token: number;
  }>();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [themeMenu, setThemeMenu] = useState(false);
  const [mobileTree, setMobileTree] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [notice, setNotice] = useState("");
  const [saveState, setSaveState] = useState("本地已保存");
  const [storeError, setStoreError] = useState("");
  const [persistent, setPersistent] = useState(false);
  const sqlInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const disabled = !ready || busy || engineFailed;
  const idleDisabled = disabled || transaction !== "I";

  useEffect(() => {
    let disposed = false;
    let unlock: (() => void) | undefined;
    readTheme()
      .then((value) => {
        if (!disposed) setTheme(value);
      })
      .catch(() => {});
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    media.addEventListener("change", changed);
    async function boot() {
      if (!navigator.locks)
        throw new Error(
          "当前浏览器不支持 Web Locks，请用新版 Chrome 或 Safari 打开本地地址。",
        );
      await navigator.locks.request(
        "pg-playground-workspace-v1",
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error(
              "另一个页面正在使用练习库。关闭那个页面后，再刷新这里。",
            );
          const held = new Promise<void>((resolve) => {
            unlock = resolve;
          });
          try {
            const stored = await loadData();
            if (disposed) return;
            setData(stored);
            const next = new DatabaseClient();
            db.current = next;
            const init = await next.request<{ version: string }>("init", {
              databaseId: stored.databaseId,
            });
            const catalog = await next.request<Catalog>("catalog");
            if (disposed) {
              next.terminate();
              return;
            }
            setClient(next);
            setVersion(init.version);
            setCatalog(catalog);
            setReady(true);
            navigator.storage
              ?.persisted()
              .then(setPersistent)
              .catch(() => {});
            await held;
          } catch (e) {
            db.current?.terminate();
            if (!disposed) setBootError(toSqlError(e).message);
          }
        },
      );
    }
    boot().catch((e) => {
      if (!disposed) setBootError(toSqlError(e).message);
    });
    return () => {
      disposed = true;
      unlock?.();
      db.current?.terminate();
      media.removeEventListener("change", changed);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    if (!data) return;
    setSaveState("保存中…");
    const timer = setTimeout(() => {
      saveData(data)
        .then(() => {
          setSaveState("本地已保存");
          setStoreError("");
        })
        .catch((e) => {
          setSaveState("保存失败");
          setStoreError(
            `浏览器存储失败：${toSqlError(e).message}。请导出 SQL 和数据库备份。`,
          );
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [data]);
  useEffect(() => {
    const flush = () => {
      if (dataRef.current) void saveData(dataRef.current).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(timer);
  }, [busy, startedAt]);

  const refresh = useCallback(
    async (showSystem = system, target = db.current) => {
      if (!target) return;
      const gen = generation.current;
      try {
        const next = await target.request<Catalog>("catalog", {
          system: showSystem,
        });
        if (gen !== generation.current) return;
        setCatalog(next);
        setStale("");
        setRevision((r) => r + 1);
        setSelected((prev) =>
          prev
            ? next.objects.find(
                (o) =>
                  o.oid === prev.oid &&
                  o.kind === prev.kind &&
                  o.schema === prev.schema &&
                  o.name === prev.name,
              )
            : undefined,
        );
      } catch (e) {
        if (gen === generation.current)
          setStale(`结构未更新：${toSqlError(e).message}`);
      }
    },
    [system],
  );

  async function run(sql: string, from = 0, selected = false) {
    if (!db.current || !ready || busyRef.current || engineFailed || !sql.trim())
      return;
    busyRef.current = true;
    setBusy(true);
    setStartedAt(Date.now());
    setElapsed(0);
    setPanel("results");
    const started = performance.now(),
      gen = generation.current,
      draft = dataRef.current?.draft || "";
    try {
      const result = await db.current.request<Execution>("execute", { sql });
      if (gen !== generation.current) return;
      const duration = performance.now() - started;
      setExecution(result);
      setExecuted({ sql, draft, from, duration });
      setResultIndex(Math.max(0, result.results.length - 1));
      setTransaction(result.transaction);
      if (result.error) setPanel("messages");
      const history: HistoryItem = {
        id: crypto.randomUUID(),
        sql,
        scope: selected ? "选区" : "全部",
        time: new Date().toISOString(),
        duration,
        success: !result.error,
        summary:
          result.error?.message ||
          result.results.map((r) => r.command).join(" · ") ||
          "空查询",
        error: result.error,
      };
      setData((d) =>
        d ? { ...d, history: [history, ...d.history].slice(0, 200) } : d,
      );
      if (result.transaction === "I") await refresh();
      else setStale("事务未结束，提交或回滚后刷新结构。");
    } catch (e) {
      if (gen === generation.current) {
        setNotice(toSqlError(e).message);
        setEngineFailed(true);
      }
    } finally {
      if (gen === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function task(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setStartedAt(Date.now());
    setElapsed(0);
    try {
      await fn();
    } catch (e) {
      setNotice(toSqlError(e).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function putDraft(sql: string) {
    setData((d) => (d ? { ...d, draft: sql } : d));
    setSelection({ text: "", from: 0 });
  }
  async function loadExample(reset = false) {
    if (idleDisabled) return;
    await task(async () => {
      await db.current!.request("seed", { reset });
      await refresh();
      setNotice(
        reset
          ? "练习数据已重置"
          : "练习数据已载入：4 张表、1 个枚举与 1 个视图",
      );
      putDraft(lessons[1].sql);
      setDialog(null);
    });
  }
  async function backup() {
    if (idleDisabled) return;
    await task(async () => {
      const archive = await db.current!.request<Blob>("backup");
      download(
        packBackup(archive, version),
        `pg-playground-${new Date().toISOString().slice(0, 10)}.pgplay`,
      );
      setNotice("数据库快照已导出");
      setDialog(null);
    });
  }
  async function switchDatabase(archive?: Blob) {
    const old = db.current!,
      oldData = dataRef.current!;
    const next = new DatabaseClient(),
      databaseId = newDatabaseId();
    try {
      const init = await next.request<{ version: string }>("init", {
        databaseId,
        archive,
      });
      const nextCatalog = await next.request<Catalog>("catalog", { system });
      const updated = {
        ...dataRef.current!,
        databaseId,
        retired: [...oldData.retired, oldData.databaseId],
      };
      await saveData(updated);
      generation.current++;
      db.current = next;
      setClient(next);
      setVersion(init.version);
      setData(updated);
      setCatalog(nextCatalog);
      setSelected(undefined);
      setExecution(undefined);
      setTransaction("I");
      setStale("");
      setPanel("results");
      setRevision((r) => r + 1);
      await old.request("close").catch(() => {});
      old.terminate();
      setDialog(null);
      setNotice(
        archive
          ? "备份已验证并恢复；原数据库仍保留在浏览器中。"
          : "已切换到新的空库；SQL 草稿和历史已保留。",
      );
    } catch (e) {
      next.terminate();
      throw e;
    }
  }
  async function restart() {
    generation.current++;
    db.current?.terminate();
    busyRef.current = true;
    setBusy(true);
    setReady(false);
    setBootError("");
    setDialog(null);
    setPhase("正在重新打开数据库…");
    const next = new DatabaseClient();
    db.current = next;
    try {
      const init = await next.request<{ version: string }>("init", {
        databaseId: dataRef.current!.databaseId,
      });
      setClient(next);
      setVersion(init.version);
      setTransaction("I");
      setEngineFailed(false);
      setExecution(undefined);
      setExecuted(undefined);
      setSelected(undefined);
      setReady(true);
      await refresh(system, next);
      setNotice("引擎已重启。中断操作的结果可能未知，请查询实际数据确认。");
    } catch (e) {
      setBootError(toSqlError(e).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function resize(
    event: PointerEvent<HTMLDivElement>,
    direction: "sidebar" | "editor",
  ) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const target = event.currentTarget;
    const move = (e: globalThis.PointerEvent) => {
      const rect = workspace.current!.getBoundingClientRect();
      if (direction === "sidebar")
        setData((d) =>
          d
            ? {
                ...d,
                sidebar: Math.max(200, Math.min(420, e.clientX - rect.left)),
              }
            : d,
        );
      else
        setData((d) =>
          d
            ? {
                ...d,
                editorHeight: Math.max(
                  22,
                  Math.min(75, ((e.clientY - rect.top) / rect.height) * 100),
                ),
              }
            : d,
        );
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }
  function locateError() {
    if (!executed || !execution?.error?.position) return;
    if (data?.draft !== executed.draft) {
      setNotice("编辑器内容已修改，请从历史恢复原 SQL 后重新运行以定位。");
      return;
    }
    const offset = Array.from(executed.sql)
      .slice(0, Number(execution.error.position) - 1)
      .join("").length;
    setFocusPosition({ offset: executed.from + offset, token: Date.now() });
  }
  const history =
    data?.history.filter((h) =>
      `${h.sql} ${h.summary}`
        .toLowerCase()
        .includes(historySearch.toLowerCase()),
    ) || [];
  const currentTheme = themeOptions.find((t) => t.value === theme)!;
  const ThemeIcon = currentTheme.Icon;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Database size={21} />
          </div>
          <div>
            <h1>
              PG <span>Playground</span>
            </h1>
            <p>你的 PostgreSQL 实验室</p>
          </div>
        </div>
        <div className="workspace-label">
          <span className="status-dot" />
          本地练习库<span className="local-tag">LOCAL</span>
        </div>
        <nav className="top-actions">
          <button aria-label="练习手册" onClick={() => setDialog("lessons")}>
            <BookOpen size={15} />
            <span>练习手册</span>
          </button>
          <button
            aria-label="数据管理"
            disabled={!ready}
            onClick={() => setDialog("backup")}
          >
            <Download size={15} />
            <span>数据管理</span>
          </button>
          <div className="theme-picker">
            <button
              aria-label={`颜色主题：${currentTheme.label}`}
              aria-expanded={themeMenu}
              onClick={() => setThemeMenu(!themeMenu)}
            >
              <ThemeIcon size={16} />
              <ChevronDown size={12} />
            </button>
            {themeMenu && (
              <>
                <button
                  className="menu-dismiss"
                  aria-label="关闭主题菜单"
                  onClick={() => setThemeMenu(false)}
                />
                <div className="theme-menu">
                  {themeOptions.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      onClick={() => {
                        setTheme(value);
                        setThemeMenu(false);
                        saveTheme(value).catch(() =>
                          setNotice("主题已切换，但偏好保存失败"),
                        );
                      }}
                    >
                      <Icon size={15} />
                      {label}
                      {theme === value && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </nav>
      </header>
      <div className="contextbar">
        <span>
          <Terminal size={13} /> WORKSPACE <span className="slash">/</span>{" "}
          <strong>自由练习</strong>
        </span>
        <button className="text-button" onClick={() => setDialog("help")}>
          使用说明 <ArrowUpRight size={12} />
        </button>
      </div>
      {!ready ? (
        <main className="boot-screen">
          {bootError ? (
            <>
              <CircleAlert size={32} />
              <h2>数据库暂时不可用</h2>
              <p>{bootError}</p>
              <button onClick={() => location.reload()}>重新加载</button>
            </>
          ) : (
            <>
              <LoaderCircle className="spin" size={30} />
              <h2>{phase}</h2>
              <p>首次启动会加载 PostgreSQL 引擎，之后数据保存在当前浏览器。</p>
            </>
          )}
        </main>
      ) : (
        <>
          {storeError && (
            <div className="global-warning" role="alert">
              {storeError}
            </div>
          )}
          <main
            className={`workspace ${mobileTree ? "show-tree" : ""}`}
            ref={workspace}
            style={
              {
                "--sidebar-width": `${data?.sidebar || 256}px`,
                "--editor-height": `${data?.editorHeight || 43}%`,
              } as CSSProperties
            }
          >
            <ObjectTree
              catalog={catalog}
              selected={selected}
              onSelect={(o) => {
                setSelected(o);
                setPanel("detail");
                setMobileTree(false);
              }}
              onRefresh={() => void refresh()}
              system={system}
              onSystem={(v) => {
                setSystem(v);
                void refresh(v);
              }}
              disabled={idleDisabled}
              stale={stale}
            />
            <div
              className="divider vertical"
              role="separator"
              aria-label="调整对象栏宽度"
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={(e) => resize(e, "sidebar")}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight")
                  setData((d) =>
                    d
                      ? {
                          ...d,
                          sidebar: Math.max(
                            200,
                            Math.min(
                              420,
                              d.sidebar + (e.key === "ArrowRight" ? 10 : -10),
                            ),
                          ),
                        }
                      : d,
                  );
              }}
            />
            <div className="main-workbench">
              <section className="editor-section">
                <div className="editor-toolbar">
                  <div className="editor-title">
                    <button
                      className="icon-button mobile-toggle"
                      aria-label="显示数据库对象"
                      onClick={() => setMobileTree(!mobileTree)}
                    >
                      <PanelLeft size={16} />
                    </button>
                    <FileCode2 size={15} />
                    <span>playground.sql</span>
                    <span className="draft-dot" title="自动保存草稿" />
                  </div>
                  <div className="editor-actions">
                    <button
                      className="icon-button"
                      aria-label="导入 SQL 文件"
                      title="导入 SQL 文件"
                      onClick={() => sqlInput.current?.click()}
                    >
                      <Upload size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="导出 SQL 文件"
                      title="导出 SQL 文件"
                      onClick={() =>
                        download(
                          new Blob([data?.draft || ""], {
                            type: "text/plain;charset=utf-8",
                          }),
                          "playground.sql",
                        )
                      }
                    >
                      <Download size={14} />
                    </button>
                    <span className="toolbar-separator" />
                    <button
                      className="primary run-button"
                      aria-label="运行"
                      title={
                        selection.text
                          ? "运行选中的 SQL（⌘ / Ctrl + Enter）"
                          : "运行全部 SQL（⌘ / Ctrl + Enter）"
                      }
                      disabled={
                        disabled ||
                        !(selection.text || data?.draft || "").trim()
                      }
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() =>
                        void run(
                          selection.text || data?.draft || "",
                          selection.text ? selection.from : 0,
                          !!selection.text,
                        )
                      }
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Play size={13} fill="currentColor" />
                      )}
                      <span>运行</span>
                      <kbd>⌘ ↵</kbd>
                    </button>
                  </div>
                </div>
                <SqlEditor
                  value={data?.draft || ""}
                  dark={dark}
                  catalog={catalog}
                  focusPosition={focusPosition}
                  onChange={(value) =>
                    setData((d) => (d ? { ...d, draft: value } : d))
                  }
                  onSelection={setSelection}
                  onRun={(text, from, selected) =>
                    void run(text, from, selected)
                  }
                />
                <div className="editor-status">
                  <span>
                    PostgreSQL <span className="muted">·</span> UTF-8
                  </span>
                  <span>
                    {selection.text
                      ? `已选择 ${selection.text.length} 个字符 · 快捷键执行选区`
                      : "⌘ / Ctrl + Enter 运行"}
                    <span className="status-divider">|</span>
                    {saveState}
                  </span>
                </div>
              </section>
              <div
                className="divider horizontal"
                role="separator"
                aria-label="调整编辑器高度"
                aria-orientation="horizontal"
                tabIndex={0}
                onPointerDown={(e) => resize(e, "editor")}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown")
                    setData((d) =>
                      d
                        ? {
                            ...d,
                            editorHeight: Math.max(
                              22,
                              Math.min(
                                75,
                                d.editorHeight +
                                  (e.key === "ArrowDown" ? 3 : -3),
                              ),
                            ),
                          }
                        : d,
                    );
                }}
              />
              <section className="output-section">
                <div className="output-tabs">
                  <div>
                    {(
                      [
                        { key: "results", label: "查询结果", Icon: TableIcon },
                        { key: "messages", label: "消息", Icon: Terminal },
                        { key: "detail", label: "对象详情", Icon: Database },
                        { key: "history", label: "历史记录", Icon: History },
                      ] as const
                    ).map(({ key, label, Icon }) => (
                      <button
                        className={panel === key ? "active" : ""}
                        key={key}
                        onClick={() => setPanel(key)}
                      >
                        <Icon size={14} />
                        {label}
                        {key === "results" && execution && (
                          <small>{execution.results.length}</small>
                        )}
                        {key === "messages" && execution?.error && (
                          <span className="error-dot" />
                        )}
                      </button>
                    ))}
                  </div>
                  <span className="execution-meta">
                    {busy
                      ? `${(elapsed / 1000).toFixed(1)}s`
                      : executed
                        ? `总耗时 ${executed.duration.toFixed(0)} ms`
                        : "等待执行"}
                  </span>
                </div>
                {((busy && elapsed > 5000) || engineFailed) && (
                  <div className="global-warning">
                    <span>
                      {engineFailed
                        ? "引擎状态异常。"
                        : "查询仍在执行，关闭此提示不会停止 SQL。"}{" "}
                      强制重启后需要核对数据。
                    </span>
                    <button onClick={() => setDialog("restart")}>
                      强制重启引擎
                    </button>
                  </div>
                )}
                {transaction !== "I" && (
                  <div
                    className={`transaction-banner ${transaction === "E" ? "failed" : ""}`}
                  >
                    <span>
                      {transaction === "E"
                        ? "当前事务已失败，请 ROLLBACK 后继续。"
                        : "当前事务尚未提交，结构浏览已暂停。"}
                    </span>
                    <div>
                      {transaction === "T" && (
                        <button
                          disabled={disabled}
                          onClick={() => void run("COMMIT;")}
                        >
                          COMMIT
                        </button>
                      )}
                      <button
                        disabled={disabled}
                        onClick={() => void run("ROLLBACK;")}
                      >
                        ROLLBACK
                      </button>
                    </div>
                  </div>
                )}
                {panel === "results" ? (
                  execution ? (
                    <>
                      {execution.error && (
                        <div className="global-warning">
                          脚本执行失败；下列是已返回的语句结果，不代表修改已提交。
                          <button onClick={() => setPanel("messages")}>
                            查看错误
                          </button>
                        </div>
                      )}
                      {execution.results.length > 0 ? (
                        <>
                          <div className="result-tabs">
                            {execution.results.map((r, i) => (
                              <button
                                key={i}
                                className={i === resultIndex ? "active" : ""}
                                onClick={() => setResultIndex(i)}
                              >
                                结果 {i + 1}
                                <span>{r.command}</span>
                              </button>
                            ))}
                          </div>
                          <ResultGrid
                            key={`${executed?.duration}:${resultIndex}`}
                            result={
                              execution.results[resultIndex] ||
                              execution.results[0]
                            }
                          />
                        </>
                      ) : (
                        <div className="empty-small">
                          没有返回结果。
                          {execution.error
                            ? "请查看错误消息。"
                            : "可以继续输入 SQL。"}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="welcome">
                      <div className="welcome-symbol">
                        <Terminal size={25} />
                      </div>
                      <span className="eyebrow">
                        A LITTLE ROOM FOR BIG QUERIES
                      </span>
                      <h2>把想法，写成 SQL。</h2>
                      <p>
                        点击右上方「运行」，执行你的第一条查询。
                        <br />
                        建表、联结、枚举与事务，都可以在这里试一试。
                      </p>
                      <div>
                        <button
                          aria-label="练习手册"
                          onClick={() => setDialog("lessons")}
                        >
                          <BookOpen size={14} />
                          探索练习手册
                        </button>
                      </div>
                      <span className="welcome-footnote">
                        <span className="status-dot" /> 在浏览器里运行 ·
                        无需安装数据库
                      </span>
                    </div>
                  )
                ) : panel === "messages" ? (
                  <div className="messages-panel">
                    {execution?.error ? (
                      <div className="error-card">
                        <div>
                          <CircleAlert size={17} />
                          <strong>{execution.error.code || "SQL ERROR"}</strong>
                          {execution.error.position && (
                            <button onClick={locateError}>定位错误 ↗</button>
                          )}
                        </div>
                        <pre>{execution.error.message}</pre>
                        {execution.error.detail && (
                          <p>DETAIL · {execution.error.detail}</p>
                        )}
                        {execution.error.hint && (
                          <p>HINT · {execution.error.hint}</p>
                        )}
                        <p>
                          错误前返回的结果不保证已提交，事务状态以底部指示为准。
                        </p>
                      </div>
                    ) : (
                      <p className="success-line">
                        <Check size={16} />
                        {execution
                          ? "执行完成，没有 SQL 错误。"
                          : "还没有执行记录。"}
                      </p>
                    )}
                    {execution?.notices.map((n, i) => (
                      <pre className="notice-message" key={i}>
                        {n}
                      </pre>
                    ))}
                    {execution?.results.map((r, i) => (
                      <p className="command-line" key={i}>
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        <code>{r.command}</code>
                        <small>
                          {r.fields.length ? `${r.rowCount} 行` : "无结果表"}
                        </small>
                      </p>
                    ))}
                  </div>
                ) : panel === "detail" ? (
                  selected && client ? (
                    <ObjectDetail
                      key={`${data?.databaseId}:${selected.kind}:${selected.oid}`}
                      object={selected}
                      client={client}
                      revision={revision}
                      disabled={idleDisabled}
                      onQuery={putDraft}
                    />
                  ) : (
                    <div className="empty-state">
                      <Database size={28} />
                      <h3>从左侧选择一个对象</h3>
                      <p>查看字段、枚举值、约束和真实数据。</p>
                    </div>
                  )
                ) : (
                  <div className="history-panel">
                    <div className="history-toolbar">
                      <label className="search-box">
                        <Search size={14} />
                        <input
                          aria-label="搜索 SQL 历史"
                          placeholder="搜索 SQL 或执行结果…"
                          value={historySearch}
                          onChange={(e) => setHistorySearch(e.target.value)}
                        />
                      </label>
                      <button
                        disabled={!data?.history.length}
                        onClick={() => {
                          if (
                            confirm(
                              "清空最近的执行历史？SQL 草稿和数据库不受影响。",
                            )
                          )
                            setData((d) => (d ? { ...d, history: [] } : d));
                        }}
                      >
                        <Trash2 size={13} />
                        清空
                      </button>
                    </div>
                    <div className="history-list">
                      {history.length ? (
                        history.map((h) => (
                          <button
                            className="history-item"
                            key={h.id}
                            onClick={() => {
                              putDraft(h.sql);
                              setNotice("SQL 已恢复到编辑器，尚未执行");
                            }}
                          >
                            <div>
                              <span
                                className={
                                  h.success ? "success-line" : "error-text"
                                }
                              >
                                {h.success ? (
                                  <Check size={13} />
                                ) : (
                                  <CircleAlert size={13} />
                                )}{" "}
                                {h.success ? "成功" : "失败"}
                              </span>
                              <time>
                                {new Date(h.time).toLocaleString("zh-CN")}
                              </time>
                              <span>
                                {h.scope} · {h.duration.toFixed(0)} ms
                              </span>
                              <ArrowUpRight size={14} />
                            </div>
                            <pre>{h.sql}</pre>
                            <p>{h.summary}</p>
                          </button>
                        ))
                      ) : (
                        <div className="empty-small">
                          暂无匹配记录。执行后会自动保存最近 200 次 SQL。
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </main>
        </>
      )}
      <footer className="statusbar">
        <span>
          <span
            className={`status-dot ${transaction === "E" || engineFailed ? "error" : ""}`}
          />
          {!ready
            ? "初始化"
            : busy
              ? "执行中"
              : engineFailed
                ? "引擎异常"
                : txnLabels[transaction]}
          <span className="status-divider">|</span>
          <span title={version}>
            {version.match(/PostgreSQL [\d.]+/)?.[0] || "PostgreSQL"} · PGlite
          </span>
        </span>
        <span>
          <span className="desktop-only">
            数据仅在当前浏览器<span className="status-divider">|</span>
          </span>
          <button className="text-button" onClick={() => setDialog("help")}>
            {persistent ? "持久存储已授权" : "本地存储"}
          </button>
        </span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <CircleAlert size={16} />
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <input
        type="file"
        ref={sqlInput}
        accept=".sql,text/plain"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > 5_000_000) {
            setNotice("SQL 文件请控制在 5 MB 以内");
            return;
          }
          try {
            const text = await file.text();
            if (
              data?.draft.trim() &&
              !confirm("用导入文件替换当前草稿？不会自动执行 SQL。")
            )
              return;
            putDraft(text);
            setNotice("SQL 已导入，尚未执行");
          } catch (err) {
            setNotice(toSqlError(err).message);
          }
        }}
      />
      <input
        type="file"
        ref={backupInput}
        accept=".pgplay"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || idleDisabled) return;
          await task(async () => {
            const archive = await unpackBackup(file, version);
            await switchDatabase(archive);
          });
        }}
      />
      {dialog === "lessons" && (
        <Modal wide title="练习手册" onClose={() => setDialog(null)}>
          <div className="lesson-intro">
            <span className="eyebrow">LEARN BY QUERYING</span>
            <h3>从一张表，到一个好问题。</h3>
            <p>
              24 位客户、120 笔订单，以及枚举、JSONB 与关联关系。
              <br />
              先载入数据，再选一条 SQL，改一改、运行看看。
            </p>
            <button
              className="primary"
              disabled={idleDisabled || catalog.schemas.includes("practice")}
              onClick={() => void loadExample()}
            >
              <Database size={14} />
              {catalog.schemas.includes("practice")
                ? "practice 已存在"
                : "载入练习数据"}
            </button>
            {catalog.schemas.includes("practice") && (
              <button
                className="text-button"
                disabled={idleDisabled}
                onClick={() => {
                  if (
                    confirm(
                      "删除并重建整个 practice schema？其中的自定义内容也会被删除。",
                    )
                  )
                    void loadExample(true);
                }}
              >
                重置示例
              </button>
            )}
          </div>
          <div className="lesson-grid">
            {lessons.map((lesson) => (
              <button
                key={lesson.title}
                className="lesson-card"
                onClick={() => {
                  putDraft(lesson.sql);
                  setDialog(null);
                  setNotice(
                    catalog.schemas.includes("practice")
                      ? "练习 SQL 已放入编辑器"
                      : "请先在练习手册中载入数据，再运行练习 SQL",
                  );
                }}
              >
                <span>{lesson.level}</span>
                <h4>
                  {lesson.title}
                  <ArrowUpRight size={16} />
                </h4>
                <p>{lesson.description}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {dialog === "backup" && (
        <Modal title="数据管理" onClose={() => setDialog(null)}>
          <p className="muted">
            备份包含数据库对象与数据。SQL 草稿可通过编辑器的导出按钮单独保存。
          </p>
          {transaction !== "I" && (
            <p className="error-text">请先提交或回滚当前事务。</p>
          )}
          <button
            className="action-card"
            disabled={idleDisabled}
            onClick={() => void backup()}
          >
            <Download size={20} />
            <span>
              <strong>导出数据库快照</strong>
              <small>下载 .pgplay 文件，供相同版本恢复</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
          <button
            className="action-card"
            disabled={idleDisabled}
            onClick={() => backupInput.current?.click()}
          >
            <Upload size={20} />
            <span>
              <strong>从快照恢复</strong>
              <small>先在新库验证，成功后切换，原库仍保留</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
          <button
            className="action-card danger"
            disabled={idleDisabled}
            onClick={() => setDialog("reset")}
          >
            <RotateCcw size={20} />
            <span>
              <strong>重置整个练习库</strong>
              <small>切换为空库，保留 SQL 草稿和历史</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
          {!!data?.retired.length && (
            <div className="retired">
              <p>
                保留了 {data.retired.length} 个旧数据库，可重新打开核对数据。
              </p>
              {data.retired.map((id, i) => (
                <button
                  key={id}
                  disabled={idleDisabled}
                  onClick={() =>
                    void task(async () => {
                      const old = db.current!,
                        next = new DatabaseClient();
                      try {
                        const info = await next.request<{ version: string }>(
                          "init",
                          { databaseId: id },
                        );
                        const cat = await next.request<Catalog>("catalog", {
                          system,
                        });
                        const updated = {
                          ...dataRef.current!,
                          databaseId: id,
                          retired: [
                            ...dataRef.current!.retired.filter((x) => x !== id),
                            dataRef.current!.databaseId,
                          ],
                        };
                        await saveData(updated);
                        generation.current++;
                        db.current = next;
                        setClient(next);
                        setVersion(info.version);
                        setData(updated);
                        setCatalog(cat);
                        setSelected(undefined);
                        setExecution(undefined);
                        setStale("");
                        setTransaction("I");
                        await old.request("close").catch(() => {});
                        old.terminate();
                        setDialog(null);
                        setNotice("已重新打开保留的数据库");
                      } catch (e) {
                        next.terminate();
                        throw e;
                      }
                    })
                  }
                >
                  打开保留库 {i + 1}
                  <small>{id.slice(-8)}</small>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
      {dialog === "reset" && (
        <Modal title="重置整个练习库？" onClose={() => setDialog(null)}>
          <p>
            将切换到一个新的空数据库。当前库会保留，可在数据管理中重新打开；SQL
            草稿和历史不会清空。
          </p>
          <div className="dialog-actions">
            <button onClick={() => setDialog("backup")}>返回</button>
            <button
              className="danger"
              disabled={idleDisabled}
              onClick={() => void task(() => switchDatabase())}
            >
              创建空库并切换
            </button>
          </div>
        </Modal>
      )}
      {dialog === "restart" && (
        <Modal title="强制重启引擎？" onClose={() => setDialog(null)}>
          <p>
            这会终止数据库线程。未提交事务将丢失，中断操作是否已经提交可能未知。重启后请查询实际数据确认。
          </p>
          <div className="dialog-actions">
            <button onClick={() => setDialog(null)}>继续等待</button>
            <button className="danger" onClick={() => void restart()}>
              强制重启
            </button>
          </div>
        </Modal>
      )}
      {dialog === "help" && (
        <Modal title="给 SQL 留一个练习的地方" onClose={() => setDialog(null)}>
          <div className="help-content">
            <h3>运行与事务</h3>
            <p>
              ⌘ / Ctrl + Enter 优先执行选区，无选区时执行全部。脚本原样交给
              PostgreSQL，不按分号切割。支持跨次执行
              BEGIN、COMMIT、ROLLBACK；事务内暂停后台结构查询。
            </p>
            <h3>结果与保存</h3>
            <p>
              每组结果最多展示 1,000
              行；这不限制数据库实际计算量，请在大查询中使用 LIMIT。值以 PG
              原始文本呈现，保留大整数、小数和时间精度。点击单元格可以查看全文和复制。
            </p>
            <p>
              数据保存在当前浏览器、当前地址下。固定使用同一个地址和端口；清除站点数据或使用无痕窗口可能丢失练习内容。建议定期导出快照。
            </p>
            <button
              disabled={persistent}
              onClick={async () => {
                const granted = await navigator.storage?.persist();
                setPersistent(!!granted);
                setNotice(
                  granted
                    ? "已获得持久存储权限"
                    : "浏览器暂未授权，仍可使用本地存储；请定期备份",
                );
              }}
            >
              {persistent ? "持久存储已授权" : "申请浏览器持久存储"}
            </button>
            <h3>运行范围</h3>
            <p>
              这是单连接 SQL
              练习环境。对象浏览覆盖表、枚举、视图和序列；没有远程连接或并发会话。psql
              的反斜杠命令与 COPY STDIN/STDOUT
              不属于编辑器接口。长查询可通过强制重启恢复。
            </p>
            <p className="mono version-text">{version}</p>
            <button disabled={!ready} onClick={() => setDialog("restart")}>
              <RotateCcw size={14} />
              强制重启引擎
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TableIcon({ size = 14 }: { size?: number }) {
  return <FileCode2 size={size} />;
}

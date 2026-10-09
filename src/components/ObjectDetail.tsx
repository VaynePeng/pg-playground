import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  KeyRound,
} from "lucide-react";
import type { DbObject, ObjectDetail as Detail, ResultSet } from "../types";
import type { DatabaseClient } from "../db/client";
import { qualified, toSqlError } from "../db/utils";
import { ResultGrid } from "./ResultGrid";
import { ObjectIcon, kindLabel } from "./ObjectTree";

export function ObjectDetail({
  object,
  client,
  revision,
  disabled,
  onQuery,
}: {
  object: DbObject;
  client: DatabaseClient;
  revision: number;
  disabled: boolean;
  onQuery: (sql: string) => void;
}) {
  const [detail, setDetail] = useState<Detail>();
  const [tab, setTab] = useState("structure");
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState<{
    result: ResultSet;
    hasMore: boolean;
    stable: boolean;
  }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const canPreview = !["enum", "sequence"].includes(object.kind);
  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const task =
      tab === "data"
        ? client
            .request<{ result: ResultSet; hasMore: boolean; stable: boolean }>(
              "preview",
              { object, page },
            )
            .then((value) => {
              if (!cancelled) setPreview(value);
            })
        : client.request<Detail>("detail", { object }).then((value) => {
            if (!cancelled) setDetail(value);
          });
    task
      .catch((e) => {
        if (!cancelled) setError(toSqlError(e).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, object, revision, disabled, tab, page]);
  return (
    <section className="detail-panel">
      <div className="detail-heading">
        <ObjectIcon kind={object.kind} size={18} />
        <div>
          <strong>
            {object.schema}.{object.name}
          </strong>
          <small>
            {kindLabel[object.kind]}
            {object.comment ? ` · ${object.comment}` : ""}
          </small>
        </div>
        {canPreview && (
          <button
            className="small-button"
            onClick={() =>
              onQuery(`SELECT *\nFROM ${qualified(object)}\nLIMIT 100;`)
            }
          >
            <ArrowUpRight size={14} />
            查询此对象
          </button>
        )}
      </div>
      {canPreview && (
        <div className="sub-tabs">
          <button
            className={tab === "structure" ? "active" : ""}
            onClick={() => setTab("structure")}
          >
            结构
          </button>
          <button
            className={tab === "data" ? "active" : ""}
            onClick={() => setTab("data")}
          >
            数据预览
          </button>
          <button
            className={tab === "constraints" ? "active" : ""}
            onClick={() => setTab("constraints")}
          >
            索引与约束
          </button>
        </div>
      )}
      {disabled ? (
        <div className="empty-small">
          执行期间或事务未结束时，暂停结构与数据查询。
        </div>
      ) : error ? (
        <div className="error-card">{error}</div>
      ) : loading ? (
        <div className="empty-small">正在读取数据库…</div>
      ) : tab === "data" && preview ? (
        <>
          <div className="preview-info">
            <span>
              {preview.stable ? "按主键排序" : "此对象没有主键，行顺序可能变化"}{" "}
              · 每页 100 行
            </span>
            <div>
              <button
                disabled={!page}
                aria-label="上一页表数据"
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={14} />
              </button>
              <span>第 {page + 1} 页</span>
              <button
                disabled={!preview.hasMore}
                aria-label="下一页表数据"
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <ResultGrid
            key={`${object.oid}:${page}:${revision}`}
            result={preview.result}
          />
        </>
      ) : detail ? (
        <div className="detail-scroll">
          {object.kind === "enum" ? (
            <>
              <div className="detail-label">
                枚举值 <span>{detail.values.length} 个 · 按定义顺序</span>
              </div>
              <div className="enum-values">
                {detail.values.map((v, i) => (
                  <div key={v}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <code>{v}</code>
                  </div>
                ))}
              </div>
              <div className="detail-label">字段引用</div>
              {detail.references.length ? (
                detail.references.map((r) => (
                  <p
                    className="reference"
                    key={`${r.schema}.${r.table}.${r.column}`}
                  >
                    <code>
                      {r.schema}.{r.table}
                    </code>
                    <span>→ {r.column}</span>
                  </p>
                ))
              ) : (
                <p className="muted">
                  暂时没有字段直接使用此枚举或其数组类型。
                </p>
              )}
            </>
          ) : object.kind === "sequence" ? (
            <>
              <p className="muted">读取配置不会消耗序列值。</p>
              <table className="structure-table">
                <tbody>
                  {Object.entries(detail.sequence || {}).map(([k, v]) => (
                    <tr key={k}>
                      <th>{k}</th>
                      <td>{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : tab === "structure" ? (
            <>
              <table className="structure-table">
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>类型</th>
                    <th>可空</th>
                    <th>默认值 / 生成方式</th>
                    <th>注释</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.columns.map((c) => (
                    <tr key={c.name}>
                      <td className="mono">{c.name}</td>
                      <td>
                        <code className="type-chip">{c.type}</code>
                      </td>
                      <td>{c.nullable ? "是" : "否"}</td>
                      <td className="mono">
                        {c.identity
                          ? `IDENTITY (${c.identity === "a" ? "ALWAYS" : "BY DEFAULT"})`
                          : c.generated
                            ? `GENERATED: ${c.default_value}`
                            : (c.default_value ?? "—")}
                      </td>
                      <td>{c.comment ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.definition && (
                <>
                  <div className="detail-label">视图定义</div>
                  <pre className="definition">{detail.definition}</pre>
                </>
              )}
            </>
          ) : (
            <>
              {[
                ["约束", detail.constraints],
                ["索引", detail.indexes],
              ].map(([title, rows]) => (
                <div key={String(title)}>
                  <div className="detail-label">
                    <KeyRound size={13} />
                    {String(title)}
                  </div>
                  {(rows as Detail["constraints"]).length ? (
                    (rows as Detail["constraints"]).map((r) => (
                      <div className="definition-item" key={r.name}>
                        <strong>{r.name}</strong>
                        <pre>{r.definition}</pre>
                      </div>
                    ))
                  ) : (
                    <p className="muted">没有{String(title)}</p>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

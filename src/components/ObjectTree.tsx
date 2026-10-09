import { useState } from "react";
import {
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Table2,
  ListOrdered,
  Eye,
  Hash,
  Database,
} from "lucide-react";
import type { Catalog, DbObject, ObjectKind } from "../types";

export const kindLabel: Record<ObjectKind, string> = {
  table: "表",
  partitioned: "分区表",
  view: "视图",
  materialized: "物化视图",
  sequence: "序列",
  enum: "枚举",
};
export function ObjectIcon({
  kind,
  size = 14,
}: {
  kind: ObjectKind;
  size?: number;
}) {
  const Icon =
    kind === "enum"
      ? ListOrdered
      : kind === "sequence"
        ? Hash
        : kind === "view" || kind === "materialized"
          ? Eye
          : Table2;
  return <Icon size={size} />;
}
export function ObjectTree({
  catalog,
  selected,
  onSelect,
  onRefresh,
  system,
  onSystem,
  disabled,
  stale,
}: {
  catalog: Catalog;
  selected?: DbObject;
  onSelect: (o: DbObject) => void;
  onRefresh: () => void;
  system: boolean;
  onSystem: (v: boolean) => void;
  disabled: boolean;
  stale: string;
}) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    pg_catalog: true,
    information_schema: true,
  });
  const toggle = (key: string) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  const term = search.toLowerCase();
  return (
    <aside className="object-tree">
      <div className="section-heading">
        <span>数据库对象</span>
        <button
          className="icon-button"
          aria-label="刷新对象"
          onClick={onRefresh}
          disabled={disabled}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <label className="search-box">
        <Search size={14} />
        <input
          aria-label="搜索数据库对象"
          placeholder="搜索表、枚举…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <kbd>⌕</kbd>
      </label>
      <div className="tree-scroll">
        {catalog.schemas.map((schema) => {
          const objects = catalog.objects.filter(
            (o) =>
              o.schema === schema &&
              `${o.schema}.${o.name}`.toLowerCase().includes(term),
          );
          if (term && !objects.length) return null;
          return (
            <div className="schema-group" key={schema}>
              <button className="schema-row" onClick={() => toggle(schema)}>
                {collapsed[schema] && !term ? (
                  <ChevronRight size={13} />
                ) : (
                  <ChevronDown size={13} />
                )}
                <Database size={13} />
                <span>{schema}</span>
                <small>{objects.length}</small>
              </button>
              {(!collapsed[schema] || term) &&
                (
                  [
                    "table",
                    "partitioned",
                    "enum",
                    "view",
                    "materialized",
                    "sequence",
                  ] as ObjectKind[]
                ).map((kind) => {
                  const items = objects.filter((o) => o.kind === kind);
                  if (!items.length) return null;
                  const key = `${schema}:${kind}`;
                  return (
                    <div className="kind-group" key={kind}>
                      <button className="kind-row" onClick={() => toggle(key)}>
                        {collapsed[key] && !term ? (
                          <ChevronRight size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                        <span>{kindLabel[kind]}</span>
                        <small>{items.length}</small>
                      </button>
                      {(!collapsed[key] || term) &&
                        items.map((o) => (
                          <button
                            title={`${o.schema}.${o.name}${o.comment ? "\n" + o.comment : ""}`}
                            className={`object-row ${selected?.oid === o.oid && selected.kind === o.kind ? "active" : ""}`}
                            key={o.oid}
                            disabled={disabled}
                            onClick={() => onSelect(o)}
                          >
                            <ObjectIcon kind={o.kind} />
                            <span>{o.name}</span>
                            {o.kind === "enum" && <span className="enum-dot" />}
                          </button>
                        ))}
                    </div>
                  );
                })}
              {!objects.length && !collapsed[schema] && (
                <p className="tree-empty">还没有对象</p>
              )}
            </div>
          );
        })}
        {term &&
          !catalog.objects.some((o) =>
            `${o.schema}.${o.name}`.toLowerCase().includes(term),
          ) && <p className="tree-empty">没有匹配的对象</p>}
      </div>
      <div className="tree-bottom">
        {stale && <p className="stale">{stale}</p>}
        <label>
          <input
            type="checkbox"
            checked={system}
            disabled={disabled}
            onChange={(e) => onSystem(e.target.checked)}
          />{" "}
          显示系统对象
        </label>
        <p>表 / 枚举 / 视图 / 序列</p>
      </div>
    </aside>
  );
}

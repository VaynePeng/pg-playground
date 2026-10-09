import { useState } from "react";
import { Check, Copy, ChevronLeft, ChevronRight } from "lucide-react";
import type { ResultSet } from "../types";
import { Modal } from "./Modal";

const typeNames: Record<number, string> = {
  16: "bool",
  20: "int8",
  21: "int2",
  23: "int4",
  25: "text",
  114: "json",
  700: "float4",
  701: "float8",
  1043: "varchar",
  1082: "date",
  1114: "timestamp",
  1184: "timestamptz",
  1700: "numeric",
  2950: "uuid",
  3802: "jsonb",
};
export function ResultGrid({ result }: { result: ResultSet }) {
  const [page, setPage] = useState(0);
  const [cell, setCell] = useState<{ name: string; value: string | null }>();
  const [copy, setCopy] = useState("复制内容");
  const maxPage = Math.max(0, Math.ceil(result.rows.length / 100) - 1);
  const currentPage = Math.min(page, maxPage);
  if (!result.fields.length)
    return (
      <div className="command-success">
        <Check size={28} />
        <h3>执行完成</h3>
        <code>{result.command}</code>
        <p>此语句没有返回数据表。</p>
      </div>
    );
  return (
    <div className="grid-wrap">
      <div className="data-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="row-number">#</th>
              {result.fields.map((field, i) => (
                <th key={i}>
                  {field.name}
                  <span className="field-type">
                    {typeNames[field.dataTypeID] || `oid ${field.dataTypeID}`}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows
              .slice(currentPage * 100, currentPage * 100 + 100)
              .map((row, r) => (
                <tr key={r}>
                  <td className="row-number">{currentPage * 100 + r + 1}</td>
                  {row.map((value, c) => (
                    <td key={c}>
                      <button
                        className={`cell ${value === null ? "null" : ""}`}
                        onClick={() => {
                          setCell({ name: result.fields[c].name, value });
                          setCopy("复制内容");
                        }}
                        title="点击展开与复制"
                      >
                        {value === null
                          ? "NULL"
                          : value === ""
                            ? "''"
                            : result.fields[c].dataTypeID === 16
                              ? value === "t"
                                ? "true"
                                : "false"
                              : value}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
        {!result.rows.length && (
          <div className="empty-small">查询成功，返回 0 行。</div>
        )}
      </div>
      <div className="grid-footer">
        <span>
          显示 {result.rows.length.toLocaleString()} / 返回{" "}
          {result.rowCount.toLocaleString()} 行{" "}
          {result.rowCount > result.rows.length
            ? "· 已截断，使用 LIMIT 缩小结果"
            : ""}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="上一页结果"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={14} />
          </button>
          <span>
            {currentPage + 1} / {maxPage + 1}
          </span>
          <button
            className="icon-button"
            aria-label="下一页结果"
            disabled={currentPage >= maxPage}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      {cell && (
        <Modal title={cell.name} onClose={() => setCell(undefined)}>
          <pre className="cell-full">
            {cell.value === null
              ? "NULL"
              : cell.value === ""
                ? "（空字符串）"
                : cell.value}
          </pre>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(cell.value ?? "NULL");
                setCopy("已复制");
              } catch {
                setCopy("复制失败，请手动选择文本");
              }
            }}
          >
            <Copy size={14} />
            {copy}
          </button>
        </Modal>
      )}
    </div>
  );
}

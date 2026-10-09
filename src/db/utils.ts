import type { SqlError } from "../types";
export function toSqlError(error: unknown): SqlError {
  const e = error as Partial<SqlError> | null;
  return {
    message: e?.message || String(error),
    code: e?.code,
    detail: e?.detail,
    hint: e?.hint,
    position: e?.position,
  };
}
export const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;
export const qualified = (o: { schema: string; name: string }) =>
  `${quoteIdent(o.schema)}.${quoteIdent(o.name)}`;

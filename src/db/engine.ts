import { type PGlite, protocol } from "@electric-sql/pglite";
import type { Execution, ResultSet, TransactionStatus } from "../types";

export const DISPLAY_LIMIT = 1000;
import { toSqlError } from "./utils";
export { toSqlError, quoteIdent, qualified } from "./utils";

// Protocol text values preserve precision, duplicate column names and original time zones.
// ReadyForQuery supplies authoritative transaction state, including failed transactions.
export async function execute(pg: PGlite, sql: string): Promise<Execution> {
  const response = await pg.execProtocol(protocol.serialize.query(sql), {
    throwOnError: false,
    syncToFs: true,
  });
  const output: Execution = { results: [], notices: [], transaction: "I" };
  let current: ResultSet | undefined;
  for (const message of response.messages) {
    if (message.name === "rowDescription") {
      const m = message as InstanceType<
        typeof protocol.messages.RowDescriptionMessage
      >;
      current = {
        fields: m.fields.map((f) => ({
          name: f.name,
          dataTypeID: f.dataTypeID,
        })),
        rows: [],
        rowCount: 0,
        command: "",
      };
    } else if (message.name === "dataRow") {
      const m = message as InstanceType<
        typeof protocol.messages.DataRowMessage
      >;
      if (current) {
        current.rowCount++;
        if (current.rows.length < DISPLAY_LIMIT) current.rows.push(m.fields);
      }
    } else if (message.name === "commandComplete") {
      const m = message as InstanceType<
        typeof protocol.messages.CommandCompleteMessage
      >;
      output.results.push({
        ...(current || { fields: [], rows: [], rowCount: 0 }),
        command: m.text,
      });
      current = undefined;
    } else if (message.name === "error") {
      output.error = toSqlError(message);
    } else if (message.name === "notice") {
      output.notices.push(
        (message as InstanceType<typeof protocol.messages.NoticeMessage>)
          .message || "",
      );
    } else if (message.name === "readyForQuery") {
      output.transaction = (
        message as InstanceType<typeof protocol.messages.ReadyForQueryMessage>
      ).status as TransactionStatus;
    } else if (
      message.name === "copyInResponse" ||
      message.name === "copyOutResponse"
    ) {
      // COPY wire streaming is not part of the SQL editor's interface.
      throw new Error(
        "此编辑器不支持 COPY STDIN/STDOUT，请使用 INSERT 或 SQL 文件。请重启引擎恢复连接。",
      );
    }
  }
  return output;
}

export async function serverVersion(pg: PGlite) {
  const result = await pg.query<{ version: string }>(
    "select pg_catalog.version() as version",
  );
  return result.rows[0].version;
}

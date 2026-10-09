export type TransactionStatus = "I" | "T" | "E";
export interface SqlError {
  message: string;
  code?: string;
  detail?: string;
  hint?: string;
  position?: string;
}
export interface ResultSet {
  fields: { name: string; dataTypeID: number }[];
  rows: (string | null)[][];
  rowCount: number;
  command: string;
}
export interface Execution {
  results: ResultSet[];
  notices: string[];
  error?: SqlError;
  transaction: TransactionStatus;
}
export type ObjectKind =
  "table" | "partitioned" | "view" | "materialized" | "sequence" | "enum";
export interface DbObject {
  oid: number;
  schema: string;
  name: string;
  kind: ObjectKind;
  comment: string | null;
}
export interface Catalog {
  schemas: string[];
  objects: DbObject[];
  columns: { schema: string; table: string; name: string }[];
}
export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default_value: string | null;
  comment: string | null;
  identity: string;
  generated: string;
}
export interface ObjectDetail {
  columns: Column[];
  constraints: { name: string; definition: string }[];
  indexes: { name: string; definition: string }[];
  values: string[];
  references: { schema: string; table: string; column: string }[];
  definition?: string;
  sequence?: Record<string, unknown>;
}
export interface HistoryItem {
  id: string;
  sql: string;
  scope: string;
  time: string;
  duration: number;
  success: boolean;
  summary: string;
  error?: SqlError;
}
export interface AppData {
  databaseId: string;
  retired: string[];
  draft: string;
  history: HistoryItem[];
  sidebar: number;
  editorHeight: number;
}

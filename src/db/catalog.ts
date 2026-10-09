import type { PGlite } from "@electric-sql/pglite";
import type { Catalog, Column, DbObject, ObjectDetail } from "../types";
import { execute, qualified, quoteIdent } from "./engine";

const userSchema = `n.nspname NOT IN ('information_schema', 'pg_catalog') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'`;

export async function readCatalog(
  pg: PGlite,
  system: boolean,
): Promise<Catalog> {
  const where = system ? "true" : userSchema;
  const schemas = await pg.query<{ name: string }>(
    `SELECT n.nspname as name FROM pg_catalog.pg_namespace n WHERE ${where} ORDER BY 1`,
  );
  const objects = await pg.query<DbObject>(`
    SELECT c.oid, n.nspname as schema, c.relname as name,
      CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized' WHEN 'S' THEN 'sequence' END as kind,
      pg_catalog.obj_description(c.oid, 'pg_class') as comment
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p','v','m','S') AND ${where}
    UNION ALL
    SELECT t.oid,n.nspname,t.typname,'enum',pg_catalog.obj_description(t.oid,'pg_type')
    FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE t.typtype='e' AND ${where}
    ORDER BY schema,kind,name`);
  const columns = await pg.query<Catalog["columns"][number]>(`
    SELECT n.nspname as schema,c.relname as table,a.attname as name
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped AND ${where}
    ORDER BY n.nspname,c.relname,a.attnum`);
  return {
    schemas: schemas.rows.map((s) => s.name),
    objects: objects.rows,
    columns: columns.rows,
  };
}

export async function readDetail(
  pg: PGlite,
  object: DbObject,
): Promise<ObjectDetail> {
  const detail: ObjectDetail = {
    columns: [],
    constraints: [],
    indexes: [],
    values: [],
    references: [],
  };
  if (object.kind === "enum") {
    const values = await pg.query<{ value: string }>(
      "SELECT enumlabel as value FROM pg_catalog.pg_enum WHERE enumtypid=$1 ORDER BY enumsortorder",
      [object.oid],
    );
    detail.values = values.rows.map((v) => v.value);
    detail.references = (
      await pg.query<ObjectDetail["references"][number]>(
        `
      SELECT n.nspname as schema,c.relname as table,a.attname as column
      FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
      WHERE (a.atttypid=$1 OR t.typelem=$1) AND a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m')
      ORDER BY 1,2,3`,
        [object.oid],
      )
    ).rows;
    return detail;
  }
  if (object.kind === "sequence") {
    detail.sequence = (
      await pg.query<Record<string, unknown>>(
        `SELECT start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text FROM pg_catalog.pg_sequences WHERE schemaname=$1 AND sequencename=$2`,
        [object.schema, object.name],
      )
    ).rows[0];
    return detail;
  }
  detail.columns = (
    await pg.query<Column>(
      `
    SELECT a.attname as name,pg_catalog.format_type(a.atttypid,a.atttypmod) as type,
      NOT a.attnotnull as nullable,pg_catalog.pg_get_expr(d.adbin,d.adrelid) as default_value,
      pg_catalog.col_description(a.attrelid,a.attnum) as comment,a.attidentity as identity,a.attgenerated as generated
    FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
      [object.oid],
    )
  ).rows;
  detail.constraints = (
    await pg.query<ObjectDetail["constraints"][number]>(
      "SELECT conname as name,pg_catalog.pg_get_constraintdef(oid,true) as definition FROM pg_catalog.pg_constraint WHERE conrelid=$1 ORDER BY conname",
      [object.oid],
    )
  ).rows;
  detail.indexes = (
    await pg.query<ObjectDetail["indexes"][number]>(
      `SELECT c.relname as name,pg_catalog.pg_get_indexdef(i.indexrelid) as definition FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=$1 ORDER BY c.relname`,
      [object.oid],
    )
  ).rows;
  if (object.kind === "view" || object.kind === "materialized") {
    detail.definition = (
      await pg.query<{ definition: string }>(
        "SELECT pg_catalog.pg_get_viewdef($1::oid,true) as definition",
        [object.oid],
      )
    ).rows[0].definition;
  }
  return detail;
}

export async function preview(pg: PGlite, object: DbObject, page: number) {
  const keys = await pg.query<{ name: string }>(
    `
    SELECT a.attname as name FROM pg_catalog.pg_index i
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,position)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
    WHERE i.indrelid=$1 AND i.indisprimary ORDER BY k.position`,
    [object.oid],
  );
  const order = keys.rows.length
    ? ` ORDER BY ${keys.rows.map((k) => quoteIdent(k.name)).join(",")}`
    : "";
  const offset = Math.max(0, Math.floor(page)) * 100;
  const data = await execute(
    pg,
    `SELECT * FROM ${qualified(object)}${order} LIMIT 101 OFFSET ${offset}`,
  );
  if (data.error) throw data.error;
  const result = data.results[0];
  const hasMore = result.rows.length > 100;
  result.rows = result.rows.slice(0, 100);
  result.rowCount = result.rows.length;
  return { result, hasMore, stable: !!keys.rows.length };
}

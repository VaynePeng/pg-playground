import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { execute } from "../src/db/engine";
import { quoteIdent } from "../src/db/utils";
import { readCatalog, readDetail, preview } from "../src/db/catalog";
import { seedSql, lessons } from "../src/examples/sql";
import { packBackup, unpackBackup } from "../src/db/client";

let pg: PGlite;
before(async () => {
  pg = await PGlite.create();
  const result = await execute(pg, seedSql);
  assert.equal(result.error, undefined);
});
after(async () => {
  await pg.close();
});

test("catalog reads actual schemas, table columns, indexes, constraints and ordered enum references", async () => {
  const catalog = await readCatalog(pg, false);
  assert.ok(catalog.schemas.includes("practice"));
  assert.equal(catalog.objects.filter((o) => o.kind === "table").length, 4);
  const order = catalog.objects.find((o) => o.name === "orders")!;
  const detail = await readDetail(pg, order);
  assert.equal(
    detail.columns.find((c) => c.name === "total")!.type,
    "numeric(10,2)",
  );
  assert.ok(
    detail.constraints.some((c) => c.definition.startsWith("FOREIGN KEY")),
  );
  assert.ok(detail.indexes.some((i) => i.name === "orders_customer_idx"));
  const enumeration = await readDetail(
    pg,
    catalog.objects.find((o) => o.kind === "enum")!,
  );
  assert.deepEqual(enumeration.values, [
    "pending",
    "paid",
    "shipped",
    "completed",
    "cancelled",
  ]);
  assert.ok(
    enumeration.references.some(
      (r) => r.table === "orders" && r.column === "status",
    ),
  );
  const view = await readDetail(
    pg,
    catalog.objects.find((o) => o.kind === "view")!,
  );
  assert.match(view.definition!, /JOIN/);
  const sequence = await readDetail(
    pg,
    catalog.objects.find((o) => o.kind === "sequence")!,
  );
  assert.equal(sequence.sequence!.increment_by, "1");
});

test("preview paginates 120 rows by primary key without advancing sequences", async () => {
  const catalog = await readCatalog(pg, false);
  const order = catalog.objects.find((o) => o.name === "orders")!;
  const page0 = await preview(pg, order, 0),
    page1 = await preview(pg, order, 1);
  assert.equal(page0.result.rows.length, 100);
  assert.equal(page0.hasMore, true);
  assert.equal(page0.stable, true);
  assert.equal(page1.result.rows.length, 20);
  assert.equal(page1.hasMore, false);
  assert.equal(page1.result.rows[0][0], "101");
});

test("protocol preserves duplicate names, decimals, int8, NULL, empty strings, JSON, array and timestamps", async () => {
  const result = await execute(
    pg,
    `SELECT 1 as id, 2 as id, 9007199254740993::bigint, 0.12345678901234567890::numeric, NULL, '', '{"x":1}'::jsonb, ARRAY[1,2], '2026-09-01 08:12:13.123456'::timestamp`,
  );
  assert.equal(result.error, undefined);
  assert.deepEqual(
    result.results[0].fields.slice(0, 2).map((f) => f.name),
    ["id", "id"],
  );
  assert.deepEqual(result.results[0].rows[0], [
    "1",
    "2",
    "9007199254740993",
    "0.12345678901234567890",
    null,
    "",
    '{"x": 1}',
    "{1,2}",
    "2026-09-01 08:12:13.123456",
  ]);
});

test("transaction state follows BEGIN, error, ROLLBACK across separate executions", async () => {
  assert.equal((await execute(pg, "BEGIN;")).transaction, "T");
  const failed = await execute(pg, "SELECT 1/0");
  assert.equal(failed.transaction, "E");
  assert.equal(failed.error?.code, "22012");
  assert.equal(failed.error?.message, "division by zero");
  assert.equal((await execute(pg, "ROLLBACK")).transaction, "I");
  assert.equal((await execute(pg, "SELECT 42")).results[0].rows[0][0], "42");
});

test("batch failure preserves observed results but rolls back implicit changes; explicit COMMIT stays committed", async () => {
  await execute(pg, "CREATE TABLE public.batch_test(n int)");
  const failure = await execute(
    pg,
    "INSERT INTO public.batch_test VALUES (1); SELECT 42; SELECT 1/0",
  );
  assert.equal(failure.error?.code, "22012");
  assert.ok(failure.results.length >= 2);
  assert.equal(
    (await execute(pg, "SELECT count(*) FROM public.batch_test")).results[0]
      .rows[0][0],
    "0",
  );
  await execute(
    pg,
    "BEGIN; INSERT INTO public.batch_test VALUES (2); COMMIT; SELECT 1/0",
  );
  assert.equal(
    (await execute(pg, "SELECT count(*) FROM public.batch_test")).results[0]
      .rows[0][0],
    "1",
  );
});

test("semicolons in strings and function bodies are handed intact to PostgreSQL", async () => {
  const result = await execute(
    pg,
    `CREATE FUNCTION public.semicolons() RETURNS text LANGUAGE plpgsql AS $$ BEGIN RETURN 'one;two'; END; $$; SELECT public.semicolons();`,
  );
  assert.equal(result.error, undefined);
  assert.equal(result.results.at(-1)!.rows[0][0], "one;two");
});

test("identifier quoting, same-name objects and enum alterations remain discoverable", async () => {
  const name = 'Odd " table';
  await execute(
    pg,
    `CREATE SCHEMA extra; CREATE TABLE extra.orders(id integer); CREATE TABLE public.${quoteIdent(name)} (id int); INSERT INTO public.${quoteIdent(name)} VALUES (7); ALTER TYPE practice.order_status ADD VALUE 'packed' AFTER 'paid'; CREATE TABLE extra.enum_array (statuses practice.order_status[]);`,
  );
  const cat = await readCatalog(pg, false);
  assert.equal(cat.objects.filter((o) => o.name === "orders").length, 2);
  assert.equal(
    (
      await preview(
        pg,
        cat.objects.find((o) => o.name === name)!,
        0,
      )
    ).result.rows[0][0],
    "7",
  );
  const detail = await readDetail(
    pg,
    cat.objects.find((o) => o.kind === "enum")!,
  );
  assert.deepEqual(detail.values.slice(0, 3), ["pending", "paid", "packed"]);
  assert.ok(detail.references.some((r) => r.table === "enum_array"));
});

test("empty results preserve headers and result display is capped without rewriting SQL", async () => {
  const empty = await execute(pg, "SELECT 1 as empty WHERE false");
  assert.equal(empty.results[0].fields[0].name, "empty");
  assert.equal(empty.results[0].rows.length, 0);
  const large = await execute(pg, "SELECT * FROM generate_series(1,1200)");
  assert.equal(large.results[0].rows.length, 1000);
  assert.equal(large.results[0].rowCount, 1200);
});

test("practice lessons run; CHECK violation is real; transaction lesson restores values", async () => {
  for (const lesson of lessons) {
    const result = await execute(pg, lesson.sql);
    if (lesson.title === "触碰约束边界")
      assert.equal(result.error?.code, "23514");
    else assert.equal(result.error, undefined, lesson.title);
    assert.equal(result.transaction, "I");
  }
});

test("snapshot envelope restores full data and rejects invalid or mismatched versions", async () => {
  const version = "test-engine";
  const archive = await pg.dumpDataDir("gzip");
  const file = new File([packBackup(archive, version)], "test.pgplay");
  const restored = await PGlite.create({
    loadDataDir: await unpackBackup(file, version),
  });
  try {
    assert.equal(
      (await execute(restored, "SELECT count(*) FROM practice.orders"))
        .results[0].rows[0][0],
      "120",
    );
    assert.equal(
      (await readCatalog(restored, false)).objects.some(
        (o) => o.kind === "enum",
      ),
      true,
    );
  } finally {
    await restored.close();
  }
  await assert.rejects(unpackBackup(file, "different"), /版本/);
  await assert.rejects(
    unpackBackup(new File(["invalid"], "bad.pgplay"), version),
    /快照/,
  );
});

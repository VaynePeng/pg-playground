/// <reference lib="webworker" />
import { PGlite } from "@electric-sql/pglite";
import { execute, serverVersion, toSqlError } from "./engine";
import { readCatalog, readDetail, preview } from "./catalog";
import { seedSql } from "../examples/sql";
import type { TransactionStatus, DbObject } from "../types";

let pg: PGlite | undefined;
let transaction: TransactionStatus = "I";
let queue = Promise.resolve();

async function handle(action: string, payload: Record<string, unknown>) {
  if (action === "init") {
    pg = await PGlite.create({
      dataDir: `idb://${payload.databaseId}`,
      loadDataDir: payload.archive as Blob | undefined,
    });
    // PG timeout signals do not reliably interrupt WASM. Recovery is explicit worker restart.
    return { version: await serverVersion(pg) };
  }
  if (!pg) throw new Error("数据库尚未初始化");
  if (action === "execute") {
    const result = await execute(pg, payload.sql as string);
    transaction = result.transaction;
    return result;
  }
  if (action === "close") {
    await pg.close();
    return null;
  }
  if (transaction !== "I")
    throw new Error("请先提交或回滚当前事务，再浏览结构、备份或载入示例。");
  if (action === "catalog") return readCatalog(pg, !!payload.system);
  if (action === "detail") return readDetail(pg, payload.object as DbObject);
  if (action === "preview")
    return preview(pg, payload.object as DbObject, Number(payload.page));
  if (action === "backup") return pg.dumpDataDir("gzip");
  if (action === "seed") {
    const exists = (
      await pg.query<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='practice') as exists",
      )
    ).rows[0].exists;
    if (exists && !payload.reset)
      throw new Error(
        "practice schema 已存在。请使用“重置示例”，避免覆盖已有内容。",
      );
    const script = payload.reset
      ? seedSql.replace(
          "BEGIN;",
          "BEGIN; DROP SCHEMA IF EXISTS practice CASCADE;",
        )
      : seedSql;
    const result = await execute(pg, script);
    transaction = result.transaction;
    if (result.error) {
      await execute(pg, "ROLLBACK");
      transaction = "I";
      throw result.error;
    }
    return null;
  }
  throw new Error(`未知操作：${action}`);
}

self.onmessage = (
  event: MessageEvent<{
    id: number;
    action: string;
    payload: Record<string, unknown>;
  }>,
) => {
  const { id, action, payload } = event.data;
  queue = queue.then(async () => {
    try {
      self.postMessage({ id, value: await handle(action, payload) });
    } catch (error) {
      self.postMessage({ id, error: toSqlError(error) });
    }
  });
};

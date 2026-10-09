import { openDB } from "idb";
import { initialSql } from "../examples/sql";
import type { AppData } from "../types";

export type Theme = "light" | "dark" | "system";
const storage = openDB("pg-playground-app-v1", 1, {
  upgrade(db) {
    db.createObjectStore("settings");
  },
});
export const newDatabaseId = () => `pg-playground-${crypto.randomUUID()}`;
export async function loadData(): Promise<AppData> {
  const db = await storage;
  const stored = await db.get("settings", "workspace");
  if (stored) return stored;
  const data: AppData = {
    databaseId: newDatabaseId(),
    retired: [],
    draft: initialSql,
    history: [],
    sidebar: 256,
    editorHeight: 43,
  };
  await db.put("settings", data, "workspace");
  return data;
}
export async function saveData(data: AppData) {
  await (await storage).put("settings", data, "workspace");
}
export async function readTheme(): Promise<Theme> {
  return (await (await storage).get("settings", "theme")) || "system";
}
export async function saveTheme(theme: Theme) {
  await (await storage).put("settings", theme, "theme");
}

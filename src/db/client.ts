import type { SqlError } from "../types";

export class DatabaseClient {
  private worker: Worker;
  private id = 0;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (e: SqlError) => void }
  >();
  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if (data.error) request.reject(data.error);
      else request.resolve(data.value);
    };
    this.worker.onerror = () =>
      this.failAll("数据库线程异常，请强制重启引擎。");
    this.worker.onmessageerror = () =>
      this.failAll("数据库通信失败，请强制重启引擎。");
  }
  request<T>(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker.postMessage({ id, action, payload });
    });
  }
  private failAll(message: string) {
    for (const request of this.pending.values()) request.reject({ message });
    this.pending.clear();
  }
  terminate() {
    this.worker.terminate();
    this.failAll("引擎已重启；先前执行结果未知，请检查数据库实际状态。");
  }
}

const BACKUP_MAGIC = "PG-PLAYGROUND/1\n";
export function packBackup(archive: Blob, version: string) {
  return new Blob(
    [
      BACKUP_MAGIC,
      JSON.stringify({ version, createdAt: new Date().toISOString() }),
      "\n",
      archive,
    ],
    { type: "application/octet-stream" },
  );
}
export async function unpackBackup(file: File, version: string) {
  const header = await file.slice(0, 4096).text();
  if (!header.startsWith(BACKUP_MAGIC))
    throw new Error("请选择本工具导出的 .pgplay 快照文件。");
  const end = header.indexOf("\n", BACKUP_MAGIC.length);
  if (end < 0) throw new Error("备份头损坏");
  const meta = JSON.parse(header.slice(BACKUP_MAGIC.length, end));
  if (meta.version !== version)
    throw new Error(
      "备份引擎版本与当前版本不同，无法保证数据目录兼容。请使用相同版本恢复。",
    );
  const bytes = new TextEncoder().encode(header.slice(0, end + 1)).length;
  return file.slice(bytes);
}

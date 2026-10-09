# PG Playground

一个运行在浏览器里的 PostgreSQL 练习工作台。React + Vite + TypeScript + CodeMirror 6 + PGlite，无需安装 PostgreSQL 或 Docker，没有业务服务器。

## 启动

推荐使用 Node.js 22.12 或更高版本（本机已使用 22.22.1 验证）。

```bash
cd /Users/vaynepeng/Documents/Codex/2026-10-08/ben/outputs/pg-playground
npm ci
npm run dev
```

打开 **http://127.0.0.1:5430/**。端口固定，发生冲突会报错，不会静默切换到另一个地址。

当前依赖已安装；再次启动只需 `npm run dev`。

```bash
npm run check   # TypeScript 检查
npm test        # 10 项真实 PGlite 集成测试
npm run build  # 检查并构建到 dist/
npm run preview # 生产构建预览 http://127.0.0.1:4173/
```

生产预览与开发地址端口不同，因此使用独立的浏览器数据库。可以通过快照导出/恢复迁移。

## 使用

1. 编辑 SQL，点击唯一的 **运行** 按钮。有选区时仅执行选区，没有选区时运行整个脚本；`Cmd/Ctrl + Enter` 行为相同。
2. 首次可打开“练习手册”，载入订单数据。包含 4 张表、1 个枚举、1 个视图、24 位客户与 120 笔订单，以及 9 个练习。
3. 左侧按 schema 浏览表、分区表、枚举、视图、物化视图和序列。支持搜索、系统对象开关及手动刷新；SQL 执行结束且事务空闲时自动刷新。
4. 点击表查看字段、默认值、注释、索引与约束；数据预览每页 100 行，存在主键时按主键排序。点击枚举查看有序枚举值和字段引用。
5. 多条 SQL 产生多组结果，点击结果标签切换。点击单元格可展开全文、复制。NULL、空字符串和布尔值有独立展示。
6. 历史保存最近 200 次执行；点击历史恢复 SQL，不自动运行。编辑器支持 SQL 文件导入与草稿导出。
7. 右上角切换**浅色 / 深色 / 跟随系统**。蓝灰配色覆盖编辑器、选区、结果和弹窗；选择会记住。

## 事务与错误

支持分次执行 `BEGIN`、SQL、`COMMIT` 或 `ROLLBACK`。界面使用 PostgreSQL 协议的 `ReadyForQuery` 状态判断空闲、事务中、事务失败，不用 SQL 正则猜测。

事务未结束时暂停内部结构和数据预览查询。发生错误时保留原始错误码、说明、detail、hint；引擎提供 position 时可定位到原 SQL，支持选区偏移与 Unicode。失败事务需要用户显式回滚。

脚本原样发送，不按分号拆分，不自动添加 LIMIT 或包裹额外事务。错误之前显示的结果是引擎确实返回的结果，**不能视为已经提交的数据**。

## 保存、备份与恢复

- 数据库保存到 IndexedDB，草稿、历史、布局与主题使用独立应用存储。
- 同一浏览器、同一地址下刷新会恢复数据。`127.0.0.1`、`localhost` 和不同端口是不同 origin，不能混用。
- “数据管理 → 导出数据库快照”生成 `.pgplay` 文件，包含版本头与 PGlite 数据目录压缩包。
- 恢复先创建新实例并验证，再切换；原库保留在“数据管理”中，可重新打开。
- “重置整个练习库”同样创建空库后切换，保留原库、草稿和历史。
- “重置示例”只重建整个 `practice` schema，其中自己添加的内容也会删除，操作前会确认。
- 清除浏览器站点数据会删除本地内容。建议定期备份；使用说明中可申请浏览器持久存储。

快照仅供同版本引擎恢复，不是通用 SQL dump。更新 PGlite 之前先备份，依赖版本以 `package-lock.json` 为准。

## 已知边界

- 单连接、单活动页面。第二个页面会提示库被占用，不支持多连接锁竞争实验。
- 结果每组最多展示 1,000 行；SQL 仍会实际计算和返回结果，界面截断不等于资源上限。大查询请自己加 LIMIT。
- WASM 环境中 `statement_timeout` 实测不能可靠取消查询。超过 5 秒显示恢复入口，也可在使用说明中强制重启引擎。重启会丢失未提交事务，已提交情况需查询确认。
- 这是 SQL 编辑器，不支持 psql 反斜杠命令、COPY STDIN/STDOUT 交互流或远程数据库连接。
- 结果保持 PG 文本表示，保留数值和时间精度。自定义类型表头可能显示类型 OID，详细类型定义在对象详情查看。
- 对象浏览首版不包含函数、触发器与 domain 专用面板；可以直接 SQL 查询它们。
- 未承诺 PGlite 支持所有服务器端扩展。浏览器需支持 Worker、IndexedDB、Web Locks 和 WebAssembly。
- 备份恢复、重置会保留旧数据库，占用额外本地存储；可以在数据管理中重新打开它们。

## 源码结构

```text
src/App.tsx                  工作台、运行、持久化与库切换
src/components/SqlEditor.tsx  CodeMirror、补全、选区与主题
src/components/ObjectTree.tsx
src/components/ObjectDetail.tsx
src/components/ResultGrid.tsx
src/db/worker.ts             单线程请求队列、事务防护
src/db/engine.ts             PG 协议解析、真实结果与事务状态
src/db/catalog.ts            系统目录查询与安全标识符预览
src/db/client.ts             Worker RPC 与备份文件格式
src/storage/store.ts         应用 IndexedDB
src/examples/sql.ts          示例库与练习
tests/database.test.ts       真实引擎集成测试
docs/验收记录.md              验证范围、结果与限制
```

字体和引擎资源随构建打包，没有外部字体 CDN 请求。使用本地开发服务器或静态 HTTP 服务器运行，不要直接双击 dist/index.html。

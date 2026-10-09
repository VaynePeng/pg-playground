export const initialSql = `-- 欢迎来到你的 SQL 实验室。
-- 直接运行试试，或点击「练习手册」载入订单数据。

SELECT
  'Hello, PostgreSQL!' AS greeting,
  current_date AS today,
  version() AS engine;
`;

export const seedSql = `
BEGIN;
CREATE SCHEMA practice;
CREATE TYPE practice.order_status AS ENUM ('pending', 'paid', 'shipped', 'completed', 'cancelled');
CREATE TABLE practice.customers (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL, city text, email text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE practice.customers IS '练习数据 · 客户';
CREATE TABLE practice.products (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL, category text NOT NULL,
  price numeric(10,2) NOT NULL CHECK(price >= 0), attributes jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE practice.orders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES practice.customers(id),
  status practice.order_status NOT NULL DEFAULT 'pending',
  total numeric(10,2) NOT NULL CHECK(total >= 0),
  created_at timestamptz NOT NULL, note text
);
COMMENT ON TABLE practice.orders IS '练习数据 · 订单，支持枚举、聚合与窗口函数练习';
COMMENT ON COLUMN practice.orders.total IS '订单总金额，单位：元';
CREATE TABLE practice.order_items (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id integer NOT NULL REFERENCES practice.orders(id),
  product_id integer NOT NULL REFERENCES practice.products(id),
  quantity integer NOT NULL CHECK(quantity > 0), unit_price numeric(10,2) NOT NULL
);
CREATE INDEX orders_customer_idx ON practice.orders(customer_id);
INSERT INTO practice.customers(name,city,email)
SELECT (ARRAY['林小满','陈远','周可','许知夏','方舟','沈清','陆遥','赵一'])[((i-1)%8)+1] || ' ' || i,
  (ARRAY['上海','杭州','成都','深圳',NULL])[((i-1)%5)+1], 'learner' || i || '@example.test'
FROM generate_series(1,24) i;
INSERT INTO practice.products(name,category,price,attributes) VALUES
('机械键盘','数码',399.00,'{"color":"green","wireless":true}'),
('帆布包','生活',89.00,'{"color":"cream"}'),
('手冲壶','生活',199.00,'{"capacity":600}'),
('SQL 笔记本','文具',39.00,'{"pages":128}'),
('桌面台灯','数码',259.00,'{"dimmable":true}'),
('钢笔','文具',129.00,'{"color":"black"}');
INSERT INTO practice.orders(customer_id,status,total,created_at,note)
SELECT ((i-1)%24)+1,
  (ARRAY['pending','paid','shipped','completed','cancelled']::practice.order_status[])[((i-1)%5)+1],
  0, '2026-09-01 08:00:00+08'::timestamptz + i * interval '7 hours',
  CASE WHEN i%7=0 THEN '请周末配送' ELSE NULL END
FROM generate_series(1,120) i;
INSERT INTO practice.order_items(order_id,product_id,quantity,unit_price)
SELECT o.id,p.id,1+(o.id%3),p.price FROM practice.orders o
JOIN practice.products p ON p.id=((o.id-1)%6)+1 OR p.id=(o.id%6)+1;
UPDATE practice.orders o SET total=(SELECT sum(quantity*unit_price) FROM practice.order_items WHERE order_id=o.id);
CREATE VIEW practice.order_summary AS
SELECT o.id,c.name AS customer,o.status,o.total,o.created_at FROM practice.orders o JOIN practice.customers c ON c.id=o.customer_id;
COMMIT;
`;

export const lessons = [
  {
    title: "第一条查询",
    level: "01 · 入门",
    description: "筛选、排序与 LIMIT",
    sql: `SELECT id, status, total, created_at\nFROM practice.orders\nWHERE total > 500\nORDER BY total DESC\nLIMIT 20;`,
  },
  {
    title: "按状态汇总",
    level: "02 · 聚合",
    description: "GROUP BY、COUNT 与 AVG",
    sql: `SELECT status,\n       count(*) AS order_count,\n       sum(total) AS revenue,\n       round(avg(total), 2) AS average\nFROM practice.orders\nGROUP BY status\nORDER BY status;`,
  },
  {
    title: "认识你的客户",
    level: "03 · 关联",
    description: "JOIN 多张表，寻找关联",
    sql: `SELECT c.name, c.city, o.id, o.total, o.status\nFROM practice.customers c\nJOIN practice.orders o ON o.customer_id = c.id\nWHERE o.status = 'completed'\nORDER BY o.total DESC;`,
  },
  {
    title: "城市消费榜",
    level: "04 · CTE",
    description: "WITH 与窗口排名",
    sql: `WITH totals AS (\n  SELECT c.city, sum(o.total) AS revenue\n  FROM practice.customers c\n  JOIN practice.orders o ON o.customer_id = c.id\n  GROUP BY c.city\n)\nSELECT city, revenue,\n       dense_rank() OVER (ORDER BY revenue DESC) AS rank\nFROM totals;`,
  },
  {
    title: "每位客户的最大订单",
    level: "05 · 子查询",
    description: "相关子查询与 MAX",
    sql: `SELECT o.*\nFROM practice.orders o\nWHERE o.total = (\n  SELECT max(other.total)\n  FROM practice.orders other\n  WHERE other.customer_id = o.customer_id\n)\nORDER BY o.customer_id;`,
  },
  {
    title: "探索 JSONB",
    level: "06 · PG 特性",
    description: "读取 JSON 字段与包含匹配",
    sql: `SELECT name, attributes->>'color' AS color, attributes\nFROM practice.products\nWHERE attributes ? 'color';\n\nSELECT * FROM practice.products\nWHERE attributes @> '{"wireless": true}'::jsonb;`,
  },
  {
    title: "枚举也有顺序",
    level: "07 · 类型",
    description: "ENUM 的定义顺序与比较",
    sql: `SELECT unnest(enum_range(NULL::practice.order_status)) AS status;\n\nSELECT id, status FROM practice.orders\nWHERE status > 'paid'::practice.order_status\nORDER BY status, id LIMIT 20;`,
  },
  {
    title: "试着回滚一次",
    level: "08 · 事务",
    description: "修改、观察，然后 ROLLBACK",
    sql: `BEGIN;\nUPDATE practice.orders SET total = 0 WHERE id = 1;\nSELECT id, total FROM practice.orders WHERE id = 1;\nROLLBACK;\nSELECT id, total FROM practice.orders WHERE id = 1;`,
  },
  {
    title: "触碰约束边界",
    level: "09 · 约束",
    description: "故意触发 CHECK，观察错误",
    sql: `-- 这条语句应失败：金额不能为负。\nINSERT INTO practice.products(name, category, price)\nVALUES ('错误示例', '文具', -1);`,
  },
];

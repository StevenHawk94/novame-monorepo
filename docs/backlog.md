# NovaMe Migration Backlog

> 跨阶段未完成事项总览。每条目标注 **触发条件** + **来源**。  
> 维护规则：每个阶段 completion 报告写完后，本文档同步更新（添加新待办、移除已完成）。

**最后更新**：2026-05-01（1.4 第二轮死代码清理后）  
**当前阶段**：批次 1 末尾（1.4 第二轮死代码清理完成；rewrites 配置 + api-client 即将启动）

---

## 按触发阶段分组

### 🟡 阶段 2.3 触发（mobile 写 src/lib/api.ts 时）

#### packages/api-client
- **来源**：原计划 1.4 第 5 条 deliverable，决策 5 推迟
- **工作内容**：
  - ApiClient 类，构造接受 `{ baseUrl, getToken }`
  - 按 endpoint 分组的方法签名（`apiClient.likeWisdom(id)` 等)
  - 统一错误处理（解决 RealUsersTab 收 404 HTML 报 SyntaxError 类问题）
- **同期可顺带做（不强制）**：
  - admin 13 处活 fetch 收编为 ApiClient 调用（注：1.4 第二轮删了 reports/support-ticket/book-orders 三套死代码后，admin 实际活 fetch 大约 13 处而不是原估的 30+）
- **原计划引用**：行 140 "新建 packages/api-client，统一的 ApiClient 类，注入 baseUrl 和 token getter"
- **风险/约束**：mobile 阶段 2.3 必须就地建立 —— 否则 mobile 会自己写一份 fetch 封装，将来去重难度倍增

---

### 🔴 阶段 5 触发（IAP 原生集成时）

#### packages/core/rules/iap.ts
- **来源**：原计划 1.4 第 2 条 deliverable，决策 5 推迟
- **触发条件**：mobile 用 react-native-iap 写购买流时
- **工作内容**：
  - 从 iap.js（旧 Capacitor 项目里有，新 monorepo 还没迁入）抽 `classifyChange(oldTier, newTier)` —— 升级 / 降级 / 续期判定
  - 抽 `TIER_RANK` `CYCLE_RANK` 常量
  - 抽 product ID ↔ tier/cycle 映射
- **不能现在写的理由**：现在没有 mobile 实际调用作为约束，纯靠想象设计签名必然返工

#### packages/core/rules/entitlement.ts
- **来源**：原计划 1.4 第 4 条 deliverable，决策 5 推迟
- **触发条件**：mobile 用 react-native-iap 写购买流时
- **工作内容**：
  - 从 PRICING_TIERS（已在 core/constants/pricing.ts）派生配额检查函数
  - 例：`canRecord(user, additionalSeconds)` / `getRemainingMonthlyAnalyses(user)` / `hasReachedDailyLimit(user)`
- **不能现在写的理由**：apps/api 当前代码只用 PRICING_TIERS 的价格字段（create-payment / book-payment），没人调用配额检查 —— 形状未知

---

### ⚪ 触发条件未明（可能永远不做）

#### packages/core/rules/card.ts
- **来源**：原计划 1.4 第 3 条 deliverable，决策 5 推迟
- **状态**：1.4 第一轮已完成 KEYWORD lookup 抽取（slugToId / idToSlug），剩余的 enrichCard / buildUserPrompt 等
- **不抽的理由**：剩余函数依赖 server-only AI 调用（Gemini/DeepSeek），mobile 不会调用 —— 抽到 core 没有消费者
- **判断**：等 mobile 真要做本地 card 渲染校验时再决定，否则永远留在 apps/api/lib/generate-card.js

---

## 不归任何阶段的 backlog（cosmetic / 旧 bug / 业务待澄清）

按优先级排序：

#### B1. admin RealUsersTab 慢加载
- **来源**：1.3 阶段旧 bug，1.4 浏览器手测时确认
- **症状**：列表加载特别慢但最终能出来
- **修复时机**：阶段 2.3 建 packages/api-client 时顺便诊断（可能是 fetch 错误处理 / 接口本身慢）
- **不修的理由**：搬迁阶段不重构原则，需要先有统一 api-client 才好诊断

#### B2. admin 11 个 .js route → .ts 转换
- **来源**：1.3 阶段刻意保留
- **位置**：apps/admin/src/app/api/admin/*/route.js（注：reports/route.js 已在 1.4 第二轮删除，现实际剩 10 个 .js route）
- **修复时机**：跟 inline createClient 一起做（见 B3），或 mobile 阶段需要严格类型时
- **不修的理由**：当前 .js + allowJs 工作正常，转 .ts 需要给所有 SQL 查询加返回类型，工作量不小

#### B3. admin 10 处 inline createClient → 抽 supabase 工厂
- **来源**：1.3 阶段刻意保留（搬迁不重构）
- **位置**：apps/admin/src/app/api/admin/*/route.js 每个文件顶部
- **修复时机**：mobile 阶段需要 server-only Supabase client 时建 packages/supabase（原计划在 monorepo 结构图里列了这个包但没作为独立 step）
- **典型代码**：每个 route 都自己写 `createClient(URL, KEY, { auth: {...} })`

#### B4. core / ui-tokens 独立 type-check rootDir 报错
- **来源**：1.4 阶段发现，与 ui-tokens 共享 tsconfig 的同样问题
- **症状**：`tsc -p packages/core` 单独跑会报 rootDir 不匹配
- **影响**：cosmetic 的，消费方（admin / api）的 type-check 完全正常
- **修复时机**：未来给 packages 加独立 CI 验证时一起修
- **修复方式**：core / ui-tokens 各自 tsconfig.json 加 `"rootDir": "./src"` 显式覆盖

#### B5. Wisdom 类型 categories 字段归属确认
- **来源**：1.4 阶段引入 categories 字段时的不确定性
- **状态**：admin wisdoms/page.tsx 用了，但不确定 mobile 是否需要
- **修复时机**：mobile 阶段 3 视图重写到 wisdom 显示时

#### B6. getVideoUrl 是否拆 getVideoPath
- **来源**：1.4 阶段 step 4 占位决策（决策 3 子项）
- **状态**：当前 core/rules/character.ts 的 getVideoUrl 返回相对路径 `/characters/...`
- **修复时机**：mobile 阶段 3 写 VideoCharacter 组件时确认 RN 怎么消费 video URL
- **可能动作**：拆成 getVideoPath（core）+ apps/mobile 自己拼 base URL

#### B7. apps/api/src/app/api/book-orders/route.js 业务关系待澄清
- **来源**：1.4 第二轮死代码清理时发现的业务架构疑问
- **现状**：
  - admin 端的 book-orders/page.tsx 已删（被 OrdersTab 取代）
  - 但 apps/api 的 book-orders route 是**活的用户下单接口**（POST 写 book_orders 表 + 处理 last_book_applied_minutes 进度逻辑）
  - 不确定用户在 mobile 上买实体书/卡片走的是 /api/book-orders 还是 /api/orders 还是 /api/create-payment 等其他 endpoint
- **风险**：如果用户下单走 /api/book-orders 写入 book_orders 表，但 admin OrdersTab 调 /api/orders 读 orders 表 —— 数据流分裂，admin 永远看不到用户下的单（潜在 P0 bug，不是死代码）
- **触发条件**：mobile 阶段 5 接 IAP / 实体书购买流时必须澄清，或者业务上发现 admin 看不到订单时

#### B8. apps/api/src/app/api/support-ticket/route.js 是用户侧活路由
- **类型**：架构事实记录（不是 backlog，是防止误删的标注）
- **现状**：
  - admin 端 SupportTicketsTab 已删（用 email 处理工单）
  - 但 apps/api 的 support-ticket route **必须保留**：用户从 mobile 提交工单 → POST 写 support_tickets 表 + Resend 发邮件到 support@soulsayit.com
  - "用 email 处理"的实现路径就是这条 route 的 Resend 调用
- **不要删除**：删了之后 mobile 用户提交工单的入口消失，email 收件箱也不再收到通知

---

## 已完成（changelog，下个阶段完成报告时移除）

### 1.4 第二轮 — 死代码清理
- ✅ reports 整套删除（commit `98532cd`）
  - apps/admin reports page + admin route + core/types/report.ts
  - OverviewTab Reports NavBtn + pendingReports stat 移除
- ✅ SupportTicketsTab 删除（commit `cd69077`）
  - apps/admin SupportTicketsTab + core/types/support.ts
  - admin/page.tsx 4 处引用（import / TabId / TABS / render）移除
  - apps/api/src/app/api/support-ticket/route.js **保留**（用户侧活路由）
- ✅ book-orders 整套删除（commit `0cc7a00`）
  - apps/admin/book-orders/ 整个目录
  - core/types/order.ts: BookOrder + ShippingInfo
  - apps/api/src/app/api/book-orders/route.js **暂留**（业务关系待澄清，见 B7）

---

## 维护说明

每个阶段 completion 报告写完后，**必须执行三个动作**：

1. **添加**：本阶段产生的、跨阶段未完成的事项 → 加入对应"按触发阶段分组"或"不归任何阶段"
2. **移除**：本阶段触发并完成的事项 → 从"按触发阶段分组"或"不归任何阶段"删除，移到"已完成"段做 changelog
3. **更新**：顶部"最后更新"和"当前阶段"

每次推迟决策做出后（"这个不在本阶段做" / "等阶段 X 触发"），**必须立即更新 backlog.md**，不等阶段完成。不更新 backlog.md = 违反治理协议。

不更新 backlog.md = 下个阶段或新对话启动时会重新踩坑。

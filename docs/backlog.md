# NovaMe Migration Backlog

> 跨阶段未完成事项总览。每条目标注 **触发条件** + **来源**。  
> 维护规则：每个阶段 completion 报告写完后，本文档同步更新（添加新待办、移除已完成）。

**最后更新**：2026-05-01（1.4 完整结束、阶段 2 启动前）  
**当前阶段**:批次 1 已完结（1.4 全部交付完成），即将进入批次 2 / 阶段 2（Expo 应用骨架）

---

## 按触发阶段分组

### 🔴 阶段 5 触发（IAP 原生集成时）

#### packages/core/rules/iap.ts
- **来源**：原计划 1.4 第 2 条 deliverable，决策 5 推迟
- **触发条件**：mobile 用 react-native-iap 写购买流时
- **工作内容**：
  - 从 iap.js（旧 Capacitor 项目里有，新 monorepo 还没迁入）抽 `classifyChange(oldTier, newTier)` —— 升级 / 降级 / 续期判定
  - 抽 `TIER_RANK` `CYCLE_RANK` 常量
  - 抽 product ID ↔ tier/cycle 映射
- **不能现在写的理由**:现在没有 mobile 实际调用作为约束，纯靠想象设计签名必然返工

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

## 不归任何阶段的 backlog（cosmetic / 旧 bug / 业务待澄清 / 配置)

按优先级排序：

#### B1. admin RealUsersTab 慢加载
- **来源**：1.3 阶段旧 bug，1.4 浏览器手测时确认仍存在
- **症状**：列表加载特别慢但最终能出来
- **1.4 第二轮观察**：ApiClient 收编后没改变这个症状（ApiClient 不改 endpoint）—— 慢的根因在 apps/api 的 `/api/admin/users` route 内部 SQL 查询，不在客户端
- **修复时机**：业务影响明显时优化（admin 内部工具，可容忍慢）
- **修复方向**:看 apps/api/src/app/api/admin/users/route.js 的 SQL 查询，可能需要 index 或限制查询范围

#### B2. admin 10 个 .js route → .ts 转换
- **来源**：1.3 阶段刻意保留
- **位置**：apps/admin/src/app/api/admin/*/route.js（reports/route.js 已在 1.4 第二轮删除）
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
- **新成员**：1.4 第二轮新建的 packages/api-client 也是同样模式，同样有此 cosmetic 问题

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

#### B9. Vercel admin 项目 TypeCheck deployment check 失败
- **来源**：1.4 第二轮发现
- **症状**：每次 deployment 的 TypeCheck check（独立于 main build）显示 "The dependency install command failed"，4 秒就失败
- **关键**：**不阻塞 production 部署** —— admin 实际部署是成功的（main build 通过），这只是一个独立 check
- **诊断未完成**：Vercel UI 只显示一行错误，无法展开完整日志，无法定位是 npm/pnpm/turbo 哪一层出错
- **可能根因**:某个 deployment integration 或 GitHub Action 创建的 check
- **修复时机**：阶段 2 启动新对话时优先级看情况，或当部署被强制阻塞时
- **不修的理由**：production 完全正常，影响仅限 Vercel UI 上有红色感叹号

---

## 已完成（changelog，下个阶段完成报告时移除）

### 1.4 第二轮 — 死代码清理（先做）
- ✅ reports 整套删除（commit `98532cd`）
  - apps/admin reports page + admin route + core/types/report.ts
  - OverviewTab Reports NavBtn + pendingReports stat 移除
- ✅ SupportTicketsTab 删除（commit `cd69077`）
  - apps/admin SupportTicketsTab + core/types/support.ts
  - admin/page.tsx 4 处引用（import / TabId / TABS / render）移除
  - apps/api 的 support-ticket route 保留（用户侧活路由，见 B8）
- ✅ book-orders 整套删除（commit `0cc7a00`）
  - apps/admin/book-orders/ 整个目录
  - core/types/order.ts: BookOrder + ShippingInfo
  - apps/api/book-orders route 暂留（业务关系待澄清，见 B7）

### 1.4 第二轮 — 配置 & 基础设施
- ✅ admin next.config.js rewrites（commit `101d0f7`）
  - 3 个 cross-app endpoint（/api/orders, /api/force-update, /api/generate-abc-cards）
  - 通过 NOVAME_API_URL 环境变量代理到 apps/api
- ✅ Turborepo env 声明（commit `838b122`）
  - turbo.json build/dev 任务声明 SUPABASE 三件套 + ADMIN_EMAILS + NOVAME_API_URL
  - 修复 next.config.js rewrites destination 在 build 时拿不到环境变量的问题
- ✅ apps/admin/.env.local.example 文档（commit `101d0f7`）

### 1.4 第二轮 — packages/api-client（主任务）
- ✅ 建立 @novame/api-client 包（commit `ea72228`）
  - ApiClient 类，分层方法（request + get/post/patch/put/delete）
  - ApiError 类，三种失败模式（HTTP / 网络 / 解析失败）统一抛
  - FormData 自动检测，跳过 JSON.stringify
  - getToken 异步注入设计（admin null，mobile 阶段 2.3 注入 Supabase token）
- ✅ admin 38 处 raw fetch 收编到 ApiClient（commit `4446f91`）
  - 10 文件 / 净删 89 行 boilerplate
  - production 浏览器手测全部通过（Posts / Orders / DefaultUsers / Cards / Overview / SeekQuestions / RealUsers / wisdoms / announcements / seek-csv）

---

## 维护说明

每个阶段 completion 报告写完后，**必须执行三个动作**：

1. **添加**：本阶段产生的、跨阶段未完成的事项 → 加入对应"按触发阶段分组"或"不归任何阶段"
2. **移除**：本阶段触发并完成的事项 → 从"按触发阶段分组"或"不归任何阶段"删除，移到"已完成"段做 changelog
3. **更新**：顶部"最后更新"和"当前阶段"

每次推迟决策做出后（"这个不在本阶段做" / "等阶段 X 触发"），**必须立即更新 backlog.md**，不等阶段完成。不更新 backlog.md = 违反治理协议。

不更新 backlog.md = 下个阶段或新对话启动时会重新踩坑。

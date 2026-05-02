# NovaMe Migration Backlog

> 跨阶段未完成事项总览。每条目标注 **触发条件** + **来源**。  
> 维护规则：每个阶段 completion 报告写完后，本文档同步更新（添加新待办、移除已完成）。

**最后更新**：2026-05-01（1.4 第一轮完成时）  
**当前阶段**：批次 1 末尾（1.4 第一轮完成；1.4 第二轮的 api-client 即将启动）

---

## 按触发阶段分组

### 🟡 阶段 2.3 触发（mobile 写 src/lib/api.ts 时）

#### packages/api-client
- **来源**：原计划 1.4 第 5 条 deliverable，决策 5 推迟
- **工作内容**：
  - ApiClient 类，构造接受 `{ baseUrl, getToken }`
  - 按 endpoint 分组的方法签名（`apiClient.likeWisdom(id)` 等）
  - 统一错误处理（解决 RealUsersTab 收 404 HTML 报 SyntaxError 类问题）
- **同期可顺带做（不强制）**：
  - admin 30+ 处 raw fetch 收编为 ApiClient 调用
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

## 不归任何阶段的 backlog（cosmetic / 旧 bug）

按优先级排序：

#### B1. admin RealUsersTab 慢加载
- **来源**：1.3 阶段旧 bug，1.4 浏览器手测时确认
- **症状**：列表加载特别慢但最终能出来
- **修复时机**：阶段 2.3 建 packages/api-client 时顺便诊断（可能是 fetch 错误处理 / 接口本身慢）
- **不修的理由**：搬迁阶段不重构原则，需要先有统一 api-client 才好诊断

#### B2. admin 11 个 .js route → .ts 转换
- **来源**：1.3 阶段刻意保留
- **位置**：apps/admin/src/app/api/admin/*/route.js
- **修复时机**：跟 inline createClient 一起做（见 B3），或 mobile 阶段需要严格类型时
- **不修的理由**：当前 .js + allowJs 工作正常，转 .ts 需要给所有 SQL 查询加返回类型，工作量不小

#### B3. admin 11 处 inline createClient → 抽 supabase 工厂
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

#### B5. apps/admin/src/app/api/admin/reports/route.js 行 123 业务 TODO
- **来源**：1.3 阶段从旧 Visdom 移植时遗留
- **内容**：`// TODO: 实现警告用户功能（可以发送通知或记录警告次数）`
- **修复时机**：业务需求触发（不属于搬迁范畴，是产品功能空白）

#### B6. Wisdom 类型 categories 字段归属确认
- **来源**：1.4 阶段引入 categories 字段时的不确定性
- **状态**：admin wisdoms/page.tsx 用了，但不确定 mobile 是否需要
- **修复时机**：mobile 阶段 3 视图重写到 wisdom 显示时

#### B7. getVideoUrl 是否拆 getVideoPath
- **来源**：1.4 阶段 step 4 占位决策（决策 3 子项）
- **状态**：当前 core/rules/character.ts 的 getVideoUrl 返回相对路径 `/characters/...`
- **修复时机**：mobile 阶段 3 写 VideoCharacter 组件时确认 RN 怎么消费 video URL
- **可能动作**：拆成 getVideoPath（core）+ apps/mobile 自己拼 base URL

---

## 已完成（仅作为 changelog 提醒，下个阶段完成报告时移除）

无（1.4 第一轮是首次维护本文档）

---

## 维护说明

每个阶段 completion 报告写完后，**必须执行三个动作**：

1. **添加**：本阶段产生的、跨阶段未完成的事项 → 加入对应"按触发阶段分组"或"不归任何阶段"
2. **移除**：本阶段触发并完成的事项 → 从本文档删除（在阶段的 completion 报告里有完整记录即可）
3. **更新**：顶部"最后更新"和"当前阶段"

不更新 backlog.md = 下个阶段或新对话启动时会重新踩坑。

# NovaMe 代码库总览

> Journal. Reflect. Evolve. — 日记 / 反思 / 游戏化成长类 App
>
> 本文档由 Claude Code 于 2026-07-21 基于全量代码阅读生成。

---

## 目录

1. [项目概况](#1-项目概况)
2. [Monorepo 结构](#2-monorepo-结构)
3. [apps/mobile — 移动端 App](#3-appsmobile--移动端-app)
4. [apps/api — 后端 API](#4-appsapi--后端-api)
5. [apps/admin — 管理后台](#5-appsadmin--管理后台)
6. [packages — 共享包](#6-packages--共享包)
7. [supabase — 数据库](#7-supabase--数据库)
8. [根目录工具与文档](#8-根目录工具与文档)
9. [全局设计模式](#9-全局设计模式)
10. [已知问题与风险清单](#10-已知问题与风险清单)

---

## 1. 项目概况

NovaMe 是一个「日记 + 反思 + 游戏化成长」移动应用：用户每天写反思（Reflect），系统按 8 个成长维度发放 XP / 宝石 / 物品 / 技能卡，养成宠物伙伴（Companion），并通过 Kit 小活动（New Lens、True North、Quiet Wins、Tame Enemy、Visit Master）、周任务（Quests）、专注冥想（Focus）和轻社交（Friends / Guess / Duo）构成完整闭环。变现方式为 Plus 订阅（Apple IAP / Google Play）+ 实体商品（智慧书/卡，Airwallex 支付）。

- **规模**：约 295 个 TS/JS 源文件、3 万余行 TypeScript
- **技术底座**：pnpm workspace + Turborepo monorepo；Supabase（DB/Auth/Storage）；Vercel（API 部署）；Cloudflare R2（媒体资产 CDN，`media.novameapp.com`）
- **迁移背景**：本仓库替代两个遗留项目 —— `Github/Visdom`（旧 Next.js API+Admin）与 `visdom-capacitor`（旧 Capacitor 移动端）。当前正处于 **v1 → v2 重构**中（Phase A 已删除 v1 的 willpower / 语音录制 / 48 关键词系统，v2 游戏化经济已上线，Phase B/C 待完成）
- **要求环境**：Node 20.x LTS、pnpm 9.x、Xcode 16+ / Android Studio + JDK 17

```bash
pnpm install                        # 安装全部依赖
pnpm --filter @novame/api dev       # API dev server (端口 3001)
pnpm build                          # 全量构建（turbo）
```

---

## 2. Monorepo 结构

```
novame/
├── apps/
│   ├── mobile/     # React Native 0.81 + Expo SDK 54 移动端（~124 文件，最大模块）
│   ├── api/        # Next.js 14 纯 API 后端（51 个端点，Vercel，端口 3001）
│   └── admin/      # Next.js 14 管理后台（端口 3000）
├── packages/
│   ├── domain/     # 零依赖领域常量（维度/提示语/任务/皮肤/场景…）
│   ├── engine/     # 纯函数游戏引擎（XP/等级/宝石/战斗/物品匹配/技能去重）
│   ├── ui-tokens/  # 设计令牌（颜色/字体/间距/阴影/动画/响应式）
│   ├── core/       # v1 遗留共享层（类型/定价/关键词/格式化）
│   ├── api-client/ # 统一 HTTP 客户端（ApiClient + ApiError）
│   └── tsconfig/   # 共享 TS 配置（base/nextjs/node-library/react-native）
├── supabase/
│   ├── migrations/ # v1 基线 + 修补期 + v2 重构（20260715+，22 个文件）
│   └── rollback/   # 前 4 个 v2 迁移的配对 down 脚本
├── tools/          # v1→v2 删除面工程化脚本（依赖图/删除规划/执行器）
├── docs/           # 迁移阶段报告 + backlog 总账（979 行）
└── turbo.json / pnpm-workspace.yaml
```

依赖方向：`mobile / api / admin` → `api-client / core / domain / engine / ui-tokens`。domain 与 engine 是客户端与服务端**逐字共享**的规则单一来源。

---

## 3. apps/mobile — 移动端 App

### 3.1 技术栈

- React Native 0.81.5 + React 19.1 + **Expo SDK 54**（新架构 Hermes，`newArchEnabled: true`）
- **expo-router v6** 文件式路由（typedRoutes）；TypeScript strict
- 认证：Supabase Auth + Apple / Google 原生登录
- 存储：**react-native-mmkv v4**（主力）+ AsyncStorage（仅 Supabase session）
- UI：@gorhom/bottom-sheet、reanimated 4、expo-video（透明 alpha 伙伴视频）、expo-audio（Focus 后台播放）、lottie、Inter 字体
- 变现：expo-iap 4.2.4（StoreKit 2）、expo-web-browser（Airwallex 收银台）
- 配置要点：bundle id `com.novame.app`、scheme `novame`、iOS `UIBackgroundModes: audio`；2 个本地 config plugin（GoogleSignIn modular headers、image-picker 照片权限修复）；metro 做了 pnpm monorepo 适配（watchFolders 根目录 + symlink + package exports）

### 3.2 导航结构

```
app/
├── index.tsx                  # 入口闸门：P0 资产就绪 → session 三路分流
├── _layout.tsx                # 根布局（448 行）：Provider 树、冷启动预热、splash 控制、
│                              #   前后台切换、onAuthStateChange 导航、强更闸门
├── (onboarding)/index.tsx     # intro 3 页 → 选宠物 → 付费墙（单文件状态机）
├── (auth)/
│   ├── sign-in.tsx            # 5 模式状态机（login/register/email-login/verify/forgot）
│   └── signing-in.tsx         # 登录后资产+缓存预热过渡屏
└── (main)/
    ├── (tabs)/                # 5 个自绘 Tab
    │   ├── index.tsx          # Home：场景背景 + 透明伙伴视频 + 气泡台词 + Focus/Reflect 入口
    │   ├── bags.tsx           # Bags：物品收藏网格 + 记忆查看
    │   ├── quests.tsx         # Quests：周任务主题选择 / 7 天计划打卡
    │   ├── friends.tsx        # Friends：emoji 窥视式好友
    │   └── status.tsx         # Status：8 维度宝石 5 阶段成长
    ├── reflect.tsx            # 核心日记流程（pick → write → done）
    ├── focus.tsx              # 正念音频（锁屏后台播放，播完算完成）
    ├── new-lens / quiet-wins / tame-enemy / true-north / visit-master  # 5 个 Kit
    ├── quest-pick.tsx         # 从 ~20 候选任务选 7 个开计划
    ├── my-logs / reflect-detail    # 反思流水与详情
    ├── friend-detail / guess / guesses  # 好友详情 / 猜 TA 的一天 / 收件箱
    ├── ai-consent.tsx         # AI 同意闸（首次触达 AI 功能前）
    └── (modals)/              # me 设置中心、账户管理、通知、支持工单、订阅付费墙、
                               # 排行榜、皮肤/场景商店、技能卡列表、实体商品支付链路
```

### 3.3 功能模块与核心文件

| 模块 | 作用 | 核心文件 |
|---|---|---|
| Reflect | 每日 ≤3 次反思；服务端算 xp/宝石/物品/技能返回完整快照 | `reflect.tsx`、`src/lib/reflect-api.ts` |
| Kits ×5 | CompanionSheet 列出：New Lens（每日翻卡换视角）、True North（每周维度排序）、Quiet Wins（每日小胜勾选）、Tame Enemy(用技能卡驯服怪物)、Visit Master（付费智者问答，48h 冷却） | `components/main/companion-sheet.tsx` + 各 screen/`*-api.ts` |
| Companion | pet1-3 伙伴，等级由 engine `levelFromXp` 派生；透明 .mov 循环视频 | `companion-api.ts`、`companion-video.tsx` |
| Quests | 主题化 7 天计划，每天勾 1 项赚 clovers，全完成有 bonus | `quests.tsx`、`quest-pick.tsx`、`quests-api.ts` |
| Bags/物品 | 反思匹配物品，服务端只回 id/count，展示信息由 engine 词典本地解出 | `bags-api.ts`、`item-sheet.tsx` |
| Clovers 经济 | 化妆品货币（余额 = xp − clovers_spent），皮肤/场景统一 500 | `cosmetics-api.ts`、`skin-select.tsx`、`scene-select.tsx` |
| Friends/Guess/Duo | 只显示好友今日物品 emoji（永不显示反思文字）；单向私密猜测+模板回应；Duo 席位分享 | `friends-api.ts`、`guess-api.ts`、`duo-api.ts` |
| 订阅 IAP | 全局唯一 purchase listener 在根布局注册，购买经 `/api/apple-iap` 服务端验证 | `iap.ts`、`subscription.ts`、`subscription-paywall.tsx` |
| 实体商品 | 订单 → Airwallex intent → 托管收银台 → `novame://` 深链返回 | `airwallex-api.ts`、`orders-api.ts` |
| 资产系统 | R2 manifest + 分级下载队列：P0 阻塞入口 → P1 后台并发 3 → P2 按需 | `asset-cache.ts`、`download-queue.ts` |
| 运营 | 公告、强制更新（fail-open）、评分请求、AI 同意闸 | `announcements-api.ts`、`force-update.ts` 等 |

### 3.4 状态管理与存储（重点设计）

**无 Redux/Zustand/React Query**，三种手段组合：

1. **Cache-first 单例模式**：每个数据域一个 `src/lib/*-api.ts`，暴露 `getCachedX()`（同步读 MMKV 立即渲染）+ `fetchX()`（后台刷新写回）；屏幕在 `useFocusEffect` 中先读缓存再覆盖
2. **模块级事件总线**（Set-of-callbacks）：`home-refresh-signal.ts`、`skin-unlock-store.ts` 等，注释中逐处论证「为什么不用 Context/Zustand」
3. **`modal-coordinator.ts`**：全局启动弹窗串行仲裁（announcement > claim > skin，settle 防抖）

**MMKV key 作用域注册表**（`src/shared/storage/`，全库最精心的基础设施）：

- `mmkv.ts` 是全仓唯一允许 import `react-native-mmkv` 的文件（ESLint 强制）
- `registry.ts` 的 `defineKey(name, scope)`：scope ∈ `user`（登出清除）/ `device`（跨账号保留）/ `preauth`（onboarding 草稿），支持 `onClear` 副作用钩子
- `keys.ts` 集中声明全部 31 个 key；dev 模式遇未注册 key 直接报错
- 起因：P0-1 事故（换账号后 14 个用户级 key 泄漏给下一个用户）

**服务器权威原则**：所有限次（每日 3 反思、Kit 每期一次）的本地 flag 只是「服务器裁决的只读影子」；派生值（等级/阶段）由共享 engine 纯函数重算，绝不本地累加。

### 3.5 外观系统

- **App 主题**：`src/theme/` 消费 ui-tokens 的 day/night 主题；但 Home/Bags/Quests 等新版屏幕大量使用硬编码暖色插画调色板
- **Kit 视觉**：每个 Kit 页有专属浅暖色调色板 + SVG `WaveBackground`（按 kit 分配色系）
- **皮肤**：每宠 6 款（skin1 免费，其余 500 clovers，5/6 号 Plus 专属）
- **场景**：6 个 Home 场景，day/night 双图按本地时间（6–18 点）切换；scene5/6 Plus 专属；目前仅 scene1 美术已打包

---

## 4. apps/api — 后端 API

### 4.1 技术栈

- Next.js 14.2（App Router，纯 API），路由几乎全为 `route.js`，部署 Vercel（`output: 'standalone'`）
- 默认 **Edge runtime**，仅需 Node crypto 的路由（apple-iap、webhooks/apple、master/ask、cosmetics/purchase）用 nodejs
- `middleware.ts`：仅做 CORS（OPTIONS 204 + 响应头；允许列表含 `*`，不带 credentials）
- 认证：Supabase JWT，用 `jose` + JWKS **本地验签**（ES256，显式算法防混淆攻击），免去每请求一次网络往返（权衡：token 撤销盲区 ≤1h，注释中为知情决策）
- 数据库全部走 `SUPABASE_SERVICE_ROLE_KEY`（绕过 RLS），授权完全依赖路由层手动校验 `token.sub === userId`

### 4.2 共享库（src/lib）

| 文件 | 作用 |
|---|---|
| `auth-guard.ts` | JWKS 本地 JWT 验签 |
| `ai.js` | AI 调用层：Gemini 2.5 Flash 主 → DeepSeek V3.2 后备；system_instruction 分离命中隐式缓存；安全过滤 BLOCK_NONE（避免日记情绪内容被拦）；`parseAIJson` 容错解析 |
| `quota.js` | 配额窗口单一事实来源：free = 终身配额（自注册起不重置）；付费 = 按账单周期（续费重置）；防降级刷配额 |

### 4.3 API 端点清单（51 个）

**账户与资料**

| 路径 | 方法 | 功能 |
|---|---|---|
| `/api/user-sync` | GET / POST | 拉取用户全量数据 / 保存 profile（从 token 取 ID 防越权） |
| `/api/update-profile` | POST | 昵称/头像/生日/aspire 词；经 Admin API 改邮箱密码 |
| `/api/upload-avatar` | POST | 头像上传：8MB 校验 → Google Vision SafeSearch → Storage |
| `/api/delete-account` | POST | 级联删除全部数据（App Store 合规） |
| `/api/onboarding-complete` | POST | 幂等 RPC 创建所选宠物 + 盖章 profile |
| `/api/ai-consent` | GET / POST | AI 处理同意时间戳 |
| `/api/auth/apple-callback` | POST / GET | Android 端 Apple 登录 → 深链带 token 回 App |

**核心玩法**

| 路径 | 方法 | 功能 |
|---|---|---|
| `/api/reflect` | POST | 提交反思：engine 算 XP(+30)/宝石，付费+已同意用户加 AI 维度分析，`submit_reflect` RPC 原子写入（日限 3 次），再做物品匹配与 AI 技能卡（best-effort） |
| `/api/reflect-feed` | GET | 私有反思流（按天分组 ~30 天） |
| `/api/status` | GET | 8 维度宝石总数 |
| `/api/me-stats` | GET | Me 页统计单次聚合（含配额） |
| `/api/skills` | GET | 技能卡（self / friend 来源） |
| `/api/bags` | GET | 物品与记忆片段 |
| `/api/leaderboard` | GET | 排行榜（种子+真实用户合并；**公开无鉴权**） |

**Kit（均走 `submit_kit`/`submit_lens` RPC 按期一次门控）**

| 路径 | 方法 | 功能 |
|---|---|---|
| `/api/focus` | POST | 专注会话 +30 XP/日 1 次，推进场景游标 |
| `/api/kit/quiet-wins` | POST | 打卡 +20 XP/日 1 次 |
| `/api/kit/true-north` | POST | 每周维度排序 +50 XP + 前三宝石(50/30/10) |
| `/api/kit/true-north/status` | GET | 本周状态 + 最近两次排序 |
| `/api/lens/next` | GET | 按游标取下一张 Lens 卡（循环） |
| `/api/lens/complete` | POST | 完成当日 Lens：+20 XP、推进游标 |
| `/api/tame-enemy` | POST / GET(status) | 驯服怪物 +20 XP/日 1 次；status 返回 8 怪 + 技能数 |

**Quests / 伙伴 / 外观**

| 路径 | 方法 | 功能 |
|---|---|---|
| `/api/quests/status` · `start` · `check` | GET / POST | 7 天计划状态 / 开启（仅一个活跃）/ 每日勾 1 项发 clovers |
| `/api/quests/custom` | POST | Plus 专属：AI 生成 ~10 条候选任务 |
| `/api/companion` | GET | 伙伴状态（xp/皮肤/名字） |
| `/api/cosmetics/unlocks` · `purchase` | GET / POST | clovers 余额与解锁 / 500 clovers 购买（服务端校验） |

**社交**

| 路径 | 方法 | 功能 |
|---|---|---|
| `/api/friends/status` · `add` · `respond` | GET / POST | 邀请码好友体系（`user_a<user_b` 规范化） |
| `/api/guess` | POST | 猜好友的一天：submit / reply（模板）/ inbox |
| `/api/master/status` · `ask` · `visit` | GET / POST | Visit Master：付费墙 + 48h 冷却 + AI 结构化解答 |

**订阅与支付**

| 路径 | 方法 | 功能 |
|---|---|---|
| `/api/apple-iap` | POST | StoreKit 2 JWS 验签 + bundleId 校验 → 激活订阅；duo 生成邀请码 |
| `/api/subscriptions` | GET | 订阅信息 + 账单历史 |
| `/api/duo/status` · `join` | GET / POST | Duo 座位状态 / 一次性码领取（不可逆） |
| `/api/book-payment` | POST | Airwallex PaymentIntent（服务端从 app_config 读权威价格） |
| `/api/payment-checkout` · `payment-result` | GET | 公开 HTML 桥接页（防开放重定向）/ 深链回 App |
| `/api/orders` | POST/GET/PATCH | 订单双模式：admin 管理全部 / 用户仅自己，非 admin 强制 `pending_payment` |
| `/api/dev/set-tier` | POST | ⚠️ 测试后门：自改 tier，注释明言待删 |

**Webhooks（服务器对服务器）**

| 路径 | 验证方式 | 功能 |
|---|---|---|
| `/api/webhooks/apple` | JWS 证书链（含 Apple Root CA 指纹） | App Store Server Notifications v2 → 订阅激活/过期/退款 |
| `/api/webhooks/google` | 回查 Play subscriptionsv2 API | Google Play RTDN → 权益激活/吊销 |
| `/api/webhooks/airwallex` | HMAC-SHA256（fail-closed） | 支付成功 → 幂等标记订单 paid |

**运营**

| 路径 | 方法 | 功能 |
|---|---|---|
| `/api/app-config` | GET | 公开动态配置（价格/解锁阈值） |
| `/api/announcements` | GET / POST | 未读公告（按 tier 过滤）/ 标记已读 |
| `/api/force-update` | GET / POST / DELETE | 强更检查（公开）/ 管理（ADMIN_USER_IDS） |
| `/api/support-ticket` | POST / GET / PATCH | 工单提交（Resend 邮件通知）；⚠️ GET/PATCH 无鉴权 |

### 4.4 外部服务依赖

| 服务 | 用途 | 关键环境变量 |
|---|---|---|
| Supabase | DB / Auth / Storage / RPC | `NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` |
| Google Gemini | 主 AI（维度分析/技能卡/Master/任务生成） | `GEMINI_API_KEY` |
| DeepSeek | AI 后备 | `DEEPSEEK_API_KEY` |
| Apple App Store | IAP 验签 + Server Notifications v2 | `WEBHOOK_VERIFY_DISABLED`（应急开关） |
| Google Play | RTDN + subscriptionsv2 | `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY` |
| Airwallex | 实体商品支付 | `AIRWALLEX_CLIENT_ID/API_KEY/ENV/WEBHOOK_SECRET` |
| Google Cloud Vision | 头像 SafeSearch | `GOOGLE_CLOUD_VISION_API_KEY` |
| Resend | 工单邮件 | `RESEND_API_KEY` |

---

## 5. apps/admin — 管理后台

### 5.1 技术栈

Next.js 14.2 + React 18.3 + Tailwind 3.4；Supabase Cookie 会话（`@supabase/ssr`）；Cloudflare R2（S3 兼容 SDK）；端口 3000。`next.config.js` 将 `/api/orders`、`/api/force-update`、`/api/generate-abc-cards` **反向代理**到 apps/api（`NOVAME_API_URL`）。

### 5.2 认证：邮箱 OTP + 白名单，三层 fail-closed 防御

1. **middleware.ts**：会话刷新（`getUser()` 真验签而非解码 cookie），`/admin/*` 要求登录且命中 `ADMIN_EMAILS` 白名单
2. **admin/layout.tsx**：SSR 二次白名单校验
3. **requireAdmin()**：每个 `/api/admin/*` handler 内显式校验（401 `no_session` / 403 `not_in_whitelist`）

登录用 `signInWithOtp`（`shouldCreateUser: false` 禁止注册）→ `verifyOtp`；四种 Supabase 客户端形态（browser/server/middleware 用 anon key，admin 路由用 service-role）。

### 5.3 页面

**`/admin` 主控制台**（单页 Tab 架构，9 个 Tab）：Overview（统计+强更管理）、Posts（wisdoms 审阅/删除）、Cards（默认卡片管理）、Default Users（排行榜种子用户）、Real Users（真实用户+CSV 导出）、Orders（订单，代理到 api）、Pricing（5 个动态价格配置）、Assets（6 张产品图上传 R2）、Seek Questions（问答管理+用户提交审批）。

**独立路由**：`/admin/login`（OTP 登录）、`/admin/wisdoms`、`/admin/announcements`（公告管理）、`/admin/seek-csv`（CSV 批量导入）、`/admin/report-list`（举报审核）、`/admin/block-list`（屏蔽聚合）。

### 5.4 管理 API（均 `requireAdmin()` + service-role，Edge runtime）

| 路径 | 方法 | 功能 |
|---|---|---|
| `/api/admin/stats` | GET | 仪表盘统计（支持 period 筛选） |
| `/api/admin/users` | GET | 全部用户 + 内容计数（缺 email 时 N+1 回填） |
| `/api/admin/default-users` · `upload-default-avatar` | GET/POST/DELETE | 排行榜种子用户与头像 |
| `/api/admin/wisdoms` · `export-wisdoms` | GET/POST/DELETE | wisdom 管理（级联清理）；CSV/TXT/JSON 导出（上限 5000） |
| `/api/admin/questions` · `seek-questions` | GET/POST/DELETE | 旧版问题 / Seek 问答全生命周期（8 种 action 分发） |
| `/api/admin/default-cards` · `real-cards` | GET/POST/DELETE | 默认卡片 / 真实用户卡片 |
| `/api/admin/wisdom-card-reports` · `wisdom-card-blocks` | GET/DELETE/PATCH | 举报审核（删卡留审计）/ 屏蔽聚合 |
| `/api/admin/announcements` | GET/POST/PATCH/DELETE | 公告管理 |
| `/api/admin/app-config` | GET/POST | 5 个动态配置（记录修改人） |
| `/api/admin/product-assets` | GET/POST | R2 产品图（webp ≤500KB，Node runtime） |

---

## 6. packages — 共享包

### 6.1 @novame/domain — 零依赖领域常量（v2 核心）

mobile 与 api 共享的单一事实来源，所有文件带决策编号注释（C5/C8/C12/D3…）：

| 文件 | 内容 |
|---|---|
| `dimensions.ts` | **8 个成长维度**：expression 表达力 / awareness 自省力 / momentum 行动力 / direction 方向感 / steadiness 稳定力 / confidence 自信力 / gratitude 知足力 / connection 关系力（id 即 Postgres 枚举/路由参数） |
| `prompts.ts` | 9 条 Reflect 引导语（8 条对应维度 + 1 条自由书写） |
| `quests.ts` | 9 个周任务主题 × 每主题 ~20 条候选；`CLOVERS_PER_TASK=5`、`COMPLETION_BONUS=120`、`PLAN_DAYS=7` |
| `skins.ts` | 皮肤解锁门槛：默认 + XP 档 400/1300/3000/5600（= 引擎 L4/8/14/20）+ 订阅赠送 |
| `lens-themes.ts` | New Lens 8 主题胶囊；`NEW_LENS_PROMPT` 隐藏引导语 |
| `true-north.ts` | 每维度身份短语；`trueNorthGemHits()` 产出前三宝石 |
| `quiet-wins.ts` | 16 条预置小胜利（每维度 2 条）+ 4 层反馈 |
| `focus-scenes.ts` | 8 个 Focus 场景（前 3 免费）；音频在 R2 |
| `home-scenes.ts` | 6 个 Home 场景（前 2 免费，昼/夜成对） |
| `bubble-lines.ts` / `guess-replies.ts` / `locales.ts` | 气泡台词轮播 / Guess 10 条回复模板 / 48 国收货地址 |

### 6.2 @novame/engine — 纯函数游戏引擎

客户端与服务端**逐字共享**，杜绝 v1 时代两套公式漂移：

- **xp.ts**：XP 规则表 —— focus 30/日1、reflect 30/日3、quietWins 20/日1、newLens 20/日1、tameEnemy 20/日1、trueNorth 50/周1；超上限归零；XP 只增不减
- **level.ts**：等级 = XP 纯函数（无 level 列），曲线 `100+20*(lv-1)`，封顶 99；皮肤门槛恰落整级，测试断言防错位
- **gems.ts**：每维度 +10；正文 <20 字不给（防刷）；免费档只记 prompt 维度，付费 AI 分析至多 3 维度（「付费买宽度不买单价」）；画像 5 阶段边界 `[600,2000,4500,9000]`
- **battle.ts + monsters.ts**：怪物 60 HP；伤害 default 10 / learned 20 / hidden 50；8 只怪一一对应维度（The Swallower、Overthinking、Procrastination、The Fog、The Spiral、The Hollow、The Comparer、The Wall）；文案避免「击败/摧毁」用语
- **skills/skill-dedup.ts**：关键词 Jaccard 相似度去重（阈值 0.35；上线前拟升级 pgvector）
- **items/item-matcher.ts + dictionary.json**：物品匹配 —— tokenize（归一化弯引号）→ 词典查表 → 否定守卫（noun 前 3 token 检 didn't/no/without…）→ 去重 → 最多 5 个按稀有度排序；词典当前 15 items 样本（正式版 480 items 直接换 JSON）

### 6.3 @novame/ui-tokens — 设计令牌

colors（night 主题为唯一活跃主题，深紫夜色；day 保留）、typography（iOS SF / Android Inter，xs 10 ~ 5xl 40）、spacing（4px 网格 + radius + layout + zIndex）、shadows（web 字符串 + RN 对象双导出）、animations（reanimated spring 预设）、responsive（375pt 基准缩放）、textStyle（Dynamic Type 11 角色）、theme（`makeTheme()` 聚合）。

### 6.4 其他包

- **@novame/core**（v1 遗留）：手写领域类型（Wisdom/Card/Order/Announcement/Seek）、48 关键词表、v2 定价（Plus $6.99/mo $49.99/yr；Duo $9.99/$79.99）、录音限制、aspire 词池
- **@novame/api-client**：`ApiClient`（baseUrl + 异步 getToken 注入 Bearer；FormData/JSON 双分支）+ `ApiError` 判别（http/network + isClientError 等）
- **@novame/tsconfig**：base / nextjs / node-library / react-native 四个 preset

### 6.5 测试

仅 domain（2 个文件）与 engine（6 个文件，vitest）有测试：xp/level/gems/battle/item-matcher/skill-dedup 全覆盖，含皮肤门槛-等级曲线对齐断言。ui-tokens/core/api-client 无测试。

---

## 7. supabase — 数据库

### 7.1 三个时代

1. **v1 基线**（`20260525062428_remote_schema.sql`，3274 行 dump）
2. **v1 修补期**（202605–202606）：订阅 plan CHECK 修复、**安全加固**（删客户端 UPDATE 策略防自助升级、storage owner-only 防音频枚举）、强更语义化、一次性邮箱域黑名单（6834 行 seed + Auth Hook）、发布配额 advisory lock 修 TOCTOU
3. **v2 重构**（`20260715+`，22 个文件）：全新游戏化经济，严格 additive 不动 v1 表

### 7.2 v1 主要表

profiles / subscriptions、wisdoms / wisdom_cards / card_keywords / card_saves / wisdom_comments（语音日记+卡片）、seek_questions / seek_question_cards（问答社区）、likes / listens / leaderboard_seeds、character_data / user_characters / daily_tasks（v1 养成，被 v2 取代）、orders / book_orders、reports / wisdom_blocks / wisdom_card_reports / blocked_users、app_announcements / app_config / force_updates / support_tickets 等。

### 7.3 v2 设计纲领

1. **枚举化**：10 个 Postgres 枚举（dimension_t、companion_t、skill_rarity、xp_source、kit_t…）
2. **账本而非计数器**：`xp_events` / `gem_events` 是事实，`companions.xp` 由账本 sum 重算自纠偏
3. **所有写入走 SECURITY DEFINER RPC**（service_role only，revoke anon/authenticated）——「让客户端直写 xp 就是让客户端印钞」
4. **`pg_advisory_xact_lock(hash(user_id))`** 串行化每用户并发
5. **引擎算数字，RPC 只做事务写入**，规则只有一份（TS engine）

### 7.4 v2 表

| 表 | 用途 |
|---|---|
| companions / companion_skins | 伙伴（xp、皮肤、阶段）；profiles 加 friend_code、active_scene_id 等 5 列 |
| xp_events | XP 账本；`(user,source,ref_id)` 部分唯一索引防重放 |
| gem_events / user_gems | 宝石账本 + 每维度汇总 |
| reflects | 反思正文（≤5000 字）、prompt_id、dimension_hits、source_kit |
| kit_completions | `unique(user,kit,period_key)` 行存在即「本期已完成」 |
| lens_cards / lens_progress | Lens 知识卡（动态内容，seed 16 张）+ 用户游标 |
| items / user_items / item_memories | 物品目录 / 收集计数 / 记忆摘录 |
| skills | 技能卡（pgvector 列刻意推迟） |
| focus_sessions / user_focus_progress | Focus 会话 + 场景轮播游标 |
| friendships / guesses | 好友（`user_a<user_b` 单行规范化）+ 猜一天 |
| duo_memberships | Duo 座位（一次性码，随 owner 订阅周期失效） |
| master_visits | Visit Master 问答（48h 冷却由最新 created_at 推导） |
| cosmetic_unlocks | clovers 购买记录；companions 加 clovers_spent |
| quest_plans | 7 天计划（tasks jsonb、一日一勾、部分唯一索引保证单活跃计划） |

### 7.5 v2 RPC

`submit_reflect`（日限 3 次 + 三账本原子写 + 返回快照）、`complete_onboarding`（幂等）、`submit_kit`（period 唯一行即门控）、`next_lens_card` / `submit_lens`（游标）、`record_item_matches`（物品失败不拖垮 reflect 本体）、`record_skill`。

`rollback/` 仅前 4 个 v2 迁移有配对 down 脚本（早期空表阶段可安全回退）。

---

## 8. 根目录工具与文档

- **turbo.json**：build/dev 显式声明 env（Turborepo 默认隔离环境变量曾导致 Vercel rewrites 404）
- **tools/**（v1→v2 删除面工程化）：`depgraph.py`（构建已解析 import 图）、`plan-delete.py`（逆拓扑删除规划 + expo-router 字符串路由扫描）、`exec-phase-a.py`（Phase A 一次性执行器）、`v2-classification.txt`（147 个文件的 DELETE/REWRITE/KEEP 台账）
- **docs/**：`1.4-completion.md` / `1.4-round-2-completion.md`（迁移阶段报告，记录 7 个架构决策与 3 个坑）、`backlog.md`（979 行跨阶段待办总账，每条注明来源/触发条件）

---

## 9. 全局设计模式

1. **服务器权威 + 原子 RPC + 共享引擎**：所有数值由服务端裁决、RPC 锁内原子写入、客户端与服务端跑同一套 engine 纯函数派生展示值 —— 三件套合起来保证「规则只有一份、数值零漂移」
2. **Cache-first + 只读影子**：客户端首帧永远从 MMKV 同步渲染，服务器快照覆盖；本地从不累加计数
3. **MMKV key 作用域注册表**：把「登出忘清 key」变成启动期硬约束
4. **决策日志式注释**：全库注释普遍带决策编号（C5/D3/Module 6 #6/Stage 3.10.4），记录被否决方案与历史 bug 根因，可追溯性极好
5. **fail-open / fail-closed 分级**：强更闸门、公告、评分 fail-open（不阻塞主流程）；鉴权、webhook 验签 fail-closed
6. **单文件多阶段状态机**：流程屏幕用 `Phase` 联合类型而非多路由，避免导航历史污染
7. **支付安全**：IAP 强制 JWS 验签、服务端定价、订单强制 pending_payment、webhook 全幂等

---

## 10. 已知问题与风险清单

### 高优先级（安全）

| # | 位置 | 问题 |
|---|---|---|
| 1 | `apps/api .../support-ticket/route.js` | **GET/PATCH 完全无鉴权** —— 任何人可读全部工单（含用户邮箱）并篡改状态 |
| 2 | `apps/api .../dev/set-tier/route.js` | 付费墙测试后门仍在：任何登录用户可自改 tier（注释承认待删） |
| 3 | apps/api CORS | `ALLOWED_ORIGINS` 含 `*`，白名单形同虚设 |
| 4 | apps/api webhooks/apple | 验签失败返回 200 静默丢弃；`WEBHOOK_VERIFY_DISABLED` 若误留开启解除整条防线 |

### 中优先级（质量/一致性）

| # | 位置 | 问题 |
|---|---|---|
| 5 | apps/api（~40 个路由） | Bearer 鉴权样板复制粘贴未抽 wrapper，是 #1 类遗漏的温床；`isoWeek()` 重复 6+ 处 |
| 6 | apps/admin `wisdom-card-reports` | `auth.adminId` 字段不存在（requireAdmin 返回 `{user,error}`），`reviewed_by` 恒为 `'admin'`，丢失审核人身份 |
| 7 | admin 搜索端点 | 用户输入直接拼进 PostgREST `.or(ilike...)`，特殊字符可破坏过滤表达式 |
| 8 | domain vs DB | `DEFAULT_SCENE_ID='scene1'` 与 DB 默认 `'scene_01'` 命名不一致 |
| 9 | apps/api `user-sync` | 硬编码 Supabase 项目 URL（默认头像列表），环境迁移会失效 |
| 10 | apps/api package.json | 未使用依赖：`@aws-sdk/client-s3`、`google-auth-library`、`date-fns`、`uuid`；两代 tier 体系（basic/pro/ultra vs free/plus）并存 |
| 11 | apps/admin | 主控台单页 Tab 刷新丢状态；界面语言中英混杂；多步写操作（CSV 导入、config upsert）无原子性 |
| 12 | apps/admin `/api/admin/users` | 缺 email 用户逐个调 Admin API 回填（N+1） |

### 低优先级 / 已知待办

- 皮肤/场景美术大部分未打包（pet2/3、scene2-6 占位）；Quests 的 Custom/Write-own 显示 coming soon
- 技能去重为测试期方案（Jaccard 0.35），上线前升级 pgvector；物品词典为 15 条样本（正式 480 条）
- `backlog.md` 有完整的跨阶段待办台账（B55 AI 降级链告警、B56 MMKV v4 dev build 持久化、B57 测试期阈值恢复等）
- 遗留命名：R2 manifest 仍叫 `video-manifest.json`；admin 表单默认 creator 仍是旧名「Visdom Team」

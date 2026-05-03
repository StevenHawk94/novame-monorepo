# NovaMe Migration Backlog

> 跨阶段未完成事项总览。每条目标注 **触发条件** + **来源**。  
> 维护规则：每个阶段 completion 报告写完后，本文档同步更新（添加新待办、移除已完成）。

**最后更新**:2026-05-03(阶段 3.3 完成、video CDN 基础设施 + R2 manifest)  
**当前阶段**:批次 3 / 阶段 3.3 已完成(R2 setup + manifest 上传 + asset-cache.ts + 52 张冗余 cards 删除),待进 3.4(auth flow: Apple/Google/Email)

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


#### B10. admin next.config.js transpilePackages 只列了 @novame/core
- **来源**:阶段 2 启动前事实核对时发现
- **现状**:
  - apps/admin/next.config.js 的 transpilePackages 数组只列了 `@novame/core`
  - 但 packages/ui-tokens 和 packages/api-client 同样是 source-only export 模式(main 指向 src/index.ts)，按理也应该列入
  - admin production 全功能正常运行 —— 推测 Next.js 14 对 workspace package 的 source-only export 有自动检测机制，或被 Next 自带 SWC 编译路径覆盖
- **风险**:升级 Next.js 主版本 / 改 export 方式 / 增加新 package 时可能突然炸
- **不修的理由**:搬迁不重构原则；production 正常；阶段 2 不能动 admin 配置
- **修复时机**:升级 Next.js 主版本时一起重新评估，或新增 package 触发 import 失败时

#### B11. NativeWind v5 仍是 preview tag(阶段 2 引入)
- **来源**:阶段 2 决策 1 选择 SDK 54 + NativeWind v5 preview
- **现状**:
  - `nativewind@preview` 是 npm preview tag，不是 stable
  - NativeWind 维护者明确表态今后不再绑定 Expo SDK 版本，意味着 v5 stable 发布的时机不确定
  - `npx rn-new@next --nativewind` 模板锚定的就是这个组合(生态对齐)
- **风险**:preview 阶段可能有未发现的边界 case bug
- **触发条件**:NativeWind v5 stable 发布后，立刻把 mobile 的 nativewind 依赖从 `@preview` 切到 stable tag(或精确 pin 版本号)
- **跟踪方式**:定期看 nativewind.dev 或 nativewind GitHub releases 页面


#### B12. fontFamily 完整迁移 + expo-font 加载
- **来源**:阶段 2.1 启动前事实核对发现
- **现状**:
  - 旧 Capacitor tailwind.config 用了 4 个字体:Inter / Press Start 2P / Outfit / Plus Jakarta Sans
  - Tailwind Web 有浏览器 fallback,RN 没有 —— 必须精确字体名 + expo-font 加载
  - 阶段 2.1 mobile 用 RN 系统字体(iOS SF Pro / Android Roboto)跑通骨架,fontFamily 暂不搬
- **触发条件**:阶段 3 UI 重写时
- **工作内容**:
  - 收集 4 个字体的 .ttf 文件(从 Google Fonts 下载)
  - 用 expo-font 在 root layout 加载
  - mobile 的 tailwind.config 用精确字体名(Inter-Regular / Inter-Bold 等)
  - 失败 fallback 策略

#### B13. tailwind theme 整合到 packages/ui-tokens
- **来源**:阶段 2.1 启动前隐藏决策点
- **现状**:阶段 2.1 mobile 的 colors / borderRadius / animation 直接搬到 apps/mobile/tailwind.config.js,不进 packages/ui-tokens
- **理由**:搬迁阶段不引入新结构变化;阶段 3 UI 重写时再决定要不要把 theme 集中进 ui-tokens 让 admin 也受益
- **触发条件**:阶段 3 UI 重写时

#### B14. SplashScreen 显示时机机制 + 行为决策
- **来源**:阶段 2.1 SplashScreen 字段映射时发现 Expo 与 Capacitor 哲学差异
- **现状**:
  - 旧 Capacitor splash 强制显示 2000ms + 300ms fade out
  - Expo 默认 "app ready 就 hide",但 expo-splash-screen 提供 preventAutoHideAsync + 手动 hideAsync 完全可控
  - 阶段 2.1 不配 prevent,跟 Expo 默认走
- **触发条件**:
  - 机制配置层面 → 阶段 2.3 装配 _layout.tsx 时(决定要不要在 root 加 preventAutoHideAsync + 自定义 hide 时机)
  - 行为决策层面 → 阶段 3 UI 重写时(到底要不要保留 2s 行为)

#### B15. 阶段 5 mobile Google OAuth client ID 复用
- **来源**:阶段 2.1 iOS Info.plist 扫描发现
- **事实**:旧项目 iOS Info.plist 里有完整的 Google OAuth 配置(reverse client ID + GIDClientID),阶段 5 mobile 必须复用同一个 client ID,不能重新申请新的
- **不复用的后果**:旧用户认证链路断,Google Cloud Console 认证记录混乱
- **具体值在哪**:旧项目 /Users/nihao/Desktop/visdom-capacitor/ios/App/App/Info.plist 里 CFBundleURLSchemes 和 GIDClientID 字段
- **触发条件**:阶段 5 Google Sign-In 集成时

#### B16. 旧项目 iPhone iOS 允许横屏(可能是默认值,需产品确认)
- **来源**:阶段 2.1 iOS Info.plist 扫描发现
- **事实**:旧 iOS Info.plist 列了 Portrait + LandscapeLeft + LandscapeRight(iPhone),但 web 模拟壳固定 390×844,UI 在横屏不可能好看
- **决策**:阶段 2.1 mobile 锁 portrait(orientation: 'portrait'),把"是否允许横屏"作为产品决策列到 backlog
- **触发条件**:阶段 3 UI 重写时,或产品 PM 提出明确要求时

#### B17. 阶段 5 触发: iOS App.entitlements 搬迁
- **来源**:阶段 2.1 iOS 目录扫描发现
- **现状**:旧项目 ios/App/App/App.entitlements 存在,可能含 Apple Sign-In / Push Notifications capability
- **触发条件**:阶段 5 原生集成 Apple Sign-In / 推送通知时
- **工作内容**:看具体 entitlements 内容,转换成 expo app.json ios.entitlements 字段或 expo-build-properties config plugin

#### B18. 阶段 5/6 触发: Products.storekit 搬迁(IAP 本地测试)
- **来源**:阶段 2.1 iOS 目录扫描发现
- **现状**:旧项目 ios/App/App/Products.storekit 是 Apple StoreKit 本地测试配置文件
- **触发条件**:阶段 5 IAP 集成时(本地测试 IAP 流程不连 sandbox)或阶段 6 真机测试时

#### B19. 阶段 5 触发: GoogleService-Info.plist 处理
- **来源**:阶段 2.1 iOS 目录扫描发现
- **现状**:旧项目 ios/App/App/GoogleService-Info.plist 存在
- **不确定**:是 Firebase 配置还是单纯 Google Sign-In 配置 —— 阶段 5 时打开看决定
- **触发条件**:阶段 5 Google Sign-In 集成时

#### B20. 阶段 5 触发: iOS 原生 IAP plugin 业务逻辑参考
- **来源**:阶段 2.1 iOS 目录扫描发现
- **现状**:旧项目自己写了 iOS 原生 IAP plugin(InAppPurchasePlugin.swift + .m),不是用 npm 包
- **价值**:.swift 代码可能有订阅升降级判定等业务逻辑值得参考 / 复用
- **触发条件**:阶段 5 用 react-native-iap 重写 IAP 时,先读旧 .swift 看业务规则

#### B21. 阶段 5 触发: Android Apple Sign-In 走 OAuth 网页流程
- **来源**:阶段 2.1 Android Manifest 扫描发现
- **事实**:Apple 没给 Android 原生 Apple Sign-In SDK,旧项目 Android 端 Apple Sign-In 用 OAuth deep link callback(scheme com.novame.app)
- **关键**:mobile 阶段 5 Android 上 Apple Sign-In 必须用 expo-auth-session OAuth 流程,不能复用 iOS 原生 ASAuthorizationAppleIDProvider 路径
- **触发条件**:阶段 5 Apple Sign-In 集成时


#### B22. nativewind preview 引入 react-dom 18 peer 冲突(react@19.1)
- **来源**:阶段 2.1.3 装依赖时发现
- **现状**:nativewind@5.0.0-preview.3 拉了 react-dom@18.3.1,跟 react@19.1.0 peer 不一致
- **影响**:peer warning 不阻塞 build;但极端情况下如果有代码意外用到 react-dom(mobile 不该用),会出现 React reconciler 版本错配
- **暂不处理理由**:搬迁阶段聚焦骨架跑通;先看 2.1.5 type-check / metro start 是否真出问题
- **触发条件**:
  - (a) 2.1.5 出实际报错 → 立刻处理(加 pnpm.overrides 强制 react-dom 跟 react 一致)
  - (b) NativeWind v5 stable 发布后这个问题可能自然消失


#### B23. monorepo @types/react 多版本冲突 + paths 修法(已解决,记录用)
- **来源**:阶段 2.1.5 类型分裂调试时发现并解决
- **根因链**:
  - admin/api 用 React 18 + @types/react@18.3.3
  - mobile 用 React 19.1 + @types/react@19.1.17
  - pnpm 默认 hoist-pattern=* 把 admin/api 的 @types/react@18.3.3 hoist 到 .pnpm/node_modules/
  - mobile TS 解析 react-native 的 .d.ts 时,通过 walk-up 找到了 .pnpm/node_modules/@types/react/(指向 18.3.3)
  - 跟 mobile 实际依赖的 19.1.17 不兼容,报 'View cannot be used as a JSX component' 等错误
- **解决方案**:apps/mobile/tsconfig.json 加 compilerOptions.paths 锁 react 到 mobile 自己的 node_modules
- **参考来源**:zackery.dev "@types/react in a Mono Repo"
- **此条 backlog 性质**:已解决问题的根因记录,防止未来重新踩坑
- **未来风险预警**:
  - 添加新 workspace 时若 React 版本跟现有 workspace 不一致,可能复发
  - 添加新依赖到 mobile 时,如果该依赖 .d.ts 用 'import * from react' 而没显式声明 @types/react peer,可能受影响
  - 若 NativeWind v5 stable 后 mobile 升级 SDK 55,要重新评估 paths 配置是否仍需要
- **失败方案备忘**(已尝试无效,不要再走):
  - shamefully-hoist=false 治标不治本(只关 root hoist,不关 .pnpm 内部 hoist)
  - compilerOptions.types: [] 不影响 import resolution(只影响 global include)
  - hoist-pattern[]=!@types/react 在某些场景不工作(pnpm GitHub discussion 5779)


#### B24. TypeScript 5.5.4 vs Expo SDK 54 推荐 ~5.9.2 警告
- **来源**:阶段 2.2.4 expo start 输出警告
- **现状**:
  - mobile devDep typescript 5.5.4(决策 5 选 A 与 monorepo 统一)
  - Expo SDK 54 期望 ~5.9.2,启动时打印推荐升级警告
  - **实测无影响**:type-check 通过 / metro bundle 成功 / paths 修法正常工作
- **暂不处理理由**:
  - Expo 警告是"推荐"非"必须"
  - 升级 mobile 单独到 5.9.2 = mobile 与 admin/api/packages 版本分裂(决策 5 选 A 推翻)
  - 升级整个 monorepo 到 5.9.2 = 阶段 2 之外的工作,需要重新跑所有 workspace type-check 和 build
- **触发条件**:
  - (a) mobile 出现实际 TS 错误且根因是 5.5.4 vs 5.9.2 特性差异 → 立即升级
  - (b) 阶段 2 / 阶段 3 收尾时统一升级 monorepo TS 5.9.2(更稳健的时机)
  - (c) Expo SDK 56 发布后 TS 要求可能变,届时一并评估
- **升级实操(参考)**:
  - root package.json: typescript 5.5.4 → 5.9.x
  - 各 workspace 的 devDep typescript 同步
  - pnpm install 后跑全部 type-check 验证


#### B25. fontFamily 消费方需加 Platform.select 包装(阶段 3 触发)
- **来源**:阶段 2.3.5 修复 typography.ts react-native 依赖时引入
- **现状**:
  - packages/ui-tokens/typography.ts 的 fontFamily 现在是 `{ ios, android, web }` 对象,不再是 string
  - mobile/src/theme/ 阶段 2.3 没有消费 fontFamily,所以不受影响
- **触发条件**:阶段 3 mobile 真用 fontFamily 渲染 Text 时
- **预期写法**:
  - mobile 消费方 import { Platform } from 'react-native' + theme.typography.fontFamily.sans[Platform.OS as 'ios' | 'android'] || theme.typography.fontFamily.sans.web
  - 或者在 src/theme/ 加一个 helper: `export function selectFontFamily(family) { return Platform.select(family) ?? family.web }`
- **设计原则**:平台选择逻辑放在消费方,不放在 ui-tokens 中(行业标准:design tokens 应 platform-agnostic)

#### B26. react-native-mmkv v4 需要 Development Build(阶段 3 触发)
- **来源**:阶段 2.3.1 装 mmkv v4 后,2.3.5 metro 验证时确认
- **现状**:
  - mmkv v4 是 Nitro Module,native code 不能在 Expo Go 中运行
  - 阶段 2.3 metro bundle 仍然成功(只 link 不执行 native module)
  - 但扫 QR 用 Expo Go 加载会报"react-native-mmkv is not supported in Expo Go"
- **触发条件**:阶段 3 第一次需要真机/模拟器加载 app 调试
- **解决方案**:
  - npx expo prebuild --clean(生成 ios/ android/ 原生项目)
  - npx expo run:ios 或 npx expo run:android(本地编译 development build)
  - 或者用 EAS Build cloud(`eas build --profile development`)
- **风险**:
  - 阶段 3 第一次跑 development build 时,可能踩 mmkv v4 + RN 0.81.5 + Expo SDK 54 已知 issue (mrousavy/react-native-mmkv#985)
  - 我们装的是 mmkv 4.3.1 + nitro 0.35.6 较新,可能已修
  - 若失败,fallback 用 mmkv v3 + 老 API(降级回 `new MMKV()`)

#### B27. packages/ui-tokens 的 react-native 依赖修复记录(已解决)
- **来源**:阶段 2.3.5 mobile type-check 暴露 typography.ts 缺 react-native 依赖
- **根因**:typography.ts 在 fontFamily 里用了 Platform.select 但 packages/ui-tokens 没声明 react-native 作为 dep/peerDep,1.4 阶段就存在但 admin/api 没消费 typography.ts 所以未暴露
- **解决方案**:路径 A — 重写 fontFamily 为 platform-agnostic 对象,packages/ui-tokens 完全脱离 RN 依赖
- **设计原则**:
  - design tokens 应该 platform-agnostic (Tailwind / Tamagui / Theme UI 行业标准)
  - 平台选择逻辑放在消费方,不放在 tokens 中
- **未选方案**(已评估):
  - 路径 B(给 ui-tokens 加 react-native 为 optional peerDep):pnpm 9 known bug autoInstallPeers 会装 optional peer 到所有 workspace,污染 admin/api 依赖图
  - 路径 C(用 dependencies 而不是 peerDep):会强制所有 workspace 装 react-native,违反 monorepo 边界
  - 路径 D(把 fontFamily 抽到独立模块):增加复杂度,跟搬迁原则不符
- **此条性质**:已解决记录;未来若有人想给 ui-tokens 加 react-native 依赖,看此条理解为什么不应该这样做


#### B28. 阶段 3 视频走 Cloudflare R2 CDN(决策已锁定,3.3 sub-step 触发)
- **来源**:阶段 3 准备讨论时确认的策略(D15 选 C)
- **决策内容**:
  - 28 个角色视频(每月新增 28 个,长期累计可能 1GB+)走 Cloudflare R2 CDN,不进 git
  - ob-10.mp4 (566 KB onboarding 视频) 进 git(首次启动立即可用)
  - 静态图片(66 webp + logo,3.2MB)进 git
- **方案细节**(供 3.3 实施参考):
  - Cloudflare R2 free tier:10GB 存储 + 免费 egress + 10M Class B 操作免费
  - 我们用量(10000 用户)预估前 5 年 $0
  - 视频 manifest 设计:JSON 含 `{ filename, size, hash }` 数组
  - mobile 启动时 fetch manifest,diff local cache,后台并行下载缺失视频
  - 已缓存视频从本地播放,切换 outfit 瞬时无网络消耗
  - 离线场景:首次启动需联网,后续完全可离线
- **3.3 sub-step 实施步骤**(待执行):
  1. 创建 R2 bucket,公开访问配置
  2. 上传 28 个 mp4(以及未来 batch)
  3. mobile 写 manifest fetch + 下载 + 缓存逻辑(`@/lib/video-cache.ts`)
  4. VideoCharacter 组件用 expo-video 消费缓存视频
  5. onboarding 期间静默后台下载(避免用户感知等待)

#### B29. 阶段 3 路由结构 + 决策记录(已锁定,3.1 已完成)
- **来源**:阶段 3 准备讨论时确认
- **路由架构**:
  - app/(main)/(tabs)/ — 4 主 tab(Home/Growth/Discover/Assets,expo-router Tabs)
  - app/(main)/(modals)/ — 12 modal route(me/skin-select/weekly-report/ranking/record/preferences/account-management/plan-billing/support/notification-settings/subscription-paywall/character-data)
  - app/(onboarding)/ — onboarding flow(3.5 sub-step 实现)
  - app/(auth)/ — auth flow(3.4 sub-step 实现)
- **关键决策**:
  - D18:expo-router Tabs(原生感最强,跟 Finch/Duolingo 一致)
  - D21:modal 默认 presentation: 'modal'(iOS 标准 slide up)
  - D22:modal 在 (modals) group(路由清晰)
  - D20:placeholder 视觉 = NovaMe 黑底紫字(从 3.1 视觉契约对齐)
- **未在 3.1 实现的事**(供后续 sub-step 参考):
  - BottomNav 自定义 UI(3.6 sub-step,替换默认 Tabs UI)
  - record / subscription-paywall 等可能改 fullScreenModal presentation(3.6+)
  - SignInPrompt modal(3.4 auth flow 决定放哪)

#### B30. 阶段 3 sub-step 完整拆分(供新对话续接参考)
- **来源**:阶段 3 准备讨论确认
- **sub-step 列表**(每步 1-2 小时,可独立 commit):
  - 3.1 路由结构 + 静态资产 + placeholder ✅(本次 commit)
  - 3.2 development build 第一次 + global infra(fonts B12 + tailwind theme B13 + 第一次 expo prebuild + run:ios B26)
  - 3.3 video CDN 基础设施(R2 setup + manifest + mobile cache 逻辑 + VideoCharacter 组件)
  - 3.4 auth flow(Apple Sign-In B21 + Google Sign-In B15 + Email password)
  - 3.5 onboarding flow(OnboardingFlow + ob-10.mp4 + 视频静默预下载 + app/index.tsx redirect 逻辑)
  - 3.6 main tabs 骨架(自定义 BottomNav UI + 4 tab 真实内容渲染 + Home VideoCharacter 房间视频)
  - 3.7 录音功能 RecordOverlay(核心)
  - 3.8 卡片功能(CardCollectionGrid / FlippableCard / CardSpinAnimation)
  - 3.9 Seek (Discover) view(SeekView / SeekModals / WisdomCard)
  - 3.10 Me page + 各 overlay 收尾 + SubscriptionPaywall UI
- **执行约束**:
  - 每个 sub-step 独立 commit + push
  - 每个 sub-step 完成后跑 admin/api type-check 验证零副作用
  - 阶段 3 多个 sub-step 可分多个对话完成,每次新对话从 backlog header 续上
- **完成标准**:
  - 所有 25 placeholder route 都被填充为真实功能
  - 旧 NovaMe 业务流程在 mobile 全可用
  - 真机测试通过(iOS + Android)
  - 视觉跟旧 NovaMe 1:1 对齐(皮囊),底层完全用 RN/expo-router 标准(底层不一样)

#### B31. assets/ 命名变更记录(已完成,记录用)
- **来源**:阶段 3.1.1 资产复制时引入
- **变更**:旧 capacitor `public/images/assets/` → mobile `apps/mobile/assets/images/product/`
- **理由**:避免 mobile 根 `assets/images/assets/` 三层 assets 命名混淆;`product` 语义更准确(产品销售点图:cards-hero/book-cover/book-detail-1)
- **影响**:阶段 3.6+ 写 UI 时要消费这些图片,路径改成 `require('@/assets/images/product/*.webp')`(不再是 `/images/assets/*.webp`)
- **此条性质**:已完成记录;未来对话写 image src 时不要写错路径


#### B32. mobile dev build 第一次跑通(已解决,记录用)
- **来源**:阶段 3.2.A
- **解决方案**:
  - npx expo prebuild --clean 生成 ios/ android/
  - npx expo run:ios 编译 + 启动 iPhone 17 Pro 模拟器
  - mmkv v4 + nitro modules native 编译通过(B26 风险消除)
  - Xcode 26.2 + RN 0.81.5 兼容(无 SWIFT_ENABLE_EXPLICIT_MODULES 错误)
  - Reanimated v4 + worklets 编译通过
- **此条性质**:已解决记录
- **后续维护**:
  - 修改 app.json 任何 native config(plugins/permissions/icon 等) → 必须 npx expo prebuild --clean + npx expo run:ios 重新编译
  - 修改 .ts/.tsx/.css → metro hot-reload 即可,不需要重 native build
  - 添加新 native module(react-native-* 类带 native code 的包)→ 必须重 prebuild + run:ios

#### B33. tsconfig.json paths 删除 react alias(B23 修法回退,已解决)
- **来源**:阶段 3.2.A.5 dev build 第一次跑 metro bundle 时报 "Unable to resolve react"
- **根因链**:
  - 阶段 2.1.5 修 B23 时,mobile/tsconfig.json 加了 `"react": ["./node_modules/@types/react"]` 让 TS type-check 找 React 19 types
  - **但 expo metro 也读 tsconfig.json paths**(Expo CLI 的扩展行为,react native 标准 metro 不读)
  - dev build 真跑 metro bundle 时,metro 用 paths alias 把 `import 'react'` resolve 到 @types/react/(types-only 包,main 字段为空字符串)
  - metro 找不到 runtime 文件 → 爆错
- **解决方案**:删除 mobile/tsconfig.json 的 `react` 和 `react/*` paths,只保留 `@/*` alias
- **为什么可以删**:
  - 当前 mobile/node_modules/@types/react symlink 已正确指向 .pnpm/@types+react@19.1.17(pnpm 9 + 我们的 .npmrc 设置已修)
  - TS 自动从该 symlink 找 React 19 types,不需要 paths 强制指定
  - B23 walk-up 漏洞已被 pnpm 9 修(2.1.5 当时是 pnpm 默认 hoist 模式,现在改了)
- **此条性质**:已解决记录;**B23 完整结案**(B23 paths 修法已被反向操作)
- **未来风险预警**:
  - 如果将来 admin / api 升级到 React 19(消除 monorepo 内 React 版本分裂),这个修复仍然安全
  - 如果将来加新 workspace 用不同 React 版本,可能再次出现 walk-up 问题,届时考虑 pnpm injected dependencies(packages/ 共享代码用 injected: true 隔离消费方 React)

#### B34. app/index.tsx 临时 Redirect 到 (main)/(tabs)(3.5 触发还原)
- **来源**:阶段 3.2.A.4 为了 dev build 验证 4 tab UI 临时改的
- **现状**:app/index.tsx 现在是 `<Redirect href="/(main)/(tabs)" />`
- **触发条件**:阶段 3.5 onboarding flow 实现时
- **3.5 sub-step 应改成**:
  - 用 mmkv storage 检查 'novame_onboarding_done' 标志
  - 用 supabase auth 检查 session
  - 三种重定向:
    - 没完成 onboarding → /(onboarding)
    - 完成 onboarding 但没登录 → /(auth)/sign-in
    - 完成 onboarding + 已登录 → /(main)/(tabs)
- **参考**:旧 capacitor src/app/page.js 的路由逻辑(localStorage 'novame_onboarding_done' + supabase getSession)

#### B35. expo-font 字体 embed 待 prebuild + run:ios 真跑通(3.6 触发)
- **来源**:阶段 3.2.C 完成,但选项 B(不立即 prebuild + run:ios)
- **现状**:
  - app.json 已声明 expo-font config plugin + 4 个 Inter weight ttf 路径
  - 4 个 ttf 文件已装(node_modules/@expo-google-fonts/inter/*)
  - 但 ios/ Pods 没有真正 embed 字体(因为 prebuild 未重跑)
- **触发条件**:阶段 3.6 main tabs 骨架第一步
- **3.6 第一步必须做**:
  - npx expo prebuild --clean(让 expo-font 把 4 个 ttf 真 embed 到 ios/android 原生项目)
  - npx expo run:ios(重新编译 NovaMe.app 含字体)
  - 验证:写一个 demo `<Text fontFamily="Inter_700Bold">` 看模拟器渲染 Inter 字体(不是 SF Pro)
- **fontFamily 名称**:Inter_400Regular / Inter_500Medium / Inter_600SemiBold / Inter_700Bold(PostScript name)

#### B36. android userInterfaceStyle 需要 expo-system-ui(prebuild 提示)
- **来源**:阶段 3.2.A.1 prebuild 输出 `» android: userInterfaceStyle: Install expo-system-ui`
- **现状**:
  - app.json 配了 userInterfaceStyle: 'automatic'(2.1 阶段加的,让 app 自动跟系统 light/dark 模式)
  - iOS 默认支持
  - **Android 需要 expo-system-ui 包才能启用**
- **不阻塞**:不装 expo-system-ui Android 仍能跑,只是不响应系统 dark mode
- **触发条件**:Android 真测试时(阶段 6 真机测试)需要装 expo-system-ui
- **修复方式**:`npx expo install expo-system-ui` + 重 prebuild


#### B37. video CDN 基础设施搭建完成(已解决,记录用)
- **来源**:阶段 3.3
- **R2 状态**:
  - bucket URL pattern: https://media.novameapp.com/{filename}
  - 18 视频 mp4 已上传(36.09 MB)
  - 52 cards webp 已上传(48 front + 4 back,2.52 MB)
  - video-manifest.json 已上传(13201 bytes)
  - cards-background.webp + save-collection.webp 不在 R2(留 git 作为 UI 框架资产)
- **mobile 代码**:
  - src/lib/asset-types.ts: AssetManifest / VideoManifestEntry / CardManifestEntry / AssetDownloadResult 类型
  - src/lib/asset-cache.ts: fetchManifestFromR2 / getCachedManifest / setCachedManifest / getCachedAssetUri / verifyCachedAsset / downloadAsset / downloadAssets / diffCacheAgainstManifest / getActiveManifest
- **设计决策**:
  - manifest URL hardcode 在 asset-cache.ts 常量(Q-3.3-B-1 = A,固定 URL 不需要 env var)
  - 缓存目录: Paths.document/cache/(永久存储,Q-3.3-B-2)
  - 启动策略: 用 cached manifest 0 延迟,后台异步刷新(Q-3.3-B-3 = B)
  - 下载方式: 串行(避免带宽/内存峰值,3-5s onboarding 可接受)
  - size 比对验证完整性(不用 hash,manifest schema 不放 hash)
- **API 用法**:用 expo-file-system v19 New API(File class + downloadFileAsync 静态方法 + Paths.document Directory 实例)
- **此条性质**:已解决记录;未来对话写消费代码时不要重新研究 expo-file-system v19 API

#### B38. 视频/cards 下载策略(3.5 onboarding 触发实现)
- **来源**:阶段 3.3 准备讨论
- **现状**:asset-cache.ts 提供 downloadAssets 工具函数,但**还没消费方**
- **触发条件**:阶段 3.5 onboarding flow 实现时
- **3.5 sub-step 应做**:
  - onboarding 第 1 屏挂载时立即触发前台下载 outfit1 的 3 视频(8.9 MB,3-5s WiFi)
  - outfit1 完成后立即触发后台下载剩 15 视频(outfit2-6) + 52 cards(共 31MB,30-90s)
  - 显示前台下载进度(progress bar),后台下载静默
  - 失败处理: 重试 1 次 → 仍失败提示 "网络异常,稍后重试" 但允许进入 app(已 unlock 视频可能没有)
- **预计实现位置**:apps/mobile/app/(onboarding)/* 或 src/lib/onboarding-flow.ts(待 3.5 设计)
- **业务规则参考**:
  - 用户等级 unlock 视频规则**不在 3.5 实现**(留 3.6+),3.5 阶段 onboarding 后所有 18 视频都已下载完成,3.6 mobile UI 按等级筛选展示

#### B39. R2 manifest 更新流程(运维记录)
- **来源**:阶段 3.3.A.3 manifest 生成方式
- **当前流程**(每月新增 28 视频时):
  1. 上传新视频文件到 R2(手动 dashboard 拖拽 或 wrangler CLI)
  2. 重新跑 manifest 生成脚本(stage 3.3.A.3 m-2 命令的 Python 脚本)
  3. 上传新 video-manifest.json 到 R2 替换旧的
  4. mobile app 用户启动时自动 fetchManifestFromR2 拿新版本(后台静默)→ 触发新视频下载
- **不需要发布 mobile app 新版本**(这是 D15 选 C CDN 的核心价值)
- **未来优化点**:
  - manifest 生成脚本应该收编到 packages/scripts/或 admin 内置工具(目前是临时 Python 脚本)
  - 考虑用 Cloudflare Workers 自动生成 manifest(每次 R2 文件变化触发)
  - 或者 admin 端加 "上传新视频" 按钮,自动上传 + 自动重生成 manifest

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

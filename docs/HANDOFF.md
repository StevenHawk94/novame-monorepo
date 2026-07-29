# NovaMe v2.0 交接文档

> 最后更新：2026-07-22 深夜 | 最新 commit `598e9a1`
> 用途：新对话/新会话的完整上下文。配合 `CODEBASE.md`（代码库全景）和
> `docs/v2-prd-execution-plan.md`（PRD 执行方案 + 18 个产品确认项）阅读。

---

## 1. 一句话现状

**v2.0 的代码骨架已全部立起来**：12 项改版任务全部完成（UI 全屏幕按设计稿
1:1、P1 经济系统、Friends 全套前后端、64 物品真图系统），三个数据库迁移
（023/024/025）均已由用户在 Supabase SQL 编辑器执行成功。剩余工作 = 任务 13
遗留项 + 素材补齐 + 真机回归测试。

## 2. 已定的关键决策（不要再讨论）

| 决策 | 结论 |
|---|---|
| 技术栈 | **留在 React Native**，不迁 Flutter（透明视频 iOS 原生支持 + 同构 TS 引擎是决定性理由） |
| 货币（Q8） | XP 账本即货币账本，等级体系废弃，封顶 99999 |
| 人物形象（Q12） | 6 阶段，界限 [500/2000/4000/6000/9999]，10000+ 完全体 |
| 技能卡（Q13） | 固定 81 张 = 9 组×9（第 9 组 Mega 万能卡），关键词匹配非 AI；占位卡库在 `domain/skill-library.ts` |
| 每日任务（Q16） | 与 Quests 周计划**并存**；每日 quest +30/任务，每天限勾 1 项 |
| 排行榜 | **已删除**（mobile 链路全删；`/api/leaderboard` 服务端暂留给老客户端） |
| Quiet Wins 更名 | **Small Wins**（代码 key 仍为 quiet_wins） |
| 战斗里程碑（Q15） | 阈值递增间隔 1000/2000/3000…→ 累计 1000/3000/6000/10000…；**每档 🍀×200**（按设计稿定）；怪物血量 50+100/阶段、**封顶 300** |
| Focus 场景（Q9） | 6 个新场景（Work/Learn/Connect 免费 + Daily Tasks/Family/Challenge 付费），维度映射为占位（用户说最后统一调整） |
| 好友隐私 | **默认私密**（`profiles.share_memory_details` default false，服务端过滤） |
| 好友配额 | 免费 1 / 付费 99（add 与 accept 双时点校验） |

## 3. 经济数值（现行）

Focus +30×2/天（每场景发对应维度分+10）；Reflect +30×3/天；Small Wins +20
（每勾选项维度+10）；New Lens +20；True North +100/周（维度分 30/20/10）；
Tame +30（免费全局 1/天，付费每怪 1/天共 8）+ 怪物维度+10；Visit Master
+50/48h；泡泡 +5×5/天；每日 quest +30；7 天全完成 +200。
单一来源：`packages/engine/src/xp.ts` 的 `XP_RULES`（API 路由全部引用它）。

## 4. 本轮新增的核心资产（新会话直接复用）

**共享组件**（`apps/mobile/src/components/`）：
- `ui/offset-card.tsx` — 偏移色投影卡（本设计语言的按钮/卡片标准，offset=4）
- `ui/spring-pop.tsx` — 从小弹大的弹簧入场
- `ui/fireworks-burst.tsx` — 纯 reanimated 烟花（claim/技能页在用）
- `ui/item-sprite.tsx` — **物品真图渲染**（8×8 图集裁切窗口，见 §5）
- `main/cave-shell.tsx` — Friends 子页棕色外壳框架
- `main/clover-burst.tsx` — “+N 🍀” 飘字（所有奖励统一用它，不再有 XP 字样）
- `main/memory-bubbles.tsx` — Home 好友回忆泡泡

**工具**：`tools/normalize-item-sheet.py` — 物品图标准化管线（泛洪抠背景保留
物品内部白色 → 连通域提取 + 碎片归属 → 掩码防邻居渗入 → 200px 居中进 256 格
→ 输出 standard 图 + 编号校对图 + mapping CSV）。依赖 pillow/numpy/scipy——
**venv 在会话临时目录已失效，新会话需重建**：
`python3 -m venv /tmp/nv && /tmp/nv/bin/pip install pillow numpy scipy`

## 5. 物品系统（2026-07-23 全量上线：23 类目 1072 物品）

- 词典：`packages/engine/src/items/dictionary.json` = **1072 物品 + 2123 同义
  词**，由 `tools/build-item-dictionary.py` 从
  `assets/memory items/icon_keyword_mapping.csv`（用户维护）+
  `keyword-conflicts-resolution.csv`（85 组关键词冲突的裁决表，胜者保留、
  败者弃词）生成。改词 → 改 CSV → 重跑脚本即可
- id 形如 `music.electric_guitar`（类目前缀 + 名称 slug）；多词词组优先且
  消费 token（"electric guitar" 不会再命中 "guitar"）
- 图集：`assets/items/` 23 张 webp（8 列 × 4-8 行 × 256px，kebab 命名如
  `food-drinks-01`）；`item-sprite.tsx` 的 `ITEM_SHEETS` 带 rows 元数据
  （**非正方形 sheet**，渲染窗口按行数算）
- 标准化管线 `tools/normalize-item-sheet.py` 新增：透明底直接用 alpha 抠图；
  `--grid` 均匀网格模式（这批规则网格图必用——自由聚类会把细线条图标
  吸附给邻居导致整表错位，Nature 表踩过）
- 引擎测试含 `real-dictionary.test.ts`：真词典完整性 + 词组优先 + 冲突裁决
  回归（重新生成词典后必跑）
- 旧 food-01 词典/图集已整体替换（2026-07-23 裁决）；旧测试数据的失效 id
  （food.egg 等）显示空白瓷砖，属预期
- 顺带修复：`/api/friends/box` POST 调 `matchItems` 少传词典参数，手动共创
  写盒此前必 500
- **DB 目录必须与词典同步**：`public.items` 是 `user_items`/`item_memories`
  的外键目标，`record_item_matches` 会静默丢弃不在表里的 id（踩过：表里只有
  16 行 C8 样本，Bags 一直为空）。`build-item-dictionary.py` 现在同时生成
  `supabase/migrations/*_items_full_catalog.sql`（upsert，可重跑），**改 CSV
  重新生成后必须在 Supabase SQL 编辑器执行它**
- 匹配数量无上限（2026-07-23 裁决）：引擎不再截 5 个，claim 页全量展示；
  `edit-memories` 批量上限相应提到 100
- ⚠️ 旧词典 id（wine 等测试数据）会显示空白瓷砖，属预期

## 6. 踩过的坑（新会话别再踩）

1. **资产文件名不能有空格**——Metro 静默解析失败（已翻车 3 次：focus 图标、
   friend list/shared memories 图标）。收到新素材先改名
2. **OffsetCard 禁用态**：透明度必须放在外层 style（面+投影一起淡），只淡卡
   面会让投影透出来像“颜色反了”
3. **背景图顶部对齐**：用 expo-image `contentPosition="top"`（Friends 两页已用）
4. **expo-video 不会自动恢复播放**——companion-video.tsx 有四层防护（混音模式
   /AppState/看门狗/focus），别删
5. `.maybeSingle()` 在可能多行的查询上会炸（tame status 曾因此有 bug）
6. 双击交互：先开遮罩会吃掉第二击（tame 战斗卡曾因此无反应，现延迟开缩放）

## 6.5 Reflect v3（2026-07-23 需求：1对1 陪伴定位）——进行中

产品重定位：为「最亲密但不在身边的人」做双向日常互通；1对1 绑定（建在
好友系统上）、三种 reflect 入口、per-reflect 可见性、Widget 图标串。
裁决已定：次数仍 3/天全模式共享；typing 有二级 prompt 选项；右上角**两个**
开关（共享回忆盒 / 对好友可见，均记住上次选择）；Widget 30 分钟刷新+打开即刷。

**服务端+数据层已完成（迁移 027 待用户执行）**：
- `pairings` 表（镜像双行、PK=user_id 天然限一人；未来多频道只改 PK）+
  `set_pairing`/`unset_pairing` RPC（校验 accepted 好友、双方未绑定）
- `reflects.mode`（typing/prompt/items）+ `submit_reflect` v3
  （p_shared_to_friends/p_mode；3/天门控不变，全模式共用）
- `/api/reflect` 三模式：typing=引擎匹配−客户端删除清单（只能删不能加）；
  prompt/items=手选 picks（词典校验、note≤200 作为回忆摘要）；
  <10 字或非 typing 跳过 AI/技能/气泡
- `/api/friends/pair`（GET/POST/DELETE）、`/api/friends/paired-feed`
  （对方某天的图标串，按 local_date、服务端过滤不可见 reflect，只出图标）
- feed/status 均已按 `shared_to_friends` 服务端过滤（status 顺带修正了
  原来按 UTC created_at 切天的问题，改按 local_date）
- 移动端 lib：`submitReflect` 支持 mode/selectedItems/removedItemIds/
  visibleToFriend；`kReflectShareDefaults` 记忆双开关；friends-api 增
  fetchPairing/setPairing/unsetPairing/fetchPairedFeed

**UI 已按设计稿完成（2026-07-24）**：入口三选
（reflect.tsx，New Lens 预设自动转发 typing）→ `reflect-typing`
（9 prompt 二级 + **客户端实时匹配条**，共享引擎 250ms debounce，铅笔开
编辑弹层可删可注）/ `reflect-guided`（3 步：Emotions→Food→Do 三类 chips；
note 选填；Plus 小故事按钮）/ `reflect-items`（全库选品+搜索+类目条，正文
必填）。共享件在 `components/main/reflect-shared.tsx`（编辑弹层/结果页/
可选网格）。**结果页 toggle 语义（重要）**：控制 paired 对**细节**的可见性
（`/api/reflect/visibility` 提交后可改），**物品图标对好友永远可见**——
feed/status/paired-feed 已按此语义过滤（细节需全局 opt-in AND per-reflect
开关同时为真）。Plus AI：回忆精炼 + 小故事已接（占位 prompt，等正式文案）；
AI 不覆盖用户手写的物品描述。输入页统一 50% 黑遮罩。

**流程2 v2（2026-07-24）**：首次进入 = 类目选择页（选 3-20 个，持久化
`kGuidedCategories`；prompt 页右上角 Edit 可改），之后每个所选类目一页
prompt（可跳过）→ note 页。配置在 `lib/guided-prompts.ts`——数据驱动，
新旧两套类目 key 都有条目 + 兜底生成器，**词典重新生成后自动变成 14 类，
零代码改动**。

**词典换代（图未到，勿跑）**：CSV 已更新为 14 类 460 项；
`build-item-dictionary.py` 的映射已切到新类目（emotions 换 sheet id 为
emotions-02 防旧图残留）。图到位后的重跑清单写在该工具的注释里
（normalize --grid → build → webp → ITEM_SHEETS → 新迁移文件 → Supabase）。

**待素材/待做**：14 张新类目图；Flutter 迁移已评估并再次否决（2026-07-24
用户确认留 RN）；类目条图标仍空缺；iOS WidgetKit（原生，30min 刷新 + 打开即刷）。

## 6.55 Connection Dashboard + pairing-first Friends（2026-07-24 需求）

- **Me 页旧功能全删**（成长阶段/维度磁贴），替换为 Connection Dashboard
  （(tabs)/status.tsx，tab 标签已改 'Me'）：Memories Hub 入口 → 共创盒页；
  关系卡（双方名/关系/For N days）；**共同物品 8 个**（/api/friends/
  common-items，双方 60 天内都收集过的物品，点开看双方各自的最新描述，
  对方文案按隐私门控）；**Plus 每日 AI 洞察**（/api/friends/insights：
  Emotion/Topic/Care Tips/Boundaries/Hangout Ideas，占位 prompt，
  connection_insights 表按 pair+日缓存一次，Copy and Send 走系统分享）
- **绑定带关系**（迁移 028，✅需在 Supabase 执行后再部署）：邀请时选
  关系（Lover/Best Friend/Mom and Daughter/Siblings/Someone Special/
  Others）+ 起始日期；`friendships.relationship(+_since)` 承载邀请，
  **accept 时自动 set_pairing**（v2 RPC 带关系；任一方已绑定则仅成为普通
  好友，非致命）。friend-add：搜索先 preview（不落库）→ 关系弹窗（自制
  三列日期滚轮，无新依赖）→ Send Invitation；请求行显示关系；
  "My Pair ID"
- Friends tab → **Memories Cave**：绑定后面板只显示 paired 对象的流
  （"Latest memories of your paired"）；未绑定显示 Pair Friend + 文案
  （mock 1:1）。friends-list/friend-profile 路由保留但入口收敛

## 6.58 Onboarding v3 + 游客模式（2026-07-26 需求）

- **强制登录已移除**：入口 `app/index.tsx` — 有 session 直进；新装机 →
  onboarding；老设备无 session → `ensureSession()`（`auth.ts`，
  `signInAnonymously` 匿名会话）→ signing-in。经典 sign-in 页只在匿名
  登录不可用或用户主动"Log in"时出现。**⚠️ 需在 Supabase Dashboard →
  Authentication 开启 "Anonymous sign-ins"，否则回退到旧登录页**。
  profiles 由 `handle_new_user` 触发器自动建，匿名用户同样生效
- **Onboarding v3**（(onboarding)/index.tsx，单文件步骤流，mock 1:1）：
  start → someone → who(4选) → blocker(4选) → **feedback（文案按
  blocker A-D 映射**，BLOCKER_FEEDBACK）→ notalk → imagine（可点物品条）
  → how → space → insights → boundaries → routine → creator →
  **paywall（BunnyUs Plus 权益卡 → Choose your plan，接真 IAP
  purchaseSubscription，可 X 跳过）** → Name Your Bunny → 完成。
  **Connect Your Account 仅在购买成功后出现且可跳过**：邮箱绑定走
  `supabase.auth.updateUser({email})`（匿名转正式）；Apple/Google 绑定
  是占位弹窗（linkIdentity 深链流程未接，见遗留）
- 兔名/选择存 kOnboardingState（preauth scope）：`setBunnyName` 等；
  companion 固定 pet1。素材在 assets/onboarding/（已改无空格文件名），
  兔头 bunny-head.png 兼作 JS splash（入口 gate 加载期显示）
- 遗留：Apple/Google 匿名账号 linkIdentity、原生 splash 图（app.json，
  需重新构建）、ob7 的打字→物品生成演示 GIF（素材未提供）

## 6.6 全局加载/流畅度（2026-07-24 优化 pass）

- **缓存优先原则**：所有页面 `useState(() => getCachedX())` 起步 + focus 时
  静默 revalidate；**刷新失败回退旧缓存，绝不清空**（friends-api 是此模式
  的参考实现）。新增 kFriendsStatus/kFriendsFeed 缓存键
- **预取**：Home focus 时 `prefetchAppData()`（60s 节流）预热全部 tab 数据
- **等待门控**：无缓存首载显示小 spinner，不闪空态文案（bags/my-logs）
- **性能**：ItemSprite 已 memo；选品网格 = 虚拟化 FlatList + memo 单元格
  （object 流全库 1000+ 瓷砖，**别再套 ScrollView**）；点选只重渲染两个格
- **动画**：`ui/confetti-burst.tsx`（纯 reanimated 纸屑，UI 线程）+
  FireworksBurst 叠加在 reflect 结果页

## 7. 遗留工作（下一步）

**任务 13（已建）**：iOS/Android 桌面 Widget（原生）、陌生人搜索（需产品定
反骚扰策略）、共创内容举报/拉黑（上架合规）、Plus AI 回忆精炼。
Reflect 共创**服务端已接通**：`/api/reflect` 接受可选 `friendUserId`（服务端
复核 accepted 好友关系），物品匹配命中会同时写入 `shared_memory_items`
（source='reflect'、带 reflect_id，只写 label 不写日记原文）；
`reflect-api.ts` 的 `submitReflect` 已透传该参数。**剩 UI**：prompt#9 的选
好友交互无设计稿（且 Q3「9 还是 10 条 prompt」未裁决），等图再做。

**素材缺口（等用户提供，代码已留位）**：宠物双状态视频（幼年/成年×睡/醒）、
Home 场景 2-6、怪物 8 只+温顺态、Master 森林图、6 张人物形象阶段图、81 张
技能卡面、Focus learn/connect+付费场景音频（现共用 work1.mp3）、皮肤图
pet2/3、类目过滤条图标。占位文案：81 卡库内容、True North focus/release
清单、Small Wins 条目、Lens 卡库存(需每主题 5-8 张)。

**未做/低优**：Scan Code 真扫码（需 expo-camera）、`/api/leaderboard` 下线、
CompanionSheet Skills 胶囊换正式图标、深链/推送、Sentry、`assets/Icons/
Untitled design (34/56/57/60).png` 未使用待认领。

**工作区未提交**（用户自己的改动，勿动）：`assets/videos/default.mov`（新宠物
视频）、`assets/memory items/` 目录、docs 下三个旧文档被删（1.4-completion
×2、backlog——可能是用户清理，提交时确认）。

## 8. 验证与常用命令

```bash
# 类型检查（分别在 apps/mobile、apps/api 下）
npx tsc --noEmit
# 引擎/领域测试
cd packages/engine && npx vitest run   # 81 tests（含真词典回归）
cd packages/domain && npx vitest run   # 10 tests
# 物品图标准化
<venv>/bin/python tools/normalize-item-sheet.py "图.png"
```

设计稿：`design-refs/`（47 张，gitignored）+ 本轮对话新增的 Focus/Reflect/
Friends 图（在用户素材目录 `~/Desktop/app final ui twist/app素材new/`）。
数据库改动一律走 `supabase/migrations/` 新文件，用户手动在 SQL 编辑器执行。
提交规范：conventional commits，只提交自己改的文件。

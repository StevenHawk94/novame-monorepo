# NovaMe App 大版本代码更新计划

> 依据：`App大版本更新：开发文档 & 上线清单.docx`、25 张界面视觉参考、当前仓库代码审查
> 计划日期：2026-09-27
> 范围：React Native / Expo App、Next.js API、Supabase 数据库与 RLS、IAP、素材目录、测试与上线
> 本文是总体计划；真实实施状态和验证证据见 `docs/app-major-update-progress.md`，未勾选项不代表已完成。

---

## 0. 执行结论

1. **继续使用现有 React Native / Expo 架构，不做框架迁移。** 当前透明角色视频、远程素材缓存、Supabase 配对/实时、反思结算、IAP 与宽屏适配都有可复用基础。
2. **需求文档负责“功能事实”，视觉稿负责“视觉语言与页面构图”。** 两者冲突时，以文档的导航、功能命名、规则和数据边界为准；视觉稿中的旧导航、旧房间数量、旧币种文字不直接写死进代码。
3. **新版主闭环是：记录一天 → 生成 Memories → 开始 Adventure → 等待/探索 → 获得物品并可能遇到朋友 → 收藏/装饰 → 与伴侣互动 → Moments 留痕。** 所有模块必须围绕这条闭环共享同一套服务端状态，而不是各页面各存一份状态。
4. **先做底层域模型和原子事务，再做页面。** 房间状态、货币、物品、冒险、礼物、任务奖励、Plus 权益如果先做成本地 UI 状态，后续会出现重复领取、跨设备不一致和伴侣同步丢失。
5. **未提供的内容用可替换占位内容实现完整交互。** 占位文案、物品、朋友、问题、任务、场景均使用稳定 ID 和内容表驱动，标记 `is_placeholder=true`；以后只替换内容和素材，不改流程代码。
6. **当前未提交代码里正在加强 Bunny Court，而新文档要求删除 Bunny Court。** 实施前必须先把现有工作保存到独立分支/提交，随后按新文档移除产品入口与运行链路，避免误删尚未归档的用户工作。

---

## 1. 输入资料的优先级与冲突裁决

### 1.1 优先级

| 优先级 | 来源 | 用途 |
|---|---|---|
| P0 | 本需求文档 | 功能范围、业务规则、奖励、权限、命名、删除项、上线要求 |
| P1 | 当前代码与数据库 | 判断复用点、技术约束、已有线上契约、实施风险 |
| P2 | 25 张视觉稿 | 色彩、构图、卡片比例、插画气质、动效意图、信息层级 |
| P3 | 本计划生成的占位内容 | 在正式内容/素材缺失时保证流程可开发、可测试、可替换 |

### 1.2 已发现的视觉稿冲突与统一方案

| 冲突 | 统一方案 |
|---|---|
| 底部导航出现 `Home/Love/Shop/Moments/Collection`、`Home/Adventure/Quests/Bag/Me` 等多版 | 固定为文档定义的 **Home / Burrow / Quests / Shop / Moments** |
| Burrow 图只画 6 个房间，且 `Game Room` 与 `Memories Room` 在不同稿中互换 | 实现可纵向滚动的 9 房间地图：My、Partner’s、Our、Friends、Game、Rage、Self Care、Memories、Collection |
| Collection 视觉稿是 Items/Gifts/Friends 三段，文档又要求 5 类及 Mine/Partner’s | 使用两级筛选：顶部 `Mine / Partner’s`，内部 `Decor / Outfits / Our Room / Gifts / Friends`；视觉仍保持卡片网格 |
| 币种视觉是胡萝卜币，文档泛称 coin | 域 ID 使用 `carrot_coin`，显示名称走内容配置，当前默认显示胡萝卜图标与 `Carrots`，不在业务代码硬编码文案 |
| `Our Room` 与 `Ours Room` 混用 | 产品和代码统一为 **Our Room** |
| 多张页面没有安全区、返回态或加载态 | 保留视觉气质，但工程实现补齐 Safe Area、加载、空态、错误态、离线态、辅助功能标签 |

---

## 2. 当前代码审查结论

### 2.1 可以直接复用的基础能力

| 能力 | 当前代码 | 处理方式 |
|---|---|---|
| 手机窄画布与宽屏居中 | `src/components/layout/adaptive-app-frame.tsx` | 保留；补 iPad 开关和 520dp 内视觉回归 |
| 透明角色视频与换装素材 | `src/components/main/companion-video.tsx`、`src/lib/outfits.ts` | 保留，扩展为房间分层场景中的角色层 |
| R2 素材下载与优先级缓存 | `src/lib/asset-cache.ts`、`download-queue.ts`、`remote-items.ts` | 扩展到房间、家具、朋友、礼物、冒险素材 |
| Write Freely / Tap Your Day | `app/(main)/reflect*.tsx` | 保留输入交互与耐久结算，外层改造成 Adventure Record 流程 |
| 反思 prepare/finalize 与离线补偿 | API reflect 路由、`reflect-settlement-outbox.ts` | 复用事务与补偿模式，替换旧奖励/AI 分析副作用 |
| 配对、共享 Plus、实时同步 | `friends/add`、`pairing-realtime.ts`、subscription 相关代码 | 保留配对和共享权益，扩展新版领域事件 |
| StoreKit/Play IAP 骨架 | `src/lib/iap.ts`、subscription API | 复用订阅验签；新增 consumable 胡萝卜包与交易账本 |
| MMKV 隐私作用域注册 | `src/shared/storage/keys.ts` | 所有新缓存、草稿、红点游标必须注册并按用户清理 |
| 服务端本地日与原子奖励模式 | quest/reflect 迁移和 RPC | 继续使用服务端时间、幂等键、advisory lock/唯一约束 |

### 2.2 必须重构或替换的模块

| 模块 | 当前状态 | 目标 |
|---|---|---|
| Tabs | 当前是 Home/Court/Moments/Insights/Collection，Quests 隐藏 | Home/Burrow/Quests/Shop/Moments |
| Home | 角色视频 + 气泡 + Quest/Reflect 按钮 | 12 类装饰分层、角色/服装、喂食、浇花、相框、双人娃娃、音乐、Affection、Adventure |
| Quests | 旧任务与 20/30 奖励 | 7 项定义；Game 未开放时从其余 6 项稳定随机 3 项，每项 +10；Special 每阶段 +15 |
| Moments | 当前主要是伴侣 journal feed + Good Vibes | 双方行为事件流：记录、冒险、朋友、Affection、照料、相框/娃娃、礼物、Memories |
| Collection | Mine/Theirs/Ours 的记忆物件 | 5 类收藏 + Mine/Partner’s + 礼物红点/聚合领取 |
| Shop | 只有分散的场景/服装购买 | 13 个 Home 类别 + Our Room；购买自己/赠送伴侣；Plus 标识；统一装饰入口 |
| Economy | `xp - clovers_spent` 充当余额，购买接口非完整单事务 | 独立 wallet + immutable ledger + 原子购买/赠礼/奖励 RPC |
| Realtime Insight | 入口与 reflect 分析队列仍运行 | 保留代码但移除入口，并停止 Connection 分析入队；Plus memory object AI 保留 |
| Bunny Court | 当前仍是主 Tab，且工作区有大批未提交增强 | 先归档当前工作，再移除入口、API 调用和运行依赖 |
| Good Vibes | 全局 inbox gate、Moments 入口、任务和 API | 全部移除，替换为六类 Affection |
| Remember Together | Reflect 第三入口且有共享投影 | 从 Reflect 移出，改成 Memories Room 的文本+照片日记，不使用 AI |

### 2.3 已验证的工程基线

- `@novame/mobile` TypeScript 检查通过。
- `@novame/api` TypeScript 检查通过。
- `@novame/engine` TypeScript 检查通过。
- `app.json` 目前 `supportsTablet: false`，与文档的 iPad/宽屏要求冲突，必须改为 `true` 并补设备回归。
- 仓库已有大量服务端权威和幂等迁移模式，应继续使用，而不是在客户端计算余额、掉落或冷却。

---

## 3. 目标信息架构与路由

### 3.1 主导航

```text
Home       Burrow       Quests       Shop       Moments
  │           │            │           │            │
  ├ Affection ├ 9 Rooms    ├ Daily     ├ Catalog    ├ Activity feed
  ├ Adventure ├ Collection └ Special   ├ Decorate   └ Event actions
  ├ Decorate  ├ Memories               ├ Gift
  └ Room care └ Game/Rage/Self Care    └ Carrot Shop
```

### 3.2 建议路由结构

```text
app/(main)/(tabs)/
  index.tsx                 Home
  burrow.tsx                9 房间地图
  quests.tsx                Daily + Special
  shop.tsx                  目录与购买
  moments.tsx               事件流

app/(main)/
  room/[roomId].tsx         房间容器
  decorate.tsx              Home/Our Room 装饰
  collection.tsx            5 类收藏
  memories-room.tsx         双人日记
  game-room.tsx             首版占位玩法
  affection/index.tsx       6 类动作选择
  affection/[type].tsx      手势页
  adventure/index.tsx       Write Freely/Tap Your Day
  adventure/settlement.tsx  Memories 确认
  adventure/progress.tsx    探险倒计时与日志
  adventure/result.tsx      宝箱/朋友/礼物强制领取
  friend-encounter.tsx      朋友内容互动
  carrot-shop.tsx           消耗型 IAP
```

Expo Router 的具体目录名可在实现时按 typed-routes 限制微调，但产品层级不要再把 Collection、Adventure、Insights 放成主 Tab。

---

## 4. 统一视觉与组件系统

### 4.1 视觉原则

- 主色：烧陶橙、洞穴棕、奶油白；主要操作用森林绿或暖金；Affection 使用珊瑚粉独立主题。
- 场景：全屏插画或代码生成的洞穴渐变背景，内容卡片为奶油色，圆角 24–32dp，轻微深棕投影。
- 字体：继续使用当前 Inter，正式美术字体到位后只替换 typography token。
- 设计基准：390×844 逻辑画布；小屏可滚动，430/520 保持比例，iPad 只居中放大到上限，不拉伸场景。
- 所有主操作至少 48dp 点击区域；文字和图标在插画背景上达到可读对比度。

### 4.2 必建的共享组件

| 组件 | 职责 |
|---|---|
| `LayeredRoomScene` | 背景、12 类装饰、角色视频、交互热点的固定 z-order 渲染 |
| `SceneLayer` | 归一化坐标、比例、anchor、z-index、选中高亮 |
| `CurrencyPill` | 余额、到账动画、跳转 Carrot Shop |
| `ServerCountdown` | 使用服务端截止时间，处理前后台和离线恢复 |
| `AffectionGestureSurface` | 手势采样、进度、触觉、完成判定、无障碍替代操作 |
| `RewardReveal` | 宝箱、物品、朋友、礼物统一揭晓状态机 |
| `OwnedItemGrid` | 商店/收藏/装饰复用的目录卡片与筛选 |
| `RedDotBadge` | 礼物、Affection、冒险完成、朋友事件的统一未读语义 |
| `EventCard` | Moments 各事件模板渲染 |
| `Empty/Error/OfflineState` | 所有数据页的完整非理想状态 |

### 4.3 房间素材协议

每个装饰资源必须有：

```ts
type RoomAsset = {
  id: string;
  slot: 'cushion' | 'table' | 'rug' | 'vase' | 'lamp' | 'window' |
        'cabinet' | 'decor' | 'music_player' | 'frame' | 'poster' |
        'couple_doll' | 'outfit' | 'scene';
  imageUrl: string;
  thumbUrl: string;
  assetVersion: number;
  anchorX: number;       // 0..1
  anchorY: number;       // 0..1
  widthRatio: number;    // 相对逻辑画布
  zIndex: number;
  plusOnly: boolean;
};
```

正式素材按“全画布透明 PNG + 固定位置”交付时，仍保留 anchor 和 z-index 元数据，避免以后换尺寸需要发版。

---

## 5. 服务端领域模型与数据库

### 5.1 内容与目录

| 表 | 关键字段 |
|---|---|
| `content_revisions` | revision、published_at、minimum_app_version |
| `catalog_items` | stable_id、type、category、title、copy、price、plus_only、tradable、asset metadata、tags、drop_weight、is_placeholder、status |
| `friend_definitions` | stable_id、name、subtitle、art、rarity、cooldowns、is_placeholder |
| `friend_content` | friend_id、type(insight/question/emotional_help)、prompt、choices、feedback、rage_monster_id、locale |
| `memory_prompts` | stable_id、prompt、active、locale |
| `moment_templates` | event_type、copy template、CTA、locale |

内容通过 stable ID 被业务记录引用。后续替换名称、文案、图或权重时不改变历史记录和客户端路由。

### 5.2 货币、库存、购买与礼物

| 表 | 关键字段/约束 |
|---|---|
| `wallets` | user_id unique、carrot_balance、version |
| `currency_ledger` | user_id、delta、reason、reference_type/id、idempotency_key unique、created_at；只追加不修改 |
| `user_inventory` | owner_id、item_id、quantity、source、acquired_at；按物品规则限制 pair 最多 2 份 |
| `purchases` | buyer_id、item_id、price_snapshot、currency、status、idempotency_key |
| `gifts` | sender_id、recipient_id、item_id、reason、status(pending/claimed)、claimed_at |
| `iap_transactions` | platform、transaction_id unique、product_id、user_id、quantity、verification payload hash、status |

禁止客户端直接写余额、库存或礼物。所有奖励、购买、赠送必须在一个数据库事务里完成。

### 5.3 房间与互动

| 表 | 关键字段/约束 |
|---|---|
| `room_loadouts` | room_type(home/our)、owner_or_pair_id、slot、item_id、transform、version、updated_by |
| `room_needs` | room_owner_id、food_value、food_updated_at、water_value、water_updated_at |
| `room_media` | pair_id、kind(frame/doll_self/doll_partner)、private_storage_path、crop JSON、updated_by、updated_at |
| `room_music` | room_owner_id、track_id/none、updated_at |

`food_value` 与 `water_value` 不通过定时任务每 5 分钟写库；读取时根据 `updated_at` 推导当前值。补满时再写一次，这样省电、省数据库写入，也更容易保证跨设备一致。

### 5.4 Affection

| 表 | 关键字段/约束 |
|---|---|
| `affection_events` | sender_id、recipient_id、type、gesture_metrics、completed_at、reward_granted、received_at、read_at |
| `affection_cooldowns`（可选） | pair_id、last_free_completed_at；也可由事件+索引计算 |

六类动作及首版判定：

| 类型 | 交互 | 完成条件 |
|---|---|---|
| Hug | 长按 | 连续 3 秒 |
| Spicy | 点击 | 10 次有效点击 |
| Cuddle | 横向抚摸 | 达到累计距离且方向交替 |
| Gratitude | 双指向内后保持 | 缩放阈值后保持约 1 秒 |
| Kiss | 双指向外 | 达到放大阈值并松手 |
| Miss You | 画心 | 轨迹闭合且命中简化心形模板 |

每 6 小时的免费额度是六类共用一个 cooldown；Plus 无限。首次每日有效 Affection 奖励必须和 cooldown 完成在同一事务里判断。

### 5.5 Adventure

| 表 | 关键字段/约束 |
|---|---|
| `adventures` | user_id、local_date unique、record_id、status、started_at、ends_at、duration_seconds、plus_snapshot、content_revision、result_type、result_id |
| `adventure_logs` | adventure_id、minute_offset、event_type、copy、payload |
| `adventure_results` | adventure_id unique、item/friend、claim_status、gift_redirected_to、claimed_at |
| `user_friend_discoveries` | user_id、friend_id、first_seen_at、interaction_completed_at |
| `friend_visits` | pair_id、friend_id、visit_date、host_user_id；满足 1/天与 7 天同朋友冷却 |

状态机：

```text
draft_record
  → record_saved
  → memories_confirmed
  → ready_to_start
  → in_progress
  → result_ready
  → friend_interaction_required / item_claim_required
  → completed
```

- 每个用户本地日最多 1 次，以开始日期占用名额。
- Free 启动时锁定 8 小时，Plus 锁定 2 小时。
- 进行中升级 Plus：事务内把剩余时间压到不超过 2 小时；过期不延长当前冒险。
- 掉落由记录的 item tags 与目录 tags 匹配，权重和排除规则全部服务端执行。
- pair 已拥有 2 份时排除；本人已有而伴侣未有时自动转为 gift；双方都有则排除。
- 冒险结束不依赖 push。Realtime 可更新红点；应用回到前台必须主动 reconcile `result_ready`。

### 5.6 Moments、Memories、Quests

| 表 | 关键字段/约束 |
|---|---|
| `moment_events` | pair_id、actor_id、target_id、event_type、visibility、payload、reference、created_at |
| `memory_room_entries` | pair_id、author_id、local_date、prompt_id、text、private_photo_path、updated_at、deleted_at |
| `daily_quest_assignments` | user_id、local_date、quest_id、target、assigned_at；unique user/date/quest |
| `quest_progress` | assignment_id、count、completed_at、claimed_at |
| `special_quest_progress` | user_id、quest_id、stage、count、claimed_stages |
| `reward_claims` | user_id、reward_type、period_key、reference_id、idempotency_key unique |

Moments 不从多个业务表在客户端拼接。各原子 RPC 成功后写一条标准化 `moment_events`，Feed 只做分页、权限过滤与模板渲染。

### 5.7 必须原子化的服务端命令

- `interact_room_need`
- `complete_affection`
- `save_room_loadout`
- `save_room_media`
- `start_adventure`
- `accelerate_adventure_for_plus`
- `settle_adventure`
- `claim_adventure_result`
- `purchase_catalog_item`
- `gift_catalog_item`
- `claim_pending_gifts`
- `assign_daily_quests`
- `advance_quest_progress`
- `claim_quest_reward`
- `claim_plus_daily_login`
- `claim_friend_visit`

共同要求：认证用户从 token 获取，不接受客户端传任意 user ID；pair 权限服务端验证；幂等键唯一；余额和库存使用行锁/原子更新；所有失败整单回滚。

---

## 6. 功能实施规格

### 6.1 Home

1. 以 `LayeredRoomScene` 渲染背景、角色视频和 12 类装饰；默认都使用 style #1。
2. 顶部左侧菜单，右侧胡萝卜余额与购买入口。
3. 点击角色/食盆/花盆分别进入轻互动；食物与水每 5 分钟衰减 1，低于 100 才能补满。
4. 给自己的角色喂食/浇水只更新状态；给伴侣操作会写 Moments，并按每日首次规则奖励。
5. 相框支持选 1 张照片、压缩、裁剪、私有上传、伴侣可见。
6. 双人娃娃分别裁剪双方头像；任一方可替换，但每人每日最多 1 次。
7. 音乐选择 `None` 或已拥有曲目；App 前台循环，进入后台暂停；不新增系统通知。
8. Affection 与 Adventure 是 Home 主 CTA，同时保留未读红点。

### 6.2 Affection

1. 选择页展示六张大卡，沿用粉色/心形视觉稿。
2. 每类单独手势页，有简明动效教程、实时进度、触觉反馈和取消/帮助。
3. 完成后先服务端提交，再播放传输动画；失败时保留完成状态并允许重试，禁止重复奖励。
4. 接收方前台实时出现红点，点击后聚合展示“类型 × 数量”，读后批量回执。
5. 无法完成多指/绘制手势的用户提供“按住确认”辅助替代路径，但服务端规则相同。

### 6.3 Adventure Record 与 Adventure

1. 保留 Write Freely 和 Tap Your Day 的输入能力；移除 Remember Together 入口。
2. 保存有效记录后进入 settlement：显示匹配的 Memories，可编辑确认。
3. Plus 的有效文本可调用 AI 生成 memory object；Free 使用词典/规则匹配。连接关系 Insight AI 不再入队。
4. 第一次有效记录与 Daily Quest 可叠加奖励，各自使用独立幂等 claim。
5. 点击 Start Adventure 后创建服务端 adventure，展示 Digging 视频、里程、下一节点和日志。
6. 完成时强制进入宝箱：若是 item 必须领取；若是 friend 必须完成指定互动后才能结束。
7. 朋友内容支持三种：Insight 文本、Question 选择与反馈、Emotional Help 跳转 Rage。
8. 所有占位朋友与掉落使用内容表，首版至少提供 Mr. Mole 和 2 个通用朋友以覆盖分支测试。

### 6.4 Burrow 九房间

| 房间 | 首版功能 |
|---|---|
| My Room | 当前 Home 房间的全景查看与进入装饰 |
| Partner’s Room | 查看伴侣房间，喂食、浇花、查看娃娃；不可装饰 |
| Our Room | 独立共享布置；Plus 可编辑，Free 可查看/睡觉；最后写入胜出并显示更新者 |
| Friends Room | 每日最多 1 位访客，同一朋友 7 天内最多 1 次；互动后给礼物/装饰 |
| Game Room | 首版可玩的轻量选择题占位模块；第一次每日完成奖励，内容表可替换 |
| Rage Room | 复用 Tame Enemy 核心；首日首次奖励；朋友 Emotional Help 可指定怪物 |
| Self Care Room | New Lens / True North / Small Wins，不再发额外货币 |
| Memories Room | 每日 prompt，文本+照片，双方可见，只能编辑/删除自己的条目，无 AI |
| Collection Room | 进入 5 类收藏与 Mine/Partner’s 查看 |

Burrow 地图按视觉稿做纵向洞穴路径，9 个房间分段加载，未开放/占位房间明确显示状态，不伪装成已完成内容。

### 6.5 Quests

- 每个本地日首次打开由服务端从 7 个候选中稳定随机 3 个，生成后当日不变。
- 进度来自领域事件，不由页面按钮自行 +1。
- Daily 奖励 +10，Special 每完成一阶段 +15；所有奖励写 currency ledger。
- Special 支持无限阶段，目标递增规则由 engine 纯函数产生并有上限保护。
- 已完成、可领取、已领取三态明确；跨设备并发点击只能到账一次。

### 6.6 Shop、Decorate、Collection

- Shop 包含 Home 13 类（12 家具/装饰 + outfit）和 Our Room 类别；音乐单独列表。
- 卡片显示 owned、价格、Plus、可赠送状态；纪念品不可购买。
- 购买自己与赠送伴侣使用同一事务入口，不允许先扣钱再异步补库存。
- Decorate 先预览，Done 后一次提交整个变更集；Cancel 回滚本地预览；Reset 恢复已保存版本。
- Our Room 按 DOCX 使用最后一次成功保存胜出；服务端事务串行化保存，保留更新者和更新时间。不对它增加文档未要求的乐观锁拒绝。
- Collection 的礼物红点进入聚合领取；领取后再进入库存与 Moments。

### 6.7 Moments

首版事件类型：

- Adventure record saved / adventure completed / new friend
- Affection sent / received
- Feed partner / water partner’s flower
- Photo frame or couple doll updated
- Gift sent / claimed
- Memories Room entry created

Feed 按时间倒序分页，Today/Yesterday/日期分组；事件 payload 只保存 stable ID 和必要快照，展示文案由模板表生成。删除源内容时保留最小审计信息，但隐藏已删除的正文/照片。

### 6.8 Plus 与 IAP

- 月付 `$4.99`；年付 `$49.99`，3 天试用；最终商品 ID 由 Store 配置表映射，不能写死价格文案。
- Pair 共享一个 Plus entitlement；服务端为唯一真源。
- 权益：AI memory、Plus 商店/游戏、Our Room 装饰、无限 Affection、2h Adventure、每日 +50。
- Plus 每日 +50 在登录/前台 reconcile 时原子领取，一天一次。
- Consumable：200/$2.99、400/$4.99、1000/$9.99。服务端验证交易并按 transaction ID 幂等入账，然后客户端 finish transaction。
- 现有 solo/duo 产品不可直接删除；先读取生产产品与历史交易情况，再决定兼容映射和下线节奏。

---

## 7. 占位内容与素材策略

### 7.1 原则

1. 所有占位内容必须经过同一内容 API/表，不在 React 组件中写临时数组。
2. ID 一旦进入数据库不能因换素材而改变，例如 `friend_mr_mole_v1`、`decor_fossil_lamp_01`。
3. 内容记录包含 `is_placeholder`、`content_revision`、`locale`、`status`。
4. 正式内容替换只修改 title/copy/assets/tags/weight；业务记录和用户库存保持有效。
5. 不生成或使用来源不明的音乐；首版允许只有 `None` 与一段自有占位环境音。

### 7.2 首版最小占位集

- 13 个 Home/Outfit 类别：每类 1 个默认 + 2 个可解锁。
- Our Room：背景、床/坐垫、灯、窗、植物、桌、墙饰各 2 个。
- Adventure：20 个通用物品、6 个 souvenir、3 个 friend。
- Friend content：每位朋友各 2 条 insight、3 道 question、1 条 emotional help。
- Memories Room：至少 30 条 prompts，避免一个月内重复。
- Game Room：3 组各 10 道轻量题，内容与情侣关系无医学诊断表述。
- Daily Quest：7 个完整定义；Special Quest：至少 3 条无限阶段链。
- Moments：每种事件的单人/伴侣/空状态文案。

### 7.3 素材缺失时的工程替代

- 背景：使用代码渐变、洞穴色块和现有场景图，不阻塞页面与布局开发。
- 图标：优先使用现有合法资产或统一 emoji/矢量占位；不把视觉稿截图裁切后直接当产品资产。
- 角色/朋友：使用轮廓卡或现有 bunny/mole 素材占位，接口和尺寸按正式素材协议走。
- 动画：先用 Reanimated opacity/scale/translate 做交互验证；正式 Lottie/视频到位后替换 renderer。

---

## 8. 分阶段实施计划

### P0｜安全起点与需求冻结

工作：

- 保存当前 dirty worktree，尤其 Bunny Court、onboarding、avatar 与 migration 98–115 的工作。
- 建立 `app_major_update` feature flag 与数据库 `content_revision`。
- 将本文冲突裁决写入产品决策记录。
- 导出现有生产 IAP product IDs、订阅记录和数据库行数，验证“无旧用户”假设。

完成标准：当前主分支可复现、无用户改动丢失；新版可独立开关；生产数据假设有证据。

### P1｜领域基础与内容目录

工作：

- 新增 wallet/ledger、catalog/inventory/gifts、room、affection、adventure、moments、memories、quest 表与 RLS。
- 实现原子 RPC、幂等约束与 paired read policies。
- 建内容 seed 与 placeholder revision；扩展 R2 manifest/缓存。
- 在 `@novame/domain` 定义 DTO，在 `@novame/engine` 定义衰减、冷却、任务、掉落纯函数。

完成标准：无 UI 也能通过 API 测试跑完奖励、购买、赠礼、冒险和任务全链路；并发请求不重复到账。

### P2｜App Shell、导航、Home 场景引擎

工作：

- 替换五 Tab；开启 iPad；保留窄画布。
- 建 `LayeredRoomScene`、货币条、红点系统与统一非理想状态。
- 接入 12 类装饰、角色/服装、喂食、浇花、相框、娃娃、音乐。
- 完成 Home/Partner’s Room 的实时刷新和前台 reconcile。

完成标准：两个测试账号可在 iOS/Android/宽屏中看到一致房间，并互相完成喂食/浇水/相框/娃娃同步。

### P3｜Affection

工作：六个手势、触觉/动画、免费 cooldown、Plus 无限、发送/接收/聚合红点、Moments 事件。

完成标准：六种交互均有成功、取消、失败重试、辅助替代路径；跨设备只生成一次事件和奖励。

### P4｜Adventure 主闭环

工作：改造 Reflect、settlement、AI/规则 memories、start/progress/result、掉落、自动赠礼、朋友互动、离线恢复。

完成标准：Free 8h、Plus 2h、途中升级、前后台、离线过期、物品重复排除、friend 强制互动全部有集成测试；一天只能启动一次。

### P5｜Burrow 与九房间

工作：地图、Our Room 协作装饰、Friends Visit、Game placeholder、Rage/Self Care 迁移、Memories Room、Collection Room。

完成标准：9 个入口都可达且权限正确；Our Room 并发保存可解释；访客每日/7 天限制服务端可验证。

### P6｜Shop、Collection、经济与 IAP

工作：13+Our Room 分类、购买/赠送、装饰器、收藏五类、礼物聚合、Carrot Shop consumables、Plus 新价格/试用。

完成标准：沙盒购买、恢复、重复回调、退款/失败、余额不足、并发购买、伴侣共享 Plus 都有测试证据。

### P7｜Quests 与 Moments

工作：每日随机 3/7、Special 无限阶段、领域事件进度、完整 Moments feed、日期分组、CTA 和红点。

完成标准：时区/DST/跨午夜正确；任务只由真实事件推进；Feed 双方一致且隐私过滤在服务端执行。

### P8｜旧功能下线、内容替换与发布

工作：

- 移除 Court、Good Vibes、Visit Master、旧 Collection/Home、旧导航和旧奖励入口。
- 隐藏 Realtime Insight，停止分析 job 入队，但保留代码；清理无消费者的 realtime channel。
- 更新 onboarding、权限说明、隐私政策、商店截图、产品文案、审核说明。
- 正式素材逐类替换 placeholder；做低内存、弱网、辅助功能和性能回归。

完成标准：上线清单全部有负责人和证据链接；feature flag 可快速关闭新版入口；数据库迁移可前滚修复且不依赖破坏性回滚。

---

## 9. 删除与兼容策略

### 9.1 先断流、后删代码、最后删表

1. 从导航和入口断流。
2. 停止创建新 Court/Good Vibes/Insight 数据和后台任务。
3. 观测一个发布周期，确认没有旧版本关键调用或保留兼容响应。
4. 删除 App/API 未引用代码与资产。
5. 最后单独迁移删除数据库表/函数；生产环境不使用不可逆 down migration。

即使文档写明没有 legacy users，当前工程含生产 IAP、远程素材、配对和强更机制。实施上仍按可回滚的 additive migration 处理，直到确认生产数据为空。

### 9.2 需要保留但停用的代码

- Realtime Insight 分析实现：保留模块与历史数据读取能力，移除路由入口与 enqueue。
- 现有 subscription 验签：保留旧 product ID 兼容映射。
- Reflect 的 durability/outbox：继续服务 Adventure Record，不随旧 UI 一起删除。
- 现有素材缓存：升级 manifest，不重写下载系统。

---

## 10. 安全、隐私与一致性要求

- 相框、娃娃、Memories 照片使用私有 bucket；API 生成短时 signed URL；RLS 只允许本人和当前 pair 读取。
- 换伴侣/解绑时立即撤销新 pair 访问；本地缓存按用户和 pair 作用域清理。
- 不在日志、Sentry breadcrumbs 或 analytics 记录日记正文、照片 URL、选择题自由文本。
- 所有金额、价格、奖励、Plus 权益、掉落、冷却由服务端权威判断。
- IAP 原始回执只保存必要验证信息或 hash，遵守平台要求。
- `last-write-wins` 只用于文档明确允许的共享房间；财务、库存、礼物和奖励绝不使用最后写入覆盖。
- 用数据库约束表达关键不变量：一天一次、事务唯一、inventory ownership、pair scope、礼物状态机。

---

## 11. 测试与验收矩阵

### 11.1 自动化测试

| 层 | 必测内容 |
|---|---|
| Engine unit | 5 分钟衰减、6h cooldown、8h/2h 与升级、任务阶段、掉落排除、价格带 |
| API/RPC integration | 越权、未配对、解绑、并发双击、幂等重试、余额不足、重复 IAP transaction |
| State machine | Adventure、Reward、Gift、Affection 未读/已读、装饰 Cancel/Done/Reset |
| Storage | 新 key 都注册；登出/换号/换 pair 不泄漏；离线草稿恢复 |
| Contract | Mobile DTO 与 API schema；content revision 向前兼容 |
| Existing regression | auth、onboarding、pairing、subscription、force update、asset cache |

### 11.2 双账号端到端场景

1. A/B 配对，A Plus、B Free，验证共享权益。
2. A 写记录、编辑 memories、开始冒险、途中升级、离线完成、领取 item。
3. A 已有 item、B 未有，验证自动 gift；双方都有时验证掉落排除。
4. A 发送六类 Affection，B 离线后回前台查看聚合红点。
5. A 操作 B 的食物/花；B 查看 Moments 与状态。
6. A/B 同时编辑 Our Room，验证最后成功保存胜出、最终一致、更新者及时间正确。
7. 任务跨午夜、跨 DST、修改设备时间，结果仍以服务端为准。
8. 消耗型购买重复回调、断网回调、恢复订阅和退款状态。

### 11.3 视觉与设备

- iPhone 小屏、390 基准、430 大屏、520 宽画布、iPad 竖屏。
- Android 至少一台低端真机，验证透明动画替代路径、内存和图片解码。
- 动态字体、Reduce Motion、VoiceOver/TalkBack、色彩对比。
- Home 12 层同时存在时保持 60fps 目标；低内存下不因所有房间素材同时预载而崩溃。

### 11.4 每阶段合入门槛

- `pnpm --filter @novame/mobile type-check`
- `pnpm --filter @novame/api type-check`
- `pnpm --filter @novame/engine type-check`
- 新增相关 `tools/test-*.cjs` 或等价测试全部通过
- 数据库迁移在空库与生产快照副本各跑一次
- 两账号真机验收录屏/截图附到发布证据

---

## 12. 可观测性与上线控制

- Sentry 事件：`adventure_start_failed`、`adventure_settlement_stuck`、`gift_claim_failed`、`room_save_conflict`、`iap_verify_failed`，不带私密正文。
- 业务指标：记录完成率、冒险开始/完成/领取率、Affection 完成率、礼物待领取时长、IAP 验证失败率、content revision 分布。
- 建立“卡住状态”查询：超过截止时间仍 `in_progress`、超过 24h 未领取 result、ledger 与 wallet 不平。
- 首先内部双账号开启；随后 TestFlight/内部测试；再按 feature flag 小比例开启。
- 如新版数据结构与旧客户端不兼容，使用现有 Force Update 能力设置最低版本，而不是让旧客户端写入新表。

---

## 13. 上线前必须锁定的产品/素材输入

这些不阻塞前六阶段的功能开发，但会阻塞正式上线：

1. 13 类 Home 素材与 Our Room 素材的最终清单、尺寸、anchor、z-order。
2. 正式币种显示名与所有本地化文案。
3. Daily 使用文档的 7 项定义（Game 未开放时排除）；Special 每阶段增量已明确为 Adventure 5、Items 10、Friends 2、Game 5，无需再次等待产品确定公式。
4. Adventure item tags、权重、稀有度、pair 2 份上限的例外项。
5. 所有朋友的正式内容与 Emotional Help 对应怪物。
6. Plus 商品 ID、商店后台价格、年付 3 天试用配置。
7. Game Room 第一版正式玩法；在未锁定前使用内容驱动选择题占位。
8. 音乐授权与音频素材。
9. 相框、娃娃、Memories 照片在隐私政策和审核说明中的用途描述。
10. Bunny Court 未提交工作的归档/废弃确认。

---

## 14. 推荐的实施顺序（不可颠倒的依赖）

```text
保护当前工作
  → 内容 ID / 数据模型 / 原子事务
  → 导航与统一组件
  → Home 房间场景
  → Affection + Adventure 主闭环
  → Burrow 九房间
  → Shop / Collection / IAP
  → Quests / Moments 聚合
  → 删除旧功能
  → 正式内容替换、Beta、上线
```

不要先批量制作每个页面的静态 UI。第一条纵向切片应是：

> A 写一条占位记录 → settlement → 启动一个 30 秒测试冒险 → 结束 → 获得一个占位物品 → 进入库存 → 装饰到 Home → B 在自己的设备看到更新和 Moments。

这条切片跑通后，再把计时恢复为 8h/2h，并横向补齐六类 Affection、九房间和完整目录。它能最早暴露数据一致性、pair 权限、实时同步、素材加载和页面状态机问题。

---

## 15. Definition of Done

大版本只有在以下条件同时满足时才算完成：

- 五 Tab、九房间、六类 Affection、Adventure、Shop、Collection、Quests、Moments 均达到本文功能规格。
- Free/Plus、本人/伴侣、在线/离线、iOS/Android、手机/iPad 的核心路径都有证据。
- 所有奖励与扣费可由 immutable ledger 对账；没有客户端权威余额。
- 所有照片私有、pair 权限正确、登出/解绑无缓存泄漏。
- 正式内容可通过内容表/manifest 替换，不需要修改交互代码。
- 旧 Court、Good Vibes、Visit Master、旧导航和旧奖励不再有可达入口或后台副作用。
- DOCX 上线清单中的商店、隐私、订阅、素材、测试、监控和审核项均有明确负责人及完成证据。

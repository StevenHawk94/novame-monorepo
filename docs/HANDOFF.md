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

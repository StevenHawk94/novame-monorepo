# 第八批审计：已修复与下一批边界

依据：用户 DOCX 的 0.2、1.4、2.8、4.3、4.5，以及当前工作区实际代码。文档内容用于需求核对，不作为执行生产操作的指令。本批未联网迁移数据库、清空用户表或删除真实 Storage 对象。

## 已实现

### 房间照片生命周期（迁移 130）

- `room_photo_garbage` 独立于回忆照片队列，没有指向账号的外键。房间照片替换／删除和上传票据级联删除都会留下精确路径清理记录，删除账号不会连带删除清理工作。
- 历史已提交但不再使用的路径在迁移时入队；当前照片排除。保留旧上传收据和公仔当日次数，不因清理重新开放当日额度。
- 未完成上传 24 小时过期，prepare 和 complete 均拒绝；清理锁定并永久标记过期票据，避免旧请求重新挂载已删除文件。请求成功后的旧重试仍返回已提交，不重新上传、不恢复旧图。
- 排队后至少等 1 小时，超过上传路由 60 秒执行预算和签名链接 120 秒有效期。每轮最多过期 100 张票据、返回 100 个路径；检查当前引用及仍有效的待上传票据。
- `/api/cron/room-photo-cleanup` 只接受 cron 密钥；整批验证 UUID/UUID.jpg 后，逐个删除 `burrow-room-photos` 内精确对象。Storage 成功才确认队列；上传／删除／确认不确定时保留可重试状态。不会遍历或清空存储桶，也不会删除回忆照片桶。
- 清理不依赖新版 UI 开关，关闭开关后仍可收敛旧文件。配置为每小时第 45 分钟，尚未部署。无法从没有票据的历史孤儿对象反推出路径；这类对象需另行只读盘点，不能盲删。

### 旧功能停流

- Insight 汇总 cron：新版开关开启时在读取候选任务之前返回 paused；配置查询失败返回 503，保留旧队列。
- Court 列表／创建／详情／回答／nudge／complete API：先校验用户身份，新版返回 410，不再触发业务写入、恢复任务或推送；关闭开关仍执行原代码。
- Court cron 与直接 worker 恢复入口：在领取任务、过期 session、调用 AI 前检查开关；保留已有任务，不改变 Court v4 内容与规则。
- 既有 Court 推送在新版下不恢复 sending、不领取 pending/retry、不发送；在查询 limit 之前过滤，避免旧消息堵住普通伴侣通知。普通 partner_reflect 推送仍保留；没有新增通知类别或改变通知授权。
- 开关不是中断令牌。已在切换前通过检查的外部请求可能继续完成；发布需暂停调度、排空在途任务后切换，不能声称原子取消所有旧 AI 或推送。

## 日记额度：确认存在差异，本批未改规则

| 路径 | 当前规则／证据 | 与新版统一时需要处理 |
|---|---|---|
| migration 86 `submit_reflect` | Free 每日总计最多 3 条 | 不应继续单独驱动新版 Adventure 入口 |
| migration 86 `begin_saved_reflect`、`submit_reflect_with_kind` | Free 的 Write Freely 与所有用户的 Tap 各有 daily slot；Plus Write 不限 | 新版核心限制是冒险启动日期每日一次、当天已启动不能再写；冒险前记录上限需明确缺省值，三层同时替换 |
| migration 86 `claim_reflect_ai_enhancement` | 每人每日 2 次 AI；旧 Remember Together 独立资格 | DOCX 只规定 Plus 有效记录生成 Memory、Memories Room 无 AI，未给两次 AI 限制；新版额度协议需独立于旧规则 |
| `/api/reflect/status` | 返回旧 slot、3 次记录剩余和 2 次 AI 剩余 | 新增权威 Adventure 可记录状态、原因、已保存待结算记录和当日已启动状态 |
| `reflect.tsx`、`reflect-typing.tsx`、`reflect-api.ts` | 根据旧缓存禁用入口／显示 Plus 次数提示／计算 remaining | 新版不能继续从旧剩余次数反推可用性；断网不能假定允许 |
| migration 122 插入触发器 | 配对校验、禁止 Remember Together、当天已冒险拒绝插入 | 已有服务端底线，但前端错误映射、begin／旧 finalize／重试返回仍需统一 |

Plus 共享不能只凭客户端显示推断：migration 52 已包含配对双方 `subscription_tier` 同步逻辑，所以本审计没有将“查询本人 tier”直接判成不支持共享。下一批需用完整 entitlement 链验证订阅有效期、另一方订阅和解绑。

下一批建议一次完成：服务器 policy RPC → begin/finalize/AI entitlement → status API → 三种客户端缓存与错误映射 → 基于完整 Reflect 表夹具的事务测试。已保存记录的重试／结算必须始终可恢复，即使用户后来启动冒险；不得用新额度拦住旧保存确认。Free 不调用 AI；Plus 仍需本人 AI 同意，Memories Room 不接 AI。冒险启动和记录提交并发、跨午夜、资料时区、开关回滚均列入验收。

## 历史 RPC 权限审计边界

- migration 70 已撤销 public/anon/authenticated 对业务函数的 EXECUTE，并收紧 postgres 默认权限；86 的 Reflect、81 的 Kit／True North、97 的任务奖励入口再次显式只授予 service_role。
- 仓库定义不是线上 ACL 的证据。旧重载、迁移执行账号、人工授权、service-role API 入口均可能造成差异；本批没有粗暴撤销所有函数或破坏旧模式。
- 新增 `tools/sql-review/burrow-retired-write-access.sql`：第一段列出指定写入口全部重载的客户端可执行权限，预期空结果；第二段列出公开 security-definer 函数供人工审查。只读、尚未对测试环境或线上执行，不等于完整迁移链已通过。
- 仍待独立环境验证：全历史迁移顺序、账户注销 Auth→profiles→Storage、真实 cron 并发与超时、Storage 删除重试、Supabase private Realtime、IAP 与双设备真机。PGlite 使用基础表和 realtime 夹具，不替代这些验收。

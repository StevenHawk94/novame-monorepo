# Burrow 资金与数据安全审计

日期：2026-10-24。结论：已有有效的账本、签名、鉴权与房间隔离保护，但不能判定为“已全面安全”；下列高优先级缺口应先关闭。本轮只读审计，未修改运行时代码、数据库、生产配置或开发规范。

## 范围与证据边界

- 审阅当前工作区的支付/订阅、金币、业务命令、资料、删除账号、媒体、Admin 与数据库权限实现；不是对全部依赖和所有旧接口的形式化安全证明。
- 对已关联生产数据库执行 READ ONLY 元数据查询：迁移至 `20261024000268`；未读取用户正文、账本内容或照片，未创建账号、支付、领取奖励或删除数据。
- 生产 public 业务表未发现未开启 RLS 的表；anon/authenticated/PUBLIC 无业务表级或列级写权限；不可信角色无 public CREATE 权限。
- 普通用户可执行的非扩展 public 函数仅三个只读关系判断函数；未获得余额、发币、订阅、删除业务 RPC 的直接执行权限。
- 私有 room/memory/surprise 桶均 public=false；avatars 桶 public=true。
- 原有支付/余额不足/会员媒体权限专项：45 项通过；个人房间隔离真实 PostgreSQL/WASM：39 条断言通过。它们并不覆盖所有商店状态漏洞。
- 新增临时隔离反例：真实 Apple 路由逻辑、mock 验签边界，4 种输入均进入授权写入；另执行仓库原始订阅 SQL 函数，过期输入把 revoked/free 写成 active/plus。未伪造真实 Apple 签名，也未在生产执行恶意请求。
- 生产函数定义另做只读核对：`apply_store_subscription` 同样没有拒绝过去 expiry 的门禁。API 路由反例基于工作区代码，并未取得生产恶意请求执行证据。
- 未核实云平台 WAF 配置、实时部署源码与工作区逐字一致性、备份/PITR、密钥轮换及 Android/iOS 实际扣款退款全链路。

## 优先修复事项

### S1 · P1 · Apple 历史收据可重新授予过期/退款订阅

证据：`apps/api/src/app/api/apple-iap/route.js:155–221` 验签后不检查 revocationDate、不拒绝过去的 expiresDate，也不获取当前订阅状态；expiry 缺失时自行补 30/365 天。`supabase/migrations/20260820000052_entitlement_security_and_realtime.sql:124–273` 的 apply_store_subscription 无事件版本/终态保护，写 active 并更新 profiles.subscription_tier。保留旧 period_start 不等于防止状态回退。

隔离反例：有效签名数据边界下，expired 与 revoked 输入均返回200并调用授权 RPC；原 SQL 把已 revoked 的记录重新写成 active/plus，且 current_period_end 已在过去。大量业务仅读 profiles.subscription_tier，因此过去的 expiry 不会自动保护这些业务。正常原生 StoreKit 不主动展示旧购买，不能防止恶意客户端直接调用 API。

影响：不需要攻破 Apple 签名，持有本人历史有效订阅收据即可尝试重新激活权益，并影响配对共享权益、会员奖励等。没有真实收据的任意字符串仍受签名验证阻挡；这不是无条件伪造交易。

方案：统一服务端订阅状态机；核验产品、类型、应用、环境、账号绑定、当前商店状态与真实权威到期/宽限期。禁止缺 expiry 时自造周期；旧事件不得覆盖新事件或退款终态；退款撤销必须有明确的新权威事件才能恢复。将防重放与状态版本比较放进同一事务，供 API/Webhook 共用。高价值操作以当前有效权益判定，不能永久信任 profile 的冗余标志。对账任务补偿漏通知；普通页面使用已确认快照，不在每个按钮点击时请求 Apple。

### S2 · P1 · 测试订阅与真实经济权益没有严格隔离

Apple 路由把 Sandbox/Production 仅作为 diagnostic metadata，二者走同一会员授权；Google 订阅路由未对 testPurchase 设置同等隔离，且最终写固定 production。金币充值已有环境与钱包隔离，但会员权益及每日金币奖励没有随之隔离。

反例：路由在 production 部署标记下也接受 Sandbox 签名数据边界并调用真实权益 RPC。此处是服务端授权边界缺口，而不是测试环境一定不该拥有 Plus：TestFlight/Sandbox 体验需要另立明确政策。

方案：先明确测试账号准入与配对规则；测试订阅使用测试权益域/受控账号，不能流入真实可消费经济域，也不能把真实伴侣提升为生产 Plus。生产不能依赖客户端环境声明；使用商店权威环境。不得简单禁掉所有 Sandbox 而破坏 App Review/TestFlight，需要兼容设计。

### S3 · P1 · 生产 avatars 允许绕过服务端上传入口

生产 Storage INSERT policy `Users can upload avatars` 的条件只有 bucket_id='avatars' 与 auth.role()='authenticated'，没有本人路径前缀、上传票据或配额校验；桶 file_size_limit=null。普通用户可以绕过 upload-avatar API 的限流、文件格式与优化大小检查，向任意未占用目录新增对象。

影响：跨用户命名空间写入、垃圾文件/存储费用与公共内容滥用。不应夸大成可覆盖已有文件、修改对方 profiles.avatar_url 或删除他人对象：此次未发现对应 UPDATE/DELETE policy。头像本身为公开 URL，知道 URL 的人可读取，这不等于其他私有照片公开。

方案：优先撤掉普通用户直接 INSERT，保留服务端生成的 scoped signed-upload ticket；如兼容旧客户端必须保留直传，至少限定首级目录=auth.uid()并实施服务端配额。桶设置图片 MIME、大小硬限制，提交前校验内容，必要时服务端解码重编码。不能只修 App 内上传按钮。上线前用普通 JWT 验证跨目录、非图片、超限、重复覆盖、删除均被拒绝，正常票据上传仍成功。

### S4 · P1（旧业务暴露面）· 遗留 Airwallex 订单未严格绑定付款与目标订单

`book-payment/route.js:154` 直接把调用者提供的 originalOrderId/orderType 写入 PaymentIntent metadata，未核实目标订单归属及应付金额。验签后的 webhook 仅按 order id 更新 book_orders/orders，未再次匹配 metadata.user_id、订单金额/币种和该订单批准的付款意图；部分写入未检查 Supabase error。

影响：知道其他订单 ID 时可尝试用自己的真实付款推动他人订单状态，或错配付款与订单；数据库失败还可能返回200吞掉本应重试的通知。此路径不是当前 StoreKit/Play 金币充值路径；不能据此声称可直接给 Burrow 刷币。未进行真实付款攻击。

方案：如果旧业务已退役，关闭 create/更新入口并保留必要的已付款对账；仍需保留则创建前校验订单归属、产品、权威金额/币种，服务端绑定 intent，webhook 在事务中按完整绑定核验且只允许合法状态迁移。所有 DB 错误返回可重试失败，按 event/intent 幂等。不要用“页面不再显示”代替服务端关闭。

### S5 · P2 · 删除账号只依赖可离线验证的 access token

delete-account 正确要求 JWT 主体=目标用户，不能仅提供他人 UUID 删除其账号。但 auth-guard 只做本地 ES256 JWT 验签，不能即时看到撤销/封禁，也未对高影响删除要求近期重新认证。被盗但尚未到期的 token 可以在其有效窗口发起不可逆删除。JWT 的 issuer/audience 也应显式固定。

方案：高影响入口增加服务端在线身份/会话有效性核验与近期重新认证，绑定一次性删除确认；普通导航保留本地快速验签。分阶段清理、审计与可恢复保障应独立设计；存储、关系库与 Auth 删除不是同一个跨系统原子事务。当前失败返回500允许重试是正确的，但不能保证部分删除自动恢复。

### S6 · P2 · Android 金币已到账但 consume 失败仍返回503

`burrow-coins.mjs:86–92` 已持久化发币后调用 Google consume；consume 失败会抛 purchase_acknowledgement_pending，客户端没有得到已提交回执而展示待确认。没有证据表明因此重复发币，幂等会保护重试，但会产生“已付款/已到账却仍显示未确认”的体验。

方案：以发币事务提交为成功事实，返回已提交回执和 acknowledgementPending；收尾放进可恢复、持久化后台任务，原 token 重试。只有权威退款时反向记账，不因网络失败撤销已到账，也不重开付款。保留未 ack 可能被商店退款的处理。

### S7 · P2 · 经济相关入口的滥用门禁仍不完整

Apple/Google 核验、coins verify、通用 command、delete-account 未见统一代码级限流；现有 rate-limit helper 在 DB 异常时 fail-open。业务幂等可以防重复入账，但不能阻止攻击者换 key 消耗计算、网络、数据库与存储资源；也不能证明真实点击过本地玩偶等自报告行为。云端 WAF 是否已有补充未在本轮核实。

方案：分身份/IP/凭据摘要/业务动作设置有界限流，关键后台队列预算、并发上限和告警；真实已付款回执不能简单丢弃，限流后应可恢复。奖励应有服务端固定金额、资格与可追溯上限，不能信任客户端计数或日期授权奖励。活动接口允许频繁改变 timezone，按 local date 发奖的规则还应补“时区切换不能额外领取”的对抗测试；不要直接变更现行业务日历而不确认。

## 已有有效保护与权限划分

| 数据/操作 | 普通用户应有的权限 | 当前已核对保护 |
| --- | --- | --- |
| 本人资料 | 经 API 修改允许的昵称/头像/生日等 | JWT 主体匹配，字段白名单；不能提交 subscription_tier 或 balance 生效 |
| 钱包/库存 | 读取本人；经业务命令购买、领取 | 不能直接写表/调用发币 RPC，服务端定价、余额校验、账本锁、幂等 |
| 订阅 | 发起购买/恢复、读取本人状态 | 商店验签/API核验及凭据归属；S1/S2 仍须修复 |
| 个人房间 | 本人装修；伴侣仅获已约定的访问/照片交互权限 | 个人 owner/库存校验；39 条隔离断言通过 |
| Memories/信件/游戏等关系内容 | 当前关系成员按业务授权查看；自己的内容按规则编辑 | JWT actor、关系版本、作者/接收者检查；不允许任意 userId 代替身份 |
| 私有照片/音频 | 当前获授权者取得短期链接 | 私有桶、服务端先查归属再签名；已下载副本或未过期签名 URL 无法靠解绑瞬间收回 |
| 公共素材/头像 | 允许公开内容按既定产品规则读取 | 头像为 public；不应把它解释成私有文件。S3 限制写入仍不足 |
| 商品价格、奖励金额、账本、收据、权限状态 | 普通用户永远不能直接修改 | 服务端角色写；普通数据库写权限已撤销；修改本地显示不等于修改权威数据 |
| Admin/系统清理 | 仅管理员/服务端 | Admin getUser+服务器白名单；Cron secret；没有发现普通用户直接全库删除通道 |

RLS 不约束 service_role。因此“数据库没有给普通用户写权限”并不能替代每条 API 内的对象归属校验；S4 就是这一边界的重要反例。也不能保证恶意用户无法保存已经合法展示给他的共享照片或文字。

## 支付失败、余额不足与回退应如何理解

- **银行/商店拒付、用户取消、尚未批准**：正常路径不应得到权威权益/金币。Google pending 已明确不授予；客户端也没有在未经核验时直接调用加币。但 Apple 历史收据风险意味着不能回答“所有情况下绝对不会误授予”。合法免费试用本来可以不扣款即获得权益，不应误判为漏洞。
- **App 内金币不足**：服务端余额核验拒绝；本轮数据库测试证实没有授予库存，组合购买的后项拒绝会回滚前项扣款/库存。客户端乐观保留额只精确撤销该次拒绝，不应覆盖后续操作。
- **商店已扣款，业务核验暂时失败/超时**：可能出现暂未到账，不能当未扣款自动回滚或让用户重付。保留凭据，后台用原交易幂等核验、补发；永久不能履约时走明确商店退款/支持流程。App 无法自行撤销银行卡扣款。
- **业务已提交，缓存或 finish/consume 失败**：权威成功不能改成付款失败。iOS 客户端 finish 失败已有保留成功保护；Android 服务端 S6 需要对齐。
- **权威退款**：金币有反向账本与旧收据重放保护；已花掉可形成债务，后续收入抵扣，不允许普通消费继续扩大债务。订阅退款状态仍需补 S1 的终态保护。

## 推荐实施顺序与验收

1. 先补 Apple 当前权益核验、原子事件版本/退款终态及测试权益隔离；同时限制 avatars 直传。先验证兼容 App Review/TestFlight/旧客户端，不擅自清除现有用户权益。
2. 关闭或加固遗留订单入口，给删除账号加近期认证；完善 Android 已到账后的收尾任务。
3. 统一反滥用预算、经济告警与定期商店对账。确认生产备份/PITR并实际演练恢复；本轮未验证恢复能力，不能只因有备份设置就承诺可恢复。
4. 必测：无签名/错误应用/错账号、过期/退款/撤销/宽限期、Sandbox跨经济域、同凭据并发/重放/删号重注册、提交丢回包、退款早于客户端回执、Google consume失败、余额不足、跨账号读改删、解绑旧链接、头像越权上传、管理员撤权与过期会话。
5. 所有修复保持用户端最小订阅与即时反馈；后台核验、队列收尾和对账不阻塞正常页面。涉及资金的“权威成功”仍须真正核验，不能为了流畅提前授予真实会员/金币。

官方依据：[Apple 当前订阅状态 API](https://developer.apple.com/documentation/appstoreserverapi/get-all-subscription-statuses)、[Google Play Billing 购买处理与核验](https://developer.android.com/google/play/billing/integrate)。签名证明交易来源，不代表历史交易在当前时刻仍有有效权益。

验收原始记录（本机临时目录，不含真实凭据或用户内容）：`/private/tmp/burrow-security-live-acl.json`、`/private/tmp/burrow-security-live-metadata.json`、`/private/tmp/burrow-security-repros-20261024.json`、`/private/tmp/burrow-security-existing-tests.log`、`/private/tmp/burrow-security-personal-db.log`。

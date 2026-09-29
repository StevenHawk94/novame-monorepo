# 第十批：金币 IAP 与可撤回的日记分享

本批依据用户确认的三个商品 ID，以及「日记原文默认分享给伴侣，用户可以关闭」实施。素材继续占位。代码已完成本地核验；没有部署、开启线上购买、执行真实支付或应用远程迁移。

## 日记分享（迁移 138）

- Write Freely / Tap Your Day 均显示默认开启的本篇分享开关；关闭后仅本人在 Moments 中可见。
- 新记录保存时冻结作者、原伴侣和分享选择。Moments 显示原文、匹配物品名称及用户允许展示的 Memory 描述；不使用原始摘录作为隐私降级兜底。
- 作者可以在 Moments 关闭／重新开启该篇分享，伴侣不能操作。关闭后服务端不再向伴侣返回该事件／正文；实时失效通知、重新进入页面及前台快照会清除旧页。无法撤回对方已经看到、复制或截屏的文字。
- 不回填、不公开旧日记；已保存旧请求的重试不改变原隐私选择。保存时与之后读取时均检查配对，不能把原文转给新伴侣。同一对用户重新配对的历史保留规则沿用此前设计。
- 旧 `shared_to_friends` / `shared_with_user_id` 不用于新原文分享；保护触发器防止旧结算把新日记扩大公开。新表与读取投影仅允许服务端调用。
- 这里的开关是**每篇日记**的选择，不是一个改变历史内容的全局公开开关。

## 金币购买（迁移 139）

| 商品 | 服务端固定数量 |
|---|---:|
| `burrow.coin.200` | 200 |
| `burrow.coin.400` | 400 |
| `burrow.coin.1000` | 1,000 |

- Carrot Shop 从系统商店读取本地化价格；不可售、配置未就绪或查询失败时不允许付款，提供重载与未完成交易检查。无硬编码美元价格，无模拟入账。
- 沿用 App 启动时的唯一购买监听器，覆盖冷启动／前台恢复；不在页面重复注册监听器。购买绑定登录账号，取消、待批准、断网、重复点击及账号切换有独立处理。
- `/api/vnext/coins/verify` 验证身份和商品，忽略客户端声明的金额／用户 ID。Apple 验证 JWS、bundle、Consumable 类型、环境与 appAccountToken；Google 查询产品购买 v2，验证 package、商品、账号哈希、购买状态及可退款数量。
- 先提交服务端账本再结束交易。Apple 在入账成功后 finish；Google 在入账成功后由服务端 consume，失败保留可重试状态。已消费商品不宣称能被系统「恢复购买」，余额保存在原 App 账号；只能恢复未完成交易。
- 订单唯一键、账号绑定、签名时间／退款顺序防止重复发币、跨账号认领及旧收据恢复已退币；Google 退款数量单调递增，防止并发旧查询重新加币。
- Apple 通知处理消耗型购买／退款／撤销／退款逆转；金币不接受现有开发环境验签跳过开关。Google 金币 RTDN 强制 OIDC，推送只是重新查验商店状态的信号。
- 已购买金币不会被旧 99,999 奖励上限吞掉，日常奖励也不会把超上限余额压低。退款已花掉的币以负余额记账，禁止继续透支；之后获得／购买的币先抵扣。账号删除后保留交易绑定墓碑，避免同一订单重新认领。

实现参考：[Google 安全购买流程](https://developer.android.com/google/play/billing/security)、[产品购买 v2](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2)、[服务端 consume](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/consume)、[Apple appAccountToken](https://developer.apple.com/documentation/appstoreserverapi/appaccounttoken)。

## 配置和发布顺序

1. **独立测试数据库**应用既有前置迁移，再执行 138、139；随后发布 API / webhook 和 Mobile。138 依赖真实 Reflect 前置迁移，不能单独跳过 131。
2. `BURROW_IAP_ENVIRONMENT=sandbox`，完成 Apple 沙盒通知配置；Android 还需 Play service account、`GOOGLE_PUBSUB_REQUIRE_AUTH=true`、准确的 push audience 与 service-account email。详见 `apps/api/.env.example`。
3. 确认商品为 Consumable／one-time consumable 且可售、地区／协议／税务状态正常；确认外部回调实际可达，测试以下矩阵后才设置 `BURROW_COIN_PURCHASES_ENABLED=true`。该开关默认关闭，仅控制新结账，已付款订单仍允许验单结算。
4. Sandbox 与 Production **不能共用钱包数据库**。TestFlight／测试购买使用隔离环境；生产改用 `BURROW_IAP_ENVIRONMENT=production`，不接受沙盒收据。不要仅修改环境变量而沿用已有沙盒余额。
5. 仍需真实设备验证三档商品、取消／待批准、重复回调、付款后杀进程、网络中断、账号切换、Google consume 重试、退款在入账前／后到达、Apple 退款逆转、两个账号观察日记撤回。没有用本地通过代替这一步。

## 已验证

- 原有 Node 回归 216 项通过；新增支付／webhook／监听器测试 16 项通过（共 232 项）。
- PostgreSQL/PGlite 主夹具 328 项断言通过，新增订单幂等、退款、负余额、超过奖励上限、删除账号及权限断言。
- 完整耐久 Reflect 前置夹具加 138：11 项测试通过，含默认分享、关闭、撤回、作者权限、旧请求不回填和不配对不可读。
- Mobile / API TypeScript、`git diff --check` 通过。
- iOS / Android Expo/Hermes 导出成功：`/tmp/novame-burrow-phase10.IR9xlu/ios`、`/tmp/novame-burrow-phase10.IR9xlu/android`。不是签名 IPA/APK/AAB。已有 Sentry organization/project 配置警告仍需发布配置核对。
- 主夹具覆盖 116–130、132–137、139；131、138 在 Reflect 夹具单独执行。不是完整历史数据库重建、真实跨连接竞争或真实商店签名／通知端到端测试。

## 仍非素材的事项

- 尚未给出或确认新版 Plus 月／年商品、价格与三天试用配置，因此保留原订阅 ID 和系统实际价格，不擅自替换。三个新 coin ID 不等于订阅 ID。
- 完整远程测试迁移、真实 IAP、双设备实时／Storage／推送、原生权限与无障碍验收仍需测试环境及授权。未声明「只剩素材」。
- 第九批遗留的全历史 RPC ACL／旧入口最终审计、可选的新增内容／回滚 CMS 等不因本批支付完成而自动完成；范围边界仍见第九批核验。

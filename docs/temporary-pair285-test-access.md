# 临时配对测试许可（2026-10-28）

仅 `24FAGF` / `88US9W` 当前双向关系生效。迁移 285 与对应单文件 API 已上线；具体授权、哈希、测试及发布证据见 [报告](../tools/reports/temporary-pair285-2026-10-28.json)。

- 启用：洛杉矶时间 2026-10-28 09:29:48 PDT。
- 自动失效：洛杉矶时间 **2026-11-04 08:29:48 PST**（固定 168 小时，期间发生夏令时切换）。不依赖另一次部署/定时任务。
- 开放：Couple Adventure/Nudge、有效 Plus 的伙伴共享、Game、Surprise/赠礼、Touch Note。真实支付、独立钱包/库存、原有次数和奖励规则不变，经济域仍为原来的 Sandbox / Production。
- 双方打开一次 Me 页面即可触发现有会员/房间刷新，或重新进入前台。无需重新配对；重新配对反而会使冻结许可失效。
- 已开启的两条 Solo 不会自动合并。验证 Couple 仍需每人自己的 log/次数、先启动者剩余超过十分钟、另一方尚未启动；许可不重置这些条件。
- 关闭后不撤销已提交交易。Touch Note 原回执、已付款 Surprise、已发送礼物、既有 Adventure/解锁继续原有收尾；未付款旧草稿不能借此新增扣款。失去 Plus 后 Touch Note 历史仍依 Free 规则裁剪。

## 提前关闭与恢复证据

只有用户明确要求时，受控数据库管理员可执行以下**精确**关闭，不修改经济域/钱包，不恢复旧收据或退款，不清空用户内容：

```sql
update public.burrow_temporary_test_pair
set enabled = false
where pair_low = '36b75655-a89b-45dd-b232-a35db4efe502'
  and pair_high = '4d95e1b8-09e9-4904-aaaa-5e564dabb603'
  and pair_version = '598d48d14cda41f9d15e119f9fb62a15';
```

之后只读复核两个方向的 `burrow_test_pair_allowed_v1` 均为 false、真实 `same_economic_domain_v1` 仍为 false、原有效自有 Plus 未变。借用会员标签经既有 `refresh_economic_entitlements_v1`/Me 刷新收敛；权威授权不依赖标签。不自动重新启用、延长期限或继承到新关系，需要新授权。

生产旧函数定义/ACL、候选逐文件核对、事务保护结果与部署回执保存于 `/private/tmp/burrow-test285.akntzR/`。正式 API 只更新 Duo 状态展示的一处权威 RPC，其他 292 个文件与原生产内容一致。无需在七天后删除函数或部署旧版本来实现关闭。

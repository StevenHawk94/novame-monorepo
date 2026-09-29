# Burrow 大版本：实施状态与交接

更新：2026-09-28。总体需求见 `app-major-update-implementation-plan.md`。

## 当前状态

**已实现前十一批代码，完成一轮收尾审查，但尚未达到“只剩图片和文字素材”。** 第十一批修复分享撤回被迟到请求覆盖、旧任务／气泡奖励入口、付款回调跨账号／新订单状态污染，以及历史刷新关闭编辑器的问题。241 项 Node 回归、328 项主数据库断言、14 项独立数据库测试、Engine 197 项、Domain 23 项、类型检查及双平台导出通过。详见 [第十一批收尾核验](burrow-phase11-audit.md)。第十批三个 coin ID 的支付闭环和日记原文默认分享见 [第十批核验](burrow-phase10-audit.md)，此前范围见 [第九批核验](burrow-phase9-audit.md)。用户授权后，已在当前 CLI 关联的 Supabase 项目执行 `116–141` 共 26 个迁移，远程记录确认无遗漏。2026-09-28 已将当前 API 部署到 Vercel 生产环境（`dpl_81Tx5cGVCDYwdL68FvAxW42ArQMy`），`api.soulsayit.com` 返回新版配置；随后将 `app_major_update_enabled` 切为 `true` 并通过数据库与公开接口双重确认。金币购买启用变量仍未设置，购买保持关闭。移动端尚未发布 OTA／商店版本，需要通过本地 Metro 和 `expo run:ios` 实机测试；Git 尚未提交。插画、角色、装饰及音乐继续使用可替换占位。

工作区原有 Court、onboarding、配对、头像等修改保留。开工前的可恢复快照位于 `/tmp/novame-major-update-checkpoint-20260927.tgz`。本轮没有删除这些原有工作。

2026-09-28 配对入口调整：配对不是进入新版页面的前置条件。未配对的已登录用户由 API 获得只含本人数据与已发布公开内容的只读浏览快照；Home、Burrows、Quests、Shop、Collection、Moments 等页面可进入，点击依赖配对的操作时再弹出连接提示。Onboarding 明示可以跳过配对。对应 API 已部署到现有生产域名（`dpl_2fJZ18bzxrHZAyWsq2x1L9bcArnH`）；未配对下的真实设备交互仍待验证。

## 已落地

- [x] 域模型：9 房间、12 Home 装饰槽位、13 Home 商品类别 + Our Room、5 收藏类别、6 Affection、任务和货币规则。
- [x] `116–141` 新迁移：内容、库存、钱包流水、赠礼、房间、互动、冒险、回忆、照片与任务表及权限、私有实时通知、版本保护保存、照片清理、记录策略、历史、内容编辑、关系代次、版本化日记分享、真实订单账本及旧气泡奖励停用，附离线 SQL 集成验证。
- [x] 三档金币 IAP、实际商店价格、服务端验单／退款、唯一全局监听器恢复、启用检查；尚未经真实沙盒购买，不代表线上可付费。
- [x] 本篇日记原文默认向当前伴侣分享；可保存前关闭或在 Moments 撤回；旧日记不回填、不自动公开。
- [x] `/api/vnext/bootstrap` 单事务配对快照。先检查开关和双向配对；未启用时不初始化钱包／房间。返回数据禁止缓存。
- [x] `/api/vnext/command` 身份校验、输入边界、UUID 校验、服务器价格、库存／钱包事务、重复请求处理。
- [x] 五主入口：Home / Burrow / Quests / Shop / Moments。关闭开关保留旧界面；新版下 Court、Insight、Visit Master 深链回到 Home，Good Vibes 全局弹层停止挂载。
- [x] 新页面：原生洞穴占位场景、九房间地图、商品类别、详情、购买确认／赠礼、Mine/Partner 收藏、礼物领取、只读 Moments、任务与奖励。
- [x] 固定槽位装饰：预览、取消、恢复默认、事务保存、物品归属及槽位校验；Our Room 要求共享 Plus，最后成功保存胜出。
- [x] 照料：自己／伴侣的食物和水，服务器时间衰减、补满、幂等、Moments 与当日伴侣奖励。
- [x] 六 Affection 手势原型、共享 6 小时免费冷却、Plus 不限次数、服务端基础手势参数校验、接收计数和已读。
- [x] 复用现有耐久日记结算；隐藏 Remember Together 入口；结算跳转冒险；新版本不再从 finalize 入队 Connection 分析，保留 memory AI。
- [x] 冒险：验证已结算的本人当日记录、每天一次、Free 8h／Plus 2h、Plus 中途缩短、离线到期对账、稳定结果、领取、物品与朋友可同时出现、服务端校验朋友互动响应。
- [x] 收齐内容池的边界：生成 `quiet` 结果，正常完成但不凭空发放重复物品。这是缺省规则补充，正式上线前复核文案即可，不应重新引入无法结束的冒险。
- [x] Daily：游戏未开放时从 6 项稳定选 3 项，每项 +10，真实事件推进；Special：5 次冒险／10 件非初始物品／2 位朋友递增，每阶段 +15，游戏任务不展示。
- [x] 首次记录 +10、首次 Affection +10、首次伴侣喂食／浇水各 +5、Plus 当日登录 +50；服务器幂等账本。
- [x] Memories Room 文字新增、编辑、删除；仅作者可编辑／删除，当前伴侣可读，不使用 AI。包含 30 条可替换提示。
- [x] 客户端共享请求、重复点击锁、失败重试沿用请求键、退出／切换账户丢弃过期私有响应；新旧入口加载协议分离。
- [x] 新页面居中窄画布；打开 iPad 支持配置（仍需真机回归）。
- [x] Our Room：双方各自持久化睡眠开关，床和按钮均可操作；双方入睡时场景变暗；Free 可睡觉、不能装修；最后装修者提示；过期重试不会覆盖更新后的睡眠状态。
- [x] Friends Room：共享每日来访，同一朋友 7 天间隔，仅从已完成发现的朋友中选择；未处理访客跨天保留；入口待处理标记；见闻确认、提问反馈、情绪求助三种交互。
- [x] 朋友来访保存内容快照，替换内容库不修改正在进行的互动。赠品只取 `friend_gift` 标签物品，赠送入库与 Moments 同事务；双方重复领取只生效一次，不发金币。双方已收齐则正常结束，不伪造新物品。
- [x] 情绪求助使用真实心魔 ID，Yes 跳转对应 Rage 战斗，完成后回朋友页领取；服务器校验接受求助之后的对应战斗记录；No 结束本次来访且不发赠品。
- [x] 新版 Rage：保留每怪物战斗积分和既有每日两场限制，取消旧 Clover／里程碑币，首次战斗 +5 胡萝卜币；重复请求不再发奖、不再加积分；超时有重试，原请求键不变。
- [x] Self Care：New Lens／True North／Small Wins 在新版下不发旧币，旧版本开关关闭时维持原逻辑。
- [x] 房间相框：相机／相册选择、原生编辑器拖动缩放裁切、预览／取消／保存；每间个人房单独一张，仅本人替换，当前伴侣只读。
- [x] 双人公仔：方形照片原生裁切后圆形展示；可替换自己／伴侣房间的公仔脸；每位操作者每天总计一次，跨房间／跨请求键均不能绕过，取消不计次数。
- [x] 私有媒体：新增独立 `room_photos`／上传票据，不破坏旧 `room_media` 占位表；SHA-256 绑定不可覆盖上传路径、成功重试不回写旧照片；照片提交和 Moments 同事务。不将私密照片复用公开头像桶。
- [x] 音乐：播放器内专属曲目列表、None、免费已拥有曲目、付费曲目金币购买、服务端所有权校验。默认 None；全局只挂载一个循环播放器，后台／退出释放、前台恢复选择，失败可重试。两段原创程序音调 WAV 为占位，总计约 689 KiB，无外部素材下载。
- [x] Our Room 独立装饰补齐：床／墙面／吊灯／地毯／窗户五个独立槽位，各含默认和付费占位样式；仍由共享 Plus 控制装修，最后保存生效，不能写入个人 Home。
- [x] 冒险朋友支持见闻确认、2–4 选项提问／反馈、情绪求助三类型；与来访共用内容表和发布校验，按 `trigger_scene` 筛选。Yes 记录接受时间，跳转对应 Rage，服务端核验之后的本人／当前伴侣战斗；No 正常结束且保留已发现朋友，不额外发币或朋友赠品。
- [x] 每次冒险启动冻结日记物品类别映射的标签和规则；结算冻结物品、朋友、对话快照。内容替换不改变待处理互动，重复回答返回原反馈。此前已生成的待处理结果在迁移时冻结旧提问分支。
- [x] 掉落实现显式获取标签、价格门槛、Plus 排除、真实基础权重与标签加权；保留双人库存／待领取预留，双方均拥有则排除。Our Room 可获得明确标记的非 Plus 掉落；免费收集不绕过共享房装修的 Plus 权限。
- [x] 纪念品不售卖、不赠送；自己已拥有即从自己的掉落池排除。迁移前待领取的重复纪念品正常转为 quiet（若同时有朋友则保留朋友），不让旧结果卡住或误赠。
- [x] 新版 `reflect/prepare` 与旧草稿 `finalize` 不再发旧 XP；Memory AI 保留。旧一步式 Reflect、旧 Daily／Special 奖励、Visit Master、Good Vibes、旧 Cosmetics 购买 API 在认证后返回 410，开关关闭时保留旧逻辑。
- [x] Connection 入队、worker、兼容 fallback、cron／邮件告警均检查新版开关；新版不领取旧队列任务、不删除旧任务，保留回滚可能。配置读取失败拒绝处理，不继续旧 AI。

- [x] 第五批角色换装：统一 `BunnyActor`，Home／伴侣房／Our Room／挖掘页读取对应主人服装。默认探险装 + 3 件可购买占位服装；试穿、购买、保存、取消、恢复默认；未拥有可以预览但不能保存，个人服装不能写入共享装修槽位。
- [x] 角色状态：个人房兔子外出时隐藏，返回后恢复；共享房分别显示双方衣服与睡眠，挖掘页显示持铲状态。食物／水为 0 不改变外观；动画在后台、失焦、减少动态效果开启时停止。
- [x] 冒险结果导航：冷启动／后台返回后等待新的服务器快照；完成结果在主导航安全时打开，等待启动遮罩、弹窗、正在保存操作和日记结算结束。前台到期仅刷新和显示 Home 提示，不自动打断当前页面。已打开结果不重复压栈。
- [x] 结果页拦截返回／移除：领奖和必需朋友互动完成后解除；仍可向前进入求助战斗再返回。解绑／关闭开关时解除，避免拦住退出新版。领取／互动权威仍由服务器掌握。
- [x] 照料值使用服务端原值＋更新时间投影，避免对已衰减数值重复扣减；前台时间采用单调计时，改手机时钟不直接跳动显示值。伴侣冒险只暴露 ID／状态／起止时间，不返回日记、标签和结果内容。

- [x] 第六批 Memories Room 照片：先保存文字，再进入该条回忆相册；相机／相册、原生裁切、预览、保存、替换、单图删除。仅作者修改，当前伴侣只读。关闭相册不影响已保存记录，上传失败保留本次编辑会话中的草稿／请求键；不运行 AI。
- [x] 私有回忆照片：独立桶 `burrow-memory-photos`，只通过认证 API 上传／取得短期链接；客户端不提供存储路径。1 MiB JPEG 上限、512×512 重新编码、SHA-256 绑定不可覆盖路径、精确旧版本冲突检查。旧成功重试不恢复旧图，删除同时撤销该槽位待上传票据，避免旧上传复活已删除照片。
- [x] 照片生命周期：替换／单图删除／回忆软删除／记录与账号资料级联删除均保留独立存储清理记录；过期未完成票据也进入清理。清理 API 使用 cron 密钥，失败不确认队列，重试只删除独立桶中的服务器生成路径。删除整条回忆同步移除相应 Moments。
- [x] 每日引导问题：按服务器快照的 `localDate` 从排序后的问题库稳定轮换；同一天保持相同、次日切换，编辑旧记录保留原问题。无需新增 AI 内容。
- [x] 第七批实时与文字离线：私有空载荷通知、前台订阅／后台释放／退避重连、配对失效隔离；回忆文字本机草稿、显式保存队列、重启幂等重放、版本冲突提示和本地清理。详细边界见本文末节。
- [x] 第八批房间相框／公仔清理：旧图替换、删除与账号级联清理队列；24 小时未完成上传过期、1 小时删除宽限、每轮最多 100 个对象；保留公仔次数和成功收据，失败可重试。独立 cron 只处理房间桶，未部署。
- [x] 第八批后台停流：新版 Court 四个 API handler 返回 410，cron／worker 暂停；既有 Court 推送过滤但普通伴侣推送保留。Insight 汇总 cron 暂停，配置失败拒绝继续，旧队列与 Court v4 规则保留。

### 第六批缺省值、运行边界与上线前检查

- DOCX 2.8 要求照片数量沿用 Remember Together；检查 `shared-memory-create.tsx` 和旧 Reflect 链路未发现用户照片上传或既有数量限制。因此采用**每条最多 3 张**作为可调整默认值，前后端均限制槽位 0–2，不声称这是原产品限制。当前统一方形裁切；后续可调整数量／比例，需要同步 UI、API、SQL 约束。
- 文字与照片分步保存，界面明确提示先保存文字再加照片；单张上传不回滚文字。不是文字＋多图一次原子提交，也不支持纯照片空文字记录。相册仅打开时加载照片，避免为全部列表签发链接。
- 签名链接有效期 120 秒，前端不持久化 URL、图片禁用磁盘缓存，后台／页面离开／账号变化清除链接；**已发出的链接在解绑或删除后可能仍使用至到期**，不声称立即撤销。尚未部署 Supabase Storage 或验证线上桶策略。
- `128_burrow_memory_photos` 新增照片、票据、清理队列表与服务 RPC。authenticated 不能直接读路径、写表或调用上传完成 RPC；bootstrap 只返回 id／slot／updatedAt。
- 未完成票据 24 小时后失效；后台分批过期，每次最多 100 张；清理队列再等待 1 小时（超过上传路由 60 秒预算和短链寿命），每次最多删除 100 个对象。API 删除成功才确认队列，失败保留重试。票据幂等记录保留；尚未实施历史票据归档。
- 新增 `/api/cron/memory-photo-cleanup` 与本地 Vercel 每小时调度配置，**没有部署或运行线上删除**。上线顺序：应用 128 → 确认 private bucket / RLS / `CRON_SECRET` → 发布 API 和任务 → 在独立测试环境验证替换／失败重试／删除／账号注销清理 → 再开启新版。不要在迁移前单独发布 cron。
- SQL 已验证 profiles 级联删除时清理记录不会一同丢失；真实账号注销的 Auth、资料及 Storage 全链路仍需联调。第六批清理器仅处理回忆照片；房间相框／公仔的独立清理器已在第八批补齐，两者不能混用。
- 照片草稿和上传重试键只保存在当前编辑器内存中，关闭 App 后不会恢复；持久化离线队列仍属后续批次。刷新、原生裁切及多设备状态需真机验收；列表目前仍是最近 100 条，尚无历史分页。
- 每日问题随服务器快照刷新切换；跨午夜一直停留当前页时需要刷新。未在这批添加全局午夜刷新调度。

### 第五批边界与后续验证

- 角色为 SVG 与轻量原生动画占位，不是最终透明视频；`BunnyActor` 的 pose／outfit 边界供后续替换。静态衣服四种样式不需要远程图片或新依赖。
- 新增 `127_burrow_character_state`：3 件非 Plus 付费占位服装、最小伴侣冒险状态、照料原值时间戳。价格 90／120／160 为可替换开发值；未改变线上开关。
- 自动结果导航只在主 tabs 安全时进入，详情页、表单、战斗不被替换。Home 的照片／音乐／商品原生弹窗加入全局占用登记。真正退后台才创建恢复意图，系统弹窗导致的短暂 inactive 不触发；旧请求和账号切换后的响应不能满足恢复检查。
- 完成已打开的结果仍为必需；网络异常保留待处理状态并提供刷新，不在客户端假完成。此前接受求助且当天战斗额度已用完的情况仍沿用原规则（伴侣协助或次日继续），没有新增战斗额度。
- 尚未验证真机导航手势／原生弹窗／屏幕阅读器及多设备切换。测试覆盖逻辑和编译，不是最终视觉验收；里程／冒险日志／开箱动画仍未实现。

### 第四批占位规则与边界

- 配置表 `burrow_adventure_rules` 的临时默认值：可掉落商品价格上限 300、新朋友概率 25%、每个匹配标签额外 2 倍基础权重，最多计 3 个标签。基础权重与加权通过稳定哈希指数抽样生效；同一已生成结果不会重抽。参数是开发缺省值，不是最终经济数值。
- `burrow_record_category_tags` 将现有 12 个记录物品类别映射到主题标签，无需额外 AI、也不把日记全文传给新模型。没有匹配标签时仍按基础权重选择。正式内容可改表，已经开始的冒险保留启动规则／标签。
- 仅 `adventure_obtainable` 可进掉落池，`purchase_only`／`plus_exclusive`／`friend_gift` 作为本批互斥获取标签排除；不把普通商品或朋友专用礼物误纳入冒险。纪念品采用 DOCX 3.5 的更具体“不赠送”规则，优先于普通物品重复自动赠送规则。
- 三类朋友内容发布校验：非空正文、合法类型、问题 2–4 个唯一选项且每项有反馈、情绪求助只有 yes／not_now 且使用现有真实心魔 ID。正式图像与内容管理后台的发布工作流仍未完成。
- 冒险接收朋友后才产生互动；求助接受状态持久化，返回／重开可继续，UI 不伪造战斗完成。来访的朋友赠品规则保持原样，冒险见朋友不再额外添加一份来访奖励。
- 本轮是 API／队列入口停流，不声称已经撤销所有历史数据库 RPC 的客户端授权；老客户端直连 RPC、AI quota／记录次数仍需剩余审计。开关并非中断令牌：已进入旧 AI 调用的请求无法靠这次布尔检查取消。上线切换需先暂停 cron、等待既有工作完成，再切换开关，不能在旧 worker 正执行时宣称即时零写入。
- 第四批结束时未完成的强制结果导航／返回拦截、冷启动打开结果、前台到期提示已在第五批补齐；里程／日志、开箱动效、通用待发送队列仍待实现。

### 第三批媒体／音乐实现边界

- 路由 `GET/POST /api/vnext/room-photo` 只接受身份绑定请求；1 MiB JPEG 上限、正方形尺寸 64–1024、分段结构／签名检查；客户端重新编码为 512×512，不上传原图 EXIF。API 对上传限流故障采取拒绝策略。
- 存储桶 `burrow-room-photos` 为 private，不授权客户端任意列举、写入或读取路径；服务端验权后签发 120 秒 URL。已发 URL 在解绑后最多仍可使用至过期；不会声称立即撤销已签名 URL。前端不持久化 URL，禁用照片图片缓存，离开页面／后台／切换账号清空。
- 当前照片请求键在编辑会话内复用。关闭 App 后待上传草稿／重试键尚未持久化，列入离线批次；已成功写入的照片／次数／Moments 均保存在服务器。
- Native 相册／相机编辑器负责拖动与缩放，公仔以圆形预览确认，不是自建圆形拖拽手势控件。需 iOS／Android 真机分别确认原生裁切体验与图片方向。
- 音乐选择持久化，重开 App 后取得配对快照才恢复；None 永久保持静音，后台不继续播放。只播放 App 内白名单 bundle key，不下载或执行内容库中的任意音频 URL；未随 App 打包的曲目不可购买。
- `room_photos` 只处理个人房相框和公仔，不是 Memories Room 照片上传的已完成声明。退役／失败上传对象清理、账号注销存储清理和真实 Storage 联调仍是上线前必做项。

### 第二批采用的缺省规则

文档未定义跨时区的共享来访日期、两只兔子是否必须一起入睡。现实现为：

- 睡眠分别属于本人兔子，双方状态共同可见；不修改对方睡眠、不影响照料值／奖励。
- 来访由一对用户共享，按 UUID 排序较小成员的资料时区确定同一个日界线，界面显示该时区。这样不因双方处于不同日期而多生成一位访客。普通个人任务和首次奖励仍用本人的资料时区。
- 前一天未处理的来访持续保留，今天处理后不再生成第二位；情绪求助选择 No 也结束当天来访。
- 当前沿用“每天最多两场、同一心魔当天一次”的旧 Rage 限制；当天已用完时，可由伴侣协助或留到次日，不增加战斗次数。

以上为可替换的产品缺省值，已在 SQL／UI 和测试中保持一致；正式上线前可统一调整。

## 必须继续完成，不能当作已上线功能

1. **角色与服装验收**：换装、状态渲染与动画占位已实现；透明视频及正式插画后续替换。角色、相框／公仔／音乐需测试环境和真机验证。
2. **Memories Room 验收**：文字 CRUD／草稿／待同步、照片裁切／增删改／私有读取及清理队列已实现；需真实 Storage、cron、原生裁切与双设备验证，照片离线持久化／全部历史分页仍待做。
3. **朋友内容发布**：冒险与来访均已支持三种内容、快照和数据库发布约束；正式内容后台／素材发布工作流尚未实现，UI 用占位，不等待正式素材。
4. **冒险呈现**：标签加权、获取标签、结果快照及结果导航／退出拦截已实现；真正的挖掘视频／里程／日志、开箱动画仍需实现，导航需要真机验收。
5. **旧链路与日记兼容**：旧日记次数／AI quota 还需统一；差异和接口清单见 `burrow-phase8-audit.md`。DOCX 明确无老用户、不要求历史余额迁移，本实现没有把旧 clover 转成新币，也没有擅自删除原表／用户数据。Connection、旧奖励、Court API／worker／推送与 Insight 汇总已加停流保护；历史 RPC 权限有仓库硬化迁移证据，但线上 ACL 和完整迁移链仍需验证。Rage、三项 Self Care 和日记 API 的新版旧币奖励已切断。
6. **奖励剩余审计**：Game 未开放不实现或发放游戏奖励；旧任务 API 已关闭，其他气泡／历史直连通道仍需全面审计。新 Daily/Special 已接真实事件，不能用客户端按钮任意完成。
7. **实时和离线**：第七批已实现私有 Broadcast、回忆文字草稿／显式保存队列、重启去重与编辑冲突保护；无需新增 Postgres Changes publication。真实 Realtime 授权／双设备收敛、照片上传持久化、其他操作队列、重新配对后的未结束冒险处置仍待完成。离线冷启动仍需联网取得配对快照后才开放回忆编辑器。
8. **Moments 完整历史**：目前最近 50 个事件、回忆最近 100 条；还需分页、日期分组／日历、事件跳转、可见性变更与删除收敛。不要把初始列表误称为全部历史。
9. **IAP**：Carrot Shop consumable 产品、Apple／Google 服务端验签、重复回调／退款、Plus 新价格与 3 天试用、sandbox 测试。**未接入真实付费；没有用本地按钮模拟真实充值。**
10. **视觉和无障碍**：占位资产清单校验、reduce-motion、屏幕阅读器替代手势、震动、键盘遮挡；全部 25 参考图逐页真机验收。正式素材最后替换；新增界面尚未做截图／真机视觉验收。
11. **上线工程**：完整现有迁移链兼容性、真正并行连接事务测试、测试环境双账号联调、账户删除覆盖新增数据／存储、房间照片与回忆照片两套清理任务上线验证、无票据孤儿对象盘点、监控、隐私说明、审核与分批发布。PGlite 未运行 Supabase Storage，不能证明桶权限／照片上传在线可用；也不证明线上已经迁移。相机／相册权限文案变更需原生重构建，不能只靠 OTA。

Game Room 按 DOCX 只保留入口及预告；它不是本轮漏做的可玩游戏。

## 已运行验证

| 检查 | 结果 |
|---|---|
| mobile / api / admin TypeScript | 第九批通过；engine 检查保留前批结果 |
| engine Vitest | 197 项通过 |
| domain Vitest | 23 项通过 |
| 新移动端状态／房间互动／个性化／冒险、API 权限与奖励、Home entry、Reflect、Kit、True North、本地日与 Connection 回归 | 第九批 216 项通过 |
| PostgreSQL/PGlite 新迁移及业务事务 | 第九批 313 项断言通过；另有 8 项记录策略测试；含 180 次固定 ID 掉落样本验证 |
| Court v4 纯规则回归 | 第八批通过；原有规则与内容未重写 |
| iOS Expo/Hermes bundle export | 第九批通过；不是签名 IPA |
| Android Expo/Hermes bundle export | 第九批通过；不是 APK/AAB 或真机安装 |
| `git diff --check` | 通过 |

回归测试补齐现有 favicon／Android typography 的 mock，并使测试符合当前 Home 的 JS 数据等待、日记结算 copy／奖励 fixture、guide `onShow` 动画；没有取消权限或业务断言。

可复跑：

```sh
pnpm --filter @novame/mobile type-check
pnpm --filter @novame/api type-check
pnpm --filter @novame/engine type-check
pnpm --filter @novame/engine test
pnpm --filter @novame/domain test
node --test tools/test-burrow-mobile.cjs tools/test-burrow-room-activity.cjs tools/test-burrow-personalization.cjs tools/test-home-entry-readiness.cjs tools/test-reflect-durability.cjs tools/test-reflect-settlement.cjs tools/test-kit-completion.cjs tools/test-true-north-release.cjs tools/test-user-local-date.cjs
node --test tools/test-burrow-adventure.cjs tools/test-connection-two-stage.cjs tools/test-burrow-character-navigation.cjs tools/test-burrow-memory-photos.cjs
node --test tools/test-burrow-sync.cjs
node --test tools/test-burrow-cleanup.cjs
node --test tools/test-burrow-phase9.cjs tools/test-burrow-affection.cjs
PGLITE_MODULE=/tmp/novame-reflect-sql.52heWI/node_modules/@electric-sql/pglite node --test tools/test-burrow-record-policy-db.cjs
node tools/test-bunny-court-v4.mjs
BURROW_PGLITE_PATH=/tmp/novame-reflect-sql.52heWI/node_modules/@electric-sql/pglite/dist/index.js node tools/test-burrow-database.mjs
```

PGlite 依赖放在隔离 `/tmp` 目录，没有修改项目 package.json／lockfile 来安装它。临时目录清理后需要重新准备该测试运行时。

第二批 bundle 位于 `/tmp/novame-burrow-ios-phase2.Q8FFWI` 和 `/tmp/novame-burrow-android-phase2.NTl0c6`，仅作本地构建证据，未发布。

第三批 bundle 位于 `/tmp/novame-burrow-ios-phase3.PhhRvK` 和 `/tmp/novame-burrow-android-phase3.DOnxQq`。占位 WAV 可通过 `node tools/build-burrow-audio.mjs` 重建；无需安装依赖或访问网络。新增测试文件 `tools/test-burrow-personalization.cjs` 覆盖音频生命周期／过期异步回调、照片校验和上传权限、原生裁切配置、预览与重试键、账号切换拒绝旧照片提交。数据库测试使用基础表夹具，不代替完整历史迁移链及真正多连接并发测试。

## 下一实施批次

第四批 bundle：`/tmp/novame-burrow-ios-phase4.T0THFq`、`/tmp/novame-burrow-android-phase4.Of0U7R`。新增 `tools/test-burrow-adventure.cjs`（18 项）、`tools/test-burrow-adventure-database.mjs`（由主 SQL 测试调用），均没有联网。第四批没有新增或生成美术素材；继续使用代码／emoji 占位。

第五批 bundle：`/tmp/novame-burrow-ios-phase5.St02yL`（11.8 MB）、`/tmp/novame-burrow-android-phase5.quRpS6`（11.9 MB）。新增 `tools/test-burrow-character-navigation.cjs`（14 项），移动端共享 store 增加 2 项恢复请求测试；`tools/test-burrow-character-database.mjs` 增加 13 项 SQL 断言，由主 SQL 测试调用。均没有连接线上数据库或发布。

第六批 bundle：`/tmp/novame-burrow-ios-phase6.qWmAYf`（11.8 MB）、`/tmp/novame-burrow-android-phase6.LsEpk1`（11.9 MB）。新增 `tools/test-burrow-memory-photos.cjs`（15 项），以及主 SQL 测试调用的 `tools/test-burrow-memory-photos-database.mjs`（35 项新增断言）。没有生成正式素材、新装依赖、连接线上数据库或发布。

第七批 bundle：`/tmp/novame-burrow-phase7.2AIJKR/ios`（11.8 MB）、`/tmp/novame-burrow-phase7.2AIJKR/android`（11.9 MB）。新增 `tools/test-burrow-sync.cjs` 与 `tools/test-burrow-sync-database.mjs`，旧共享 store 增加配对失效测试；没有新装依赖、生成正式美术素材或部署。

第八批：新增迁移 `130_burrow_room_photo_cleanup`、独立房间照片清理 cron、Court／Insight 停流和推送筛选；16 项 Node 测试及 25 项新增 SQL 断言通过。详细实现与日记额度差异见 `burrow-phase8-audit.md`，提供只读历史写入口权限检查 SQL。没有部署或实际删除 Storage 对象；没有改动移动端或重新导出 bundle。

上述第八批后续中的记录策略、历史分页、冒险呈现和关系代次已在第九批落地；照片采用耐久本机草稿＋明确点击重试，不自动上传。第九批当前边界覆盖此前章节的历史描述。IAP、日记共享隐私选择、完整迁移链与双设备真机验收仍未完成，详见第九批核验。正式上线前保持开关关闭。

## 第七批：实时刷新和回忆文字耐久保存

- `129_burrow_sync_and_memory_outbox` 为房间、钱包、库存、赠礼、Affection、冒险、回忆和照片等业务表建立私有 `burrow:<user UUID>` Broadcast。广播只携带空对象，客户端重新读取经过配对校验的 bootstrap，不广播文字、照片路径或余额。配对变化同时通知旧伴侣并立即清空客户端配对快照；迟到的旧请求不能恢复它。
- `BurrowSyncGate` 在新版主布局挂载一个订阅，前台启动／恢复补取快照，400ms 合并通知，断线／失败按 2–60 秒退避重试；后台释放连接，换账号停止旧订阅，失效连接回调不再生效。正常连接无定时轮询；如果通知丢失，页面进入／回前台刷新仍可收敛。
- `burrow-memory-local` 使用现有单一 MMKV 与注册的 user-scope 前缀，按本人 UUID + 伴侣 UUID 分区。输入只保存草稿，明确点击 Save 才入队；先持久化请求键和正文再发送，重启沿用同一键，最多 20 个待同步保存。确认旧保存时不删除后来输入的新草稿。
- `save_memory_durable` 验证认证账号、原伴侣、UUID 请求键；编辑带上服务器 `updated_at`，版本不符返回 `memory_conflict`，不覆盖另一设备的更改。确认响应丢失后先按收据重放，再处理版本检查。冲突保留原文，提供复制到新草稿／明确移除待保存项，复制不会覆盖已有新草稿。
- 编辑器显示“本机草稿”“待服务器确认”“等待连接”“需要核对”；写盘失败保留当前可见文字并报错，不伪装成功。退出账号／切换账号依既有隐私策略清除 user-scope 草稿和队列，界面明确提示；重启同账号保留。不是云端草稿，也不是端到端加密：沿用现有未配置 encryptionKey 的 MMKV，设备静态数据保护仍需上线前统一审计。
- 本批只自动重放回忆文字保存，不自动重放删除、购买、赠礼、奖励领取或照片上传。不缓存完整配对快照到磁盘；离线冷启动须联网校验配对后才能进入编辑器。解绑后旧配对本地草稿保持隔离；与同一 UUID 重新配对会复用旧分区，关系 generation 与历史数据保留策略仍需明确。不能宣称已实现所有离线场景。
- SQL 测试的 `realtime.send` 是本地事件捕获夹具，证明触发对象／目标／空载荷和重复 bootstrap 无通知循环；并非真实 Supabase WebSocket 或线上授权验收。上线前必须独立测试环境验证 private topic 拒绝他人订阅、断网重连、双方解绑、照片删除刷新、两设备同时编辑及耗电／通知风暴。

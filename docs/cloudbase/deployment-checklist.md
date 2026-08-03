# CloudBase 部署检查清单

> 项目：love_diary
> 环境：`cloud1-d0g9qamm1ffcc26ca`
> 最后更新：2026-07-07

---

## 一、数据库集合与索引

### 1.1 确认集合存在

在云开发控制台 → 数据库 中确认以下 16 个集合均已创建：

| # | 集合名 | 用途 | 权限模型 |
|---|--------|------|----------|
| 1 | `users` | 用户文档（_id = OPENID） | 安全规则 |
| 2 | `couple` | 情侣关系文档 | 安全规则 |
| 3 | `coupleRequest` | 绑定请求 | 安全规则 |
| 4 | `invite` | 邀请码预留 | 安全规则 |
| 5 | `moment` | 动态 | 安全规则 |
| 6 | `diaries` | 日记 | 安全规则 |
| 7 | `letter` | 情书 | 安全规则 |
| 8 | `album` | 相册照片 | 安全规则 |
| 9 | `album_folders` | 相册文件夹 | 安全规则 |
| 10 | `money` | 记账 | 安全规则 |
| 11 | `cost` | 费用分摊 | 安全规则 |
| 12 | `note` | 便签 | 安全规则 |
| 13 | `schedule` | 日程 | 安全规则 |
| 14 | `goals` | 目标 | 安全规则 |
| 15 | `companion_records` | 陪伴记录 | 安全规则 |
| 16 | `couple_tree` | 情侣树 | 安全规则 |

### 1.2 创建复合索引

在云开发控制台 → 数据库 → 索引管理 中创建以下索引：

| 集合 | 索引字段 | 方向 | 说明 |
|------|----------|------|------|
| `users` | `inviteCode` | 升序 | 通过邀请码查找目标用户 |
| `couple` | `status` + `purgeAfter` | 升序 + 升序 | 清理函数查询过期关系 |
| `coupleRequest` | `toOpenid` + `status` + `createdAt` | 升序 + 升序 + 降序 | 查询收到的请求 |
| `coupleRequest` | `fromOpenid` + `status` + `createdAt` | 升序 + 升序 + 降序 | 查询发出的请求 |
| `moment` | `coupleId` + `createTime` | 升序 + 降序 | 共享动态查询 |
| `diaries` | `coupleId` + `createTime` | 升序 + 降序 | 共享日记查询 |
| `letter` | `coupleId` + `createTime` | 升序 + 降序 | 共享情书查询 |
| `album` | `coupleId` + `createTime` | 升序 + 降序 | 共享相册查询 |
| `album_folders` | `coupleId` + `createTime` | 升序 + 降序 | 共享文件夹查询 |
| `money` | `coupleId` + `createTime` | 升序 + 降序 | 共享记账查询 |
| `cost` | `coupleId` + `createTime` | 升序 + 降序 | 共享分摊查询 |
| `note` | `coupleId` + `createTime` | 升序 + 降序 | 共享便签查询 |
| `schedule` | `coupleId` + `createTime` | 升序 + 降序 | 共享日程查询 |
| `goals` | `coupleId` + `createTime` | 升序 + 降序 | 共享目标查询 |
| `companion_records` | `coupleId` + `createTime` | 升序 + 降序 | 共享陪伴记录查询 |
| `couple_tree` | `coupleId` + `createTime` | 升序 + 降序 | 共享情侣树查询 |

> 所有共享集合的 `coupleId + createTime` 复合索引确保安全规则校验时查询性能。

---

## 二、安全规则部署

### 2.1 逐集合配置安全规则

按照 `docs/cloudbase/security-rules.md` 中的模板，在云开发控制台 → 数据库 → 选择集合 → 安全规则 中逐个粘贴配置。

推荐部署顺序（由简到繁，逐步验证）：

1. **第一批**：`users`、`couple`、`coupleRequest`、`invite`（核心集合，禁止客户端直接写入）
2. **第二批**：`moment`、`diaries`（高频使用集合，先验证规则可用性）
3. **第三批**：`letter`、`album`、`album_folders`（中等频率）
4. **第四批**：`money`、`cost`、`note`、`schedule`、`goals`（中等频率）
5. **第五批**：`companion_records`、`couple_tree`（游戏/陪伴功能）

每批部署后等待 2-3 分钟，使用微信开发者工具验证基础读写。

### 2.2 配置云存储安全规则

在云开发控制台 → 存储 → 权限设置中更新写入规则：

```json
{
  "read": "resource.openid == auth.openid",
  "write": "resource.openid == auth.openid"
}
```

---

## 三、云函数部署

### 3.1 relationshipService

```bash
# 在微信开发者工具中：
# 右键 cloudfunctions/relationshipService → 上传并部署：云端安装依赖

# 或使用 CLI（如果已配置）：
# cd cloudfunctions/relationshipService && npm install --production
```

**部署前确认**：
- [ ] `cloudfunctions/relationshipService/package.json` 存在且声明 `wx-server-sdk: latest`
- [ ] `cloudfunctions/relationshipService/index.js` 从 `getWXContext()` 获取 OPENID
- [ ] `cloudfunctions/relationshipService/lib/domain.js` 包含所有领域函数
- [ ] `cloudfunctions/relationshipService/lib/service.js` 包含完整生命周期逻辑
- [ ] `cloudfunctions/relationshipService/lib/cloudRepository.js` 使用 `db.runTransaction`

### 3.2 sharedDataService

```bash
# 右键 cloudfunctions/sharedDataService → 上传并部署：云端安装依赖
```

**部署前确认**：
- [ ] 所有客户端危险更新/删除都调用 `sharedDataService`
- [ ] `getFileUrls` 只返回当前 active 情侣目录下文件的临时地址
- [ ] 事务覆盖签到、目标任务、点赞评论和情侣树

### 3.3 ocrSchedule

```bash
# 右键 cloudfunctions/ocrSchedule → 上传并部署：云端安装依赖
```

**部署前确认**：
- [ ] 只接受 `ocr/<OPENID>/` 下的临时图片
- [ ] 成功或失败都会删除临时图片
- [ ] 返回值不包含 OCR 原文、调试对象或供应商错误

### 3.4 cleanupExpiredCouples

```bash
# 在微信开发者工具中：
# 右键 cloudfunctions/cleanupExpiredCouples → 上传并部署：云端安装依赖
```

**部署前确认**：
- [ ] `cloudfunctions/cleanupExpiredCouples/package.json` 存在且声明 `wx-server-sdk: latest`
- [ ] `cloudfunctions/cleanupExpiredCouples/index.js` 拒绝客户端调用
- [ ] `cloudfunctions/cleanupExpiredCouples/lib/cleanup.js` 覆盖所有 12 个共享集合

### 3.5 配置定时触发器

在云开发控制台 → 云函数 → cleanupExpiredCouples → 触发器 中：

1. 创建定时触发器：
   - **触发方式**：定时触发
   - **触发周期**：每天凌晨 3:00（Cron: `0 0 3 * * * *`）
   - **触发器名称**：`dailyCleanup`
2. （可选）设置环境变量 `CLEANUP_TOKEN` 用于非 Timer 场景的安全调用。

---

## 四、部署后验证

### 4.1 自动化验证（本地）

在项目根目录运行：

```bash
npm test                                    # 全部测试
node scripts/regression_checks.js            # 回归检查
for f in pages/*/*.js utils/*.js; do node --check "$f"; done  # 语法检查
```

预期：所有测试通过，无语法错误。

### 4.2 手动验证 — 双人正常流程

需要两个微信测试账号（账号 A 和账号 B）。

| # | 步骤 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | 启动 | A 打开小程序 | 显示"我的"页面，邀请码可见 |
| 2 | 启动 | B 打开小程序 | 显示"我的"页面，邀请码可见 |
| 3 | 发请求 | A 输入 B 的邀请码，发送绑定请求 | 成功发送 |
| 4 | 查看请求 | B 在"我的"页面查看请求列表 | 看到 A 的请求 |
| 5 | 同意 | B 点击同意，选择角色 | 绑定成功，双方显示伴侣信息 |
| 6 | 共享数据 | A 发布一条动态 | 发布成功 |
| 7 | 共享数据 | B 查看动态列表 | 看到 A 的动态 |
| 8 | 共享数据 | B 发布一条动态 | 发布成功 |
| 9 | 共享数据 | A 查看动态列表 | 看到两条动态 |
| 10 | 解绑 | A 点击解绑，确认 | 解绑成功，双方恢复单身状态 |
| 11 | 解绑后访问 | A 尝试查看动态 | 提示"请先绑定情侣"或无数据 |
| 12 | 解绑后访问 | B 尝试查看动态 | 提示"请先绑定情侣"或无数据 |

### 4.3 手动验证 — 30 天恢复流程

| # | 步骤 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | 重新绑定 | A 再次向 B 发送请求，B 同意 | 绑定成功 |
| 2 | 数据恢复 | A 查看动态列表 | 看到之前的两条动态（同一 coupleId 恢复）|

### 4.4 手动验证 — 第三人拒绝

需要第三个微信测试账号（账号 C）。

| # | 步骤 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | 准备 | A 和 B 已绑定，C 已登录但未绑定 |
| 2 | 直接读 | 在 C 的开发者工具控制台执行 `db.collection('moment').where({ coupleId: '<A和B的coupleId>' }).get()` | 返回空或被拒绝 |
| 3 | 直接写 | C 尝试直接向 `couple` 集合写入 | 被安全规则拒绝 |

### 4.5 手动验证 — 清理函数

| # | 步骤 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | 准备 | A 和 B 解绑（产生 archived 关系） |
| 2 | 模拟过期 | 在云开发控制台将 `couple.purgeAfter` 改为过去的时间 |
| 3 | 手动触发 | 在云开发控制台手动触发 `cleanupExpiredCouples` |
| 4 | 验证清理 | 查询共享集合中该 `coupleId` 的记录 | 全部删除 |
| 5 | 验证关系 | 查询 `couple` 集合中该文档 | 已删除 |
| 6 | 验证幂等 | 再次手动触发清理 | 成功，无错误 |

### 4.6 手动验证 — 解绑验证（立即拒绝访问）

| # | 步骤 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | 绑定后立即解绑 | A 和 B 绑定后，A 立即解绑 | 解绑成功 |
| 2 | 对方立即验证 | B 刷新页面 | 显示单身状态 |
| 3 | 对方尝试访问 | B 尝试访问共享数据 | 被拒绝或无数据 |

---

## 五、回退方案

如果安全规则导致生产问题：

1. **临时回退**：恢复上一版已验证的限制规则；不要改成公开读写。
2. **暂停危险操作**：如更新/删除云函数异常，可先停止对应入口，保留只读和安全创建能力。
3. **数据恢复**：`cleanupExpiredCouples` 默认只处理 `purgeAfter <= now` 的记录——手动修改 `purgeAfter` 可以推迟清理。

---

## 六、常见问题

### Q1: 安全规则启用后前端查询返回空数组

**原因**：查询条件未包含 `coupleId`，或 `coupleId` 值与 `users` 集合中的不匹配。

**排查**：
1. 确认 `wx.getStorageSync('coupleId')` 有值。
2. 确认查询使用了 `where({ coupleId: getCoupleId() })`。
3. 在云开发控制台确认 `users.<OPENID>.coupleId` 与查询的 `coupleId` 一致。

### Q2: 创建记录时被拒绝

**原因**：添加的记录中缺少 `authorOpenid` 字段或值与 `auth.openid` 不匹配。

**排查**：
1. 确认 `.add()` 的数据中包含 `authorOpenid: wx.getStorageSync('openid')`。
2. 确认 `authorOpenid` 的值与当前用户的 OPENID 完全一致。

### Q3: 解绑后仍能访问共享数据

**原因**：安全规则可能未生效或 `relationshipStatus` 未更新。

**排查**：
1. 确认解绑操作返回成功。
2. 在云开发控制台确认 `users.<OPENID>.relationshipStatus` 为 `'single'`。
3. 等待 1-5 分钟让安全规则缓存刷新。
4. 强制刷新小程序（杀掉进程重新打开）。

### Q4: 清理函数手动触发时报 FORBIDDEN

**原因**：清理函数检测到客户端调用（非 Timer 触发且无有效 CLEANUP_TOKEN）。

**解决**：
1. 在云开发控制台通过"测试"按钮手动触发（控制台触发自带 Timer 上下文）。
2. 或设置环境变量 `CLEANUP_TOKEN`，并在调用时传入 `{ token: '<CLEANUP_TOKEN>' }`。

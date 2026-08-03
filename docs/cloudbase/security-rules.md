# CloudBase 安全规则配置

> 适用环境：`cloud1-d0g9qamm1ffcc26ca`
>
> 部署方式：在 [微信云开发控制台](https://console.cloud.tencent.com/tcb) → 数据库 → 集合 → 安全规则 中逐集合粘贴。

---

## 前置条件

1. `users` 集合中每个用户的 `_id` 必须是其微信 OPENID（由 `relationshipService.bootstrap` 保证）。
2. 所有共享业务记录必须包含 `coupleId` 字段（已在 Task 7 中全局替换）。
3. 所有共享业务记录创建时必须附带 `authorOpenid` 字段（已在 Task 7 中实现）。
4. 安全规则依赖 `get(`database.users.${auth.openid}`)` 查询——**每个前端查询条件必须包含规则中引用的字段**，否则查询会被拒绝。

---

## 核心集合规则

### users

用户文档 `_id` = 调用者 OPENID。客户端只能读取自己的文档，不能写入。

```json
{
  "read": "doc._id == auth.openid",
  "create": false,
  "update": false,
  "delete": false
}
```

**说明**：`relationshipService` 云函数不受安全规则限制，可以正常读写 `users`。客户端通过 `bootstrap` action 间接获取自己的用户信息。

### couple

客户端只能读取自己所属的 active 关系，不能创建、修改或删除。

```json
{
  "read": "doc.status == 'active' && doc.memberOpenids.indexOf(auth.openid) >= 0",
  "create": false,
  "update": false,
  "delete": false
}
```

**说明**：`relationshipService` 负责所有 couple 文档的创建、更新和归档。客户端读取时使用 `db.collection('couple').doc(getCoupleId()).get()`。

### coupleRequest

客户端无直接权限。所有请求操作通过 `relationshipService` 的 `sendRequest` / `listRequests` / `acceptRequest` / `rejectRequest` / `cancelRequest` 进行。

```json
{
  "read": false,
  "create": false,
  "update": false,
  "delete": false
}
```

### invite

邀请码由云函数在事务中分配，客户端无权限。

```json
{
  "read": false,
  "create": false,
  "update": false,
  "delete": false
}
```

---

## 共享业务集合规则

以下规则适用于所有 12 个共享集合。每条规则确保：
- 只能读取/操作属于自己情侣关系的数据（通过 `coupleId` 匹配）。
- 用户的关系状态必须为 `active`。
- 创建记录时，`authorOpenid` 必须是调用者本人。

### moment（动态）

```json
{
  "read": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "create": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active' && doc.authorOpenid == auth.openid",
  "update": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "delete": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'"
}
```

### diaries（日记）

```json
{
  "read": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "create": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active' && doc.authorOpenid == auth.openid",
  "update": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "delete": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'"
}
```

### letter（情书）

```json
{
  "read": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "create": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active' && doc.authorOpenid == auth.openid",
  "update": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "delete": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'"
}
```

### album（相册）

```json
{
  "read": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "create": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active' && doc.authorOpenid == auth.openid",
  "update": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "delete": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'"
}
```

### album_folders（相册文件夹）

```json
{
  "read": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "create": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active' && doc.authorOpenid == auth.openid",
  "update": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "delete": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'"
}
```

### money（记账）

```json
{
  "read": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "create": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active' && doc.authorOpenid == auth.openid",
  "update": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "delete": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'"
}
```

### cost（分摊）

```json
{
  "read": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "create": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active' && doc.authorOpenid == auth.openid",
  "update": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "delete": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'"
}
```

### note（便签）

```json
{
  "read": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "create": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active' && doc.authorOpenid == auth.openid",
  "update": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "delete": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'"
}
```

### schedule（日程）

```json
{
  "read": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "create": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active' && doc.authorOpenid == auth.openid",
  "update": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "delete": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'"
}
```

### goals（目标）

```json
{
  "read": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "create": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active' && doc.authorOpenid == auth.openid",
  "update": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "delete": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'"
}
```

### companion_records（陪伴记录）

```json
{
  "read": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "create": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active' && doc.authorOpenid == auth.openid",
  "update": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "delete": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'"
}
```

### couple_tree（情侣树）

```json
{
  "read": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "create": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active' && doc.authorOpenid == auth.openid",
  "update": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'",
  "delete": "doc.coupleId == get(`database.users.${auth.openid}`).coupleId && get(`database.users.${auth.openid}`).relationshipStatus == 'active'"
}
```

---

## 云存储安全规则

在云开发控制台 → 存储 → 权限设置中配置：

```json
{
  "read": true,
  "write": "resource.path.indexOf('couples/' + get(`database.users.${auth.openid}`).coupleId) == 0"
}
```

**说明**：
- 所有用户可读取文件（用于图片展示）。
- 写入权限限制为只能上传到 `couples/<自己的coupleId>/` 路径下。
- OCR 临时文件路径 `ocr/` 不受此限制（OCR 由云函数 `ocrSchedule` 处理）。

---

## 安全规则激活注意事项

1. **规则生效有延迟**：CloudBase 安全规则在控制台保存后通常 1-5 分钟生效，期间旧缓存可能允许未授权访问。
2. **前端查询必须包含规则字段**：即使查询条件中未显式过滤 `coupleId`，只要规则中引用了 `doc.coupleId`，查询就会被拒绝。例如 `db.collection('moment').where({ coupleId: 'cp_xxx' }).get()` 可以工作，但 `db.collection('moment').get()` 会被拒绝。
3. **get() 函数限制**：`get(`database.collection.docId`)` 只能引用已存在的文档。如果用户文档不存在（首次登录前），所有依赖 `users` 的共享集合规则都会拒绝访问。确保 `relationshipService.bootstrap` 已在应用启动时调用。
4. **云函数不受影响**：CloudBase 安全规则仅约束小程序客户端 SDK 的数据库操作。云函数使用服务端 SDK（`wx-server-sdk`），不受安全规则限制。
5. **逐集合逐步启用**：建议先在 `moment` 等非关键集合上测试规则，确认无误后再扩展到全部集合。

---

## 规则测试矩阵

| 场景 | 操作 | 预期结果 |
|------|------|----------|
| 已绑定用户 A 读取共享 moment（coupleId 匹配） | `where({ coupleId })` | ✅ 允许 |
| 已绑定用户 A 创建 moment（authorOpenid 匹配） | `.add({ coupleId, authorOpenid })` | ✅ 允许 |
| 已绑定用户 A 读取共享 moment（不带 coupleId 条件） | `where()` | ❌ 拒绝 |
| 未绑定用户 C 尝试读取任何共享集合 | `where({ coupleId })` | ❌ 拒绝（relationshipStatus != 'active'）|
| 用户 A 尝试读取用户 B 的 users 文档 | `doc('B的OPENID').get()` | ❌ 拒绝 |
| 用户 A 尝试直接写 couple 集合 | `.update()` | ❌ 拒绝 |
| 用户 A 尝试直接读 coupleRequest | `.get()` | ❌ 拒绝 |
| 用户 A 创建 moment 但 authorOpenid 填 B | `.add({ coupleId, authorOpenid: 'B' })` | ❌ 拒绝 |

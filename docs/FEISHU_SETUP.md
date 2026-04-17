# 飞书接入部署教程

本文说明如何把“单板共享”应用接入飞书工作台，让用户从飞书自建应用入口打开页面，并使用飞书多维表格保存业务数据。

## 当前状态

当前项目已经实现：

- 单板列表、申请、预约时间段、归还、超时请求归还、管理员维护页面。
- 占用时间线展示所有单板预约、占用和超时片段，空闲段可直接点击预约。
- 后端业务校验和接口。
- 本地 JSON 存储。
- 飞书多维表格存储适配层。
- 飞书消息发送适配层。
- 飞书工作台免登录跳转。
- `/api/auth/feishu` 用飞书 `code` 换用户身份。
- 后端 session/cookie 登录态。
- `DEV_AUTH=false` 后，所有 `/api/*` 请求优先通过 session 识别飞书用户。

当前免登流程：

```text
飞书打开网页
-> 前端跳转飞书登录授权地址获取 auth code
-> POST /api/auth/feishu
-> 后端用 code 换飞书用户身份
-> 后端设置 HttpOnly session cookie
-> 后续 /api/* 自动识别当前用户
```

## 1. 部署服务

在公司服务器部署本项目，并放到 HTTPS 域名后面。例如：

```text
https://board.example.com
```

启动命令：

```bash
npm start
```

生产环境建议使用进程管理工具托管，例如 `systemd`、`pm2` 或容器平台。飞书工作台页面应使用 HTTPS 域名，不建议使用 `localhost`、裸 IP 或临时端口地址。

## 2. 配置服务端环境变量

本地默认使用 JSON 文件存储。接入飞书多维表格时，设置：

```bash
PORT=3000
DEV_AUTH=false
STORAGE=feishu

FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_REDIRECT_URI=https://board.example.com/
FEISHU_CHAT_ID=oc_xxx

FEISHU_BITABLE_APP_TOKEN=xxx
FEISHU_BOARDS_TABLE_ID=tbl_xxx
FEISHU_RESERVATIONS_TABLE_ID=tbl_xxx
FEISHU_RETURN_REQUESTS_TABLE_ID=tbl_xxx
FEISHU_ADMINS_TABLE_ID=tbl_xxx

ADMIN_USER_IDS=ou_xxx,ou_yyy

SESSION_COOKIE_NAME=sb_session
SESSION_MAX_AGE_SECONDS=604800
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAMESITE=Lax
```

变量说明：

- `PORT`：后端监听端口。
- `DEV_AUTH`：生产环境必须设为 `false`，避免信任前端传入的 `x-user-id`。
- `STORAGE`：设为 `feishu` 后，业务数据读写飞书多维表格。
- `FEISHU_APP_ID`：飞书自建应用的 App ID。
- `FEISHU_APP_SECRET`：飞书自建应用的 App Secret。
- `FEISHU_REDIRECT_URI`：飞书登录回跳地址，必须和飞书后台“重定向 URL”完全一致，例如 `https://board.example.com/`。
- `FEISHU_CHAT_ID`：归还请求要提醒的共享群 chat_id。
- `FEISHU_BITABLE_APP_TOKEN`：目标多维表格 app token。
- `FEISHU_*_TABLE_ID`：各业务表 table ID。
- `ADMIN_USER_IDS`：管理员飞书用户 ID，多个值用英文逗号分隔。
- `SESSION_COOKIE_NAME`：登录态 cookie 名称。
- `SESSION_MAX_AGE_SECONDS`：登录态有效期，默认 7 天。
- `SESSION_COOKIE_SECURE`：正式飞书环境建议为 `true`，只有 HTTPS 会写入 cookie。
- `SESSION_COOKIE_SAMESITE`：默认 `Lax`；如果飞书客户端内嵌页面时 cookie 不回传，可改为 `None`，同时必须保持 `SESSION_COOKIE_SECURE=true`。

## 3. 创建飞书自建应用

进入飞书开放平台，创建“企业自建应用”。

官方入口：

```text
https://open.feishu.cn/document/home/introduction-to-custom-app-development/self-built-application-development-process
```

创建完成后，在应用后台记录：

```text
App ID
App Secret
```

将它们写入服务器环境变量：

```bash
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
```

## 4. 添加网页应用入口

在飞书应用后台添加网页应用能力，并配置页面地址：

```text
https://board.example.com
```

电脑端和移动端可以先使用同一个地址。

同时在应用后台的安全设置中添加重定向 URL，必须与 `FEISHU_REDIRECT_URI` 完全一致，例如：

```text
https://board.example.com/
```

然后在应用后台的安全设置中添加安全域名：

```text
board.example.com
```

如果部署在反向代理后面，确认以下内容：

- HTTPS 证书有效。
- 反向代理能转发 `/api/*` 请求。
- 静态资源路径 `/app.js`、`/styles.css`、`/assets/board.png` 可访问。

## 5. 创建飞书多维表格

创建一个多维表格，记录 app token，并创建 4 张表：

```text
Boards
Reservations
ReturnRequests
Admins
```

字段名需要和代码默认字段名一致。字段类型建议使用基础类型：文本、多行文本、数字、复选框。不要先使用人员、关联记录、单选、多选、日期等复杂字段；当前代码按普通字符串和数字读写，复杂字段需要额外适配。

### Boards 表

| 字段名 | 建议类型 | 用途 |
| --- | --- | --- |
| ID | 文本 | 系统生成的单板 ID |
| 单板编号 | 文本 | 管理员填写，要求唯一 |
| 类型 | 文本 | 单板类型 |
| 版本号 | 文本 | 硬件或板卡版本 |
| 系统版本号 | 文本 | 系统版本 |
| 子卡列表 | 多行文本 | JSON 字符串，保存多个子卡 |
| 状态 | 文本 | `available`、`in_use`、`overdue`、`deleted` |
| 当前使用人 | 文本 | 当前使用人飞书用户 ID |
| 当前使用人姓名 | 文本 | 当前使用人姓名 |
| 当前申请记录 | 文本 | 当前有效申请记录 ID |
| 备注 | 多行文本 | 单板备注 |
| 是否删除 | 复选框 | 软删除标记 |
| 创建时间 | 文本 | ISO 时间字符串 |
| 更新时间 | 文本 | ISO 时间字符串 |

### Reservations 表

| 字段名 | 建议类型 | 用途 |
| --- | --- | --- |
| ID | 文本 | 系统生成的申请记录 ID |
| 单板ID | 文本 | 对应 Boards.ID |
| 申请人 | 文本 | 申请人飞书用户 ID |
| 申请人姓名 | 文本 | 申请人姓名 |
| 申请时长 | 数字 | 小时数，最小 0.5 小时 |
| 用途备注 | 多行文本 | 申请用途 |
| 开始时间 | 文本 | 申请开始时间，保存 ISO 时间字符串 |
| 计划结束时间 | 文本 | 按 09:00-21:00 工作时段计算出的结束时间 |
| 实际归还时间 | 文本 | 归还时间 |
| 状态 | 文本 | `reserved`、`active` 或 `returned`，超时由当前时间派生展示 |
| 归还请求次数 | 数字 | 超时后被请求归还次数 |
| 创建时间 | 文本 | ISO 时间字符串 |
| 更新时间 | 文本 | ISO 时间字符串 |

### ReturnRequests 表

| 字段名 | 建议类型 | 用途 |
| --- | --- | --- |
| ID | 文本 | 系统生成的请求 ID |
| 申请记录 | 文本 | 对应 Reservations.ID |
| 请求人 | 文本 | 请求人飞书用户 ID |
| 请求人姓名 | 文本 | 请求人姓名 |
| 请求时间 | 文本 | 请求归还时间 |
| 通知状态 | 文本 | `sent`、`partial`、`failed`、`skipped` |

### Admins 表

| 字段名 | 建议类型 | 用途 |
| --- | --- | --- |
| 管理员飞书用户 ID | 文本 | 管理员用户 ID |
| 姓名 | 文本 | 管理员姓名 |
| 启用状态 | 复选框 | 是否启用 |

时间字段建议建为“文本”，因为当前代码保存的是 ISO 字符串，例如 `2026-04-17T01:30:00.000Z`。如果改成飞书“日期”字段，API 读写格式不同，需要额外改适配层。

状态字段建议建为“文本”，不要建为“单选”。当前代码直接写入 `available`、`reserved`、`active` 等字符串；单选字段 API 格式不同。

用户字段建议建为“文本”，不要建为“人员”。当前代码保存飞书用户 ID 和姓名；人员字段 API 格式更复杂。

创建完成后，将多维表格 app token 和各 table ID 写入环境变量：

```bash
FEISHU_BITABLE_APP_TOKEN=xxx
FEISHU_BOARDS_TABLE_ID=tbl_xxx
FEISHU_RESERVATIONS_TABLE_ID=tbl_xxx
FEISHU_RETURN_REQUESTS_TABLE_ID=tbl_xxx
FEISHU_ADMINS_TABLE_ID=tbl_xxx
```

多维表格记录接口官方文档：

```text
https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/list
```

## 6. 申请飞书应用权限

在飞书应用后台为自建应用申请权限，并发布版本让企业管理员审批。

本项目需要的权限方向：

- 获取用户身份。
- 读取和写入多维表格。
- 发送消息。

相关官方文档：

```text
https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal
https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/list
https://open.feishu.cn/document/server-docs/im-v1/message/create
```

权限未发布或未审批时，常见表现是：

- 接口返回飞书权限错误。
- 多维表格读写失败。
- 归还请求无法发送私聊或群消息。

## 7. 配置共享群提醒

归还请求需要发送到共享群时：

1. 将自建应用机器人加入共享群。
2. 获取该群的 `chat_id`。
3. 设置环境变量：

```bash
FEISHU_CHAT_ID=oc_xxx
```

用户点击“请求归还”后，系统会：

- 给当前使用人发送飞书私聊提醒。
- 给共享群发送提醒。
- 在 `ReturnRequests` 表写入通知状态。

如果没有配置 `FEISHU_CHAT_ID`，系统仍可尝试发送私聊，但群提醒会跳过。

## 8. 发布应用

完成网页应用入口、权限、多维表格和服务端环境变量配置后，在飞书应用后台创建版本并发布。

发布后检查：

- 应用是否出现在飞书工作台。
- 点击应用后是否打开 `https://board.example.com`。
- 页面是否能拿到当前飞书用户。
- 普通用户只能查看、申请、归还。
- 管理员能新增、编辑、软删除单板。

## 9. 验收流程

建议按以下顺序验收：

1. 管理员打开应用，新增一块单板。
2. 普通用户打开应用，确认只能看到普通操作。
3. 普通用户选择开始时间，预约该单板 0.5 小时。
4. 在占用时间线中点击空闲段预约，确认开始时间默认填该空闲段的可用起点，并确认预约片段显示正确。
5. 另一个用户尝试预约重叠时间段，确认被拒绝。
6. 等申请超时，另一个用户点击“请求归还”。
7. 确认当前使用人收到飞书私聊。
8. 确认共享群收到提醒。
9. 当前使用人归还单板。
10. 确认单板恢复为可申请。
11. 管理员软删除空闲单板，确认普通列表不再展示。
12. 查询历史申请，确认删除单板的历史记录仍保留。

## 10. 生产登录态说明

本地开发模式可以通过请求头切换身份：

```text
x-user-id
x-user-name
```

这只适合本地开发和演示。正式飞书环境应设置：

```text
DEV_AUTH=false
```

此时页面会自动走飞书免登：

- `/api/auth/config` 返回飞书 App ID 和登录地址。
- 前端没有 session 时跳转飞书获取 `code`。
- 飞书回跳页面后，前端调用 `POST /api/auth/feishu`。
- 后端调用飞书接口用 `code` 换用户身份。
- 后端创建 session，并设置 HttpOnly cookie。
- `/api/me` 和其他业务接口从 session 中读取当前用户。
- `POST /api/logout` 可清理 session。

当前实现使用内存 session。单实例部署可以直接使用；如果后续多实例部署，建议把 session 存储替换为 Redis。

## 11. 常见问题

### 页面在飞书里打不开

检查：

- 是否使用 HTTPS。
- 飞书应用安全域名是否包含当前域名。
- 反向代理是否能访问静态资源和 `/api/*`。
- 应用版本是否已经发布并审批通过。

### 多维表格读写失败

检查：

- `STORAGE=feishu` 是否配置。
- `FEISHU_BITABLE_APP_TOKEN` 是否正确。
- 各 `FEISHU_*_TABLE_ID` 是否正确。
- 表字段名是否和教程一致。
- 应用是否拥有多维表格读写权限。

### 归还提醒没有发出

检查：

- 应用是否有发送消息权限。
- 应用机器人是否在共享群里。
- `FEISHU_CHAT_ID` 是否正确。
- 当前使用人的飞书用户 ID 是否是可接收消息的 open_id 或代码中对应的 ID 类型。

### 飞书授权登录报 `ReferenceError: fetch is not defined`

这是服务端 Node 版本过旧时常见的问题。当前代码已在飞书客户端里增加 `https.request` fallback；更新代码并重启服务即可。生产环境仍建议使用 Node 18 或更高版本。

### 管理员入口不显示

检查：

- 当前用户 ID 是否在 `ADMIN_USER_IDS` 中。
- 或者 `Admins` 表是否有该用户，且 `启用状态` 为 true。
- 生产环境是否已经正确识别飞书登录用户。

## 时间线接口

`GET /api/timeline?from=...&to=...` 返回所有单板在指定范围内的预约和占用片段。`POST /api/reservations` 可传 `startAt` 预约未来时间段；同一单板的未归还记录只要时间段重叠就会被拒绝。

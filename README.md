# 单板共享

基于 `PLAN.md` 的最小可运行实现：静态前端 + Node.js 后端 API。默认使用本地 JSON 文件存储，配置飞书环境变量后可接入飞书鉴权、消息通知和多维表格。

## 功能

- 单板列表展示当前占用、下次预约和超时状态。
- 占用时间线展示所有单板在指定时间范围内的预约、占用和超时片段，空闲段可直接点击预约。
- 用户可选择开始时间和申请时长预约占用时间段；从时间线空闲段点击时，开始时间默认填该空闲段的可用起点；同一单板时间段重叠会被拒绝。
- 使用时长按每天 `09:00-21:00` 累加，非工作时段开始会顺延到下一个 `09:00`。

## 运行

```bash
npm start
```

默认地址：`http://localhost:3000`

本地开发默认启用请求头身份：

- `x-user-id`
- `x-user-name`

前端页面右上角可以直接切换本地身份。默认管理员为 `ou_admin`。

## 测试

```bash
npm test
```

## 环境变量

基础配置：

- `PORT`：服务端口，默认 `3000`
- `DATA_FILE`：本地 JSON 数据文件，默认 `data/share-board.json`
- `DEV_AUTH`：是否允许本地请求头身份，默认 `true`
- `ADMIN_USER_IDS`：管理员飞书用户 ID，英文逗号分隔
- `STORAGE`：`local` 或 `feishu`，默认 `local`
- `SESSION_COOKIE_NAME`：登录态 cookie 名称，默认 `sb_session`
- `SESSION_MAX_AGE_SECONDS`：登录态有效期，默认 7 天
- `SESSION_COOKIE_SECURE`：是否只通过 HTTPS 写 cookie；飞书正式环境建议 `true`
- `SESSION_COOKIE_SAMESITE`：cookie SameSite 策略，默认 `Lax`；若飞书内嵌环境不回传 cookie，可设为 `None` 并保持 HTTPS

飞书配置：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_REDIRECT_URI`：飞书登录回跳地址，必须和飞书后台“重定向 URL”完全一致
- `FEISHU_CHAT_ID`：归还请求共享群 chat_id
- `FEISHU_BITABLE_APP_TOKEN`
- `FEISHU_BOARDS_TABLE_ID`
- `FEISHU_RESERVATIONS_TABLE_ID`
- `FEISHU_RETURN_REQUESTS_TABLE_ID`
- `FEISHU_ADMINS_TABLE_ID`

多维表格字段名按当前代码默认值创建即可：

- Boards：`ID`、`单板编号`、`类型`、`版本号`、`系统版本号`、`子卡列表`、`状态`、`当前使用人`、`当前使用人姓名`、`当前申请记录`、`备注`、`是否删除`、`创建时间`、`更新时间`
- Reservations：`ID`、`单板ID`、`申请人`、`申请人姓名`、`申请时长`、`用途备注`、`开始时间`、`计划结束时间`、`实际归还时间`、`状态`、`归还请求次数`、`创建时间`、`更新时间`。`状态` 可为 `reserved`、`active`、`returned`，超时由当前时间派生展示
- ReturnRequests：`ID`、`申请记录`、`请求人`、`请求人姓名`、`请求时间`、`通知状态`
- Admins：`管理员飞书用户 ID`、`姓名`、`启用状态`

## 飞书接入教程

飞书工作台、自建应用、多维表格、权限和群提醒的完整配置步骤见：[docs/FEISHU_SETUP.md](docs/FEISHU_SETUP.md)。

## API

- `GET /api/me`
- `GET /api/boards`
- `GET /api/timeline`：查询所有单板在时间范围内的预约和占用片段，支持 `from`、`to` 参数
- `POST /api/boards`
- `PATCH /api/boards/:id`
- `DELETE /api/boards/:id`：软删除单板
- `POST /api/boards/:id/restore`：管理员恢复软删除单板
- `POST /api/reservations`：申请或预约单板，支持 `boardId`、`startAt`、`durationHours`、`purpose`
- `POST /api/reservations/:id/return`
- `POST /api/reservations/:id/request-return`
- `GET /api/my/reservations`

## 常见问题

### 飞书授权登录报 `ReferenceError: fetch is not defined`

这是服务端 Node 版本过旧时常见的问题。当前代码已在飞书客户端里增加 `https.request` fallback；更新代码并重启服务即可。生产环境仍建议使用 Node 18 或更高版本。

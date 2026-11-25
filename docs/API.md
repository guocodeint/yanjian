# 接口与数据约定

同源 JSON API，错误形态 `{ "error": "中文提示" }`。个人模型密钥由用户提交，服务端加密保存且不回显。除 health、auth 与静态资源外，API 必须登录。浏览器自动携带 HttpOnly Cookie。

| 方法与路径 | 输入 | 返回 |
|---|---|---|
| GET /api/health | 无 | ok |
| POST /api/auth/register | username、password | user；设置会话 Cookie |
| POST /api/auth/login | username、password | user；设置会话 Cookie |
| POST /api/auth/logout | 空对象 | ok；撤销会话 |
| GET /api/auth/me | 无 | user 或 null |
| POST /api/query | question | query，供人工确认 |
| GET /api/papers | query、可选 from/to/cursor | items、total、nextCursor、实际 query |
| POST /api/analyze | question、papers:[{source,id}] | evidence、sections、最新 papers、analyzedAt |
| GET /api/projects | 无 | 当前账号完整项目数组 |
| PUT /api/projects/:id | Project | ok，校验项目 ID 与内容一致 |
| DELETE /api/projects/:id | 无 | ok，同时删除关联导出 |
| GET /api/exports | 无 | 当前账号导出元数据列表 |
| POST /api/projects/:id/exports | format:json/csv/md | id、url、filename |
| GET /api/exports/:id | 无 | 当前账号所属文件下载 |

完整类型和校验源为 `shared/schema.ts`。Project.version=1 表示导入格式版本，不是编辑并发版本。项目 ID 在账号范围内唯一。导入后分配新 ID；不覆盖原项目。

Paper.key 为 `source:id`，url 仅由来源和 ID 构造。客户端提交分析时不传不可信正文；服务端重新检索。新简报的 claims 保存 text、refs、highlight、pending。每个 ref 必须指向同一项目证据快照中的原句。旧版段落引用仍可读取。original 保留生成时的分析。

参考版已使用 revision 乐观锁：保存必须携带当前修订号，成功后服务端递增；冲突返回 409，保留服务器版本并提示下载本地备份后刷新。客户端同一项目保存串行化。正式 Qoder 数据库应使用事务或条件更新实现相同行为。实时协同合并不在首版范围内。

公开部署不要直接托管参考版的本地磁盘适配器。Sites 必须将 database/projects 模块替换为平台持久化能力，文件必须私有访问。AI 队列若改为异步任务，可在保持前端业务行为的前提下增加任务提交与状态查询 API。

个人设置接口均需登录。GET /api/settings 返回昵称、研究方向、模型和配置状态。PUT /api/settings/profile 更新 nickname、focus。PUT /api/settings/ai 更新 model 及可选 key，DELETE /api/settings/ai 清除本账号密钥。POST /api/auth/password 验证 currentPassword，设置 newPassword 并替换会话。


POST /api/translate 要求已登录、已配置个人 AI；items 中每项包含 key、field（title 或 abstract）、text（当前保存的原文）。一次最多 20 个标题，或者一篇的标题和摘要。返回 items，每项为 key、field、zh。项目内可选 titleZh、abstractZh 兼容旧备份。
## 相关性及原文定位接口

- POST /api/search 返回逐行 JSON 文本流（application/x-ndjson）。输入 question、query、from、to、concepts（terms、required）、可选 cursor 和 offset。event 携带 stage、detail、at；完成时 result 返回 items、total、received、query、nextCursor 和 concepts，中断返回 error。登录或输入错误使用普通 HTTP 错误响应。
- POST /api/rerank 接收 question、concepts 和最多 20 篇候选的 key、题名及摘要。返回每篇的 key、score、reason 和已核对的 quote。使用账号配置和 AI 限额。
- POST /api/analyze 除文献标识及问题外可传 terms。服务器优先解析开放全文 XML 的正文段落，并按问题选择片段。证据快照包含来源类型、章节、段号、句号序号、原句及上下文。缺少可用全文时使用摘要。模型选择编号，服务端回填原句。

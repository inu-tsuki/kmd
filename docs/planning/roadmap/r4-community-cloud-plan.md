# Community Cloud Reader：社区优先的跨仓库衔接

> 文档状态：社区侧规划输入；不是 Android 实施计划
> 最近更新：2026-07-14
> 历史代号：R4

## 当前判断

Android Reader 已在 R3-K1 结束课程阶段并进入维护休眠。社区能力接下来应先在 KMD 主仓库建立
稳定的数据模型、API、权限和测试；Android 不参与早期契约试错，也不构成 community-api、
Phase B 或 runtime 工作的 gate。

旧 Android R4 草案已归档为历史输入，其中 `local_issue_overrides` 等假设从未成为 R3 实现事实，
不得作为 schema 或同步协议依据。未来恢复 Android 时，应根据届时已经运行的社区契约重新立项。

## 仓库所有权

| 边界 | 当前所有者 | Android 恢复后的角色 |
|---|---|---|
| 社区作品、身份、权限、issue/discussion/review、revision 服务 | `apps/community-api/` 及其后续持久化层 | 消费稳定 API，不定义服务器事实 |
| KMD 语法、播放、inspection、时间/源码定位能力 | language 与 `packages/reader-runtime-web/` | 通过 bridge 消费 capability，不复制解释逻辑 |
| 本地导入、书架、阅读进度、偏好、draft 防丢 | `kmd-reader-android` | 已由 R3 冻结；未来负责客户端状态与同步 UI |

## Android 已有的真实衔接面

- `local_drafts`：issue draft 的本地防丢缓冲；不代表 close/reopen 或提交已持久化/同步。
- `local_revisions`：不可变本地 revision 存储与播放优先级接口；当前没有用户编辑入口或云端同步链路。
- Review / Issues companion：已有源码上下文、marker、draft UI 与本地会话动作骨架，但社区事实仍未权威化。
- WebView bridge：可接收 runtime inspection、进度与 settings；新增社区契约不应穿透或重写播放协议。

不存在可直接复用的 `local_issue_overrides` 同步队列。未来若需要离线 action/outbox，必须根据服务端
幂等键、冲突模型和状态机重新设计，而不是从旧草案恢复表名。

## 社区先行交付

在重新启动 Android 集成前，主仓库应先闭合：

1. 可持久化的作品、revision、issue、discussion/thread 和 review 模型。
2. 身份/权限、状态变更审计、幂等提交、分页与错误契约。
3. 稳定的 DTO/schema 版本策略和 API 集成测试。
4. 位置引用模型。line/time 可先落地；scene/tag 必须等待 Phase B 语言与 runtime 解析事实稳定。
5. Web 或测试客户端完成完整创建、查询、状态变更和冲突路径，证明协议不是 Android 专用草案。

具体端点和字段不在本文提前封盘；它们应由 community-api 的当前计划和实现共同定义。

## Android 重启 Gate

只有以下条件同时满足，才创建新的 Android 社区阶段：

- 社区 API 已部署或可用稳定测试环境，schema 与认证方式有版本化文档。
- issue/discussion/review/revision 的权威状态、幂等、冲突和离线失败语义已通过主仓库测试。
- SourceAnchor 或替代位置模型已有真实 producer 与 consumer，不只是概念类型。
- Android 从 `r3-final` 在当前工具链完成 runtime build、unit、assemble 和 device 回归。
- 新计划明确 Room migration、draft/outbox 生命周期、同步状态机和用户可恢复错误。

Android 恢复入口：

- [Post-R3 re-entry backlog](https://github.com/inu-tsuki/kmd-reader-android/blob/main/docs/planning/post-r3-reentry-backlog.md)
- [归档的旧 R4 reader 草案](https://github.com/inu-tsuki/kmd-reader-android/blob/main/docs/archive/course-r3-2026/future-drafts/r4-community-review-plan.md)

第二个链接只供考古；第一个链接才是未来恢复入口。

## 与 Phase B / Runtime 的关系

- community-api 的基础作品与讨论能力不等待 Android。
- scene/tag 位置解析等待 Phase B 的正式语法与 AST；line/time 能力可独立设计，但不得伪造未来兼容承诺。
- runtime settings transaction 与 reduced-motion 按既定顺序在 Phase B graph ownership 后收束，与 Android 是否活跃无关。
- 未来 Android 只消费已固化的 runtime/community capability，不反向迫使主仓库为旧客户端保持未发布草案。

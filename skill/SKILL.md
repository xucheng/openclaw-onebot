---
name: openclaw-onebot
description: OpenClaw OneBot 11 plugin for QQ via NapCat/go-cqhttp. Native channel integration with private/group chat, group reactions, block streaming, voice pipeline, allowFrom filtering, and local install/repair workflow.
metadata:
  openclaw:
    emoji: "🐧"
    type: "channel-plugin-installer"
    requires:
      bins: ["git", "node", "npm", "openclaw"]
      config:
        [
          "~/.openclaw/openclaw.json",
          "plugins.allow",
          "plugins.entries.openclaw-onebot",
          "plugins.installs.openclaw-onebot",
          "channels.onebot.wsUrl",
          "channels.onebot.httpUrl"
        ]
      writes:
        [
          "~/.openclaw/local-plugins/openclaw-onebot",
          "~/.openclaw/extensions/onebot",
          "~/.openclaw/openclaw.json"
        ]
      services: ["openclaw-gateway-restart"]
---

# OpenClaw OneBot 11 Channel Plugin

[中文](#中文) | [English](#english)

---

## 中文

OpenClaw 的 **OneBot 11 协议通道插件**，让 QQ 成为 OpenClaw 一等消息通道。

支持 [NapCat](https://github.com/NapNeko/NapCatQQ)、[go-cqhttp](https://github.com/Mrs4s/go-cqhttp) 等所有兼容 OneBot 11 协议的 QQ 机器人框架。

说明：

- 插件 `id` 是 `openclaw-onebot`
- 通道 `id` 仍然是 `onebot`
- 因此 `plugins.allow` / `plugins.entries` / `plugins.installs` 使用 `openclaw-onebot`
- `channels.onebot` 保持不变

### 功能

- 原生 OpenClaw ChannelPlugin 集成
- QQ 私聊和群聊收发
- 群聊 reaction
- 群聊自动 reaction，默认开启
- OpenClaw block streaming 分块回复
- QQ 语音链路：SILK/AMR -> MP3 -> STT/TTS -> sendRecord
- 图片、语音、文件附件发送
- `allowFrom` 来源过滤
- WebSocket 自动重连
- 64 个测试用例通过

### 为什么选它

相对 QQ 官方 Bot API 方案：

- 保留 OneBot 生态兼容性
- 直接进入 OpenClaw 原生消息路由
- 更适合 NapCat / go-cqhttp 现有部署

相对独立 Python 桥接脚本方案：

- 不需要额外 listener 或文件队列
- 不需要自己维护消息桥接逻辑
- block streaming、group reaction、voice pipeline 都在同一插件里
- 测试覆盖更完整

核心区别：

- 这是 OpenClaw 原生插件，不是外挂桥接脚本
- QQ 会像 Telegram、Discord 一样进入统一消息管线
- 不需要额外消息队列或独立 listener

### 适合什么场景

- 想把 QQ 接进 OpenClaw 主网关
- 需要 QQ 私聊和群聊共存
- 需要群聊自动 reaction
- 需要 QQ 端分块连续回复
- 需要处理 QQ 语音消息
- 需要按 `private:<qq>` / `group:<id>` 做精确路由

### 能力边界

- 群聊 reaction 可用
- QQ 私聊 reaction 目前不可靠，不应作为稳定能力依赖
- streaming 这里指 OpenClaw `block streaming`
- QQ 端表现为连续多条分块消息，不是“编辑同一条消息”

### OpenClaw 侧最小配置

```json
{
  "plugins": {
    "allow": ["openclaw-onebot"],
    "entries": {
      "openclaw-onebot": {
        "enabled": true
      }
    }
  },
  "channels": {
    "onebot": {
      "enabled": true,
      "wsUrl": "ws://your-host:3001",
      "httpUrl": "http://your-host:3001",
      "groupAutoReact": true,
      "groupAutoReactEmojiId": 1
    }
  }
}
```

如果你希望 QQ 支持 block streaming，还需要：

```json
{
  "agents": {
    "defaults": {
      "blockStreamingDefault": "on"
    }
  }
}
```

可选调优：

```json
{
  "channels": {
    "onebot": {
      "blockStreamingCoalesce": {
        "minChars": 80,
        "idleMs": 600
      }
    }
  }
}
```

### 常用参数

| 参数 | 说明 |
|---|---|
| `channels.onebot.wsUrl` | OneBot WebSocket 地址 |
| `channels.onebot.httpUrl` | OneBot HTTP API 地址 |
| `channels.onebot.accessToken` | 可选鉴权 token |
| `channels.onebot.allowFrom` | 允许的私聊/群聊来源 |
| `channels.onebot.groupAutoReact` | 群聊自动 reaction 开关，默认 `true` |
| `channels.onebot.groupAutoReactEmojiId` | 默认群聊 reaction emoji id，默认 `1` |
| `agents.defaults.blockStreamingDefault` | 是否默认开启 block streaming |

### 目标格式

- `private:<QQ号>` -> 私聊
- `group:<群号>` -> 群聊
- `<QQ号>` -> 自动识别为私聊

### 这个 skill 会做什么

使用这个 skill 时，默认执行：

1. 先核验上游来源：
   - 检查 GitHub 仓库是否为 `https://github.com/xucheng/openclaw-onebot`
   - 优先使用明确 tag / commit，而不是盲目跟随远端默认分支
   - 在执行安装前，先查看 `package.json`、`scripts/`、`test/`
2. 备份 `~/.openclaw/openclaw.json`
3. 只有在用户明确同意后，才克隆或更新仓库到 `~/.openclaw/local-plugins/openclaw-onebot`
4. 同步到 `~/.openclaw/extensions/onebot`
5. 检查并修改 `~/.openclaw/openclaw.json` 中的插件与通道配置
6. 按需补齐 block streaming 和 group auto reaction 配置
7. 在本地执行 `npm test`
8. 只有在用户确认或任务明确要求时，才重启 OpenClaw gateway
9. 验证 `openclaw status --deep`
10. 验证 QQ 收发、群聊 reaction、分块回复

### 安全与确认约定

- 这是一个会修改本地 OpenClaw 安装的 skill
- 它会读写 `~/.openclaw/` 下的插件目录和配置文件
- 它可能重启本地 OpenClaw gateway
- 它会运行仓库中的 `npm test`
- 在执行克隆、写配置、重启服务前，应先向用户明确说明
- 如果用户只要求审查或比较方案，不应默认执行安装

### 推荐安装来源

优先级建议：

1. GitHub 仓库源码核验后安装
2. npm 已发布版本配合仓库代码核验
3. ClawHub skill 仅作为安装/维护说明入口，不应替代源码审查

不建议：

- 在未查看仓库内容的情况下直接 clone 并执行
- 在未备份 `~/.openclaw/openclaw.json` 的情况下直接覆盖配置
- 在不知晓影响范围的情况下直接重启 gateway

### 安装后建议验证

```bash
cd ~/.openclaw/local-plugins/openclaw-onebot
npm test
openclaw status --deep
```

成功标准：

- 测试通过
- `OneBot = ON / OK`
- QQ 能正常收发
- 群聊 reaction 生效
- 开启 streaming 后日志能看到 `deliver(block)`

### 备注

- 这个 skill 用于安装、更新、修复、验收插件，不用于发布代码
- 如果 gateway 重启后短暂断开，等待几秒再查一次即可
- 如果用户更在意供应链安全，应固定到指定 commit/tag，并在隔离环境先跑一次测试

---

## English

An **OpenClaw OneBot 11 channel plugin** that makes QQ a first-class OpenClaw channel.

Works with [NapCat](https://github.com/NapNeko/NapCatQQ), [go-cqhttp](https://github.com/Mrs4s/go-cqhttp), and other OneBot 11 compatible QQ bot frameworks.

Notes:

- Plugin id: `openclaw-onebot`
- Channel id: `onebot`
- Use `openclaw-onebot` for `plugins.allow` / `plugins.entries` / `plugins.installs`
- Use `channels.onebot` for runtime channel config

### Features

- Native OpenClaw ChannelPlugin integration
- QQ private and group messaging
- Group reactions
- Automatic group reactions enabled by default
- OpenClaw block streaming
- Voice pipeline for QQ voice messages
- Attachments for images, voice, and files
- `allowFrom` filtering
- WebSocket auto-reconnect
- 64 tests passing

### Why choose it

Compared with the QQ official bot API route:

- keeps compatibility with the OneBot ecosystem
- plugs directly into OpenClaw native routing
- fits existing NapCat / go-cqhttp deployments better

Compared with standalone Python bridge scripts:

- no extra listener or file-queue bridge
- no custom routing glue to maintain
- block streaming, group reactions, and voice pipeline live in one plugin
- better test coverage

### Capability boundaries

- Group reactions are supported
- Private-chat reactions are not reliable
- Streaming here means OpenClaw `block streaming`
- QQ receives multiple chunked messages, not in-place message edits

### Minimal OpenClaw config

```json
{
  "plugins": {
    "allow": ["openclaw-onebot"],
    "entries": {
      "openclaw-onebot": {
        "enabled": true
      }
    }
  },
  "channels": {
    "onebot": {
      "enabled": true,
      "wsUrl": "ws://your-host:3001",
      "httpUrl": "http://your-host:3001",
      "groupAutoReact": true,
      "groupAutoReactEmojiId": 1
    }
  }
}
```

To enable block streaming:

```json
{
  "agents": {
    "defaults": {
      "blockStreamingDefault": "on"
    }
  }
}
```

Optional coalescing:

```json
{
  "channels": {
    "onebot": {
      "blockStreamingCoalesce": {
        "minChars": 80,
        "idleMs": 600
      }
    }
  }
}
```

### What this skill does

When used, this skill should:

1. Verify the upstream source first:
   - confirm the GitHub repo is `https://github.com/xucheng/openclaw-onebot`
   - prefer a specific tag or commit over an implicit moving branch head
   - inspect `package.json`, `scripts/`, and `test/` before execution
2. Back up `~/.openclaw/openclaw.json`
3. Only after user confirmation, clone or update the repo into `~/.openclaw/local-plugins/openclaw-onebot`
4. Sync it into `~/.openclaw/extensions/onebot`
5. Verify and update plugin/channel config in `~/.openclaw/openclaw.json`
6. Enable block streaming and group auto reactions when requested
7. Run `npm test`
8. Only restart the OpenClaw gateway when the user asked for install/apply behavior
9. Verify `openclaw status --deep`
10. Verify QQ round-trip messaging, group reactions, and streaming blocks

### Safety and confirmation rules

- This skill modifies a local OpenClaw installation
- It reads and writes under `~/.openclaw/`
- It may restart the local OpenClaw gateway
- It runs repository code via `npm test`
- Before cloning, editing config, or restarting services, it should explicitly inform the user
- If the user only wants review or comparison, it should not install by default

### Preferred install sources

Recommended order:

1. GitHub source after manual inspection
2. npm published package plus repository inspection
3. ClawHub as an install/maintenance entrypoint, not as a substitute for source review

Avoid:

- cloning and executing without inspection
- overwriting `~/.openclaw/openclaw.json` without backup
- restarting the gateway without understanding impact

### Post-install checks

```bash
cd ~/.openclaw/local-plugins/openclaw-onebot
npm test
openclaw status --deep
```

Expected:

- tests pass
- `OneBot = ON / OK`
- QQ messages round-trip
- group reactions are visible
- `deliver(block)` appears in logs when streaming is enabled

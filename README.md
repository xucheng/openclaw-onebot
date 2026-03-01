# OpenClaw OneBot 11 Channel Plugin

[中文](#中文) | [English](#english)

---

## 中文

OpenClaw 的 OneBot 11 协议通道插件，支持 [NapCat](https://github.com/NapNeko/NapCatQQ)、[go-cqhttp](https://github.com/Mrs4s/go-cqhttp) 等所有兼容 OneBot 11 协议的 QQ 机器人框架。

### 功能

- 🔌 OneBot 11 协议全支持，QQ 消息作为 OpenClaw 一等通道
- 📨 私聊和群聊收发消息
- 🖼️ 图片、语音、文件附件发送
- 🔄 WebSocket 自动重连（指数退避）
- 🔒 可选 access token 鉴权
- 🎯 `allowFrom` 消息来源过滤（私聊/群聊/用户级别）
- ✅ 58 个测试用例全部通过

### 架构

```
QQ 机器人框架 (NapCat / go-cqhttp)
  ├── WebSocket → 接收消息
  └── HTTP API  → 发送消息
      ↕
OpenClaw OneBot Plugin (ChannelPlugin)
      ↕
OpenClaw 主会话
```

### 安装

```bash
# 方式一：插件安装
openclaw plugin install openclaw-onebot

# 方式二：手动安装
cd ~/.openclaw/plugins
git clone https://github.com/xucheng/openclaw-onebot.git onebot
cd onebot && npm install && npm run build
```

重启 gateway 生效。

### 配置

在 `openclaw.json` 中添加：

```json
{
  "channels": {
    "onebot": {
      "enabled": true,
      "wsUrl": "ws://your-host:port",
      "httpUrl": "http://your-host:port"
    }
  }
}
```

也可以通过环境变量配置：

```bash
ONEBOT_WS_URL=ws://your-host:port
ONEBOT_HTTP_URL=http://your-host:port
ONEBOT_ACCESS_TOKEN=your_token  # 可选
```

#### 高级配置

```json
{
  "channels": {
    "onebot": {
      "enabled": true,
      "wsUrl": "ws://your-host:port",
      "httpUrl": "http://your-host:port",
      "accessToken": "your_token",
      "allowFrom": ["private:12345", "group:67890"],
      "users": ["12345"]
    }
  }
}
```

| 参数 | 说明 |
|------|------|
| `allowFrom` | 消息来源过滤 — `private:<QQ号>`、`group:<群号>`、或 `<QQ号>`（同时匹配私聊和群聊） |
| `users` | 允许触发机器人的 QQ 用户白名单 |
| `accessToken` | HTTP API 使用 `Authorization: Bearer <token>`，WebSocket 使用 query 参数 |

### 消息目标格式

发送消息时，target 格式为：
- `private:<QQ号>` — 私聊消息
- `group:<群号>` — 群聊消息
- `<QQ号>` — 自动识别为私聊

### NapCat 部署

1. 部署 [NapCat](https://github.com/NapNeko/NapCatQQ)（推荐 Docker）
2. 启用 WebSocket 和 HTTP API（同一端口）
3. 在插件中配置对应地址

### 开发

```bash
npm install
npm test          # 运行测试
npm run build     # 编译 TypeScript
npm run coverage  # 覆盖率报告
```

---

## English

An [OpenClaw](https://github.com/openclaw/openclaw) channel plugin that connects to [NapCat](https://github.com/NapNeko/NapCatQQ), [go-cqhttp](https://github.com/Mrs4s/go-cqhttp), or any OneBot 11 compatible QQ bot framework.

### Features

- 🔌 Full OneBot 11 protocol support — QQ as a first-class OpenClaw channel
- 📨 Private & group chat messaging (inbound + outbound)
- 🖼️ Image, audio (record), and file attachments
- 🔄 WebSocket auto-reconnect with exponential backoff
- 🔒 Optional access token authentication
- 🎯 `allowFrom` filtering (private/group/user-level)
- ✅ 58 tests passing

### Architecture

```
QQ Bot Framework (NapCat / go-cqhttp)
  ├── WebSocket → Inbound messages
  └── HTTP API  → Outbound messages
      ↕
OpenClaw OneBot Plugin (ChannelPlugin)
      ↕
OpenClaw Main Session
```

### Installation

```bash
# Option 1: Plugin install
openclaw plugin install openclaw-onebot

# Option 2: Manual
cd ~/.openclaw/plugins
git clone https://github.com/xucheng/openclaw-onebot.git onebot
cd onebot && npm install && npm run build
```

Restart your gateway to activate.

### Configuration

Add to `openclaw.json`:

```json
{
  "channels": {
    "onebot": {
      "enabled": true,
      "wsUrl": "ws://your-host:port",
      "httpUrl": "http://your-host:port"
    }
  }
}
```

Or via environment variables:

```bash
ONEBOT_WS_URL=ws://your-host:port
ONEBOT_HTTP_URL=http://your-host:port
ONEBOT_ACCESS_TOKEN=your_token  # optional
```

#### Advanced Options

```json
{
  "channels": {
    "onebot": {
      "enabled": true,
      "wsUrl": "ws://your-host:port",
      "httpUrl": "http://your-host:port",
      "accessToken": "your_token",
      "allowFrom": ["private:12345", "group:67890"],
      "users": ["12345"]
    }
  }
}
```

| Option | Description |
|--------|-------------|
| `allowFrom` | Filter inbound messages — `private:<qq>`, `group:<id>`, or `<qq>` (matches both) |
| `users` | Whitelist of QQ user IDs that can trigger the bot |
| `accessToken` | Sent as `Authorization: Bearer <token>` for HTTP API and as query param for WebSocket |

### Target Format

When sending messages, targets use the format:
- `private:<qq_number>` — Private message
- `group:<group_id>` — Group message
- `<qq_number>` — Auto-detected as private

### NapCat Setup

1. Deploy [NapCat](https://github.com/NapNeko/NapCatQQ) (Docker recommended)
2. Enable WebSocket server and HTTP API on the same port
3. Configure the plugin with the NapCat endpoint

### Development

```bash
npm install
npm test          # Run tests
npm run build     # Compile TypeScript
npm run coverage  # Coverage report
```

## License

MIT

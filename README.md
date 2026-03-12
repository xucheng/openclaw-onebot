# OpenClaw OneBot 11 Channel Plugin 🐧

[中文](#中文) | [English](#english)

---

## 中文

> ⚠️ **ClawHub 安全扫描说明**：本 skill 在 ClawHub 上可能被标记为 "Suspicious"，这是因为 `.ts` (TypeScript) 文件的扩展名被自动识别为 `video/mp2t` (MPEG-2 视频流) MIME 类型触发了误报。所有源码均为标准 TypeScript，可在 [GitHub](https://github.com/xucheng/openclaw-onebot) 审查。


OpenClaw 的 **OneBot 11 协议通道插件**，让 QQ 成为 OpenClaw 一等消息通道。

支持 [NapCat](https://github.com/NapNeko/NapCatQQ)、[go-cqhttp](https://github.com/Mrs4s/go-cqhttp) 等所有兼容 OneBot 11 协议的 QQ 机器人框架。

说明：
- 插件 `id` 是 `openclaw-onebot`
- 通道 `id` 仍然是 `onebot`
- 因此 `plugins.allow` / `plugins.entries` / `plugins.installs` 使用 `openclaw-onebot`
- `channels.onebot` 保持不变

### 功能

- 🔌 **原生通道插件** — QQ 与 Discord / Telegram / WhatsApp 同级
- 📨 私聊和群聊收发消息
- 😀 **Reaction 支持（群聊）** — 通过 NapCat `set_msg_emoji_like` 给群消息加表情回应；QQ 私聊目前不稳定/通常不生效
- 🌊 **Block streaming** — 支持 OpenClaw 分块回复，QQ 端会连续收到多条流式消息
- 🎤 **语音完整链路** — QQ 语音 (SILK/AMR) → MP3 → STT → TTS → 发送 QQ 语音
- 📦 **消息聚合** — 连续多条消息 1.5s 内自动合并（类似 Telegram 风格）
- 🖼️ 图片、语音、文件附件发送
- 🔄 WebSocket 自动重连（指数退避）
- 🔒 可选 access token 鉴权
- 🎯 `allowFrom` 消息来源过滤（私聊/群聊/用户级别）
- ✅ 64 个测试用例全部通过

### 与其他方案对比

| | **openclaw-onebot** (本项目) | **方案 A** | **方案 B** |
|---|---|---|---|
| **协议** | OneBot 11 (NapCat/go-cqhttp) | QQ 官方 Bot API | OneBot 11 (NapCat) |
| **集成方式** | ✅ **ChannelPlugin 原生集成** | ❌ 独立 Python 脚本 + 文件队列 | ❌ 独立 Python 脚本 |
| **消息路由** | OpenClaw 自动路由，`message` tool 直接用 | 文件队列读写，需手动桥接 | 手动调 Python API |
| **Reaction** | ✅ 群聊支持，私聊不保证 | ❌ 无 | ❌ 无 |
| **流式回复** | ✅ Block streaming 多段消息 | ❌ 无 | ❌ 无 |
| **语音支持** | ✅ SILK/AMR → MP3 → STT/TTS 全自动 | ❌ 无 | ❌ 无 |
| **消息聚合** | ✅ 1.5s 智能合并 | ❌ 无 | ❌ 无 |
| **自动重连** | ✅ WebSocket 指数退避 | daemon 脚本重启 | ❌ 无 |
| **测试** | ✅ 64 tests | ❌ 无 | ❌ 无 |
| **语言** | TypeScript | Python | Python |
| **需要额外进程** | ❌ 随 gateway 启动 | ✅ 需独立运行 daemon | ✅ 需独立运行 listener |

**核心区别**：本项目是 OpenClaw **原生通道插件**，安装后 QQ 就和 Discord / Telegram 一样使用，不需要额外的桥接脚本或消息队列。其他方案都是外挂式的独立进程，需要自己处理消息路由和会话管理。

### 架构

```
QQ 机器人框架 (NapCat / go-cqhttp)
  ├── WebSocket → 接收消息 (含语音 SILK/AMR 自动转 MP3)
  └── HTTP API  → 发送消息 (文字/图片/语音)
      ↕
OpenClaw OneBot Plugin (ChannelPlugin)
  ├── 消息聚合 (1.5s debounce)
  ├── 语音处理 (SILK → pilk → PCM → ffmpeg → MP3)
  └── allowFrom 过滤
      ↕
OpenClaw Gateway (统一消息管线)
  ├── STT (语音转文字)
  ├── Agent 对话
  ├── Block streaming (多段消息回复)
  ├── Reaction action
  └── TTS (文字转语音) → sendRecord → QQ 语音
```

### 快速开始

#### 1. 安装插件

```bash
# 自动安装
bash scripts/install.sh

# 或手动
cp -r src index.ts package.json package-lock.json openclaw.plugin.json tsconfig.json ~/.openclaw/plugins/onebot/
cd ~/.openclaw/plugins/onebot && npm install && npm run build
```

#### 2. 配置

在 `openclaw.json` 中添加：

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
      "httpUrl": "http://your-host:3001"
    }
  }
}
```

说明：
- 插件配置键使用 `openclaw-onebot`
- 通道配置键使用 `channels.onebot`
- 如果你是通过本地路径/扩展目录安装插件，通常还需要在 `plugins.installs.openclaw-onebot` 中指向实际安装目录；如果用 OpenClaw 自己的插件安装流程，这一项会自动生成

也支持环境变量：

```bash
ONEBOT_WS_URL=ws://your-host:3001
ONEBOT_HTTP_URL=http://your-host:3001
ONEBOT_ACCESS_TOKEN=your_token  # 可选
```

#### 3. 重启 Gateway

```bash
openclaw gateway restart
```

### 高级配置

```json
{
  "channels": {
    "onebot": {
      "enabled": true,
      "wsUrl": "ws://your-host:3001",
      "httpUrl": "http://your-host:3001",
      "accessToken": "your_token",
      "allowFrom": ["private:12345", "group:67890"]
    }
  }
}
```

| 参数 | 说明 |
|------|------|
| `allowFrom` | 消息来源白名单 — `private:<QQ号>`、`group:<群号>`、或 `*`（允许所有） |
| `accessToken` | HTTP API 用 Bearer token，WebSocket 用 query 参数 |

### Reaction 与流式回复

- **Reaction**
  - 插件实现了 OpenClaw channel action `react`
  - 通过 NapCat `set_msg_emoji_like` 对群消息或指定群消息 `message_id` 添加表情
  - QQ 私聊 reaction 目前不可靠，接口可能返回成功，但不会真正落到消息上
- **流式回复**
  - 这里支持的是 **OpenClaw block streaming**
  - QQ 端表现为连续多条分块消息，不是“编辑同一条消息”的 draft stream
  - 开启方式：

```json
{
  "agents": {
    "defaults": {
      "blockStreamingDefault": "on"
    }
  }
}
```

- 可选调优：

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

### 验证

- **Reaction**
  - 先让家庭群里出现一条新消息
  - 从 gateway 日志里拿到 `msg=<message_id>`
  - 再执行：

```bash
npm run build
npm run react-test -- --message-id <message_id> --emoji 76
```

  - 当前建议只把这项验证用于群聊消息；私聊 reaction 在 QQ/NapCat 上通常不生效

- **Streaming**
  - 在 OpenClaw 配置里开启 `agents.defaults.blockStreamingDefault = "on"`
  - 然后在 QQ 里发一条明确要求“分段回复”的消息
  - 成功时，QQ 会连续收到多条消息，日志里会出现 `deliver(block)`，最后再有 `deliver(final)`

### 语音支持（可选）

支持 QQ 语音消息的完整自动处理链路：

- **入站**：QQ 语音 (SILK/AMR) → 下载 → 转 MP3 → OpenClaw STT 转文字 → Agent 生成回复
- **出站**：Agent 回复 → TTS 生成音频 → `sendRecord` 发送 QQ 语音

**依赖**：
- `ffmpeg` — 音频格式转换
- `uv` — 运行 `pilk` 解码 SILK 格式（AMR 仅需 ffmpeg）

不需要语音功能时可以跳过这些依赖。

### 消息目标格式

- `private:<QQ号>` — 私聊消息
- `group:<群号>` — 群聊消息
- `<QQ号>` — 自动识别为私聊

### NapCat 部署参考

推荐使用 Docker 部署 [NapCat](https://github.com/NapNeko/NapCatQQ)：

```yaml
# docker-compose.yml
services:
  napcat:
    image: mlikiowa/napcat-docker:latest
    restart: always
    ports:
      - "3001:3001"   # OneBot 11 WS + HTTP
      - "6099:6099"   # WebUI
    volumes:
      - ./napcat-data:/app/.config/QQ
      - ./shared:/shared   # 文件共享目录
```

### 开发

```bash
npm install
npm test          # 64 tests
npm run build     # 编译 TypeScript
npm run coverage  # 覆盖率报告
```

---

## English

> ⚠️ **ClawHub Security Note**: This skill may be flagged as "Suspicious" on ClawHub because `.ts` (TypeScript) files are auto-detected as `video/mp2t` (MPEG-2 Transport Stream) MIME type, triggering a false positive. All source code is standard TypeScript — review it on [GitHub](https://github.com/xucheng/openclaw-onebot).


An [OpenClaw](https://github.com/openclaw/openclaw) **native channel plugin** that connects to [NapCat](https://github.com/NapNeko/NapCatQQ), [go-cqhttp](https://github.com/Mrs4s/go-cqhttp), or any OneBot 11 compatible QQ bot framework.

Note:
- Plugin `id`: `openclaw-onebot`
- Channel `id`: `onebot`
- Use `openclaw-onebot` in `plugins.allow` / `plugins.entries` / `plugins.installs`
- Keep `channels.onebot` unchanged

### Features

- 🔌 **Native channel plugin** — QQ on par with Discord / Telegram / WhatsApp
- 📨 Private & group chat (inbound + outbound)
- 😀 **Reaction support (groups)** — react to a QQ group message via NapCat `set_msg_emoji_like`; QQ private-chat reactions are currently unreliable
- 🌊 **Block streaming** — OpenClaw partial replies arrive as multiple QQ messages
- 🎤 **Full voice pipeline** — QQ voice (SILK/AMR) → MP3 → STT → TTS → send QQ voice
- 📦 **Message batching** — auto-merge rapid messages within 1.5s (Telegram-style)
- 🖼️ Image, audio, and file attachments
- 🔄 WebSocket auto-reconnect with exponential backoff
- 🔒 Optional access token authentication
- 🎯 `allowFrom` filtering (private/group/user-level)
- ✅ 64 tests passing

### Comparison with Alternatives

| | **openclaw-onebot** (this) | **方案 A** | **方案 B** |
|---|---|---|---|
| **Protocol** | OneBot 11 (NapCat/go-cqhttp) | QQ Official Bot API | OneBot 11 |
| **Integration** | ✅ **Native ChannelPlugin** | ❌ Standalone Python + file queue | ❌ Standalone Python scripts |
| **Message routing** | Auto via OpenClaw `message` tool | Manual file I/O bridge | Manual Python API calls |
| **Reactions** | ✅ Group chats only; private chats not reliable | ❌ None | ❌ None |
| **Streaming replies** | ✅ Block-streamed multi-message replies | ❌ None | ❌ None |
| **Voice** | ✅ SILK/AMR → MP3 → STT/TTS auto | ❌ None | ❌ None |
| **Batching** | ✅ 1.5s smart merge | ❌ None | ❌ None |
| **Auto-reconnect** | ✅ Exponential backoff | Daemon restart | ❌ None |
| **Tests** | ✅ 64 tests | ❌ None | ❌ None |
| **Language** | TypeScript | Python | Python |
| **Extra process** | ❌ Runs with gateway | ✅ Separate daemon | ✅ Separate listener |

**Key difference**: This is a **native OpenClaw channel plugin** — once installed, QQ works just like Discord or Telegram. No bridge scripts, no message queues, no extra processes.

### Quick Start

#### 1. Install

```bash
bash scripts/install.sh
```

#### 2. Configure

Add to `openclaw.json`:

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
      "httpUrl": "http://your-host:3001"
    }
  }
}
```

Notes:
- Use `openclaw-onebot` for plugin config keys
- Keep runtime channel config under `channels.onebot`
- If you install from a local path / extension directory, you may also need `plugins.installs.openclaw-onebot` pointing at the actual install directory; OpenClaw usually writes this automatically during plugin install

Or via environment variables:

```bash
ONEBOT_WS_URL=ws://your-host:3001
ONEBOT_HTTP_URL=http://your-host:3001
ONEBOT_ACCESS_TOKEN=your_token  # optional
```

#### 3. Restart Gateway

```bash
openclaw gateway restart
```

### Voice Support (Optional)

End-to-end voice flow:
- **Inbound**: QQ voice (SILK/AMR) → download → MP3 → OpenClaw STT → Agent reply
- **Outbound**: Agent reply → TTS audio → `sendRecord` → QQ voice

**Dependencies**: `ffmpeg` + `uv` (for SILK decoding via `pilk`). Skip if text/image only.

### Reactions and Streaming Replies

- **Reactions**
  - The plugin implements the OpenClaw `react` channel action
  - It maps to NapCat `set_msg_emoji_like`
  - Group-message reactions are supported
  - QQ private-chat reactions are currently unreliable: the API may return success while no visible reaction is persisted
- **Streaming replies**
  - This plugin supports **OpenClaw block streaming**
  - QQ receives multiple incremental messages instead of a single edited draft message
  - Enable it with:

```json
{
  "agents": {
    "defaults": {
      "blockStreamingDefault": "on"
    }
  }
}
```

- Optional coalescing hint for OneBot:

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

### Verification

- **Reaction**
  - Send a fresh QQ group message first
  - Read the inbound `msg=<message_id>` from the gateway log
  - Then run:

```bash
npm run build
npm run react-test -- --message-id <message_id> --emoji 76
```

  - For now, treat this as a group-chat verification flow; private-chat reactions are not a reliable capability

- **Streaming**
  - Enable `agents.defaults.blockStreamingDefault = "on"` in OpenClaw config
  - Send a QQ prompt that explicitly asks for chunked / stepwise output
  - Success looks like multiple QQ messages plus `deliver(block)` entries in the gateway log, followed by `deliver(final)`

### Configuration

| Option | Description |
|--------|-------------|
| `allowFrom` | Whitelist — `private:<qq>`, `group:<id>`, or `*` (allow all) |
| `accessToken` | Bearer token for HTTP, query param for WebSocket |

### Target Format

- `private:<qq_number>` — Private message
- `group:<group_id>` — Group message
- `<qq_number>` — Auto-detected as private

### Development

```bash
npm install
npm test          # Run 64 tests
npm run build     # Compile TypeScript
npm run coverage  # Coverage report
```

## License

MIT

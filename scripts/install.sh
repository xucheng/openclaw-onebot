#!/usr/bin/env bash
# OpenClaw OneBot 11 Plugin — 安装脚本
# Install script for OneBot 11 channel plugin
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OPENCLAW_CLI="${OPENCLAW_CLI:-openclaw}"
PLUGIN_DIR="${OPENCLAW_HOME:-$HOME/.openclaw}/plugins/onebot"
RELEASE_DIR="$SKILL_DIR/.clawhub-plugin/openclaw-onebot-plugin"

echo "📦 Installing OpenClaw OneBot plugin..."

# 先在源码仓库完成构建，再把运行时 dist 安装到 OpenClaw 插件目录
if [ ! -d "$SKILL_DIR/node_modules" ]; then
  echo "📥 Installing build dependencies in source repo..."
  (cd "$SKILL_DIR" && npm ci)
fi

echo "📦 Preparing release payload..."
(cd "$SKILL_DIR" && npm run prepare:clawhub:plugin)

if command -v "$OPENCLAW_CLI" >/dev/null 2>&1; then
  echo "🔌 Registering plugin with OpenClaw plugin index..."
  if "$OPENCLAW_CLI" plugins install "$RELEASE_DIR" --force; then
    if [ "${ONEBOT_SYNC_OPENCLAW_CLI:-0}" = "1" ]; then
      node "$RELEASE_DIR/scripts/sync-openclaw-cli.mjs" 2>/dev/null || echo "⚠️  OpenClaw CLI sync skipped; run npm run sync:openclaw-cli if needed."
    else
      echo "ℹ️  OpenClaw CLI patch skipped. Set ONEBOT_SYNC_OPENCLAW_CLI=1 only if your OpenClaw build lacks shared-dir setup flags."
    fi
    echo "✅ OneBot plugin installed via $OPENCLAW_CLI plugins install"
    echo ""
    echo "📝 Next steps:"
    echo "   1. Add to openclaw.json:"
    echo '      "channels": { "onebot": { "enabled": true, "wsUrl": "ws://your-host:port", "httpUrl": "http://your-host:port", "accessToken": "strong-token", "allowFrom": ["private:12345"] } }'
    echo "   2. Restart gateway: openclaw gateway restart"
    exit 0
  fi
  echo "⚠️  $OPENCLAW_CLI plugins install failed; falling back to legacy copy install."
else
  echo "⚠️  OpenClaw CLI not found; falling back to legacy copy install."
fi

# 创建插件目录并清理旧文件，避免残留源码安装时代的兼容文件
mkdir -p "$PLUGIN_DIR"
rm -rf "$PLUGIN_DIR"/src "$PLUGIN_DIR"/scripts "$PLUGIN_DIR"/dist
rm -f \
  "$PLUGIN_DIR"/index.ts \
  "$PLUGIN_DIR"/setup-entry.ts \
  "$PLUGIN_DIR"/tsconfig.json \
  "$PLUGIN_DIR"/package.json \
  "$PLUGIN_DIR"/package-lock.json \
  "$PLUGIN_DIR"/openclaw.plugin.json \
  "$PLUGIN_DIR"/README.md \
  "$PLUGIN_DIR"/LICENSE

# 复制精简后的发布产物
cp -r "$RELEASE_DIR"/dist "$PLUGIN_DIR"/
cp -r "$RELEASE_DIR"/scripts "$PLUGIN_DIR"/
cp "$RELEASE_DIR"/package.json "$PLUGIN_DIR"/
cp "$RELEASE_DIR"/openclaw.plugin.json "$PLUGIN_DIR"/
cp "$RELEASE_DIR"/README.md "$PLUGIN_DIR"/
cp "$RELEASE_DIR"/LICENSE "$PLUGIN_DIR"/

# 安装运行时依赖；显式跳过 peer 依赖，并关闭 audit/lockfile/fund，避免插件安装拖尾
cd "$PLUGIN_DIR"
npm install --omit=dev --omit=peer --no-package-lock --no-audit --no-fund
if [ "${ONEBOT_SYNC_OPENCLAW_CLI:-0}" = "1" ]; then
  node "$PLUGIN_DIR/scripts/sync-openclaw-cli.mjs" 2>/dev/null || echo "⚠️  OpenClaw CLI sync skipped; run npm run sync:openclaw-cli if needed."
else
  echo "ℹ️  OpenClaw CLI patch skipped. Set ONEBOT_SYNC_OPENCLAW_CLI=1 only if your OpenClaw build lacks shared-dir setup flags."
fi

echo "✅ OneBot plugin installed to $PLUGIN_DIR"
echo ""
echo "📝 Next steps:"
echo "   1. Add to openclaw.json:"
echo '      "channels": { "onebot": { "enabled": true, "wsUrl": "ws://your-host:port", "httpUrl": "http://your-host:port", "accessToken": "strong-token", "allowFrom": ["private:12345"] } }'
echo "   2. Restart gateway: openclaw gateway restart"

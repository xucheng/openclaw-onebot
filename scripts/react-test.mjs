#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

import { resolveOneBotAccount } from "../dist/src/config.js";
import { reactToMessage } from "../dist/src/outbound.js";

function usage(exitCode = 0) {
  const text = `Usage:
  npm run react-test -- --message-id <id> --emoji <emoji_id> [--account <id>] [--config <path>] [--json] [--dry-run]

Examples:
  npm run react-test -- --message-id 123456 --emoji 76
  npm run react-test -- --message-id 123456 --emoji 76 --config ~/.openclaw/openclaw.json --json

Notes:
  - This uses the configured OneBot HTTP API and calls set_msg_emoji_like.
  - QQ/NapCat reactions usually expect a QQ emoji id, not arbitrary Unicode text.
`;
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(text);
  process.exit(exitCode);
}

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

function parseArgs(argv) {
  const parsed = {
    account: "default",
    config: process.env.OPENCLAW_CONFIG_PATH || path.join(homedir(), ".openclaw", "openclaw.json"),
    dryRun: false,
    json: false,
    messageId: "",
    emoji: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        usage(0);
        break;
      case "--account":
        parsed.account = argv[++i] ?? "";
        break;
      case "--config":
        parsed.config = argv[++i] ?? "";
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--message-id":
        parsed.messageId = argv[++i] ?? "";
        break;
      case "--emoji":
      case "--emoji-id":
        parsed.emoji = argv[++i] ?? "";
        break;
      default:
        process.stderr.write(`Unknown argument: ${arg}\n`);
        usage(1);
    }
  }

  parsed.config = expandHome(parsed.config);
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.messageId || !args.emoji) usage(1);

  const raw = await readFile(args.config, "utf8");
  const cfg = JSON.parse(raw);
  const account = resolveOneBotAccount(cfg, args.account);

  if (!account.httpUrl) {
    process.stderr.write(`OneBot account "${args.account}" is missing httpUrl in ${args.config}\n`);
    process.exit(1);
  }

  const payload = {
    accountId: account.accountId,
    httpUrl: account.httpUrl,
    messageId: args.messageId,
    emoji: args.emoji,
  };

  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify({ ok: true, dryRun: true, payload }, null, 2)}\n`);
    return;
  }

  const result = await reactToMessage(account, args.messageId, args.emoji);
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ payload, result }, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(
      `Reaction sent: account=${payload.accountId} message_id=${payload.messageId} emoji=${payload.emoji}\n`,
    );
  } else {
    process.stderr.write(`Reaction failed: ${result.error ?? "unknown error"}\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

import WebSocket from "ws";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type {
  ResolvedOneBotAccount,
  OneBotEvent,
  OneBotMessageEvent,
  OneBotMessageSegment,
} from "./types.js";
import { getOneBotRuntime } from "./runtime.js";
import { reactToMessage, sendText as sendOutboundText, sendImage, sendRecord } from "./outbound.js";
import { cleanupVoiceFiles, processVoiceSegments } from "./voice.js";
export {
  cleanupVoiceFiles,
  convertAmrToMp3,
  convertSilkToMp3,
  downloadVoiceFile,
  ensureVoiceTmpDir,
  isAmrFormat,
  isSilkFormat,
  processVoiceSegments,
} from "./voice.js";

// Reconnect configuration
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000];
const MAX_RECONNECT_ATTEMPTS = 100;

// Message batching — aligned with telegram text fragment gap
const BATCH_GAP_MS = 1500;
const BATCH_MAX_MESSAGES = 12;
const BATCH_MAX_CHARS = 50000;

export interface GatewayContext {
  account: ResolvedOneBotAccount;
  abortSignal: AbortSignal;
  cfg: OpenClawConfig;
  onReady?: (data: unknown) => void;
  onError?: (error: Error) => void;
  log?: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    debug?: (msg: string) => void;
  };
}

// ── Text / image extraction ──

export function extractText(segments: OneBotMessageSegment[]): string {
  return segments
    .filter((seg) => seg.type === "text")
    .map((seg) => String(seg.data.text ?? ""))
    .join("");
}

export function extractImages(segments: OneBotMessageSegment[]): string[] {
  return segments
    .filter((seg) => seg.type === "image")
    .map((seg) => String(seg.data.url ?? seg.data.file ?? ""))
    .filter(Boolean);
}

// Fallback: parse CQ-style image codes from raw message text, e.g. [CQ:image,file=xxx] or [CQ:image,url=...]
export function extractImagesFromRawMessage(raw: string | undefined): string[] {
  if (!raw) return [];
  const imgs: string[] = [];
  // Prefer `url=` when both `file=` and `url=` present
  const re = /\[CQ:image,([^\]]*)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const attrs = m[1];
    const fileMatch = /file=([^,\]]+)/i.exec(attrs);
    const urlMatch = /url=([^,\]]+)/i.exec(attrs);
    const chosen = urlMatch ? urlMatch[1] : fileMatch ? fileMatch[1] : null;
    if (chosen) imgs.push(chosen);
  }
  return imgs;
}

export function extractRecordSegments(segments: OneBotMessageSegment[]): OneBotMessageSegment[] {
  return segments.filter((seg) => seg.type === "record");
}

// ── Message batching ──

interface BufferedMessage {
  event: OneBotMessageEvent;
  text: string;
  images: string[];
  recordSegments: OneBotMessageSegment[];
}

interface ChatBatch {
  messages: BufferedMessage[];
  timer: ReturnType<typeof setTimeout>;
  totalChars: number;
}

export function resolveInboundCommandAuthorization(params: {
  pluginRuntime: ReturnType<typeof getOneBotRuntime>;
  cfg: OpenClawConfig;
  allowFrom?: string[];
  peerId: string;
}): boolean {
  const { pluginRuntime, cfg, allowFrom, peerId } = params;
  const hasAllowFrom = Array.isArray(allowFrom) && allowFrom.length > 0;
  const senderAllowedForCommands = !hasAllowFrom
    || allowFrom.some((pattern) => peerId === pattern || pattern === "*");
  const resolveCommandAuthorized =
    pluginRuntime.channel.commands?.resolveCommandAuthorizedFromAuthorizers;

  if (typeof resolveCommandAuthorized !== "function") {
    return senderAllowedForCommands;
  }

  return resolveCommandAuthorized({
    useAccessGroups: cfg.commands?.useAccessGroups !== false,
    authorizers: [
      {
        configured: hasAllowFrom,
        allowed: senderAllowedForCommands,
      },
    ],
    modeWhenAccessGroupsOff: "configured",
  });
}

// ── Gateway ──

export async function startGateway(ctx: GatewayContext): Promise<void> {
  const { account, abortSignal, cfg, onReady, onError, log } = ctx;

  if (!account.wsUrl) {
    throw new Error("OneBot not configured (missing wsUrl)");
  }

  let reconnectAttempts = 0;
  let isAborted = false;
  let currentWs: WebSocket | null = null;
  let isConnecting = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Per-chat message batch buffers
  const chatBatches = new Map<string, ChatBatch>();

  abortSignal.addEventListener("abort", () => {
    isAborted = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // Flush all pending batches
    for (const [key, batch] of chatBatches) {
      clearTimeout(batch.timer);
      chatBatches.delete(key);
    }
    cleanup();
  });

  const cleanup = () => {
    if (currentWs && (currentWs.readyState === WebSocket.OPEN || currentWs.readyState === WebSocket.CONNECTING)) {
      currentWs.close();
    }
    currentWs = null;
  };

  const getReconnectDelay = () => {
    const idx = Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1);
    return RECONNECT_DELAYS[idx];
  };

  const scheduleReconnect = (customDelay?: number) => {
    if (isAborted || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log?.error(`[onebot:${account.accountId}] Max reconnect attempts reached or aborted`);
      return;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const delay = customDelay ?? getReconnectDelay();
    reconnectAttempts++;
    log?.info(`[onebot:${account.accountId}] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!isAborted) {
        connect();
      }
    }, delay);
  };

  const connect = async () => {
    if (isConnecting) {
      log?.debug?.(`[onebot:${account.accountId}] Already connecting, skip`);
      return;
    }
    isConnecting = true;

    try {
      cleanup();

      const wsUrl = account.wsUrl;
      const wsOptions: WebSocket.ClientOptions = {};

      let connectUrl = wsUrl;
      if (account.accessToken) {
        const separator = wsUrl.includes("?") ? "&" : "?";
        connectUrl = `${wsUrl}${separator}access_token=${account.accessToken}`;
      }

      log?.info(`[onebot:${account.accountId}] Connecting to ${wsUrl}`);

      const ws = new WebSocket(connectUrl, wsOptions);
      currentWs = ws;

      const pluginRuntime = getOneBotRuntime();

          // Echo/pending map for sending OneBot actions over this WebSocket (simple RPC)
          const pendingEcho = new Map<string, { resolve: (v: any) => void; timeout: ReturnType<typeof setTimeout> }>();
          let echoCounter = 0;
          const nextEcho = () => `onebot-${Date.now()}-${++echoCounter}`;

          const sendOneBotAction = (wsocket: WebSocket, action: string, params: Record<string, unknown>) => {
            const echo = nextEcho();
            const payload = { action, params, echo };
            log?.info?.(`[onebot:${account.accountId}] sendOneBotAction: action=${action} echo=${echo} params=${JSON.stringify(params).slice(0,200)}`);
            return new Promise<any>((resolve) => {
              const timeout = setTimeout(() => {
                pendingEcho.delete(echo);
                log?.info?.(`[onebot:${account.accountId}] sendOneBotAction timeout: action=${action} echo=${echo}`);
                resolve(null);
              }, 15000);
              pendingEcho.set(echo, { resolve, timeout });
              try {
                wsocket.send(JSON.stringify(payload), (err) => {
                  if (err) {
                    clearTimeout(timeout);
                    pendingEcho.delete(echo);
                    log?.info?.(`[onebot:${account.accountId}] sendOneBotAction send error: action=${action} echo=${echo} err=${String(err)}`);
                    resolve(null);
                  }
                });
              } catch (err) {
                clearTimeout(timeout);
                pendingEcho.delete(echo);
                log?.info?.(`[onebot:${account.accountId}] sendOneBotAction exception: action=${action} echo=${echo} err=${String(err)}`);
                resolve(null);
              }
            });
          };

          const fetchQuotedMessage = async (messageId: string | number) => {
            try {
              log?.info?.(`[onebot:${account.accountId}] fetchQuotedMessage: trying ws get_msg message_id=${messageId}`);
              if (ws && ws.readyState === WebSocket.OPEN) {
                const res = await sendOneBotAction(ws, "get_msg", { message_id: messageId });
                log?.info?.(`[onebot:${account.accountId}] fetchQuotedMessage: ws response for message_id=${messageId} -> ${res ? JSON.stringify(res).slice(0,400) : "<null>"}`);
                if (res?.retcode === 0 && res?.data) return res.data as any;
              } else {
                log?.info?.(`[onebot:${account.accountId}] fetchQuotedMessage: ws not open`);
              }
              // No ws RPC response — do not fallback to HTTP here (keep simple)
              return null;
            } catch (err) {
              log?.info?.(`[onebot:${account.accountId}] fetchQuotedMessage exception: ${String(err)}`);
              return null;
            }
          };

      // ── Dispatch a (possibly batched) set of messages ──

      const dispatchMessages = async (batchKey: string, messages: BufferedMessage[]) => {
        if (messages.length === 0) return;

        const first = messages[0];
        const last = messages[messages.length - 1];
        const event = first.event;
        const isGroup = event.message_type === "group";
        const senderId = String(event.user_id);
        const senderName = event.sender.card || event.sender.nickname || senderId;

        // Combine text, images, and record segments from all buffered messages
        const combinedText = messages.map((m) => m.text).filter(Boolean).join("\n");
        const combinedImages = messages.flatMap((m) => m.images);
        const combinedRecordSegs = messages.flatMap((m) => m.recordSegments);

        if (messages.length > 1) {
          log?.info(
            `[onebot:${account.accountId}] Batched ${messages.length} messages from ${senderName}: ${combinedText.slice(0, 100)}`,
          );
        }

        pluginRuntime.channel.activity.record({
          channel: "onebot",
          accountId: account.accountId,
          direction: "inbound",
        });

        const peerId = isGroup ? `group:${event.group_id}` : `private:${senderId}`;

        const route = pluginRuntime.channel.routing.resolveAgentRoute({
          cfg,
          channel: "onebot",
          accountId: account.accountId,
          peer: {
            kind: isGroup ? "group" : "direct",
            id: peerId,
          },
        });

        const envelopeOptions = pluginRuntime.channel.reply.resolveEnvelopeFormatOptions(cfg);

        // Process voice segments → download, convert SILK, get local paths
        const voiceMedia = await processVoiceSegments(combinedRecordSegs, log);
        const voiceFilePaths = voiceMedia.map((v) => v.path);

        // Build text body — images as placeholders, voice handled via MediaPath
        let attachmentInfo = "";
        for (const img of combinedImages) {
          attachmentInfo += `\n[Image: ${img}]`;
        }
        if (voiceMedia.length > 0) {
          attachmentInfo += "\n<media:audio>";
        } else if (combinedRecordSegs.length > 0) {
          // Voice download/conversion failed — add text placeholder
          attachmentInfo += "\n[语音]";
        }

        const userContent = combinedText + attachmentInfo;

        const body = pluginRuntime.channel.reply.formatInboundEnvelope({
          channel: "OneBot",
          from: senderName,
          timestamp: last.event.time * 1000,
          body: userContent,
          chatType: isGroup ? "group" : "direct",
          sender: {
            id: senderId,
            name: senderName,
          },
          envelope: envelopeOptions,
          ...(combinedImages.length > 0 ? { imageUrls: combinedImages } : {}),
        });

        const fromAddress = isGroup
          ? `onebot:group:${event.group_id}`
          : `onebot:private:${senderId}`;
        const toAddress = fromAddress;
        const commandAuthorized = resolveInboundCommandAuthorization({
          pluginRuntime,
          cfg,
          allowFrom: account.allowFrom,
          peerId,
        });

        // Build media payload for the platform's unified audio pipeline
        const mediaPayload: Record<string, unknown> = {};
        if (voiceMedia.length > 0) {
          mediaPayload.MediaPath = voiceMedia[0].path;
          mediaPayload.MediaType = voiceMedia[0].contentType;
          mediaPayload.MediaUrl = voiceMedia[0].path;
          if (voiceMedia.length > 1) {
            mediaPayload.MediaPaths = voiceMedia.map((v) => v.path);
            mediaPayload.MediaTypes = voiceMedia.map((v) => v.contentType);
            mediaPayload.MediaUrls = voiceMedia.map((v) => v.path);
          }
        }

        // Include images in media payload so downstream handlers see them like single-image messages
        if (combinedImages.length > 0) {
          mediaPayload.MediaUrls = mediaPayload.MediaUrls ?? combinedImages;
          mediaPayload.MediaPaths = mediaPayload.MediaPaths ?? combinedImages;
          // Provide image-specific aliases as well
          mediaPayload.ImageUrls = combinedImages;
          mediaPayload.ImagePaths = combinedImages;
        }

        if (combinedImages.length > 0) {
          log?.info?.(`[onebot:${account.accountId}] dispatchMessages: attaching ${combinedImages.length} image(s) to ctxPayload`);
          for (const img of combinedImages) log?.info?.(`[onebot:${account.accountId}] dispatchMessages image: ${img}`);
        }

        const ctxPayload = pluginRuntime.channel.reply.finalizeInboundContext({
          Body: body,
          RawBody: combinedText,
          CommandBody: combinedText,
          From: fromAddress,
          To: toAddress,
          SessionKey: route.sessionKey,
          AccountId: route.accountId,
          ChatType: isGroup ? "group" : "direct",
          SenderId: senderId,
          SenderName: senderName,
          Provider: "onebot",
          Surface: "onebot",
          MessageSid: String(last.event.message_id),
          Timestamp: last.event.time * 1000,
          CommandAuthorized: commandAuthorized,
          CommandSource: "text",
          OriginatingChannel: "onebot",
          OriginatingTo: toAddress,
          ...mediaPayload,
        });

        log?.info(
          `[onebot:${account.accountId}] ctxPayload: From=${fromAddress}, SessionKey=${route.sessionKey}, ChatType=${isGroup ? "group" : "direct"}, hasAudio=${voiceMedia.length > 0}`,
        );

        const sendErrorMessage = async (errorText: string) => {
          try {
            await sendOutboundText({ to: fromAddress, text: errorText, account });
          } catch (sendErr) {
            log?.error(`[onebot:${account.accountId}] Failed to send error message: ${sendErr}`);
          }
        };

        try {
          const messagesConfig = pluginRuntime.channel.reply.resolveEffectiveMessagesConfig(cfg, route.agentId);

          let hasResponse = false;
          const responseTimeout = 90000;
          let timeoutId: ReturnType<typeof setTimeout> | null = null;

          const timeoutPromise = new Promise<void>((_, reject) => {
            timeoutId = setTimeout(() => {
              if (!hasResponse) reject(new Error("Response timeout"));
            }, responseTimeout);
          });

          const dispatchPromise = pluginRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctxPayload,
            cfg,
            dispatcherOptions: {
              responsePrefix: messagesConfig.responsePrefix,
              deliver: async (
                payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string },
                info: { kind: string },
              ) => {
                hasResponse = true;
                if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }

                log?.info(
                  `[onebot:${account.accountId}] deliver(${info.kind}): textLen=${payload.text?.length ?? 0}`,
                );

                let replyText = payload.text ?? "";
                let audioSendFailed = false;

                const mediaPaths: string[] = [];
                if (payload.mediaUrls?.length) mediaPaths.push(...payload.mediaUrls);
                if (payload.mediaUrl && !mediaPaths.includes(payload.mediaUrl)) {
                  mediaPaths.push(payload.mediaUrl);
                }

                const AUDIO_EXTS = new Set([".mp3", ".ogg", ".wav", ".m4a", ".flac", ".aac", ".opus", ".amr", ".silk"]);
                for (const mediaPath of mediaPaths) {
                  const ext = mediaPath.toLowerCase().replace(/.*(\.[^.]+)$/, "$1");
                  try {
                    const targetType = isGroup ? "group" as const : "private" as const;
                    const targetId = isGroup ? event.group_id! : event.user_id;
                    if (AUDIO_EXTS.has(ext)) {
                      const result = await sendRecord(account, targetType, targetId, mediaPath);
                      const sentId = (result.data as { message_id?: number } | null)?.message_id;
                      log?.info(`[onebot:${account.accountId}] Sent voice: ${mediaPath}${sentId != null ? ` message_id=${sentId}` : ''}`);
                    } else {
                      const result = await sendImage(account, targetType, targetId, mediaPath);
                      const sentId = (result.data as { message_id?: number } | null)?.message_id;
                      log?.info(`[onebot:${account.accountId}] Sent media: ${mediaPath}${sentId != null ? ` message_id=${sentId}` : ''}`);
                    }
                  } catch (err) {
                    if (AUDIO_EXTS.has(ext)) {
                      audioSendFailed = true;
                    }
                    log?.error(`[onebot:${account.accountId}] Media send failed: ${err}`);
                  }
                }

                if (audioSendFailed && !replyText.trim()) {
                  replyText = '[OpenClaw] 语音回复发送失败，已切换为文本提醒。';
                }

                if (replyText.trim()) {
                  try {
                    await sendOutboundText({ to: fromAddress, text: replyText, account });
                    pluginRuntime.channel.activity.record({
                      channel: "onebot",
                      accountId: account.accountId,
                      direction: "outbound",
                    });
                  } catch (err) {
                    log?.error(`[onebot:${account.accountId}] Send failed: ${err}`);
                  }
                }
              },
              onError: async (err: unknown) => {
                log?.error(`[onebot:${account.accountId}] Dispatch error: ${err}`);
                hasResponse = true;
                if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
                await sendErrorMessage(`[OpenClaw] Error: ${String(err).slice(0, 500)}`);
              },
            },
            replyOptions: {},
          });

          try {
            await Promise.race([dispatchPromise, timeoutPromise]);
          } catch (err) {
            if (timeoutId) clearTimeout(timeoutId);
            if (!hasResponse) {
              log?.error(`[onebot:${account.accountId}] No response within timeout`);
              await sendErrorMessage("[OpenClaw] Request received, processing...");
            }
          }
        } catch (err) {
          log?.error(`[onebot:${account.accountId}] Message processing failed: ${err}`);
          await sendErrorMessage(`[OpenClaw] Processing failed: ${String(err).slice(0, 500)}`);
        } finally {
          // Cleanup temp voice files after dispatch
          cleanupVoiceFiles(voiceFilePaths);
        }
      };

      // ── Buffer an incoming message and debounce dispatch ──

      const bufferMessage = async (event: OneBotMessageEvent) => {
        const isGroup = event.message_type === "group";
        const senderId = String(event.user_id);
        const senderName = event.sender.card || event.sender.nickname || senderId;

        // Start with message text extracted from segments or raw_message
        let text = extractText(event.message) || event.raw_message || "";

        // Skip own messages
        if (event.user_id === event.self_id) return;

        log?.info(
          `[onebot:${account.accountId}] ${isGroup ? "Group" : "Private"} message from ${senderName}(${senderId}) msg=${event.message_id}: ${text.slice(0, 100)}`,
        );
        // Mentions / trigger keywords: in group chats, optionally require an @mention
        // or presence of any trigger keyword before proceeding to reply. If filtering
        // is active and message doesn't match, skip processing early to avoid work.
        let allowedByMentionOrKeyword = true;
        if (isGroup) {
          const requireMention = account.requireMention === true;
          const triggerKeywords = account.triggerKeywords ?? account.config.triggerKeywords ?? [];
          const filteringActive = requireMention === true || (Array.isArray(triggerKeywords) && triggerKeywords.length > 0);

          if (filteringActive) {
            allowedByMentionOrKeyword = false;

            if (requireMention) {
              const mentioned = event.message.some((seg) => seg.type === "at" && String((seg.data as any)?.qq) === String(event.self_id));
              if (mentioned) allowedByMentionOrKeyword = true;
            }

            if (!allowedByMentionOrKeyword && Array.isArray(triggerKeywords) && triggerKeywords.length > 0) {
              const lowerText = (text || event.raw_message || "").toLowerCase();
              for (const kw of triggerKeywords) {
                if (!kw) continue;
                if (lowerText.includes(String(kw).toLowerCase())) {
                  allowedByMentionOrKeyword = true;
                  break;
                }
              }
            }

            if (!allowedByMentionOrKeyword) {
              log?.debug?.(`[onebot:${account.accountId}] Ignoring group message without mention or trigger keyword`);
              return;
            }
          } else {
            // No filtering configured — allow processing as before
            allowedByMentionOrKeyword = true;
          }
        }

        // Try to detect a quoted (reply) message id in segments or raw_message
        let replyId: string | number | null = null;
        try {
          for (const seg of event.message) {
            if (seg.type === "reply") {
              const d = seg.data as any;
              replyId = d.id ?? d.message_id ?? d.reply ?? null;
              if (replyId) break;
            }
          }
          if (!replyId && event.raw_message) {
            const m = /\[CQ:reply,id=(\d+)\]/i.exec(event.raw_message);
            if (m) replyId = m[1];
          }
        } catch {}

        // If replyId found, fetch quoted message via WS RPC (best-effort) and collect quoted images
        const quotedImages: string[] = [];
        if (replyId != null) {
          try {
            const quoted = await fetchQuotedMessage(replyId as string | number);
            if (quoted && quoted.message) {
              const qmsg = typeof quoted.message === "string" ? JSON.parse(String(quoted.message)) : quoted.message;
              const qtext = Array.isArray(qmsg) ? extractText(qmsg) : String(qmsg || "");
              const qimgs = Array.isArray(qmsg) ? extractImages(qmsg) : [];
              if (qtext.trim()) {
                const senderLabel = quoted?.sender?.nickname ?? quoted?.sender?.user_id ?? "某人";
                text = `[引用 ${String(senderLabel)} 的消息：${qtext.trim()}]\n${text}`;
              }
              if (qimgs.length > 0) quotedImages.push(...qimgs);
            }
          } catch (e) {
            log?.debug?.(`[onebot:${account.accountId}] fetchQuotedMessage failed: ${String(e)}`);
          }
        }

        // Extract images from segments, record source for debugging
        const imagesFromSegments: string[] = [];
        for (const seg of event.message) {
          if (seg.type === 'image') {
            const val = String((seg.data as any)?.url ?? (seg.data as any)?.file ?? '');
            if (val) imagesFromSegments.push(val);
          }
        }

        let images: string[] = imagesFromSegments.slice();
        if (images.length > 0) {
          log?.info?.(`[onebot:${account.accountId}] extractImages: found ${images.length} image(s) from message segments`);
          // for (const img of images) log?.info?.(`[onebot:${account.accountId}] image(segment): ${img}`);
        } else {
          // If no image segments found, try parsing CQ codes from raw_message as a fallback
          const rawImgs = extractImagesFromRawMessage(event.raw_message);
          if (rawImgs.length > 0) {
            images = rawImgs;
            log?.info?.(`[onebot:${account.accountId}] extractImages: fallback parsed ${rawImgs.length} image(s) from raw_message`);
            // for (const img of rawImgs) log?.info?.(`[onebot:${account.accountId}] image(parsedRaw): ${img}`);
          } else {
            // No images found — dump segments for inspection segments=${JSON.stringify(event.message)}
            try {
              log?.info?.(`[onebot:${account.accountId}] extractImages: no images found`);
            } catch (e) {
              log?.info?.(`[onebot:${account.accountId}] extractImages: no images found`);
            }
          }
        }
        // merge quoted images (avoid duplicates)
        if (quotedImages.length > 0) {
          for (const qi of quotedImages) {
            if (!images.includes(qi)) images.push(qi);
          }
          log?.info?.(`[onebot:${account.accountId}] merged ${quotedImages.length} quoted image(s) into message images`);
        }

        const recordSegments = extractRecordSegments(event.message);

        // Log resolved mention/keyword config per message for verification
        // try {
        //   const requireMentionResolved = account.requireMention === true;
        //   const triggerKeywordsResolved = account.triggerKeywords ?? account.config.triggerKeywords ?? [];
        //   log?.info?.(
        //     `[onebot:${account.accountId}] Message config: requireMention=${requireMentionResolved} triggerKeywords=${JSON.stringify(
        //       triggerKeywordsResolved,
        //     )}`,
        //   );
        // } catch (e) {
        //   log?.info?.(`[onebot:${account.accountId}] Failed to read message-level config: ${String(e)}`);
        // }

        // allowFrom check — apply per-message-type
        const peerId = isGroup ? `group:${event.group_id}` : `private:${senderId}`;
        if (account.allowFrom && account.allowFrom.length > 0) {
          const patterns: string[] = account.allowFrom;

          const hasGroupPatterns = patterns.some((p) => p === "*" || String(p).startsWith("group:"));
          const hasPrivatePatterns = patterns.some((p) => p === "*" || String(p).startsWith("private:"));

          let allowed = true;
          if (isGroup) {
            // Only enforce group-level filtering if there are group/* entries
            if (hasGroupPatterns) {
              allowed = patterns.some((pattern) => pattern === "*" || pattern === `group:${event.group_id}`);
            }
          } else {
            // Private message: only enforce if there are private/* entries
            if (hasPrivatePatterns) {
              allowed = patterns.some((pattern) => pattern === "*" || pattern === `private:${senderId}`);
            }
          }

          if (!allowed) {
            log?.debug?.(`[onebot:${account.accountId}] Ignoring message from unlisted ${peerId} (allowFrom=${JSON.stringify(patterns)})`);
            return;
          }
        }

        if (isGroup && account.groupAutoReact && allowedByMentionOrKeyword) {
          void reactToMessage(account, event.message_id, account.groupAutoReactEmojiId)
            .then((result) => {
              if (!result.ok) {
                log?.error(
                  `[onebot:${account.accountId}] Auto reaction failed for group:${event.group_id} msg=${event.message_id}: ${result.error ?? "unknown error"}`,
                );
              }
            })
            .catch((err) => {
              log?.error(
                `[onebot:${account.accountId}] Auto reaction error for group:${event.group_id} msg=${event.message_id}: ${String(err)}`,
              );
            });
        }

        // Batch key: per-chat + per-sender for groups
        const batchKey = isGroup
          ? `group:${event.group_id}::${senderId}`
          : `private:${senderId}`;

        const buffered: BufferedMessage = { event, text, images, recordSegments };

        const existing = chatBatches.get(batchKey);
        if (existing) {
          // Check limits
          if (
            existing.messages.length >= BATCH_MAX_MESSAGES ||
            existing.totalChars + text.length > BATCH_MAX_CHARS
          ) {
            // Flush current batch immediately, then start new one
            clearTimeout(existing.timer);
            chatBatches.delete(batchKey);
            dispatchMessages(batchKey, existing.messages).catch((err) =>
              log?.error(`[onebot:${account.accountId}] Batch dispatch error: ${err}`),
            );
            // Start fresh batch with this message
            const timer = setTimeout(() => {
              const batch = chatBatches.get(batchKey);
              if (batch) {
                chatBatches.delete(batchKey);
                dispatchMessages(batchKey, batch.messages).catch((err) =>
                  log?.error(`[onebot:${account.accountId}] Batch dispatch error: ${err}`),
                );
              }
            }, BATCH_GAP_MS);
            chatBatches.set(batchKey, {
              messages: [buffered],
              timer,
              totalChars: text.length,
            });
          } else {
            // Append to existing batch and reset timer
            existing.messages.push(buffered);
            existing.totalChars += text.length;
            clearTimeout(existing.timer);
            existing.timer = setTimeout(() => {
              const batch = chatBatches.get(batchKey);
              if (batch) {
                chatBatches.delete(batchKey);
                dispatchMessages(batchKey, batch.messages).catch((err) =>
                  log?.error(`[onebot:${account.accountId}] Batch dispatch error: ${err}`),
                );
              }
            }, BATCH_GAP_MS);
          }
        } else {
          // New batch
          const timer = setTimeout(() => {
            const batch = chatBatches.get(batchKey);
            if (batch) {
              chatBatches.delete(batchKey);
              dispatchMessages(batchKey, batch.messages).catch((err) =>
                log?.error(`[onebot:${account.accountId}] Batch dispatch error: ${err}`),
              );
            }
          }, BATCH_GAP_MS);
          chatBatches.set(batchKey, {
            messages: [buffered],
            timer,
            totalChars: text.length,
          });
        }
      };

      ws.on("open", () => {
        log?.info(`[onebot:${account.accountId}] WebSocket connected`);
        isConnecting = false;
        reconnectAttempts = 0;
        onReady?.({});
      });

      ws.on("message", async (data) => {
        try {
          const rawData = data.toString();
          let parsed: any;
          try {
            parsed = JSON.parse(rawData);
          } catch {
            parsed = null;
          }

          // Handle echo responses for sendOneBotAction RPC
          if (parsed && parsed.echo && pendingEcho.has(parsed.echo)) {
            try {
              const h = pendingEcho.get(parsed.echo)!;
              clearTimeout(h.timeout);
              pendingEcho.delete(parsed.echo);
              h.resolve(parsed);
            } catch {
              /* ignore */
            }
            return;
          }

          const event = (parsed ?? (rawData ? JSON.parse(rawData) : null)) as OneBotEvent;

          log?.debug?.(`[onebot:${account.accountId}] Event: post_type=${event?.post_type}`);

          switch (event?.post_type) {
            case "meta_event":
              if (event.meta_event_type === "lifecycle" && event.sub_type === "connect") {
                log?.info(`[onebot:${account.accountId}] Lifecycle: connected`);
              }
              break;

            case "message":
              bufferMessage(event as OneBotMessageEvent);
              break;

            case "notice":
              log?.debug?.(`[onebot:${account.accountId}] Notice: ${(event as { notice_type?: string }).notice_type}`);
              break;
          }
        } catch (err) {
          log?.error(`[onebot:${account.accountId}] Message parse error: ${err}`);
        }
      });

      ws.on("close", (code, reason) => {
        log?.info(`[onebot:${account.accountId}] WebSocket closed: ${code} ${reason.toString()}`);
        isConnecting = false;
        cleanup();

        if (!isAborted && code !== 1000) {
          scheduleReconnect();
        }
      });

      ws.on("error", (err) => {
        log?.error(`[onebot:${account.accountId}] WebSocket error: ${err.message}`);
        isConnecting = false;
        onError?.(err);
      });
    } catch (err) {
      isConnecting = false;
      log?.error(`[onebot:${account.accountId}] Connection failed: ${err}`);
      scheduleReconnect();
    }
  };

  // Start connection
  await connect();

  // Wait for abort signal
  return new Promise((resolve) => {
    abortSignal.addEventListener("abort", () => resolve());
  });
}

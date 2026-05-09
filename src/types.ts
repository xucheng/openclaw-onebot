/**
 * OneBot 11 account configuration (raw config values)
 */
export interface OneBotAccountConfig {
  enabled?: boolean;
  name?: string;
  /** WebSocket URL for inbound events, e.g. ws://localhost:3001 */
  wsUrl?: string;
  /** HTTP API URL for outbound messages, e.g. http://localhost:3001 */
  httpUrl?: string;
  /** Optional access token for authentication */
  accessToken?: string;
  /** Host directory mounted into the NapCat container for outbound files */
  sharedDir?: string;
  /** Container path that maps to the shared host directory */
  containerSharedDir?: string;
  /** Whitelist of allowed senders, e.g. ["private:12345", "group:67890", "*"] */
  allowFrom?: string[];
  /** Automatically react to inbound group messages (disabled by default) */
  groupAutoReact?: boolean;
  /** QQ/NapCat emoji id used for automatic group reactions */
  groupAutoReactEmojiId?: string | number;
  /** Require an @mention in group messages before replying */
  requireMention?: boolean;
  /** Trigger keywords that cause the bot to reply when present in a message */
  triggerKeywords?: string[];
}

/**
 * Resolved OneBot account (ready to use)
 */
export interface ResolvedOneBotAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  wsUrl: string;
  httpUrl: string;
  accessToken?: string;
  allowFrom?: string[];
  groupAutoReact: boolean;
  groupAutoReactEmojiId: string | number;
  requireMention: boolean;
  triggerKeywords?: string[];
  config: OneBotAccountConfig;
}

// ── OneBot 11 Event Types ──

/**
 * OneBot 11 message segment (CQ message array element)
 */
export interface OneBotMessageSegment {
  type: string;
  data: Record<string, unknown>;
}

/**
 * OneBot 11 sender info
 */
export interface OneBotSender {
  user_id: number;
  nickname?: string;
  card?: string;
  sex?: string;
  age?: number;
  role?: string;
}

/**
 * OneBot 11 message event
 */
export interface OneBotMessageEvent {
  post_type: "message";
  message_type: "private" | "group";
  sub_type: string;
  message_id: number;
  user_id: number;
  group_id?: number;
  message: OneBotMessageSegment[];
  raw_message: string;
  sender: OneBotSender;
  self_id: number;
  time: number;
  font?: number;
}

/**
 * OneBot 11 notice event
 */
export interface OneBotNoticeEvent {
  post_type: "notice";
  notice_type: string;
  sub_type?: string;
  self_id: number;
  time: number;
  [key: string]: unknown;
}

/**
 * OneBot 11 meta event (lifecycle, heartbeat)
 */
export interface OneBotMetaEvent {
  post_type: "meta_event";
  meta_event_type: "lifecycle" | "heartbeat";
  sub_type?: string;
  self_id: number;
  time: number;
  status?: Record<string, unknown>;
  interval?: number;
}

/**
 * Any OneBot 11 event
 */
export type OneBotEvent = OneBotMessageEvent | OneBotNoticeEvent | OneBotMetaEvent;

/**
 * OneBot 11 API response
 */
export interface OneBotApiResponse {
  status: string;
  retcode: number;
  data: unknown;
  message?: string;
  wording?: string;
  echo?: string;
}

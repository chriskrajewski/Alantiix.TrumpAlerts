import type { SocialPost } from "../types/post";
import type { SentimentResult } from "./sentiment";
import { getWebhookUrls } from "../config/env";
import { logger } from "../utils/logger";

export interface NotificationPayload {
  platform: SocialPost["platform"];
  account: {
    handle: string;
    displayName?: string;
    id?: string;
  };
  post: {
    id: string;
    url: string;
    text: string;
    createdAt: string;
  };
  sentiment: SentimentResult;
  metadata?: Record<string, unknown>;
}

const webhookUrls = getWebhookUrls();

export async function sendNotification(
  payload: NotificationPayload
): Promise<{ delivered: number }> {
  if (webhookUrls.length === 0) {
    logger.warn("Skipping notification, no webhook configured");
    return { delivered: 0 };
  }

  let delivered = 0;
  await Promise.all(
    webhookUrls.map(async (url) => {
      try {
        const body = buildWebhookBody(url, payload);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          const text = await response.text();
          logger.error("Webhook delivery failed", {
            url,
            status: response.status,
            body: text
          });
          return;
        }
        delivered += 1;
      } catch (error) {
        logger.error("Webhook request errored", {
          url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    })
  );

  return { delivered };
}

function buildWebhookBody(url: string, payload: NotificationPayload): unknown {
  if (isDiscordWebhook(url)) {
    return createDiscordMessage(payload);
  }
  return payload;
}

function isDiscordWebhook(url: string): boolean {
  return /^https:\/\/(?:ptb\.|canary\.)?discord\.com\/api\/webhooks\//i.test(url);
}

function createDiscordMessage(payload: NotificationPayload): Record<string, unknown> {
  const displayName = payload.account.displayName ?? payload.account.handle;
  const platform = getPlatformVisuals(payload.platform);
  const style = getSentimentStyle(payload.sentiment.label);
  const rationale = truncate(payload.sentiment.rationale, 1024, "…");
  const description = formatQuote(
    truncate(
      payload.post.text.trim().length > 0 ? payload.post.text : "(no text content provided)",
      2000,
      "…"
    )
  );
  const metadata = formatMetadata(payload.metadata);

  const content = truncate(
    `${style.emoji} ${platform.emoji} ${platform.name} alert · ${displayName}`,
    2000,
    "…"
  );

  const embedFields = [
    {
      name: "Quick Action",
      value: buildQuickAction(style, payload, platform.name),
      inline: false
    },
    {
      name: "Sentiment Signals",
      value: buildSentimentField(payload.sentiment, style),
      inline: false
    },
    {
      name: "Post Details",
      value: buildPostDetails(payload, platform.name, displayName, platform.emoji),
      inline: false
    }
  ];

  if (rationale.length > 0) {
    embedFields.push({
      name: "Sentiment Rationale",
      value: rationale,
      inline: false
    });
  }

  if (metadata) {
    embedFields.push({
      name: "Metadata",
      value: metadata,
      inline: false
    });
  } 

  return {
    username: "TrumpPump Alert",
    content,
    embeds: [
      {
        author: {
        },
        title: `${style.emoji} ${platform.emoji} ${displayName} on ${platform.name}`,
        url: payload.post.url,
        description,
        timestamp: payload.post.createdAt,
        color: style.color,
        fields: embedFields,
        thumbnail: {
          url: platform.thumbnailUrl
        },
        footer: {
          text: `${platform.emoji} ${platform.name} • Post ID: ${payload.post.id}`
        }
      }
    ]
  };
}

function formatMetadata(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }
  const maxInnerLength = 1024 - 12; // account for ```json\n and \n``` wrappers
  const serialized = JSON.stringify(metadata, null, 2);
  const inner = truncate(serialized, maxInnerLength, "…");
  return "```json\n" + inner + "\n```";
}

function buildQuickAction(
  style: SentimentStyle,
  payload: NotificationPayload,
  platformName: string
): string {
  return [
    `${style.emoji} **${style.headline}**`,
    style.action,
    ""
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function buildSentimentField(sentiment: SentimentResult, style: SentimentStyle): string {
  const gauge = createSentimentGauge(sentiment.label, style);
  const confidence = buildConfidenceIndicator(sentiment.confidence);
  return [
    `${style.emoji} **${sentiment.label}**`,
    `Gauge: ${gauge}`,
    `Confidence: ${confidence}`,
    `Source: ${sentiment.source}`
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function buildPostDetails(
  payload: NotificationPayload,
  platformName: string,
  displayName: string,
  platformEmoji: string
): string {
  return [
    `**Published:** ${formatTimestamp(payload.post.createdAt)}`
  ].join("\n");
}

const SENTIMENT_ORDER: SentimentResult["label"][] = [
  "Extremely Negative",
  "Very Negative",
  "Negative",
  "Neutral",
  "Positive",
  "Very Positive",
  "Extremely Positive"
];

function createSentimentGauge(label: SentimentResult["label"], style: SentimentStyle): string {
  const totalSegments = SENTIMENT_ORDER.length;
  const index = Math.max(0, SENTIMENT_ORDER.indexOf(label));
  let gauge = "";
  for (let i = 0; i < totalSegments; i += 1) {
    gauge += i <= index ? style.gaugeFill : style.gaugeEmpty;
  }
  return gauge;
}

function buildConfidenceIndicator(confidence: number | null): string {
  if (typeof confidence !== "number") {
    return "N/A";
  }
  const segments = 10;
  const filled = Math.round(confidence * segments);
  const bar = "▰".repeat(filled).padEnd(segments, "▱");
  return `${bar} ${Math.round(confidence * 100)}%`;
}

interface SentimentStyle {
  emoji: string;
  headline: string;
  action: string;
  color: number;
  gaugeFill: string;
  gaugeEmpty: string;
}

function getSentimentStyle(label: SentimentResult["label"]): SentimentStyle {
  switch (label) {
    case "Extremely Positive":
      return {
        emoji: "🚀",
        headline: "Breakout positive sentiment",
        action: "Capitalize on the momentum—share with stakeholders and monitor market reactions closely.",
        color: 0x00b341,
        gaugeFill: "🟩",
        gaugeEmpty: "⬜"
      };
    case "Very Positive":
      return {
        emoji: "📈",
        headline: "Strong positive tone detected",
        action: "Highlight upside potential and evaluate opportunities aligned with the message.",
        color: 0x1f9d50,
        gaugeFill: "🟩",
        gaugeEmpty: "⬜"
      };
    case "Positive":
      return {
        emoji: "✅",
        headline: "Positive sentiment registered",
        action: "Log the positive tone and keep an eye on follow-up statements.",
        color: 0x3aa55d,
        gaugeFill: "🟩",
        gaugeEmpty: "⬜"
      };
    case "Neutral":
      return {
        emoji: "ℹ️",
        headline: "Neutral sentiment",
        action: "No immediate action—scan for context or subsequent updates if relevant.",
        color: 0x5865f2,
        gaugeFill: "🟦",
        gaugeEmpty: "⬜"
      };
    case "Negative":
      return {
        emoji: "⚠️",
        headline: "Potentially Negative sentiment flagged",
        action: "Flag for review and watch for official responses or market shifts.",
        color: 0xfaa61a,
        gaugeFill: "🟧",
        gaugeEmpty: "⬜"
      };
    case "Very Negative":
      return {
        emoji: "🚨",
        headline: "High-risk negative sentiment",
        action: "Escalate to decision-makers and assess potential downside scenarios.",
        color: 0xf04747,
        gaugeFill: "🟥",
        gaugeEmpty: "⬜"
      };
    case "Extremely Negative":
      return {
        emoji: "🛑",
        headline: "Critical negative sentiment",
        action: "Immediate attention required—coordinate a response plan and monitor impacts continuously.",
        color: 0xad1457,
        gaugeFill: "🟥",
        gaugeEmpty: "⬜"
      };
    default:
      return {
        emoji: "🔔",
        headline: "Sentiment update",
        action: "Review this update and determine any necessary follow-up.",
        color: 0x2b2d31,
        gaugeFill: "🟦",
        gaugeEmpty: "⬜"
      };
  }
}

function getPlatformVisuals(
  platform: SocialPost["platform"]
): {
  name: string;
  emoji: string;
  iconUrl: string;
  thumbnailUrl: string;
} {
  if (platform === "twitter") {
    return {
      name: "X (Twitter)",
      emoji: "🐦",
      iconUrl: "https://abs.twimg.com/icons/apple-touch-icon-192x192.png",
      thumbnailUrl: "https://abs.twimg.com/icons/apple-touch-icon-180x180.png"
    };
  }
  return {
    name: "Truth Social",
    emoji: "",
    iconUrl: "https://truthsocial.com/apple-touch-icon.png",
    thumbnailUrl: "https://truthsocial.com/assets/logo.png"
  };
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const iso = date.toISOString();
  const datePart = iso.slice(0, 10);
  const timePart = iso.slice(11, 16);
  return `${datePart} ${timePart} UTC`;
}

function formatQuote(value: string): string {
  return value
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

function truncate(value: string, maxLength: number, ellipsis: string): string {
  if (value.length <= maxLength) {
    return value;
  }
  const sliceLength = Math.max(0, maxLength - ellipsis.length);
  return value.slice(0, sliceLength).trimEnd() + ellipsis;
}

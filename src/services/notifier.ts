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
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
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

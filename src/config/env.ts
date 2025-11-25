import { z } from "zod";

const envSchema = z.object({
  TWITTER_BEARER_TOKEN: z.string().min(1).optional(),
  TWITTER_HANDLES: z.string().optional(),
  TRUTHSOCIAL_HANDLES: z.string().optional(),
  TRUTHSOCIAL_API_BASE_URL: z.string().url().optional(),
  TRUTHSOCIAL_TEST_CREATED_AFTER: z.string().min(1).optional(),
  TRUTHSOCIAL_USER_AGENT: z.string().min(1).optional(),
  ENABLE_TWITTER: z.string().optional(),
  ENABLE_TRUTHSOCIAL: z.string().optional(),
  ENABLE_WEBHOOK_METADATA: z.string().optional(),
  ENABLE_NEWS: z.string().optional(),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  ALERT_WEBHOOK_URLS: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  POLL_WEBHOOK_TOKEN: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  FINNHUB_API_KEY: z.string().min(1).optional(),
  FINNHUB_NEWS_CATEGORY: z.string().min(1).optional(),
  NEWS_KEYWORDS: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-nano")
});

export type Env = z.infer<typeof envSchema>;

const normalizedEnv = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => {
    if (typeof value !== "string") {
      return [key, value];
    }
    const trimmed = value.trim();
    return [key, trimmed.length > 0 ? trimmed : undefined];
  })
) as Record<string, unknown>;

export const env: Env = envSchema.parse(normalizedEnv);

export function getWebhookUrls(): string[] {
  const urls = new Set<string>();
  if (env.ALERT_WEBHOOK_URL) {
    urls.add(env.ALERT_WEBHOOK_URL);
  }
  if (env.ALERT_WEBHOOK_URLS) {
    env.ALERT_WEBHOOK_URLS.split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .forEach((entry) => {
        try {
          const url = new URL(entry);
          urls.add(url.toString());
        } catch {
          // ignore invalid URL entries
        }
      });
  }
  return Array.from(urls);
}

export function flagEnabled(value: string | undefined, defaultValue = true): boolean {
  if (typeof value !== "string") {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

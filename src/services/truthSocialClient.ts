import type { TruthSocialAccountConfig } from "../config/accounts";
import { env } from "../config/env";
import type { SocialPost } from "../types/post";
import { logger } from "../utils/logger";

interface TruthSocialStatus {
  id: string;
  url?: string;
  uri?: string;
  content?: string;
  created_at?: string;
  createdAt?: string;
  account?: {
    id?: string;
    username?: string;
    display_name?: string;
    displayName?: string;
    url?: string;
  };
}

type TruthSocialResponse = TruthSocialStatus[] | { data?: TruthSocialStatus[] };

const DEFAULT_API_BASE_URL = "https://truthsocial-api.vercel.app";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0";

const testCreatedAfterOverride = sanitizeTestCreatedAfter(env.TRUTHSOCIAL_TEST_CREATED_AFTER);

export async function fetchLatestTruths(
  account: TruthSocialAccountConfig,
  createdAfter?: string | null
): Promise<SocialPost[]> {
  const baseUrl = resolveBaseUrl();
  const handle = normalizeHandle(account.handle);
  const params = new URLSearchParams({
    username: handle,
    replies: "false",
    pinned: "false"
  });

  const createdAfterIso =
    testCreatedAfterOverride ?? toIsoString(createdAfter);
  if (createdAfterIso) {
    params.set("createdAfter", createdAfterIso);
  }

  const url = `${baseUrl}/api/statuses?${params.toString()}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": env.TRUTHSOCIAL_USER_AGENT ?? DEFAULT_USER_AGENT
      }
    });
  } catch (error) {
    logger.error("Truth Social API request failed to send", {
      handle,
      url,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }

  if (!response.ok) {
    const body = await safeReadBody(response);
    logger.error("Truth Social API request returned non-OK status", {
      handle,
      url,
      status: response.status,
      body
    });
    return [];
  }

  let payload: TruthSocialResponse;
  try {
    payload = (await response.json()) as TruthSocialResponse;
  } catch (error) {
    logger.error("Truth Social API response could not be parsed as JSON", {
      handle,
      url,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }

  const statuses = Array.isArray(payload) ? payload : payload?.data ?? [];
  return statuses
    .map((status) => toSocialPost(status, account, handle))
    .filter((post): post is SocialPost => Boolean(post))
    .sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
}

function resolveBaseUrl(): string {
  const candidate = env.TRUTHSOCIAL_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  return candidate.endsWith("/") ? candidate.slice(0, -1) : candidate;
}

function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, "").trim();
}

function sanitizeTestCreatedAfter(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const iso = toIsoString(value);
  if (!iso) {
    logger.warn("Ignoring TRUTHSOCIAL_TEST_CREATED_AFTER; invalid ISO-8601 timestamp.", {
      value
    });
    return null;
  }
  logger.info("Truth Social test mode active with createdAfter override.", {
    createdAfter: iso
  });
  return iso;
}

function toIsoString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

function toSocialPost(
  status: TruthSocialStatus,
  account: TruthSocialAccountConfig,
  handle: string
): SocialPost | null {
  const createdAt = status.created_at ?? status.createdAt;
  if (!status.id || !createdAt) {
    return null;
  }

  const accountDisplayName =
    account.displayName ??
    status.account?.display_name ??
    status.account?.displayName ??
    status.account?.username ??
    handle;

  const url =
    status.url ??
    status.uri ??
    `https://truthsocial.com/@${handle}/${encodeURIComponent(status.id)}`;

  const text = extractPlainText(status.content ?? "");
  if (text.trim().length === 0) {
    return null;
  }

  return {
    platform: "truth-social",
    accountHandle: handle,
    accountDisplayName,
    accountId: status.account?.id,
    id: status.id,
    url,
    text,
    createdAt,
    raw: status
  };
}

async function safeReadBody(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function extractPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

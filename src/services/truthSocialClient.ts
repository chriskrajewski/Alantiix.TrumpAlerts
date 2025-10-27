import type { TruthSocialAccountConfig } from "../config/accounts";
import { env } from "../config/env";
import type { SocialPost } from "../types/post";
import { logger } from "../utils/logger";

interface TruthSocialStatus {
  id: string;
  url?: string;
  content?: string;
  created_at: string;
  account?: {
    id: string;
    username: string;
    display_name?: string;
    url?: string;
  };
}

interface TruthSocialAccount {
  id: string;
  username: string;
  display_name?: string;
  url?: string;
}

const API_BASE_URL = "https://truthsocial.com/api";
const CLIENT_ID = "9X1Fdd-pxNsAgEDNi_SfhJWi8T-vLuV2WVzKIbkTCw4";
const CLIENT_SECRET = "ozF8jzI4968oTKFkEnsBC-UbLPCdrSv0MkXGQu2o_-M";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0";

const accountCache = new Map<string, TruthSocialAccount>();

interface AuthState {
  token: string;
  expiresAt?: number;
}

interface AuthFailure {
  message: string;
  status?: number;
  timestamp: number;
}

function getGlobalAuthState(): AuthState | null {
  const key = "__alantiix_truth_social_auth__";
  return ((globalThis as Record<string, unknown>)[key] as AuthState | undefined) ?? null;
}

function setGlobalAuthState(state: AuthState | null) {
  const key = "__alantiix_truth_social_auth__";
  if (state) {
    (globalThis as Record<string, unknown>)[key] = state;
  } else {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

function getGlobalAuthFailure(): AuthFailure | null {
  const key = "__alantiix_truth_social_auth_failure__";
  return ((globalThis as Record<string, unknown>)[key] as AuthFailure | undefined) ?? null;
}

function setGlobalAuthFailure(failure: AuthFailure | null) {
  const key = "__alantiix_truth_social_auth_failure__";
  if (failure) {
    (globalThis as Record<string, unknown>)[key] = failure;
  } else {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

export async function fetchLatestTruths(
  account: TruthSocialAccountConfig
): Promise<SocialPost[]> {
  const handle = account.handle.replace(/^@/, "");

  if (env.TRUTHSOCIAL_PROXY_URL) {
    return fetchViaProxy(handle, account.displayName);
  }

  const token = await ensureAuthToken();
  if (!token) {
    if (env.TRUTHSOCIAL_USERNAME && env.TRUTHSOCIAL_PASSWORD) {
      const failure = getGlobalAuthFailure();
      logger.error("Truth Social authentication unavailable; skipping polling.", {
        handle,
        failure
      });
    } else {
      logger.warn("Truth Social credentials missing; skipping polling.", { handle });
    }
    return [];
  }

  const profile = await getOrLookupAccount(handle, token);
  if (!profile) {
    logger.warn("Could not resolve Truth Social account", { handle });
    return [];
  }

  const params = new URLSearchParams({
    limit: "10",
    exclude_replies: "true"
  });

  const response = await apiGet(
    `/v1/accounts/${profile.id}/statuses`,
    token,
    params,
    `statuses:${handle}`
  );
  if (!response.ok) {
    logger.error("Truth Social statuses request failed", {
      handle,
      status: response.status
    });
    return [];
  }

  try {
    const statuses = (await response.json()) as TruthSocialStatus[];
    return statuses
      .map<SocialPost>((status) => ({
        platform: "truth-social",
        accountHandle: handle,
        accountDisplayName: account.displayName ?? profile.display_name,
        accountId: profile.id,
        id: status.id,
        url: status.url ?? `https://truthsocial.com/@${handle}/${status.id}`,
        text: extractPlainText(status.content ?? ""),
        createdAt: status.created_at,
        raw: status
      }))
      .filter((post) => post.text.trim().length > 0)
      .sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  } catch (error) {
    logger.error("Truth Social statuses JSON parse failed", {
      handle,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

async function getOrLookupAccount(handle: string, token: string): Promise<TruthSocialAccount | null> {
  const cacheKey = handle.toLowerCase();
  const cached = accountCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    acct: handle
  });

  const response = await apiGet("/v1/accounts/lookup", token, params, `lookup:${handle}`);
  if (!response.ok) {
    logger.error("Truth Social account lookup failed", {
      handle,
      status: response.status
    });
    return null;
  }

  try {
    const account = (await response.json()) as TruthSocialAccount;
    accountCache.set(cacheKey, account);
    return account;
  } catch (error) {
    logger.error("Truth Social lookup JSON parse failed", {
      handle,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

async function ensureAuthToken(): Promise<string | null> {
  if (env.TRUTHSOCIAL_TOKEN) {
    setGlobalAuthFailure(null);
    return env.TRUTHSOCIAL_TOKEN;
  }

  const currentState = getGlobalAuthState();
  if (currentState && !isExpired(currentState.expiresAt)) {
    setGlobalAuthFailure(null);
    return currentState.token;
  }

  if (!env.TRUTHSOCIAL_USERNAME || !env.TRUTHSOCIAL_PASSWORD) {
    setGlobalAuthFailure(null);
    return null;
  }

  const newToken = await requestPasswordGrant(
    env.TRUTHSOCIAL_USERNAME,
    env.TRUTHSOCIAL_PASSWORD
  );
  if (!newToken) {
    return null;
  }

  setGlobalAuthFailure(null);
  setGlobalAuthState(newToken);
  return newToken.token;
}

function isExpired(timestamp?: number): boolean {
  if (!timestamp) {
    return false;
  }
  return Date.now() >= timestamp;
}

async function requestPasswordGrant(
  username: string,
  password: string
): Promise<AuthState | null> {
  try {
    const response = await fetch("https://truthsocial.com/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": userAgent()
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "password",
        username,
        password,
        redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
        scope: "read"
      })
    });

    if (!response.ok) {
      logger.error("Truth Social login failed", {
        status: response.status
      });
      setGlobalAuthFailure({
        message: "login-failed",
        status: response.status,
        timestamp: Date.now()
      });
      return null;
    }

    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!payload.access_token) {
      logger.error("Truth Social login response missing access token");
      setGlobalAuthFailure({
        message: "login-response-missing-access-token",
        timestamp: Date.now()
      });
      return null;
    }

    setGlobalAuthFailure(null);
    return {
      token: payload.access_token,
      expiresAt: payload.expires_in ? Date.now() + (payload.expires_in - 60) * 1000 : undefined
    };
  } catch (error) {
    logger.error("Truth Social login request errored", {
      error: error instanceof Error ? error.message : String(error)
    });
    setGlobalAuthFailure({
      message: "login-request-error",
      timestamp: Date.now()
    });
    return null;
  }
}

async function apiGet(
  path: string,
  token: string,
  params: URLSearchParams,
  label: string,
  retry = true
): Promise<Response> {
  const url = new URL(`${API_BASE_URL}${path}`);
  params.forEach((value, key) => url.searchParams.set(key, value));

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "user-agent": userAgent()
    }
  });

  if (response.status === 401 && retry && env.TRUTHSOCIAL_USERNAME && env.TRUTHSOCIAL_PASSWORD) {
    logger.warn("Truth Social token expired, refreshing credentials.");
    setGlobalAuthState(null);
    const refreshed = await ensureAuthToken();
    if (refreshed) {
      return apiGet(path, refreshed, params, label, false);
    }
  }

  if (response.status === 429) {
    const reset = response.headers.get("x-ratelimit-reset");
    logger.warn("Truth Social API rate limited request", {
      label,
      reset
    });
  }

  return response;
}

function userAgent(): string {
  return env.TRUTHSOCIAL_USER_AGENT ?? DEFAULT_USER_AGENT;
}

function extractPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchViaProxy(handle: string, displayName?: string): Promise<SocialPost[]> {
  const template = env.TRUTHSOCIAL_PROXY_URL!;
  let resolvedUrl: string;
  if (template.includes(":handle")) {
    resolvedUrl = template.replace(/:handle/gi, encodeURIComponent(handle));
  } else if (template.includes("{handle}")) {
    resolvedUrl = template.replace(/\{handle\}/gi, encodeURIComponent(handle));
  } else if (template.includes("?")) {
    resolvedUrl = `${template}&handle=${encodeURIComponent(handle)}`;
  } else if (template.endsWith("/")) {
    resolvedUrl = `${template}${encodeURIComponent(handle)}`;
  } else {
    resolvedUrl = `${template}?handle=${encodeURIComponent(handle)}`;
  }

  try {
    const response = await fetch(resolvedUrl, {
      headers: {
        accept: "application/json",
        "user-agent": userAgent()
      }
    });
    if (!response.ok) {
      logger.error("Truth Social proxy request failed", {
        handle,
        status: response.status
      });
      return [];
    }

    const payload = (await response.json()) as TruthSocialStatus[] | { statuses?: TruthSocialStatus[] };
    const statuses = Array.isArray(payload) ? payload : payload.statuses ?? [];
    return statuses
      .map<SocialPost>((status) => ({
        platform: "truth-social",
        accountHandle: handle,
        accountDisplayName: displayName,
        accountId: status.account?.id,
        id: status.id,
        url: status.url ?? `https://truthsocial.com/@${handle}/${status.id}`,
        text: extractPlainText(status.content ?? ""),
        createdAt: status.created_at,
        raw: status
      }))
      .filter((post) => post.text.trim().length > 0)
      .sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  } catch (error) {
    logger.error("Truth Social proxy request errored", {
      handle,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

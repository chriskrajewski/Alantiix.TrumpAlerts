import "../src/config/loadEnv";
import { runPollingCycle } from "../src/services/polling";
import { logger } from "../src/utils/logger";
import { env } from "../src/config/env";

interface MinimalRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
}

interface MinimalResponse {
  setHeader(name: string, value: string): void;
  status(code: number): MinimalResponse;
  json(body: unknown): void;
}

export default async function handler(req: MinimalRequest, res: MinimalResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET,POST");
    res.status(405).json({ message: "Method Not Allowed" });
    return;
  }

  if (env.POLL_WEBHOOK_TOKEN) {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ message: "Missing webhook token" });
      return;
    }
    if (token !== env.POLL_WEBHOOK_TOKEN) {
      res.status(401).json({ message: "Invalid webhook token" });
      return;
    }
  }

  try {
    const result = await runPollingCycle();
    res.status(200).json({
      ok: true,
      result
    });
  } catch (error) {
    logger.error("Polling cycle failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

function extractToken(req: MinimalRequest): string | null {
  const headerKey = "x-poll-token";
  const headers = req.headers ?? {};
  const headerValue = headers[headerKey] ?? headers[headerKey.toUpperCase()];

  const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof headerToken === "string" && headerToken.trim().length > 0) {
    return headerToken.trim();
  }

  const queryToken = req.query?.token ?? req.query?.pollToken ?? req.query?.poll_token;
  const normalizedQueryToken = Array.isArray(queryToken) ? queryToken[0] : queryToken;
  if (typeof normalizedQueryToken === "string" && normalizedQueryToken.trim().length > 0) {
    return normalizedQueryToken.trim();
  }

  return null;
}

import "../src/config/loadEnv";
import { runPollingCycle } from "../src/services/polling";
import { logger } from "../src/utils/logger";

interface MinimalRequest {
  method?: string;
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

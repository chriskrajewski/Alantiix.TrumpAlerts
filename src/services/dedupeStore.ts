import { Redis } from "@upstash/redis";
import { env } from "../config/env";
import type { PostCursor } from "../types/post";
import { logger } from "../utils/logger";

export interface DedupeStore {
  getCursor(key: string): Promise<PostCursor | null>;
  setCursor(key: string, cursor: PostCursor): Promise<void>;
}

const redisConfigured =
  typeof env.UPSTASH_REDIS_REST_URL === "string" &&
  env.UPSTASH_REDIS_REST_URL.length > 0 &&
  typeof env.UPSTASH_REDIS_REST_TOKEN === "string" &&
  env.UPSTASH_REDIS_REST_TOKEN.length > 0;

const redisClient = redisConfigured
  ? new Redis({
      url: env.UPSTASH_REDIS_REST_URL!,
      token: env.UPSTASH_REDIS_REST_TOKEN!
    })
  : null;

class UpstashDedupeStore implements DedupeStore {
  async getCursor(key: string): Promise<PostCursor | null> {
    if (!redisClient) {
      return null;
    }
    try {
      const result = await redisClient.get<PostCursor>(key);
      if (result && typeof result === "object" && "id" in result && "createdAt" in result) {
        return result;
      }
      return null;
    } catch (error) {
      logger.error("Failed to read cursor from Redis", {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async setCursor(key: string, cursor: PostCursor): Promise<void> {
    if (!redisClient) {
      return;
    }
    try {
      await redisClient.set(key, cursor);
    } catch (error) {
      logger.error("Failed to persist cursor in Redis", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

class MemoryDedupeStore implements DedupeStore {
  private readonly state: Map<string, PostCursor>;

  constructor() {
    const globalKey = "__alantiix_dedupe_state__";
    const globalRecord = (globalThis as Record<string, unknown>)[globalKey] as
      | Map<string, PostCursor>
      | undefined;
    if (globalRecord) {
      this.state = globalRecord;
    } else {
      this.state = new Map<string, PostCursor>();
      (globalThis as Record<string, unknown>)[globalKey] = this.state;
    }
  }

  async getCursor(key: string): Promise<PostCursor | null> {
    return this.state.get(key) ?? null;
  }

  async setCursor(key: string, cursor: PostCursor): Promise<void> {
    this.state.set(key, cursor);
  }
}

export const dedupeStore: DedupeStore = redisClient
  ? new UpstashDedupeStore()
  : new MemoryDedupeStore();

export const dedupeStoreType = redisClient ? "upstash" : "memory";

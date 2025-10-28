import { env } from "../config/env";
import {
  finnhubNewsCategory,
  finnhubNewsKeywords,
  finnhubNewsKeywordsNormalized
} from "../config/news";
import type { SocialPost } from "../types/post";
import { logger } from "../utils/logger";

interface FinnhubNewsArticle {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
}

export interface FinnhubNewsRaw {
  article: FinnhubNewsArticle;
  matchedKeywords: string[];
}

const FINNHUB_NEWS_ENDPOINT = "https://finnhub.io/api/v1/news";

export async function fetchFinnhubNews(createdAfter?: string | null): Promise<SocialPost[]> {
  const token = env.FINNHUB_API_KEY;
  if (!token) {
    logger.warn("Finnhub news requested without FINNHUB_API_KEY configured.");
    return [];
  }

  const params = new URLSearchParams({
    category: finnhubNewsCategory,
    token
  });
  const url = `${FINNHUB_NEWS_ENDPOINT}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json"
      }
    });
  } catch (error) {
    logger.error("Finnhub news request failed to send", {
      url,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }

  if (!response.ok) {
    const body = await safeReadBody(response);
    logger.error("Finnhub news request returned non-OK status", {
      url,
      status: response.status,
      body
    });
    return [];
  }

  const payload = await parseResponse(response, url);
  if (!payload) {
    return [];
  }

  const createdAfterMillis = parseCreatedAfter(createdAfter);
  const posts = payload
    .map((article) => toSocialPost(article, createdAfterMillis))
    .filter((post): post is SocialPost => Boolean(post))
    .sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

  return posts;
}

async function parseResponse(response: Response, url: string): Promise<FinnhubNewsArticle[] | null> {
  try {
    const json = await response.json();
    if (!Array.isArray(json)) {
      logger.error("Finnhub news response was not an array", {
        url,
        receivedType: typeof json
      });
      return null;
    }
    return json.filter(isFinnhubNewsArticle);
  } catch (error) {
    logger.error("Finnhub news response could not be parsed as JSON", {
      url,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

function toSocialPost(
  article: FinnhubNewsArticle,
  createdAfterMillis: number | null
): SocialPost | null {
  const createdAt = toIsoString(article.datetime);
  if (!createdAt) {
    return null;
  }
  if (createdAfterMillis !== null && new Date(createdAt).getTime() <= createdAfterMillis) {
    return null;
  }
  if (!article.url) {
    return null;
  }

  const matchedKeywords = collectKeywordMatches(article);
  if (finnhubNewsKeywords.length > 0 && matchedKeywords.length === 0) {
    return null;
  }

  const source = normalizeSource(article.source);
  const text = buildText(article);

  const raw: FinnhubNewsRaw = {
    article,
    matchedKeywords
  };

  return {
    platform: "finnhub-news",
    accountHandle: source,
    accountDisplayName: source,
    id: createArticleId(article),
    url: article.url,
    text,
    createdAt,
    raw
  };
}

function createArticleId(article: FinnhubNewsArticle): string {
  if (typeof article.id === "number") {
    return article.id.toString();
  }
  if (typeof article.url === "string") {
    return article.url;
  }
  return `finnhub-${article.datetime ?? Date.now()}`;
}

function buildText(article: FinnhubNewsArticle): string {
  const headline = typeof article.headline === "string" ? article.headline.trim() : "";
  const summary = typeof article.summary === "string" ? article.summary.trim() : "";
  const parts = [headline, summary].filter((part) => part.length > 0);
  if (parts.length === 0) {
    return article.url ?? "";
  }
  return parts.join("\n\n");
}

function normalizeSource(source: string | undefined): string {
  const trimmed = typeof source === "string" ? source.trim() : "";
  return trimmed.length > 0 ? trimmed : "Finnhub";
}

function collectKeywordMatches(article: FinnhubNewsArticle): string[] {
  if (finnhubNewsKeywords.length === 0) {
    return [];
  }
  const searchSpace = [
    article.headline,
    article.summary,
    article.related,
    article.category,
    article.source
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  const matches = new Set<string>();
  finnhubNewsKeywordsNormalized.forEach((keyword, index) => {
    if (keyword.length === 0) {
      return;
    }
    if (searchSpace.includes(keyword)) {
      matches.add(finnhubNewsKeywords[index] ?? keyword);
    }
  });
  return Array.from(matches);
}

function toIsoString(datetime: number | undefined): string | null {
  if (typeof datetime !== "number" || Number.isNaN(datetime)) {
    return null;
  }
  const date = new Date(datetime * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function parseCreatedAfter(createdAfter: string | null | undefined): number | null {
  if (!createdAfter) {
    return null;
  }
  const timestamp = Date.parse(createdAfter);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return timestamp;
}

async function safeReadBody(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function isFinnhubNewsArticle(candidate: unknown): candidate is FinnhubNewsArticle {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return typeof record.url === "string";
}

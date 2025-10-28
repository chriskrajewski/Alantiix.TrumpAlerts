import { env, flagEnabled } from "./env";

const DEFAULT_CATEGORY = "top news";

function parseKeywords(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export const newsEnabled = flagEnabled(env.ENABLE_NEWS, true);

export const finnhubNewsCategory = (env.FINNHUB_NEWS_CATEGORY ?? DEFAULT_CATEGORY).trim();

export const finnhubNewsKeywords = parseKeywords(env.NEWS_KEYWORDS);

export const hasFinnhubApiKey =
  typeof env.FINNHUB_API_KEY === "string" && env.FINNHUB_API_KEY.length > 0;

export const finnhubNewsKeywordsNormalized = finnhubNewsKeywords.map((keyword) =>
  keyword.toLowerCase()
);

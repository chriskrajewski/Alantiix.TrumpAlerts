import { twitterAccounts, truthSocialAccounts } from "../config/accounts";
import { env, flagEnabled } from "../config/env";
import {
  finnhubNewsCategory,
  finnhubNewsKeywords,
  hasFinnhubApiKey,
  newsEnabled
} from "../config/news";
import { dedupeStore, dedupeStoreType } from "./dedupeStore";
import { analyzeFinancialSentiment } from "./sentiment";
import { fetchLatestTweets, twitterAvailable } from "./twitterClient";
import { fetchLatestTruths } from "./truthSocialClient";
import { fetchFinnhubNews, type FinnhubNewsRaw } from "./finnhubNewsClient";
import { sendNotification } from "./notifier";
import {
  isCursorBefore,
  isPostAfterCursor,
  toCursor,
  type PostCursor,
  type SocialPost
} from "../types/post";
import { logger } from "../utils/logger";

export interface PollingResult {
  processedPosts: number;
  notificationsSent: number;
  twitterAccountsChecked: number;
  truthSocialAccountsChecked: number;
  finnhubArticlesMatched: number;
  notes?: string[];
}

export async function runPollingCycle(): Promise<PollingResult> {
  const notes: string[] = [];
  const twitterEnabled = flagEnabled(env.ENABLE_TWITTER, true);
  const truthSocialEnabled = flagEnabled(env.ENABLE_TRUTHSOCIAL, true);
  const metadataEnabled = flagEnabled(env.ENABLE_WEBHOOK_METADATA, true);
  if (!metadataEnabled) {
    notes.push("Webhook metadata disabled via ENABLE_WEBHOOK_METADATA flag.");
  }
  if (truthSocialEnabled && env.TRUTHSOCIAL_TEST_CREATED_AFTER) {
    notes.push(
      `Truth Social test mode active. Using TRUTHSOCIAL_TEST_CREATED_AFTER=${env.TRUTHSOCIAL_TEST_CREATED_AFTER}.`
    );
  }
  const collected: Array<{ post: SocialPost; cursorKey: string }> = [];

  let twitterChecked = 0;
  if (!twitterEnabled) {
    notes.push("Twitter polling disabled via ENABLE_TWITTER flag.");
  } else if (!twitterAvailable) {
    notes.push("Twitter credentials missing, skipping Twitter polling.");
  } else if (twitterAccounts.length === 0) {
    notes.push("No Twitter accounts configured.");
  } else {
    for (const account of twitterAccounts) {
      const cursorKey = `twitter:${account.username.toLowerCase()}`;
      const cursor = await dedupeStore.getCursor(cursorKey);
      try {
        const posts = await fetchLatestTweets(account, cursor?.id ?? null);
        const fresh = cursor ? posts.filter((post) => isPostAfterCursor(post, cursor)) : posts;
        collected.push(
          ...fresh.map((post) => ({
            post,
            cursorKey
          }))
        );
        twitterChecked += 1;
      } catch (error) {
        logger.error("Polling Twitter account failed", {
          account: account.username,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  let truthSocialChecked = 0;
  if (!truthSocialEnabled) {
    notes.push("Truth Social polling disabled via ENABLE_TRUTHSOCIAL flag.");
  } else if (truthSocialAccounts.length === 0) {
    notes.push("No Truth Social accounts configured.");
  } else {
    for (const account of truthSocialAccounts) {
      const cursorKey = `truth-social:${account.handle.toLowerCase()}`;
      const cursor = await dedupeStore.getCursor(cursorKey);
      const posts = await fetchLatestTruths(account, cursor?.createdAt ?? null);
      const fresh = cursor ? posts.filter((post) => isPostAfterCursor(post, cursor)) : posts;
      collected.push(
        ...fresh.map((post) => ({
          post,
          cursorKey
        }))
      );
      truthSocialChecked += 1;
    }
  }

  let finnhubMatched = 0;
  if (!newsEnabled) {
    notes.push("Finnhub news polling disabled via ENABLE_NEWS flag.");
  } else if (!hasFinnhubApiKey) {
    notes.push("Finnhub news polling skipped; FINNHUB_API_KEY not configured.");
  } else if (finnhubNewsKeywords.length === 0) {
    notes.push("Finnhub news polling skipped; NEWS_KEYWORDS is empty.");
  } else {
    const cursorKey = buildFinnhubCursorKey(finnhubNewsCategory);
    const cursor = await dedupeStore.getCursor(cursorKey);
    try {
      const posts = await fetchFinnhubNews(cursor?.createdAt ?? null);
      const fresh = cursor ? posts.filter((post) => isPostAfterCursor(post, cursor)) : posts;
      collected.push(
        ...fresh.map((post) => ({
          post,
          cursorKey
        }))
      );
      finnhubMatched += fresh.length;
    } catch (error) {
      logger.error("Polling Finnhub news failed", {
        category: finnhubNewsCategory,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const sorted = collected.sort(
    (a, b) => new Date(a.post.createdAt).getTime() - new Date(b.post.createdAt).getTime()
  );

  let notificationsSent = 0;
  const latestCursorByKey = new Map<string, PostCursor>();
  for (const { post, cursorKey } of sorted) {
    const sentiment = await analyzeFinancialSentiment(post.text);
    const metadata = metadataEnabled
      ? buildMetadata({
          post,
          twitterEnabled,
          truthSocialEnabled,
          finnhubEnabled: newsEnabled
        })
      : undefined;
    const response = await sendNotification({
      platform: post.platform,
      account: {
        handle: post.accountHandle,
        displayName: post.accountDisplayName,
        id: post.accountId
      },
      post: {
        id: post.id,
        url: post.url,
        text: post.text,
        createdAt: post.createdAt
      },
      sentiment,
      metadata
    });
    const candidateCursor = toCursor(post);
    const existingCursor = latestCursorByKey.get(cursorKey) ?? null;
    if (isCursorBefore(existingCursor, candidateCursor)) {
      latestCursorByKey.set(cursorKey, candidateCursor);
    }
    notificationsSent += response.delivered;
  }

  await Promise.all(
    Array.from(latestCursorByKey.entries()).map(([cursorKey, cursor]) =>
      dedupeStore.setCursor(cursorKey, cursor)
    )
  );

  return {
    processedPosts: sorted.length,
    notificationsSent,
    twitterAccountsChecked: twitterEnabled ? twitterChecked : 0,
    truthSocialAccountsChecked: truthSocialEnabled ? truthSocialChecked : 0,
    finnhubArticlesMatched: newsEnabled ? finnhubMatched : 0,
    notes
  };
}

function buildFinnhubCursorKey(category: string): string {
  const normalized = category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `finnhub-news:${normalized.length > 0 ? normalized : "top-news"}`;
}

function buildMetadata(options: {
  post: SocialPost;
  twitterEnabled: boolean;
  truthSocialEnabled: boolean;
  finnhubEnabled: boolean;
}): Record<string, unknown> {
  const { post, twitterEnabled, truthSocialEnabled, finnhubEnabled } = options;
  const base: Record<string, unknown> = {
    dedupeStore: dedupeStoreType,
    openAiConfigured: Boolean(env.OPENAI_API_KEY),
    twitterEnabled,
    truthSocialEnabled,
    finnhubEnabled
  };

  if (post.platform === "truth-social") {
    base.truthSocial = {
      apiBaseUrl: env.TRUTHSOCIAL_API_BASE_URL ?? "https://truthsocial-api.vercel.app",
      testCreatedAfter: env.TRUTHSOCIAL_TEST_CREATED_AFTER ?? null
    };
  }

  if (post.platform === "finnhub-news") {
    const raw = post.raw as FinnhubNewsRaw | undefined;
    const finnhubInfo: Record<string, unknown> = {
      category: finnhubNewsCategory,
      matchedKeywords: raw?.matchedKeywords ?? [],
      keywordsConfigured: finnhubNewsKeywords
    };
    if (raw?.article && typeof raw.article === "object") {
      const image = raw.article.image;
      if (typeof image === "string" && image.trim().length > 0) {
        finnhubInfo.articleImage = image;
      }
    }
    base.finnhub = finnhubInfo;
  }

  return base;
}

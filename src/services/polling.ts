import { twitterAccounts, truthSocialAccounts } from "../config/accounts";
import { env, flagEnabled } from "../config/env";
import { dedupeStore, dedupeStoreType } from "./dedupeStore";
import { analyzeFinancialSentiment } from "./sentiment";
import { fetchLatestTweets, twitterAvailable } from "./twitterClient";
import { fetchLatestTruths } from "./truthSocialClient";
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
  notes?: string[];
}

export async function runPollingCycle(): Promise<PollingResult> {
  const notes: string[] = [];
  const twitterEnabled = flagEnabled(env.ENABLE_TWITTER, true);
  const truthSocialEnabled = flagEnabled(env.ENABLE_TRUTHSOCIAL, true);
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

  const sorted = collected.sort(
    (a, b) => new Date(a.post.createdAt).getTime() - new Date(b.post.createdAt).getTime()
  );

  let notificationsSent = 0;
  const latestCursorByKey = new Map<string, PostCursor>();
  for (const { post, cursorKey } of sorted) {
    const sentiment = await analyzeFinancialSentiment(post.text);
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
      metadata: {
        dedupeStore: dedupeStoreType,
        openAiConfigured: Boolean(env.OPENAI_API_KEY),
        twitterEnabled,
        truthSocialApiBaseUrl: env.TRUTHSOCIAL_API_BASE_URL ?? "https://truthsocial-api.vercel.app",
        truthSocialTestCreatedAfter: env.TRUTHSOCIAL_TEST_CREATED_AFTER ?? null,
        truthSocialEnabled
      }
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
    notes
  };
}

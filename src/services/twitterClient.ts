import { TwitterApi, type TweetV2 } from "twitter-api-v2";
import { env } from "../config/env";
import type { TwitterAccountConfig } from "../config/accounts";
import type { SocialPost } from "../types/post";
import { logger } from "../utils/logger";

const bearerToken = env.TWITTER_BEARER_TOKEN;

const twitterClient = bearerToken ? new TwitterApi(bearerToken) : null;

export const twitterAvailable = Boolean(twitterClient);

const userCache = new Map<string, { id: string; username: string }>();

export async function fetchLatestTweets(
  account: TwitterAccountConfig,
  sinceId: string | null
): Promise<SocialPost[]> {
  if (!twitterClient) {
    throw new Error("Twitter client is not configured.");
  }

  const username = account.username.replace(/^@/, "");
  const user = await getOrFetchUser(username);
  if (!user) {
    return [];
  }

  const timeline = await twitterClient.v2.userTimeline(user.id, {
    max_results: 10,
    since_id: sinceId ?? undefined,
    exclude: ["replies", "retweets"],
    "tweet.fields": ["created_at", "lang", "text"]
  });

  const tweets: TweetV2[] = timeline.tweets ?? [];
  const posts = tweets
    .map<SocialPost>((tweet) => ({
      platform: "twitter",
      accountHandle: username,
      accountDisplayName: account.displayName,
      accountId: user.id,
      id: tweet.id,
      url: `https://twitter.com/${username}/status/${tweet.id}`,
      text: tweet.text ?? "",
      createdAt: tweet.created_at ?? new Date().toISOString(),
      raw: tweet
    }))
    .sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

  return posts;
}

async function getOrFetchUser(
  username: string
): Promise<{ id: string; username: string } | null> {
  const cached = userCache.get(username.toLowerCase());
  if (cached) {
    return cached;
  }

  if (!twitterClient) {
    return null;
  }

  try {
    const response = await twitterClient.v2.userByUsername(username);
    if (!response.data?.id) {
      logger.warn("Twitter user lookup returned no data", { username });
      return null;
    }
    const payload = {
      id: response.data.id,
      username: response.data.username
    };
    userCache.set(username.toLowerCase(), payload);
    return payload;
  } catch (error) {
    logger.error("Twitter user lookup failed", {
      username,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

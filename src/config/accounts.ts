import { env } from "./env";

export interface TwitterAccountConfig {
  username: string;
  displayName?: string;
}

export interface TruthSocialAccountConfig {
  handle: string;
  displayName?: string;
}

function parseHandles(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const defaultTwitterHandles: TwitterAccountConfig[] = [
  { username: "realDonaldTrump", displayName: "Donald J. Trump" },
  { username: "POTUS", displayName: "President Joe Biden" },
  { username: "USTreasury", displayName: "U.S. Treasury" },
  { username: "federalreserve", displayName: "Federal Reserve" }
];

const defaultTruthSocialHandles: TruthSocialAccountConfig[] = [
  { handle: "realDonaldTrump", displayName: "Donald J. Trump" }
];

const customTwitterHandles = parseHandles(env.TWITTER_HANDLES).map<TwitterAccountConfig>(
  (username) => ({ username })
);

const customTruthSocialHandles = parseHandles(env.TRUTHSOCIAL_HANDLES).map<TruthSocialAccountConfig>(
  (handle) => ({ handle })
);

function dedupeByUsername(accounts: TwitterAccountConfig[]): TwitterAccountConfig[] {
  const seen = new Set<string>();
  return accounts.filter((account) => {
    if (seen.has(account.username.toLowerCase())) {
      return false;
    }
    seen.add(account.username.toLowerCase());
    return true;
  });
}

function dedupeByHandle(accounts: TruthSocialAccountConfig[]): TruthSocialAccountConfig[] {
  const seen = new Set<string>();
  return accounts.filter((account) => {
    if (seen.has(account.handle.toLowerCase())) {
      return false;
    }
    seen.add(account.handle.toLowerCase());
    return true;
  });
}

export const twitterAccounts: TwitterAccountConfig[] = dedupeByUsername([
  ...customTwitterHandles,
  ...defaultTwitterHandles
]);

export const truthSocialAccounts: TruthSocialAccountConfig[] = dedupeByHandle([
  ...customTruthSocialHandles,
  ...defaultTruthSocialHandles
]);

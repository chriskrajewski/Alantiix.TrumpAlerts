export type Platform = "twitter" | "truth-social";

export interface SocialPost {
  platform: Platform;
  accountHandle: string;
  accountDisplayName?: string;
  accountId?: string;
  id: string;
  url: string;
  text: string;
  createdAt: string;
  raw: unknown;
}

export interface PostCursor {
  id: string;
  createdAt: string;
}

export function toCursor(post: SocialPost): PostCursor {
  return {
    id: post.id,
    createdAt: post.createdAt
  };
}

export function isPostAfterCursor(post: SocialPost, cursor: PostCursor | null): boolean {
  if (!cursor) {
    return true;
  }
  const postTime = new Date(post.createdAt).getTime();
  const cursorTime = new Date(cursor.createdAt).getTime();
  if (postTime === cursorTime) {
    return post.id !== cursor.id;
  }
  return postTime > cursorTime;
}

export function isCursorBefore(current: PostCursor | null, next: PostCursor): boolean {
  if (!current) {
    return true;
  }
  const currentTime = new Date(current.createdAt).getTime();
  const nextTime = new Date(next.createdAt).getTime();
  if (nextTime === currentTime) {
    return current.id !== next.id;
  }
  return nextTime > currentTime;
}

/**
 * A shared chat's public paths: /c/<token> (its page), /c/<token>/portrait (its character's picture) and its link
 * preview picture (opengraph-image). The proxy lets exactly these through without a session; the page and routes
 * check the token themselves and answer 404 for one that isn't live.
 */
export const CHAT_SHARE_PATH = /^\/c\/([A-Za-z0-9_-]{32})(?:\/(?:portrait|opengraph-image(?:-[\w-]+)?))?$/;

export const chatShareRoute = (pathname: string): boolean => CHAT_SHARE_PATH.test(pathname);

/** The browser remembers that this visitor said they're 18 or older (shared Mango Chilli chats). */
export const ADULT_OK_KEY = "fuobe:chat-adult-ok";

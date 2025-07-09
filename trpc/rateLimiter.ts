// trpc/rateLimiter.ts

// Configuration for the rate limiter
const TIME_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 30; // 30 requests per minute

// In-memory store for request timestamps per IP
const requestTimestamps = new Map<string, number[]>();

/**
 * Checks if a request from a given IP is within the rate limit.
 * This function has side effects: it mutates the `requestTimestamps` map.
 *
 * @param ip The IP address of the requester.
 * @returns `true` if the request is allowed, `false` otherwise.
 */
export const checkRateLimit = (ip: string): boolean => {
  const now = Date.now();
  const windowStart = now - TIME_WINDOW_MS;

  const timestamps = requestTimestamps.get(ip) ?? [];
  const recentTimestamps = timestamps.filter((ts) => ts > windowStart);

  if (recentTimestamps.length >= MAX_REQUESTS) {
    return false;
  }

  recentTimestamps.push(now);
  requestTimestamps.set(ip, recentTimestamps);
  return true;
};

/**
 * Periodically cleans up the rate limiter's in-memory store to prevent memory leaks
 * from IPs that are no longer making requests.
 */
const cleanup = () => {
  const now = Date.now();
  const windowStart = now - TIME_WINDOW_MS;
  for (const [ip, timestamps] of requestTimestamps.entries()) {
    const recentTimestamps = timestamps.filter((ts) => ts > windowStart);
    if (recentTimestamps.length === 0) {
      requestTimestamps.delete(ip);
    } else {
      requestTimestamps.set(ip, recentTimestamps);
    }
  }
};

// Run cleanup every 5 minutes
setInterval(cleanup, 5 * 60 * 1000);

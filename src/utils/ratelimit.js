import config from '../../config.js';

/** In-memory per-user command rate limiter. */
const cooldowns = new Map();

/**
 * Returns true if the user should be rate-limited (i.e. they are calling too fast).
 * Returns false if the command is allowed.
 */
export function isRateLimited(userId) {
  const now = Date.now();
  const last = cooldowns.get(userId);
  if (last && now - last < config.commandCooldownMs) {
    return true;
  }
  cooldowns.set(userId, now);
  return false;
}

// Periodically clean stale entries to avoid unbounded growth
setInterval(() => {
  const cutoff = Date.now() - config.commandCooldownMs * 2;
  for (const [key, ts] of cooldowns) {
    if (ts < cutoff) cooldowns.delete(key);
  }
}, 60_000).unref();

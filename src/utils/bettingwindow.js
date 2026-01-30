import config from '../../config.js';

const bettingWindows = new Map();

export function registerBettingWindow(matchId) {
  bettingWindows.set(matchId, Date.now() + config.bettingWindowMs);
}

export function isBettingOpen(matchId) {
  const closeTime = bettingWindows.get(matchId);
  if (!closeTime) return false;
  return Date.now() < closeTime;
}

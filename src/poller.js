import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import config from '../config.js';
import logger from './utils/logger.js';
import { getActiveGame, getMatchResult } from './riot.js';
import { registerBettingWindow } from './utils/bettingwindow.js';
import {
  getAllTrackedPlayers,
  upsertActiveMatch,
  getAllActiveMatches,
  markMatchFinished,
  getUnresolvedBetsByMatch,
  resolveBet,
  updateUserStats,
  touchMatch,
  getGuildChannel,
  getActiveMatchByMatchId,
} from './db.js';

let client = null;
let pollTimer = null;

export function startPoller(discordClient) {
  client = discordClient;
  logger.info({ intervalMs: config.pollIntervalMs }, 'Starting match poller');
  pollTimer = setInterval(pollTick, config.pollIntervalMs);
  pollTick();
}

export function stopPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollTick() {
  try {
    await checkForNewMatches();
    await checkActiveMatches();
  } catch (err) {
    logger.error({ err }, 'Poller tick error');
  }
}

function getDisplayName(riotTag) {
  return riotTag.split('#')[0];
}

async function checkForNewMatches() {
  const players = getAllTrackedPlayers();

  for (const player of players) {
    const game = await getActiveGame(player.puuid, player.region);
    if (!game || game.rateLimited) {
      if (game?.rateLimited) {
        logger.warn('Rate limited during new-match check, pausing tick');
        return;
      }
      continue;
    }

    const regional = config.getRegionalRoute(player.region).toUpperCase();
    const matchId = `${regional}_${game.gameId}`;

    const result = upsertActiveMatch(player.guild_id, player.puuid, matchId);
    if (result.changes > 0) {
      const name = getDisplayName(player.riot_tag);
      logger.info({ guildId: player.guild_id, riotTag: player.riot_tag, matchId }, 'New active match detected');
      registerBettingWindow(matchId);

      const embed = new EmbedBuilder()
        .setTitle('🎮 Match Detected!')
        .setDescription(`**${name}** just entered a match!\n\n⏰ Betting closes in **3 minutes** — place your bets!`)
        .setColor(0x2ecc71)
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bet_win_${matchId}_${player.puuid}`)
          .setLabel('🟢 WIN')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`bet_lose_${matchId}_${player.puuid}`)
          .setLabel('🔴 LOSE')
          .setStyle(ButtonStyle.Danger),
      );

      sendToGuild(player.guild_id, { embeds: [embed], components: [row] });

      // Disable buttons after 3 minutes
      setTimeout(() => {
        closeBetting(player.guild_id, matchId, name);
      }, config.bettingWindowMs);
    }
  }
}

function closeBetting(guildId, matchId, playerName) {
  const embed = new EmbedBuilder()
    .setTitle('🔒 Betting Closed')
    .setDescription(`Betting on **${playerName}**'s match is now closed. Good luck!`)
    .setColor(0x95a5a6)
    .setTimestamp();

  sendToGuild(guildId, { embeds: [embed] });
}

async function checkActiveMatches() {
  const matches = getAllActiveMatches();

  for (const match of matches) {
    const result = await getMatchResult(match.match_id, getRegionForMatch(match));
    if (!result) {
      touchMatch(match.id);
      continue;
    }
    if (result.rateLimited) {
      logger.warn('Rate limited during active-match check, pausing tick');
      return;
    }

    logger.info({ matchId: match.match_id, guildId: match.guild_id }, 'Match ended, settling bets');
    markMatchFinished(match.guild_id, match.match_id);

    const participant = result.info.participants.find(p => p.puuid === match.puuid);
    if (!participant) {
      logger.warn({ matchId: match.match_id, puuid: match.puuid }, 'Tracked player not found in match result');
      continue;
    }
    const trackedPlayerWon = participant.win;

    // Find the player name
    const players = getAllTrackedPlayers();
    const trackedPlayer = players.find(p => p.puuid === match.puuid && p.guild_id === match.guild_id);
    const playerName = trackedPlayer ? getDisplayName(trackedPlayer.riot_tag) : 'Unknown';

    const bets = getUnresolvedBetsByMatch(match.guild_id, match.match_id);
    const lines = [];

    for (const bet of bets) {
      const predictedWin = bet.prediction === 'win';
      const correct = predictedWin === trackedPlayerWon;
      const outcome = correct ? 'correct' : 'incorrect';
      const payout = correct ? bet.amount * config.payoutMultiplier : 0;

      resolveBet(bet.id, outcome);
      updateUserStats(match.guild_id, bet.discord_id, correct, payout);

      const emoji = correct ? '✅' : '❌';
      const resultText = correct ? `won **${payout.toLocaleString()}** 🪙` : 'lost their bet';
      lines.push(`${emoji} <@${bet.discord_id}> bet **${bet.prediction.toUpperCase()}** (${bet.amount.toLocaleString()} 🪙) — ${resultText}`);
    }

    const outcomeEmoji = trackedPlayerWon ? '🏆' : '💀';
    const outcomeText = trackedPlayerWon ? 'WON' : 'LOST';

    const embed = new EmbedBuilder()
      .setTitle(`${outcomeEmoji} Match Over!`)
      .setDescription(
        `**${playerName}** has **${outcomeText}** the match!\n\n` +
        (lines.length > 0 ? lines.join('\n') : '_No bets were placed on this match._')
      )
      .setColor(trackedPlayerWon ? 0x2ecc71 : 0xe74c3c)
      .setTimestamp();

    sendToGuild(match.guild_id, { embeds: [embed] });
  }
}

function getRegionForMatch(match) {
  const players = getAllTrackedPlayers();
  const player = players.find(p => p.puuid === match.puuid && p.guild_id === match.guild_id);
  return player?.region || config.riotRegion;
}

function sendToGuild(guildId, messagePayload) {
  if (!client) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const configuredId = getGuildChannel(guildId);
  const channel = configuredId
    ? guild.channels.cache.get(configuredId)
    : guild.channels.cache.find(
        ch => ch.isTextBased() && !ch.isVoiceBased() && ch.permissionsFor(guild.members.me)?.has('SendMessages')
      );
  if (channel) {
    channel.send(messagePayload).catch(err => logger.error({ err, guildId }, 'Failed to send notification'));
  }
}

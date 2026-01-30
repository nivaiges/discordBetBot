import 'dotenv/config';
import {
  Client, GatewayIntentBits, Collection, REST, Routes,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} from 'discord.js';
import logger from './utils/logger.js';
import { isRateLimited } from './utils/ratelimit.js';
import { startPoller } from './poller.js';
import {
  ensureUser,
  getActiveMatchByMatchId,
  getUserBetOnMatch,
  deductCoins,
  placeBet,
} from './db.js';
import config from '../config.js';
import { isBettingOpen } from './utils/bettingwindow.js';

// Import commands
import * as collect from './commands/collect.js';
import * as adduser from './commands/adduser.js';
import * as bet from './commands/bet.js';
import * as baltop from './commands/baltop.js';
import * as stats from './commands/stats.js';
import * as rank from './commands/rank.js';
import * as bethere from './commands/bethere.js';

// ── Validate env ─────────────────────────────────────────────────────────────

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const RIOT_API_KEY = process.env.RIOT_API_KEY;

if (!DISCORD_TOKEN) {
  logger.fatal('Missing DISCORD_TOKEN environment variable');
  process.exit(1);
}
if (!RIOT_API_KEY) {
  logger.fatal('Missing RIOT_API_KEY environment variable');
  process.exit(1);
}

// ── Build command collection ─────────────────────────────────────────────────

const commands = [collect, adduser, bet, baltop, stats, rank, bethere];
const commandCollection = new Collection();
for (const cmd of commands) {
  commandCollection.set(cmd.data.name, cmd);
}

// ── Register slash commands globally ─────────────────────────────────────────

async function registerCommands(clientId) {
  const rest = new REST().setToken(DISCORD_TOKEN);
  const body = commands.map(c => c.data.toJSON());

  logger.info({ count: body.length }, 'Registering slash commands');
  await rest.put(Routes.applicationCommands(clientId), { body });
  logger.info('Slash commands registered');
}

// ── Create client ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', async () => {
  logger.info({ user: client.user.tag, guilds: client.guilds.cache.size }, 'Bot is online');
  await registerCommands(client.user.id);
  startPoller(client);
});

client.on('interactionCreate', async (interaction) => {
  // ── Slash commands ───────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const cmd = commandCollection.get(interaction.commandName);
    if (!cmd) return;

    if (isRateLimited(interaction.user.id)) {
      return interaction.reply({ content: '⏳ Slow down! Try again in a few seconds.', ephemeral: true });
    }

    try {
      await cmd.execute(interaction);
    } catch (err) {
      logger.error({ err, command: interaction.commandName }, 'Command execution error');
      const reply = { content: '❌ Something went wrong executing that command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
    return;
  }

  // ── Button clicks (bet_win / bet_lose) ───────────────────────────────────
  if (interaction.isButton()) {
    const id = interaction.customId;
    if (!id.startsWith('bet_win_') && !id.startsWith('bet_lose_')) return;

    // Parse: bet_{prediction}_{matchId}_{puuid}
    const parts = id.split('_');
    const prediction = parts[1]; // win or lose
    const puuid = parts[parts.length - 1];
    const matchId = parts.slice(2, -1).join('_');

    // Check betting window
    if (!isBettingOpen(matchId)) {
      return interaction.reply({ content: '🔒 Betting is closed for this match.', ephemeral: true });
    }

    // Show modal to ask for amount
    const modal = new ModalBuilder()
      .setCustomId(`betmodal_${prediction}_${matchId}_${puuid}`)
      .setTitle(`Bet ${prediction.toUpperCase()} — Enter Amount`);

    const amountInput = new TextInputBuilder()
      .setCustomId('bet_amount')
      .setLabel('How many coins do you want to bet?')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 5000')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
    await interaction.showModal(modal);
    return;
  }

  // ── Modal submit (bet amount) ────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    const id = interaction.customId;
    if (!id.startsWith('betmodal_')) return;

    const parts = id.split('_');
    const prediction = parts[1];
    const puuid = parts[parts.length - 1];
    const matchId = parts.slice(2, -1).join('_');

    const amountStr = interaction.fields.getTextInputValue('bet_amount');
    const amount = parseInt(amountStr, 10);

    if (isNaN(amount) || amount <= 0) {
      return interaction.reply({ content: '❌ Enter a valid positive number.', ephemeral: true });
    }

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // Check betting window again
    if (!isBettingOpen(matchId)) {
      return interaction.reply({ content: '🔒 Betting closed while you were entering your amount.', ephemeral: true });
    }

    // Check match is still active
    const match = getActiveMatchByMatchId(guildId, matchId);
    if (!match) {
      return interaction.reply({ content: '❌ This match is no longer active.', ephemeral: true });
    }

    const user = ensureUser(guildId, userId);

    // Check balance
    if (user.coins < amount) {
      return interaction.reply({ content: `💰 Insufficient coins. You have **${user.coins.toLocaleString()}** 🪙.`, ephemeral: true });
    }

    // Check duplicate
    const existing = getUserBetOnMatch(guildId, userId, matchId);
    if (existing) {
      return interaction.reply({ content: `⚠️ You already bet **${existing.prediction.toUpperCase()}** (${existing.amount.toLocaleString()} 🪙) on this match.`, ephemeral: true });
    }

    // Place bet
    deductCoins(guildId, userId, amount);
    placeBet(guildId, userId, matchId, puuid, prediction, amount);

    const emoji = prediction === 'win' ? '🟢' : '🔴';
    return interaction.reply(
      `${emoji} **${interaction.user.username}** bet **${prediction.toUpperCase()}** for **${amount.toLocaleString()}** 🪙`
    );
  }
});

// ── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Login ────────────────────────────────────────────────────────────────────

client.login(DISCORD_TOKEN);

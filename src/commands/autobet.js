import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getTrackedPlayerByTag, ensureUser, setAutoBet, removeAutoBet, getAutoBets } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('autobet')
  .setDescription('Auto-bet on a tracked player whenever they enter a match')
  .addStringOption(opt =>
    opt.setName('player').setDescription('Riot tag (e.g. Name#TAG)').setRequired(false))
  .addStringOption(opt =>
    opt.setName('prediction').setDescription('win or lose').addChoices(
      { name: 'Win', value: 'win' },
      { name: 'Lose', value: 'lose' },
    ).setRequired(false))
  .addIntegerOption(opt =>
    opt.setName('amount').setDescription('Coins to bet each game').setMinValue(1).setRequired(false))
  .addBooleanOption(opt =>
    opt.setName('clear').setDescription('Remove auto-bet for this player').setRequired(false));

export async function execute(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const playerTag = interaction.options.getString('player');
  const clear = interaction.options.getBoolean('clear');

  // No player specified — show current auto-bets
  if (!playerTag) {
    const autoBets = getAutoBets(guildId, userId);
    if (!autoBets.length) {
      return interaction.reply({ content: 'You have no active auto-bets. Use `/autobet player:Name#TAG prediction:win amount:5000` to set one.', ephemeral: true });
    }
    const lines = autoBets.map(ab => {
      const emoji = ab.prediction === 'win' ? '🟢' : '🔴';
      return `${emoji} **${ab.riot_tag}** — ${ab.prediction.toUpperCase()} for **${ab.amount.toLocaleString()}** 🪙`;
    });
    const embed = new EmbedBuilder()
      .setTitle('🤖 Your Auto-Bets')
      .setDescription(lines.join('\n'))
      .setColor(0x3498db);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Look up tracked player
  const tracked = getTrackedPlayerByTag(guildId, playerTag);
  if (!tracked) {
    return interaction.reply({ content: `❌ Player **${playerTag}** is not tracked in this server.`, ephemeral: true });
  }

  // Clear mode
  if (clear) {
    removeAutoBet(guildId, userId, tracked.puuid);
    return interaction.reply({ content: `✅ Auto-bet removed for **${playerTag}**.`, ephemeral: true });
  }

  // Set mode — require prediction and amount
  const prediction = interaction.options.getString('prediction');
  const amount = interaction.options.getInteger('amount');

  if (!prediction || !amount) {
    return interaction.reply({ content: '❌ Provide `prediction` and `amount` to set an auto-bet, or use `clear:True` to remove one.', ephemeral: true });
  }

  ensureUser(guildId, userId);
  setAutoBet(guildId, userId, tracked.puuid, prediction, amount);

  const emoji = prediction === 'win' ? '🟢' : '🔴';
  return interaction.reply({
    content: `${emoji} Auto-bet set: **${prediction.toUpperCase()}** for **${amount.toLocaleString()}** 🪙 on **${playerTag}** every game.`,
    ephemeral: true,
  });
}

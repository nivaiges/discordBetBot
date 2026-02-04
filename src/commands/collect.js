import { SlashCommandBuilder } from 'discord.js';
import { ensureUser, updateCollect } from '../db.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('collect')
  .setDescription('Collect 10,000 coins every 2 hours');

export async function execute(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const user = ensureUser(guildId, userId);

  const now = new Date();

  if (user.last_collect_at) {
    const lastCollect = new Date(user.last_collect_at + 'Z'); // stored as UTC
    const elapsed = now.getTime() - lastCollect.getTime();
    const remaining = config.collectCooldownMs - elapsed;

    if (remaining > 0) {
      const hours = Math.floor(remaining / 3_600_000);
      const minutes = Math.floor((remaining % 3_600_000) / 60_000);
      const seconds = Math.floor((remaining % 60_000) / 1_000);
      return interaction.reply({
        content: `⏳ You already collected recently. Come back in **${hours}h ${minutes}m ${seconds}s**.`,
        ephemeral: true,
      });
    }
  }

  const newCoins = user.coins + config.collectAmount;
  updateCollect(guildId, userId, newCoins, now.toISOString().replace('T', ' ').slice(0, 19));

  return interaction.reply(
    `🪙 Collected **${config.collectAmount.toLocaleString()}** coins! Your balance: **${newCoins.toLocaleString()}** 🪙`
  );
}

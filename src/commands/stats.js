import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { ensureUser } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show your betting stats');

export async function execute(interaction) {
  const user = ensureUser(interaction.guildId, interaction.user.id);

  const streakDisplay = user.current_streak > 0 ? `${user.current_streak} 🔥` : '0';

  const embed = new EmbedBuilder()
    .setTitle(`📊 Stats for ${interaction.user.username}`)
    .addFields(
      { name: '🪙 Coins', value: user.coins.toLocaleString(), inline: true },
      { name: '🎯 Record', value: `${user.correct}W / ${user.incorrect}L`, inline: true },
      { name: '🔥 Streak', value: `${streakDisplay} (Best: ${user.best_streak})`, inline: true },
      { name: '💸 Total Wagered', value: user.total_wagered.toLocaleString(), inline: true },
      { name: '💰 Total Won', value: user.total_won.toLocaleString(), inline: true },
    )
    .setColor(0x3498db);

  return interaction.reply({ embeds: [embed] });
}

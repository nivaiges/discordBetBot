import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getBetHistory } from '../db.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('Show your last 10 bets');

export async function execute(interaction) {
  const bets = getBetHistory(interaction.guildId, interaction.user.id, 10);

  if (bets.length === 0) {
    return interaction.reply({ content: 'You haven\'t placed any bets yet.', ephemeral: true });
  }

  const lines = bets.map(b => {
    const player = b.riot_tag ? b.riot_tag.split('#')[0] : 'Unknown';
    const pred = b.prediction.toUpperCase();
    const amount = b.amount.toLocaleString();

    if (!b.outcome) {
      return `⏳ **${pred}** on ${player} — ${amount} 🪙 (pending)`;
    }

    const correct = b.outcome === 'correct';
    const emoji = correct ? '✅' : '❌';
    const multiplier = b.prediction === 'win' ? config.payoutMultiplier : config.losePayoutMultiplier;
    const payout = correct ? (b.amount * multiplier).toLocaleString() : '0';
    return `${emoji} **${pred}** on ${player} — ${amount} 🪙 → ${correct ? `+${payout}` : 'lost'}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📜 Bet History — ${interaction.user.username}`)
    .setDescription(lines.join('\n'))
    .setColor(0x3498db)
    .setFooter({ text: 'Last 10 bets' });

  return interaction.reply({ embeds: [embed] });
}

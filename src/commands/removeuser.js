import { SlashCommandBuilder } from 'discord.js';
import { removeTrackedPlayer } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('removeuser')
  .setDescription('Stop tracking a League of Legends player')
  .addStringOption(opt =>
    opt.setName('riot_id')
      .setDescription('Riot ID in GameName#TagLine format (e.g. Nivy#NA1)')
      .setRequired(true)
  );

export async function execute(interaction) {
  const riotId = interaction.options.getString('riot_id');
  const guildId = interaction.guildId;

  const removed = removeTrackedPlayer(guildId, riotId);
  if (!removed) {
    return interaction.reply({ content: `❌ **${riotId}** is not being tracked in this server.`, ephemeral: true });
  }

  return interaction.reply(`✅ Stopped tracking **${riotId}**. Any auto-bets for this player have been removed.`);
}

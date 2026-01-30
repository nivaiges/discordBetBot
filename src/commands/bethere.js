import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { setGuildChannel } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('bethere')
  .setDescription('Set the current channel as the betting notification channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

export async function execute(interaction) {
  setGuildChannel(interaction.guildId, interaction.channelId);
  return interaction.reply(`📌 Betting notifications will now be sent to <#${interaction.channelId}>.`);
}

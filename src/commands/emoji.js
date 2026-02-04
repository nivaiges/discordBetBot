import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isEmojiEnabled, setEmojiEnabled } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('emoji')
  .setDescription('Toggle rank emojis on or off')
  .addStringOption(opt =>
    opt.setName('toggle')
      .setDescription('Turn emojis on or off')
      .setRequired(true)
      .addChoices(
        { name: 'on', value: 'on' },
        { name: 'off', value: 'off' },
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const toggle = interaction.options.getString('toggle');
  const enabled = toggle === 'on';
  const guildId = interaction.guildId;

  setEmojiEnabled(guildId, enabled);

  const current = isEmojiEnabled(guildId);
  const status = current ? 'ON' : 'OFF';
  return interaction.reply(`Rank emojis are now **${status}** for this server.`);
}

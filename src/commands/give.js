import { SlashCommandBuilder } from 'discord.js';
import { transferCoins, ensureUser } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('give')
  .setDescription('Give coins to another user')
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('The user to give coins to')
      .setRequired(true)
  )
  .addIntegerOption(opt =>
    opt.setName('amount')
      .setDescription('Amount of coins to give')
      .setRequired(true)
      .setMinValue(1)
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const guildId = interaction.guildId;
  const senderId = interaction.user.id;

  if (target.id === senderId) {
    return interaction.reply({ content: '❌ You can\'t give coins to yourself.', ephemeral: true });
  }

  if (target.bot) {
    return interaction.reply({ content: '❌ You can\'t give coins to a bot.', ephemeral: true });
  }

  const sender = ensureUser(guildId, senderId);
  if (sender.coins < amount) {
    return interaction.reply({ content: `💰 Insufficient coins. You have **${sender.coins.toLocaleString()}** 🪙.`, ephemeral: true });
  }

  const success = transferCoins(guildId, senderId, target.id, amount);
  if (!success) {
    return interaction.reply({ content: '❌ Transfer failed. Check your balance.', ephemeral: true });
  }

  return interaction.reply(`🎁 **${interaction.user.username}** gave **${amount.toLocaleString()}** 🪙 to **${target.username}**`);
}

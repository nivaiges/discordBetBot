import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getAccountByRiotId, getSummonerByPuuid, getRankedStats } from '../riot.js';
import config from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Show a player\'s Solo/Duo rank')
  .addStringOption(opt =>
    opt.setName('riot_id')
      .setDescription('Riot ID in GameName#TagLine format (e.g. Nivy#NA1)')
      .setRequired(true)
  );

export async function execute(interaction) {
  const riotId = interaction.options.getString('riot_id');
  const parts = riotId.split('#');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return interaction.reply({ content: 'Invalid format. Use `GameName#TagLine`.', ephemeral: true });
  }

  await interaction.deferReply();

  const [gameName, tagLine] = parts;
  const region = config.riotRegion;

  const account = await getAccountByRiotId(gameName, tagLine, region);
  if (!account || account.rateLimited) {
    return interaction.editReply(account?.rateLimited ? 'Riot API rate limited.' : `Account **${riotId}** not found.`);
  }

  const summoner = await getSummonerByPuuid(account.puuid, region);
  if (!summoner || summoner.rateLimited) {
    return interaction.editReply('Could not fetch summoner data.');
  }

  const entries = await getRankedStats(summoner.id, region);
  if (!entries || entries.rateLimited) {
    return interaction.editReply('Could not fetch ranked data.');
  }

  const solo = Array.isArray(entries) && entries.find(e => e.queueType === 'RANKED_SOLO_5x5');
  if (!solo) {
    return interaction.editReply(`**${riotId}** is unranked in Solo/Duo.`);
  }

  const embed = new EmbedBuilder()
    .setTitle(`${riotId} — Solo/Duo`)
    .addFields(
      { name: 'Rank', value: `${solo.tier} ${solo.rank}`, inline: true },
      { name: 'LP', value: `${solo.leaguePoints}`, inline: true },
      { name: 'Record', value: `${solo.wins}W / ${solo.losses}L`, inline: true },
    )
    .setColor(0x9b59b6);

  return interaction.editReply({ embeds: [embed] });
}

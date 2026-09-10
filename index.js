const { Client, GatewayIntentBits, PermissionsBitField, AuditLogEvent, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const BOT_ID = "1542872463870922814";
const MUAF_ROL_ID = "1542874337546338386";
const SES_KANALI_ID = "BURAYA_SES_KANALI_ID";
const LOG_KANALI_ID = "1547734034023452722";

const spamMap = new Map();

client.once('ready', async () => {
    console.log(`[BAŞARILI] Bot aktif! Giriş yapılan hesap: ${client.user.tag}`);
    client.user.setActivity('Sunucu Güvenlikte 🛡️', { type: 3 });
    sesKanalinaBaglan();
});

async function sesKanalinaBaglan() {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;
        const channel = guild.channels.cache.get(SES_KANALI_ID);
        if (!channel) return;

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
        });

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                connection.destroy();
                setTimeout(() => sesKanalinaBaglan(), 5000);
            }
        });
    } catch (error) {}
}

async function logGonder(guild, embed) {
    try {
        const logChannel = guild.channels.cache.get(LOG_KANALI_ID);
        if (logChannel) {
            await logChannel.send({ embeds: [embed] });
        }
    } catch (e) {}
}

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    if (message.member.roles.cache.has(MUAF_ROL_ID) || message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return;
    }

    const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.gg\/[^\s]+)/gi;
    if (urlRegex.test(message.content)) {
        try {
            await message.delete();
            await message.member.timeout(10 * 60 * 1000, "İzinsiz link (URL) paylaşımı.");
            
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🚨 İzinsiz Link Engellendi!')
                .setDescription(`**Kullanıcı:** ${message.author} (${message.author.tag})\n**Kanal:** ${message.channel}\n**İşlem:** Mesaj silindi ve 10 dakika zaman aşımı uygulandı.`);
            logGonder(message.guild, embed);
        } catch (err) {}
        return;
    }

    const userId = message.author.id;
    const userSpam = spamMap.get(userId) || { count: 0, lastTime: Date.now() };
    const now = Date.now();

    if (now - userSpam.lastTime < 3000) {
        userSpam.count += 1;
        if (userSpam.count > 4) {
            try {
                await message.member.timeout(5 * 60 * 1000, "Spam yapmak.");
                const embed = new EmbedBuilder()
                    .setColor('#FFA500')
                    .setTitle('⚠️ Spam Koruması Tetiklendi!')
                    .setDescription(`**Kullanıcı:** ${message.author}\n**İşlem:** Aşırı spam nedeniyle 5 dakika zaman aşımı verildi.`);
                logGonder(message.guild, embed);
                userSpam.count = 0;
            } catch (e) {}
        }
    } else {
        userSpam.count = 1;
    }
    userSpam.lastTime = now;
    spamMap.set(userId, userSpam);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const fetchedLogs = await newMember.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.MemberRoleUpdate,
    }).catch(() => null);

    if (!fetchedLogs) return;
    const auditEntry = fetchedLogs.entries.first();
    if (!auditEntry || auditEntry.target.id !== newMember.id) return;

    const { executor } = auditEntry;
    if (executor.bot) return;

    const executorMember = await newMember.guild.members.fetch(executor.id).catch(() => null);
    if (!executorMember) return;

    const isOwner = executorMember.id === newMember.guild.ownerId;
    const hasMuaf = executorMember.roles.cache.has(MUAF_ROL_ID);
    const isAdmin = executorMember.permissions.has(PermissionsBitField.Flags.Administrator);

    if (!isOwner && !hasMuaf && !isAdmin) {
        try {
            await newMember.roles.set(oldMember.roles.cache);
            await executorMember.timeout(10 * 60 * 1000, "Yetkisiz rol verme girişimi.");

            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🛡️ Yetkisiz Rol Verme Engellendi!')
                .setDescription(`**İşlemi Yapan:** ${executorMember} (${executor.tag})\n**Hedef Üye:** ${newMember}\n**İşlem:** Rol verme engellendi, eski roller geri yüklendi ve yetkiliye zaman aşımı atıldı.`);
            logGonder(newMember.guild, embed);
        } catch (e) {}
    } else {
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('📝 Rol / Yetki Güncellendi')
            .setDescription(`**Yetkili:** ${executorMember} (${executor.tag})\n**Üye:** ${newMember}\n**Durum:** Başarıyla rol/yetki güncellendi.`);
        logGonder(newMember.guild, embed);
    }
});

client.on('guildAuditLogEntryCreate', async (auditLog, guild) => {
    if (auditLog.action === AuditLogEvent.MemberDisconnect) {
        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🔊 Üye Sesten Atıldı')
            .setDescription(`**Yetkili:** <@${auditLog.executor.id}>\n**Hedef:** <@${auditLog.target.id}>`);
        logGonder(guild, embed);
    }

    if (auditLog.action === AuditLogEvent.MemberUpdate) {
        const timeoutChange = auditLog.changes.find(c => c.key === 'communication_disabled_until');
        if (timeoutChange) {
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('⏱️ Kullanıcıya Zaman Aşımı (Timeout) Verildi')
                .setDescription(`**Yetkili:** <@${auditLog.executor.id}>\n**Cezalandırılan:** <@${auditLog.target.id}>\n**Bitiş Süresi:** ${timeoutChange.new ? new Date(timeoutChange.new).toLocaleString() : 'Kaldırıldı'}`);
            logGonder(guild, embed);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
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

const BOT_ID = "1542872463870922814";          // Botun ID'si (Ses kanalında duracak)
const SES_KANALI_ID = "1542872463870922814";   // Botun ses kanalının ID'si
const LOG_KANALI_ID = "1547734034023452722";   // Logların atılacağı kanal ID'si
const YETKILI_USER_ID = "1542872076980068372"; // Sadece bu ID tam yetkilidir (Link ve cezasız rol verme)
const MUAF_ROL_ID = "1542874337546338386";     // Bu role sahip olanlar ceza almaz ama her yaptığı loglanır!

const spamMap = new Map();
let globalConnection = null;

client.once('ready', async () => {
    console.log(`[BAŞARILI] Bot aktif! Giriş yapılan hesap: ${client.user.tag}`);
    client.user.setActivity('Sunucu Güvenlikte 🛡️', { type: 3 });
    sesKanalinaBaglan();
});

// --- SES KANALINDA SABİT DURMA ---
async function sesKanalinaBaglan() {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;
        const channel = guild.channels.cache.get(SES_KANALI_ID);
        if (!channel) return;

        globalConnection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        globalConnection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(globalConnection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(globalConnection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                if (globalConnection) globalConnection.destroy();
                setTimeout(() => sesKanalinaBaglan(), 5000);
            }
        });
    } catch (error) {}
}

setInterval(async () => {
    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;
        const botMember = guild.members.cache.get(BOT_ID) || await guild.members.fetch(BOT_ID).catch(() => null);
        
        if (!botMember || botMember.voice.channelId !== SES_KANALI_ID) {
            sesKanalinaBaglan();
        }
    } catch (e) {}
}, 10000);

async function logGonder(guild, embed) {
    try {
        const logChannel = guild.channels.cache.get(LOG_KANALI_ID);
        if (logChannel) {
            await logChannel.send({ embeds: [embed] });
        }
    } catch (e) {}
}

// --- LİNK VE SPAM KORUMASI (HER DURUMDA LOG DÜŞER) ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const isOwner = message.author.id === message.guild.ownerId;
    const isAuthorizedUser = message.author.id === YETKILI_USER_ID;

    const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.gg\/[^\s]+)/gi;
    if (urlRegex.test(message.content)) {
        if (!isOwner && !isAuthorizedUser) {
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
    }

    // Yetkili/Owner dışındakiler için spam kontrolü
    if (!isOwner && !isAuthorizedUser) {
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
    }
});

// --- ROL KORUMA VE KESİNTİSİZ LOGLAMA ---
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
    const isAuthorizedUser = executorMember.id === YETKILI_USER_ID;
    const hasMuafRole = executorMember.roles.cache.has(MUAF_ROL_ID);

    // Eğer yapan kişi Owner, Belirtilen Yetkili ID veya Muaf Role sahipse ceza almaz, işlemi geçerlidir.
    if (isOwner || isAuthorizedUser || hasMuafRole) {
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('📝 Rol Güncellendi (Yetkili/Muaf İşlemi)')
            .setDescription(`**Yetkili:** ${executorMember} (${executor.tag})\n**Üye:** ${newMember}\n**Durum:** İşlem onaylandı ve loglandı.`);
        logGonder(newMember.guild, embed);
    } else {
        // Bu kişiler dışındakiler rol verirse: Rol geri alınır, kicklenir ve kesinlikle loglanır.
        try {
            await newMember.roles.set(oldMember.roles.cache);

            if (executorMember.kickable) {
                await executorMember.kick("İzinsiz başkasına rol verme girişimi (Guard Koruma)");
            }

            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🚨 YETKİSİZ ROL VERME ENGELLENDİ!')
                .setDescription(`**Yetkisiz İşlem Yapan:** ${executorMember} (${executor.tag})\n**Yapılan İşlem:** Sunucudan atıldı (Kick)!\n**Hedef Üye:** ${newMember}\n**Durum:** Verilen roller geri alındı.`);
            logGonder(newMember.guild, embed);
        } catch (e) {}
    }
});

// --- SES HAREKETLERİ ---
client.on('voiceStateUpdate', async (oldState, newState) => {
    const guild = newState.guild;

    if (oldState.channelId && !newState.channelId) {
        const fetchedLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberDisconnect,
        }).catch(() => null);

        const auditEntry = fetchedLogs?.entries.first();
        if (auditEntry && auditEntry.target.id === newState.member.id && (Date.now() - auditEntry.createdTimestamp < 3000)) {
            const embed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('🔊 Üye Sesten Atıldı')
                .setDescription(`**Yetkili:** <@${auditEntry.executor.id}> (${auditEntry.executor.tag})\n**Atılan Üye:** ${newState.member} (${newState.member.user.tag})\n**Kanal:** ${oldState.channel.name}`);
            logGonder(guild, embed);
        }
        return;
    }

    if (oldState.serverMute !== newState.serverMute) {
        const fetchedLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberUpdate,
        }).catch(() => null);

        const auditEntry = fetchedLogs?.entries.first();
        const executor = auditEntry?.executor || { id: 'Bilinmiyor', tag: 'Bilinmiyor' };

        if (newState.serverMute) {
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🔇 Üye Sunucuda Susturuldu (Server Mute)')
                .setDescription(`**Yetkili:** <@${executor.id}> (${executor.tag})\n**Susturulan:** ${newState.member} (${newState.member.user.tag})`);
            logGonder(guild, embed);
        } else {
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🔊 Üyenin Susturulması Kaldırıldı (Server Unmute)')
                .setDescription(`**Yetkili:** <@${executor.id}> (${executor.tag})\n**Susturması Açılan:** ${newState.member} (${newState.member.user.tag})`);
            logGonder(guild, embed);
        }
    }
});

// --- ZAMAN AŞIMI (TIMEOUT) LOGLARI ---
client.on('guildAuditLogEntryCreate', async (auditLog, guild) => {
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

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
const LOG_KANALI_ID = "1547734034023452722";   // Logların atılacağı doğru kanal ID'si

// Sadece bu iki ID rol verebilir (Birinci kullanıcı ID'si ve ikinci rol ID'si)
const YETKILI_USER_ID = "1542872076980068372"; 
const YETKILI_ROL_ID = "1542874337546338386";     

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

// --- LİNK VE 15 MESAJ SPAM KORUMASI ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const isOwner = message.author.id === message.guild.ownerId;
    const isAuthorizedUser = message.author.id === YETKILI_USER_ID;
    const hasAuthorizedRole = message.member.roles.cache.has(YETKILI_ROL_ID);

    // 1. Link / URL Koruması
    const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.gg\/[^\s]+)/gi;
    if (urlRegex.test(message.content)) {
        if (!isOwner && !isAuthorizedUser && !hasAuthorizedRole) {
            try {
                await message.delete();
                await message.member.timeout(10 * 60 * 1000, "İzinsiz link (URL) paylaşımı.");
                
                const embed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('🚨 İzinsiz Link Engellendi & Timeout Atıldı!')
                    .setDescription(`**Kullanıcı:** ${message.author} (${message.author.tag})\n**Kanal:** ${message.channel}\n**İşlem:** Mesaj silindi ve 10 dakika zaman aşımı uygulandı.`);
                logGonder(message.guild, embed);
            } catch (err) {}
            return;
        }
    }

    // 2. Üst üste 15 mesaj spam koruması
    if (!isOwner && !isAuthorizedUser && !hasAuthorizedRole) {
        const userId = message.author.id;
        const userSpam = spamMap.get(userId) || { count: 0, lastTime: Date.now() };
        const now = Date.now();

        if (now - userSpam.lastTime < 5000) {
            userSpam.count += 1;
            if (userSpam.count >= 15) {
                try {
                    await message.member.timeout(10 * 60 * 1000, "Üst üste 15 mesaj (Spam) atma.");
                    const embed = new EmbedBuilder()
                        .setColor('#FFA500')
                        .setTitle('⚠️ Üst Üste 15 Mesaj Spam Koruması!')
                        .setDescription(`**Kullanıcı:** ${message.author} (${message.author.tag})\n**İşlem:** Hızlı mesaj spamı nedeniyle 10 dakika zaman aşımı (timeout) verildi.`);
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

// --- ROL KORUMA (SADECE BELİRTİLEN 2 İSTİSNA ROL VEREBİLİR) ---
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
    const hasAuthorizedRole = executorMember.roles.cache.has(YETKILI_ROL_ID);

    if (isOwner || isAuthorizedUser || hasAuthorizedRole) {
        // İzin verilenler rol verdiyse log düş
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('📝 Rol Güncellendi (Yetkili Onaylı)')
            .setDescription(`**Yetkili:** ${executorMember} (${executor.tag})\n**Üye:** ${newMember}\n**Durum:** İşlem onaylandı.`);
        logGonder(newMember.guild, embed);
    } else {
        // Başkası rol verdiyse: Rolü geri al, kickle ve log düş!
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

// --- ÜYE GİRİŞ / ÇIKIŞ LOGLARI ---
client.on('guildMemberAdd', async (member) => {
    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('📥 Sunucuya Yeni Üye Katıldı')
        .setDescription(`**Üye:** ${member} (${member.user.tag})\n**ID:** ${member.id}`);
    logGonder(member.guild, embed);
});

client.on('guildMemberRemove', async (member) => {
    const fetchedLogs = await member.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.MemberKick,
    }).catch(() => null);

    const auditEntry = fetchedLogs?.entries.first();
    let aciklama = `**Üye:** ${member} (${member.user.tag}) sunucudan ayrıldı.`;

    if (auditEntry && auditEntry.target.id === member.id && (Date.now() - auditEntry.createdTimestamp < 5000)) {
        aciklama = `**Atılan Üye:** ${member} (${member.user.tag})\n**Atan Yetkili:** <@${auditEntry.executor.id}> (${auditEntry.executor.tag})`;
    }

    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('📤 Üye Sunucudan Ayrıldı / Atıldı')
        .setDescription(aciklama);
    logGonder(member.guild, embed);
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

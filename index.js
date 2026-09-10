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
const SES_KANALI_ID = "1542872463870922814";   
const LOG_KANALI_ID = "1547734034023452722";   

// MUAFİYETLER
const YETKILI_USER_ID = "1542872076980068372"; 
const YETKILI_ROL_ID = "1542874337546338386";     

const spamMap = new Map();
let globalConnection = null;

client.once('ready', async () => {
    console.log(`[BAŞARILI] Piyasaya çıktık! Bot aktif: ${client.user.tag}`);
    client.user.setActivity('Gözüm Üzerinizde 👀', { type: 3 });
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

// --- LİNK VE 10 MESAJ SPAM KORUMASI ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const isOwner = message.author.id === message.guild.ownerId;
    const isAuthorizedUser = message.author.id === YETKILI_USER_ID;
    const hasAuthorizedRole = message.member?.roles.cache.has(YETKILI_ROL_ID);

    // 1. Link / URL Koruması
    const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.gg\/[^\s]+)/gi;
    if (urlRegex.test(message.content)) {
        if (!isOwner && !isAuthorizedUser && !hasAuthorizedRole) {
            try {
                await message.delete();
                await message.member.timeout(10 * 60 * 1000, "İzinsiz link (URL) paylaşımı.");
                
                const embed = new EmbedBuilder()
                    .setColor('#FF0055')
                    .setTitle('🚨 Yakalandın! Kaçak Link Tespit Edildi!')
                    .setDescription(`**Vatandaş:** ${message.author} (${message.author.tag})\n**Olay Yeri:** ${message.channel}\n**Ceza:** Link çöpe atıldı, arkadaşa da 10 dakikalık soğuk su terapisi uygulandı. 🧊`)
                    .setFooter({ text: 'Guard Bot Şakaya Gelmez', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();
                logGonder(message.guild, embed);
            } catch (err) {}
            return;
        }
    }

    // 2. Üst üste 10 mesaj spam koruması (ve mesaj silme)
    if (!isOwner && !isAuthorizedUser && !hasAuthorizedRole) {
        const userId = message.author.id;
        const userSpam = spamMap.get(userId) || { count: 0, lastTime: Date.now(), messages: [] };
        const now = Date.now();

        if (now - userSpam.lastTime < 5000) { 
            userSpam.count += 1;
            userSpam.messages.push(message); 

            if (userSpam.count >= 10) { 
                try {
                    await message.channel.bulkDelete(userSpam.messages).catch(() => null);
                    await message.member.timeout(10 * 60 * 1000, "Üst üste 10 mesaj (Spam) atma.");
                    
                    const embed = new EmbedBuilder()
                        .setColor('#FFAA00')
                        .setTitle('🛑 Klavyeyi Yavaşça Yere Bırak!')
                        .setDescription(`**Hız Tutkunu:** ${message.author} (${message.author.tag})\n**Olay:** Arkadaş klavyede ralli yaptığı için radara yakalandı. \n**Sonuç:** Attığı **${userSpam.messages.length}** mesaj temizlendi ve kendisine 10 dakika dinlenme molası verildi. 🧘‍♂️`)
                        .setFooter({ text: 'Spam sevmiyoruz canım.', iconURL: client.user.displayAvatarURL() })
                        .setTimestamp();
                    logGonder(message.guild, embed);
                    
                    userSpam.count = 0;
                    userSpam.messages = [];
                } catch (e) {}
            }
        } else {
            userSpam.count = 1;
            userSpam.messages = [message];
        }
        userSpam.lastTime = now;
        spamMap.set(userId, userSpam);
    }
});

// --- ROL KORUMA ---
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    await new Promise(resolve => setTimeout(resolve, 1500));

    const fetchedLogs = await newMember.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.MemberRoleUpdate,
    }).catch(() => null);

    if (!fetchedLogs) return;
    const auditEntry = fetchedLogs.entries.first();
    
    if (!auditEntry || auditEntry.target.id !== newMember.id || (Date.now() - auditEntry.createdTimestamp > 5000)) return;

    const { executor } = auditEntry;
    if (executor.bot) return;

    const executorMember = await newMember.guild.members.fetch(executor.id).catch(() => null);
    if (!executorMember) return;

    const isOwner = executorMember.id === newMember.guild.ownerId;
    const isAuthorizedUser = executorMember.id === YETKILI_USER_ID;
    const hasAuthorizedRole = executorMember.roles.cache.has(YETKILI_ROL_ID);

    if (isOwner || isAuthorizedUser || hasAuthorizedRole) {
        const embed = new EmbedBuilder()
            .setColor('#00FF7F')
            .setTitle('📜 Yasal İşlem Başarılı!')
            .setDescription(`**Yetkili:** ${executorMember} (${executor.tag})\n**Şanslı Üye:** ${newMember}\n**Durum:** Rol işlemi başarıyla tamamlandı. Patron onaylı, tamamen legal! 💼`)
            .setTimestamp();
        logGonder(newMember.guild, embed);
    } 
    else {
        try {
            await newMember.roles.set(oldMember.roles.cache);

            if (executorMember.kickable) {
                await executorMember.kick("İzinsiz başkasına rol verme girişimi (Guard Koruma)");
            }

            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('⛔ HOOOP! Orada Dur Bakalım!')
                .setDescription(`**Kaçak Yönetici:** ${executorMember} (${executor.tag})\n**Hedef Üye:** ${newMember}\n**Olay:** Arkadaş kendisini patron sanıp rol dağıtmaya kalktı. \n**Cezası:** Verilen rol tıpış tıpış geri alındı, rolü veren kişi de sunucudan mancınıkla fırlatıldı! ✈️ İyi uçuşlar.`)
                .setThumbnail(executorMember.user.displayAvatarURL())
                .setFooter({ text: 'Bot abin affetmez.' })
                .setTimestamp();
            logGonder(newMember.guild, embed);
        } catch (e) {
            console.log("[GUARD HATASI] Botun yetkisi yetmiyor olabilir:", e);
        }
    }
});

// --- ÜYE GİRİŞ / ÇIKIŞ LOGLARI ---
client.on('guildMemberAdd', async (member) => {
    const embed = new EmbedBuilder()
        .setColor('#00FFFF')
        .setTitle('📥 Mekana Yeni Biri Damladı!')
        .setDescription(`**Gelen Gideni Aratmaz Umarım:** ${member} (${member.user.tag})\n**Kimlik (ID):** ${member.id}\nÇayları tazeleyin, yeni üyemiz geldi! ☕`)
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();
    logGonder(member.guild, embed);
});

client.on('guildMemberRemove', async (member) => {
    const fetchedLogs = await member.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.MemberKick,
    }).catch(() => null);

    const auditEntry = fetchedLogs?.entries.first();
    let aciklama = `**Giden:** ${member} (${member.user.tag})\nBavulunu topladı ve aramızdan sessizce ayrıldı. Yolun açık olsun! 🚶‍♂️`;

    if (auditEntry && auditEntry.target.id === member.id && (Date.now() - auditEntry.createdTimestamp < 5000)) {
        aciklama = `**Şutlanan:** ${member} (${member.user.tag})\n**Şutlayan Yetkili:** <@${auditEntry.executor.id}> (${auditEntry.executor.tag})\nArkadaşa tekme tokat girişip kapı dışarı ettiler. 👋`;
    }

    const embed = new EmbedBuilder()
        .setColor('#8B0000')
        .setTitle('📤 Bir Yıldız Daha Kaydı...')
        .setDescription(aciklama)
        .setTimestamp();
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
                .setColor('#FF4500')
                .setTitle('🥾 Sesten Şutlandı!')
                .setDescription(`**Yetkili:** <@${auditEntry.executor.id}>\n**Kovulan:** ${newState.member}\n**Kanal:** ${oldState.channel.name}\nBiri sesten yaka paça dışarı atıldı!`)
                .setTimestamp();
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
                .setColor('#DC143C')
                .setTitle('🤐 Fişi Çekildi (Susturuldu)')
                .setDescription(`**Fişi Çeken:** <@${executor.id}>\n**Susturulan:** ${newState.member}\nBiri fazla konuştu galiba, mikrofonun kablosunu kestiler. ✂️`)
                .setTimestamp();
            logGonder(guild, embed);
        } else {
            const embed = new EmbedBuilder()
                .setColor('#32CD32')
                .setTitle('🎤 Fişi Takıldı (Susturma Açıldı)')
                .setDescription(`**Affeden Yetkili:** <@${executor.id}>\n**Konuşma Hakkı Kazanan:** ${newState.member}\nBantları söktük, hadi yine iyisin!`)
                .setTimestamp();
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
                .setColor('#8A2BE2')
                .setTitle(timeoutChange.new ? '🛋️ Soğuk Su Terapisi Başladı!' : '🕊️ Özgürlüğüne Kavuştu!')
                .setDescription(`**Yargıç:** <@${auditLog.executor.id}>\n**Sanık:** <@${auditLog.target.id}>\n**Durum:** ${timeoutChange.new ? `Buzdolabına kilitlendi. Bitiş: ${new Date(timeoutChange.new).toLocaleString()}` : 'Cezası bitti, aramıza döndü.'}`)
                .setTimestamp();
            logGonder(guild, embed);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

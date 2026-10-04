const { Client, GatewayIntentBits, PermissionsBitField, AuditLogEvent, EmbedBuilder, ActionRowBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// 📌 ID TANIMLAMALARI
const BOT_ID = "1542872463870922814";        
const SES_KANALI_ID = "1542872463870922814";   
const LOG_KANALI_ID = "1547734034023452722";   

// 📌 VIP DİKTATÖR ROLÜ (Her şeyden muaf, her şeyi yapabilir ama loglanır)
const YETKILI_ROL_ID = "1542874337546338386";      

const spamMap = new Map();
let globalConnection = null;

// GÜNLÜK BAN LİMİTİ TAKİBİ (VIP'ler hariç)
let dailyBans = { count: 0, date: new Date().toDateString() };

client.once('ready', async () => {
    console.log(`[BAŞARILI] Bot aktif! Yargı dağıtmaya hazır: ${client.user.tag}`);
    client.user.setActivity('Gözüm Üzerinizde 🪓', { type: 3 });
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
                setTimeout(() => sesKanalinaBaglan(), 5_000);
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

// --- MERKEZİ LOG GÖNDERME FONKSİYONU ---
async function logGonder(guild, embed) {
    try {
        const logChannel = guild.channels.cache.get(LOG_KANALI_ID);
        if (logChannel) {
            await logChannel.send({ embeds: [embed] });
        }
    } catch (e) {
        console.error("Log gönderilemedi:", e);
    }
}

// --- 1. YENİ ÜYE VE ŞÜPHELİ HESAP LOGU ---
client.on('guildMemberAdd', async (member) => {
    const kurulusTarihi = member.user.createdAt;
    const suAn = new Date();
    const farkGun = Math.floor((suAn - kurulusTarihi) / (1000 * 60 * 60 * 24)); 
    const isSuspicious = farkGun < 7;
    const timeString = `<t:${Math.floor(kurulusTarihi.getTime() / 1000)}:R>`; 
    
    let description = `**Sunucuya Katılan:** ${member} (${member.user.tag})\n`;
    description += `**Hesap ID:** \`${member.id}\`\n`;
    description += `**Hesap Kuruluş:** ${timeString} (${farkGun} gün önce)\n`;
    
    const embed = new EmbedBuilder()
        .setTimestamp()
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));

    if (isSuspicious) {
        embed.setColor('#FF0000') 
             .setTitle('🚨 ŞÜPHELİ HESAP GİRİŞİ!')
             .setDescription(description + `\n\n⚠️ **DİKKAT:** Bu hesap sadece **${farkGun} gün önce** açılmış! Fake veya patlatıcı olabilir.`);
    } else {
        embed.setColor('#00FF00') 
             .setTitle('👋 Yeni Bir Üye Katıldı')
             .setDescription(description + `\n\n✅ Bu hesap güvenilir görünüyor.`);
    }
    logGonder(member.guild, embed);
});

// --- 2. DETAYLI ROL VERME / ALMA KORUMASI VE LOGU ---
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

    if (addedRoles.size === 0 && removedRoles.size === 0) return;

    await new Promise(resolve => setTimeout(resolve, 2000)); 

    const fetchedLogs = await newMember.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberRoleUpdate }).catch(() => null);
    let executorMember = null;

    if (fetchedLogs) {
        const auditEntry = fetchedLogs.entries.first();
        if (auditEntry && auditEntry.target.id === newMember.id && (Date.now() - auditEntry.createdTimestamp < 10000)) {
            executorMember = await newMember.guild.members.fetch(auditEntry.executor.id).catch(() => null);
        }
    }

    const executorMention = executorMember ? executorMember.toString() : "Bilinmiyor / Bot";
    const hasAuthorizedRole = executorMember ? executorMember.roles.cache.has(YETKILI_ROL_ID) : false;

    let logDescription = `**İşlem Gören:** ${newMember} (${newMember.user.tag})\n**İşlemi Yapan:** ${executorMention}\n\n`;

    if (addedRoles.size > 0) logDescription += `✅ **Verilen Roller:** ${addedRoles.map(r => `<@&${r.id}>`).join(', ')}\n`;
    if (removedRoles.size > 0) logDescription += `❌ **Alınan Roller:** ${removedRoles.map(r => `<@&${r.id}>`).join(', ')}\n`;

    if (executorMember && !executorMember.user.bot && !hasAuthorizedRole) {
        logDescription += `\n🚨 **KORUMA DEVREDE:** İşlemi yapan kişinin VIP rolü olmadığı için **roller geri alındı** ve kendisi sunucudan atıldı!`;
        try {
            await newMember.roles.set(oldMember.roles.cache); 
            if (executorMember.kickable) await executorMember.kick("VIP rolü olmadan rol verme/alma girişimi.");
        } catch (e) {}

        const embed = new EmbedBuilder().setColor('#FF0000').setTitle('⛔ YETKİSİZ ROL İŞLEMİ (Guard)').setDescription(logDescription).setTimestamp();
        logGonder(newMember.guild, embed);
    } else {
        const embed = new EmbedBuilder().setColor('#00FFFF').setTitle('📝 Rol Güncellemesi İşlendi').setDescription(logDescription).setTimestamp();
        logGonder(newMember.guild, embed);
    }
});

// --- 3. MESAJLAR, KÜFÜR, SPAM VE GUARD PANEL KOMUTU ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const hasAuthorizedRole = message.member?.roles.cache.has(YETKILI_ROL_ID);

    // GUARD PANEL
    if (message.content === '!guardpanel') {
        if (!hasAuthorizedRole) return message.reply({ content: "HOP! ⛔ Bu paneli açmak için VIP rozetin yok. Uza bakalım!" });

        const embed = new EmbedBuilder()
            .setColor('#2B2D31')
            .setTitle('🛡️ Gardiyan Yargı Paneli ⚖️')
            .setDescription("Aşağıdaki menüden birini seçerek ona **28 güne kadar** soğuk su terapisi (Timeout) uygulayabilirsin.")
            .setThumbnail(client.user.displayAvatarURL())
            .setFooter({ text: 'Sadece VIP yetkililere özeldir.' });

        const userSelect = new UserSelectMenuBuilder().setCustomId('guard_panel_user').setPlaceholder('Kurbanı seçmek için tıkla... 🕵️‍♂️');
        const row = new ActionRowBuilder().addComponents(userSelect);
        await message.channel.send({ embeds: [embed], components: [row] });
        return;
    }

    // KÜFÜR KORUMASI
    if (!hasAuthorizedRole) {
        const temizMetin = message.content.toLowerCase().replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-9]/g, ''); 
        const yasakliKelimeler = ['amk', 'aq', 'amq', 'sik', 'siktir', 'orospu', 'orospucocugu', 'oevladi', 'pic', 'got', 'yarrak', 'yarak', 'ibne', 'anani', 'amcik', 'kahpe', 'orospi', 'sikik', 'sikis', 'siker', 'ananin', 'avradini', 'ananinkami', 'gotveren', 'pezevenk', 'orosbunun', 'orosbucocugu', 'sikisken', 'amcikoglusu', 'yarrakbasi'];
        const normalTemizMetin = message.content.toLowerCase().replace(/\s+/g, '');
        
        if (yasakliKelimeler.some(kelime => temizMetin.includes(kelime) || normalTemizMetin.includes(kelime))) {
            try {
                await message.delete();
                await message.member.timeout(10 * 60 * 1000, "Küfür ve argo kullanımı.");
                const embed = new EmbedBuilder().setColor('#FF0055').setTitle('🛡️ Küfür Filtresi Devrede!').setDescription(`**Vatandaş:** ${message.author}\n**Olay Yeri:** ${message.channel}\n**Ceza:** Mesaj silindi ve 10 dakika timeout atıldı. 🧊`).setTimestamp();
                logGonder(message.guild, embed);
            } catch (err) {}
            return;
        }
    }

    // LİNK KORUMASI
    const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.gg\/[^\s]+)/gi;
    if (urlRegex.test(message.content) && !hasAuthorizedRole) {
        try {
            await message.delete();
            await message.member.timeout(10 * 60 * 1000, "İzinsiz link paylaşımı.");
            const embed = new EmbedBuilder().setColor('#FF0055').setTitle('🚨 Kaçak Link Tespit Edildi!').setDescription(`**Vatandaş:** ${message.author}\n**Olay Yeri:** ${message.channel}\n**Ceza:** Link çöpe atıldı, 10 dakika timeout verildi. 🧊`).setTimestamp();
            logGonder(message.guild, embed);
        } catch (err) {}
        return;
    }

    // SPAM KORUMASI
    if (!hasAuthorizedRole) {
        const userId = message.author.id;
        const userSpam = spamMap.get(userId) || { count: 0, lastTime: Date.now(), messages: [] };
        const now = Date.now();

        if (now - userSpam.lastTime < 5000) { 
            userSpam.count += 1;
            userSpam.messages.push(message); 

            if (userSpam.count >= 10) { 
                try {
                    await message.channel.bulkDelete(userSpam.messages).catch(() => null);
                    await message.member.timeout(10 * 60 * 1000, "Spam yapma.");
                    const embed = new EmbedBuilder().setColor('#FFAA00').setTitle('🛑 Klavyeyi Yavaşça Yere Bırak!').setDescription(`**Hız Tutkunu:** ${message.author}\n**Sonuç:** Attığı ${userSpam.messages.length} mesaj silindi ve 10 dakika mola verildi. 🧘‍♂️`).setTimestamp();
                    logGonder(message.guild, embed);
                    userSpam.count = 0; userSpam.messages = [];
                } catch (e) {}
            }
        } else {
            userSpam.count = 1; userSpam.messages = [message];
        }
        userSpam.lastTime = now;
        spamMap.set(userId, userSpam);
    }
});

// --- 4. GUARD PANEL MENÜ (Etkileşim) ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isUserSelectMenu() && !interaction.isStringSelectMenu()) return;

    if (!interaction.member?.roles.cache.has(YETKILI_ROL_ID)) {
        return interaction.reply({ content: "HOP! ⛔ Bu düğmeler senin boyunu aşar!", ephemeral: true });
    }

    if (interaction.customId === 'guard_panel_user') {
        const targetId = interaction.values[0];
        const durationSelect = new StringSelectMenuBuilder()
            .setCustomId(`guard_panel_duration_${targetId}`)
            .setPlaceholder('Ne kadar süre içeride kalacak? ⏳')
            .addOptions([
                { label: '10 Dakika', value: '10m', emoji: '☕' },
                { label: '1 Saat', value: '1h', emoji: '🧘' },
                { label: '1 Gün', value: '1d', emoji: '🛌' },
                { label: '1 Hafta', value: '1w', emoji: '🏖️' },
                { label: '28 Gün (1 Ay)', value: '28d', emoji: '💀' }
            ]);

        const row = new ActionRowBuilder().addComponents(durationSelect);
        await interaction.reply({ content: `✅ <@${targetId}> seçildi. Ceza süresini belirle:`, components: [row], ephemeral: true });
    } 
    else if (interaction.customId.startsWith('guard_panel_duration_')) {
        const targetId = interaction.customId.split('_')[3];
        const duration = interaction.values[0];
        const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
        
        if (!targetMember) return interaction.reply({ content: "Sanık firar etmiş! (Sunucuda bulunamadı).", ephemeral: true });

        let ms = 0; let text = "";
        if (duration === '10m') { ms = 10 * 60 * 1000; text = "10 Dakika"; }
        if (duration === '1h') { ms = 60 * 60 * 1000; text = "1 Saat"; }
        if (duration === '1d') { ms = 24 * 60 * 60 * 1000; text = "1 Gün"; }
        if (duration === '1w') { ms = 7 * 24 * 60 * 60 * 1000; text = "1 Hafta"; }
        if (duration === '28d') { ms = 28 * 24 * 60 * 60 * 1000; text = "28 Gün (1 Ay)"; }

        try {
            await targetMember.timeout(ms, `Guard Panel: ${interaction.user.tag} tarafından.`);
            await interaction.update({ content: `⚖️ **ADALET YERİNİ BULDU!** <@${targetId}>, **${text}** soğuk suya gönderildi.`, components: [] });

            const embed = new EmbedBuilder().setColor('#8A2BE2').setTitle('🎛️ Guard Panel Yargı Dağıttı!').setDescription(`**Vuran VIP:** ${interaction.user}\n**İçeri Atılan:** <@${targetId}>\n**Ceza Süresi:** ${text}`).setTimestamp();
            logGonder(interaction.guild, embed);
        } catch (e) {
            await interaction.update({ content: "❌ Tüh! Yetkim yetmedi.", components: [] });
        }
    }
});

// --- 5. KANAL OLUŞTURMA LOGU ---
client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const fetchedLogs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate }).catch(() => null);
    if (!fetchedLogs) return;
    
    const auditEntry = fetchedLogs.entries.first();
    if (!auditEntry || auditEntry.target.id !== channel.id) return;

    const embed = new EmbedBuilder().setColor('#2ECC71').setTitle('📁 Yeni Bir Kanal Açıldı').setDescription(`**Açan Kişi:** <@${auditEntry.executor.id}>\n**Kanal Adı:** ${channel} (\`${channel.name}\`)`).setTimestamp();
    logGonder(channel.guild, embed);
});

// --- 6. KANAL SİLME KORUMASI VE LOGU ---
client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const fetchedLogs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    if (!fetchedLogs) return;
    
    const auditEntry = fetchedLogs.entries.first();
    if (!auditEntry || auditEntry.target.id !== channel.id || auditEntry.executor.bot) return;

    const executorMember = await channel.guild.members.fetch(auditEntry.executor.id).catch(() => null);
    if (!executorMember) return;

    if (executorMember.roles.cache.has(YETKILI_ROL_ID)) {
        const embed = new EmbedBuilder().setColor('#FFA500').setTitle('🗑️ Kanal Silindi (VIP)').setDescription(`**VIP Yetkili:** ${executorMember}\n**Silinen Kanal:** \`${channel.name}\``).setTimestamp();
        logGonder(channel.guild, embed);
    } else {
        try {
            await channel.clone({ reason: "İzinsiz silindiği için geri açıldı." });
            if (executorMember.kickable) await executorMember.kick("İzinsiz kanal silme girişimi!");
            
            const embed = new EmbedBuilder().setColor('#FF0000').setTitle('🚨 KANAL SİLME KORUMASI DEVREDE!').setDescription(`**Haddini Aşan:** ${executorMember}\n**Silinmeye Çalışılan:** \`${channel.name}\`\n**Sonuç:** Kanal geri açıldı, yetkisiz kişi atıldı!`).setTimestamp();
            logGonder(channel.guild, embed);
        } catch (e) {}
    }
});

// --- 7. TIMEOUT VE BAN OLAYLARI (LİMİT KORUMASI DAHİL) ---
client.on('guildAuditLogEntryCreate', async (auditLog, guild) => {
    if (auditLog.action === AuditLogEvent.MemberUpdate) {
        const timeoutChange = auditLog.changes.find(c => c.key === 'communication_disabled_until');
        if (timeoutChange) {
            const embed = new EmbedBuilder().setColor('#8A2BE2').setTitle(timeoutChange.new ? '🛋️ Soğuk Su Terapisi Başladı!' : '🕊️ Özgürlüğüne Kavuştu!').setDescription(`**Yetkili:** <@${auditLog.executor.id}>\n**Kişi:** <@${auditLog.target.id}>`).setTimestamp();
            logGonder(guild, embed);
        }
    }

    if (auditLog.action === AuditLogEvent.MemberBanRemove) {
        const embed = new EmbedBuilder().setColor('#00FF7F').setTitle('🕊️ Ban Kaldırıldı').setDescription(`**Affeden:** <@${auditLog.executor.id}>\n**Affedilen:** <@${auditLog.target.id}>`).setTimestamp();
        logGonder(guild, embed);
    }

    if (auditLog.action === AuditLogEvent.MemberBanAdd) {
        const executorMember = await guild.members.fetch(auditLog.executor.id).catch(() => null);
        if (!executorMember || executorMember.user.bot) return;

        if (executorMember.roles.cache.has(YETKILI_ROL_ID)) { 
            const embed = new EmbedBuilder().setColor('#FF1493').setTitle('🔨 VIP Yargı Dağıttı!').setDescription(`**VIP Yetkili:** ${executorMember}\n**Banlanan:** <@${auditLog.target.id}>\n*VIP olduğu için limite takılmaz.*`).setTimestamp();
            return logGonder(guild, embed); 
        }

        const today = new Date().toDateString();
        if (dailyBans.date !== today) dailyBans = { count: 0, date: today };
        dailyBans.count++;

        if (dailyBans.count > 2) {
            try {
                await guild.members.unban(auditLog.target.id, "Limit Aşımı");
                if (executorMember.kickable) await executorMember.kick("Günde 2'den fazla ban atma girişimi.");
                const embed = new EmbedBuilder().setColor('#FF0000').setTitle('🚨 BAN LİMİTİ AŞILDI (MAX 2)').setDescription(`**Yetkili:** ${executorMember}\nSon attığı ban geri çekildi ve sunucudan atıldı!`).setTimestamp();
                logGonder(guild, embed);
            } catch (e) {}
        } else {
            const embed = new EmbedBuilder().setColor('#FF4500').setTitle('🔨 Ban Atıldı').setDescription(`**Yetkili:** ${executorMember}\n**Banlanan:** <@${auditLog.target.id}>\n**Kullanılan Hak:** ${dailyBans.count}/2 ⚠️`).setTimestamp();
            logGonder(guild, embed);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

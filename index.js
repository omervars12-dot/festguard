const { Client, GatewayIntentBits, PermissionsBitField, Partials, ChannelType, AuditLogEvent, EmbedBuilder, ActionRowBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ],
    // Önbellekte olmayan (eski) mesajlar silinince de log düşsün diye
    partials: [Partials.Message, Partials.Channel]
});

// 📌 ID TANIMLAMALARI
const SES_KANALI_ID = "1542872463870922814";
const LOG_KANALI_ID = "1557504662842900480";
const YETKILI_ROL_ID = "1542874337546338386"; // VIP: her şeyi yapabilir, loglanır

// 📌 AYARLAR
const CEZA_SURESI_MS = 28 * 24 * 60 * 60 * 1000; // Guard ihlallerinde timeout süresi (28 gün)
const MESAJ_LIMIT = 200;                          // Kanal başına yedeklenen mesaj sayısı

const spamMap = new Map();
const botSildi = new Set();           // botun kendi sildiği mesajlar (çift log olmasın)
const mesajYedek = new Map();         // kanalId -> son mesajlar (kanal silinirse geri yüklemek için)
const geriYukleniyor = new Set();     // geri yükleme sırasında yedeğe tekrar eklenmesin
let globalConnection = null;
let dailyBans = { count: 0, date: new Date().toDateString() };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const kisalt = (t, n = 1000) => (t && t.length > n ? t.slice(0, n) + '…' : (t || '*(boş)*'));
const isVip = member => !!member?.roles?.cache?.has(YETKILI_ROL_ID);

client.once('ready', async () => {
    console.log(`[BAŞARILI] Bot aktif: ${client.user.tag}`);
    client.user.setActivity('Gözüm Üzerinizde 🪓', { type: 3 });
    sesKanalinaBaglan();
    await yetkileriGeriVer(); // önceki sürümün aldığı yetkileri iade eder (tek seferlik)
    yedekDoldur();
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
        const botMember = guild.members.cache.get(client.user.id) || await guild.members.fetch(client.user.id).catch(() => null);
        if (!botMember || botMember.voice.channelId !== SES_KANALI_ID) sesKanalinaBaglan();
    } catch (e) {}
}, 10000);

// --- MERKEZİ LOG (etiketle=true ise VIP rolünü etiketler) ---
async function logGonder(guild, embed, etiketle = false) {
    try {
        const logChannel = guild.channels.cache.get(LOG_KANALI_ID);
        if (!logChannel) return;
        await logChannel.send({
            content: etiketle ? `<@&${YETKILI_ROL_ID}>` : undefined,
            embeds: [embed],
            allowedMentions: { roles: etiketle ? [YETKILI_ROL_ID] : [] }
        });
    } catch (e) {
        console.error("Log gönderilemedi:", e);
    }
}

// --- ÖNCEKİ SÜRÜMÜN SÖKTÜĞÜ YETKİLERİ GERİ VER ---
// Önceki sürüm her sökme işlemini log kanalına yazmıştı. Burada o loglar okunur,
// "Kanalları Yönet" yetkisi o rollere iade edilir ve işlenen log silinir (tekrar işlenmez).
async function yetkileriGeriVer() {
    try {
        const guild = client.guilds.cache.first();
        const logChannel = guild?.channels.cache.get(LOG_KANALI_ID);
        if (!logChannel) return;

        const iade = [], elleKontrol = [];
        let before;
        for (let sayfa = 0; sayfa < 10; sayfa++) {
            const mesajlar = await logChannel.messages.fetch({ limit: 100, before }).catch(() => null);
            if (!mesajlar || mesajlar.size === 0) break;
            before = mesajlar.last().id;

            for (const msg of mesajlar.values()) {
                if (msg.author.id !== client.user.id) continue;
                const emb = msg.embeds[0];
                if (!emb || emb.title !== '🔒 Rolden Yetki Söküldü') continue;

                const roleId = emb.description?.match(/<@&(\d+)>/)?.[1];
                const role = roleId ? guild.roles.cache.get(roleId) : null;
                if (!role) { await msg.delete().catch(() => {}); continue; }

                if (emb.description.includes('Yönetici /')) {
                    // Eski sürüm: hangi yetkinin gerçekten alındığı kayıtlı değil, otomatik iade edilmez
                    elleKontrol.push(role);
                    await msg.delete().catch(() => {});
                } else {
                    const ok = await role.setPermissions(role.permissions.add(PermissionsBitField.Flags.ManageChannels), "Guard: önceki sürümün aldığı yetki iade edildi.").then(() => true).catch(() => false);
                    if (ok) { iade.push(role); await msg.delete().catch(() => {}); }
                }
            }
        }

        if (iade.length || elleKontrol.length) {
            let d = '';
            if (iade.length) d += `✅ **"Kanalları Yönet" yetkisi geri verildi:** ${iade.map(r => `<@&${r.id}>`).join(', ')}\n`;
            if (elleKontrol.length) d += `⚠️ **Elle kontrol et** (eski sürüm Yönetici / Rolleri Yönet yetkisini de almış olabilir, hangisi olduğu kayıtlı değil): ${elleKontrol.map(r => `<@&${r.id}>`).join(', ')}`;
            logGonder(guild, new EmbedBuilder().setColor('#2ECC71').setTitle('♻️ Yetkiler İade Edildi').setDescription(d).setTimestamp());
        }
    } catch (e) { console.error("Yetki iadesi hatası:", e); }
}

// --- MESAJ YEDEĞİ (kanal silinirse geri yüklemek için) ---
const yedekleneBilir = ch => ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement);

function yedekGirdisi(msg) {
    if (!msg.author || msg.author.id === client.user.id) return null;
    const ek = [...msg.attachments.values()].map(a => a.url);
    const icerik = msg.content || '';
    if (!icerik && ek.length === 0) return null;
    return {
        id: msg.id,
        yazar: msg.member?.displayName || msg.author.username || 'Bilinmiyor',
        avatar: msg.author.displayAvatarURL({ extension: 'png' }),
        icerik, ek,
        zaman: msg.createdTimestamp
    };
}

function yedegeEkle(msg) {
    if (!msg.guild || !yedekleneBilir(msg.channel) || geriYukleniyor.has(msg.channelId)) return;
    const g = yedekGirdisi(msg);
    if (!g) return;
    const liste = mesajYedek.get(msg.channelId) || [];
    liste.push(g);
    while (liste.length > MESAJ_LIMIT) liste.shift();
    mesajYedek.set(msg.channelId, liste);
}

function yedektenSil(channelId, ids) {
    const liste = mesajYedek.get(channelId);
    if (liste) mesajYedek.set(channelId, liste.filter(x => !ids.includes(x.id)));
}

async function yedekDoldur() {
    const guild = client.guilds.cache.first();
    if (!guild) return;
    for (const ch of guild.channels.cache.values()) {
        if (!yedekleneBilir(ch)) continue;
        try {
            const msgs = await ch.messages.fetch({ limit: 100 });
            const liste = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp).map(yedekGirdisi).filter(Boolean);
            const ids = new Set(liste.map(x => x.id));
            const mevcut = (mesajYedek.get(ch.id) || []).filter(x => !ids.has(x.id));
            mesajYedek.set(ch.id, [...liste, ...mevcut].slice(-MESAJ_LIMIT));
        } catch (e) {}
        await sleep(300);
    }
    console.log('[YEDEK] Mesaj yedeği hazır.');
}

// Silinen kanalın mesajlarını webhook ile yeni kanala yazar
async function kanalGeriYukle(eskiKanal, yeniKanal) {
    const liste = mesajYedek.get(eskiKanal.id);
    mesajYedek.delete(eskiKanal.id);
    if (!liste?.length || !yedekleneBilir(yeniKanal)) return 0;

    geriYukleniyor.add(yeniKanal.id);
    let hook, gonderilen = 0;
    try {
        hook = await yeniKanal.createWebhook({ name: 'Mesaj Geri Yükleme' });
        for (const m of liste) {
            let metin = m.icerik;
            if (m.ek.length) metin += (metin ? '\n' : '') + m.ek.join('\n');
            metin += `\n-# 🕓 <t:${Math.floor(m.zaman / 1000)}:f>`;
            if (metin.length > 2000) metin = metin.slice(0, 1990) + '…';
            const isim = (m.yazar || 'Bilinmiyor').replace(/discord|clyde/gi, x => '_' + x.slice(1)).slice(0, 80) || 'Bilinmiyor';
            await hook.send({ content: metin, username: isim, avatarURL: m.avatar, allowedMentions: { parse: [] } })
                .then(() => gonderilen++).catch(() => {});
            await sleep(500);
        }
    } catch (e) {
        console.error("Mesaj geri yükleme hatası:", e);
    } finally {
        if (hook) await hook.delete().catch(() => {});
        geriYukleniyor.delete(yeniKanal.id);
        mesajYedek.set(yeniKanal.id, liste); // yeni kanal da yedekli kalsın
    }
    return gonderilen;
}

// --- YARDIMCILAR ---
// Audit log'dan işlemi yapanı bulur (log gecikebildiği için birkaç kez dener)
async function findEntry(guild, actions, targetId) {
    for (let i = 0; i < 5; i++) {
        const logs = await guild.fetchAuditLogs({ limit: 8 }).catch(() => null);
        if (logs) {
            const entry = logs.entries.find(e =>
                actions.includes(e.action) &&
                e.target?.id === targetId &&
                Date.now() - e.createdTimestamp < 15000
            );
            if (entry) return entry;
        }
        await sleep(500);
    }
    return null;
}

// Yetkisiz kişiye timeout verir
async function cezala(guild, executorId, reason) {
    const m = await guild.members.fetch(executorId).catch(() => null);
    if (!m || m.user.bot || isVip(m) || m.id === client.user.id) return "Cezalandırılamadı";
    try {
        await m.timeout(CEZA_SURESI_MS, reason);
        return `${Math.round(CEZA_SURESI_MS / 86400000)} gün timeout verildi`;
    } catch (e) {}
    return "Timeout verilemedi (kişi Yönetici/sunucu sahibi olabilir ya da bot rolü yetersiz)";
}

// Müdahale gerekiyor mu? (bot kendisi, VIP veya başka bot ise gerekmez)
async function yetkisizMi(guild, executor) {
    if (!executor || executor.id === client.user.id || executor.bot) return false;
    const m = await guild.members.fetch(executor.id).catch(() => null);
    return !isVip(m);
}

function kanalDegisimleri(o, n) {
    const d = [];
    if (o.name !== n.name) d.push(`**İsim:** \`${o.name}\` → \`${n.name}\``);
    if (o.parentId !== n.parentId) d.push(`**Kategori:** ${o.parentId ? `<#${o.parentId}>` : 'yok'} → ${n.parentId ? `<#${n.parentId}>` : 'yok'}`);
    if (o.topic !== n.topic) d.push(`**Konu:** ${kisalt(o.topic, 100)} → ${kisalt(n.topic, 100)}`);
    if (o.nsfw !== n.nsfw) d.push(`**NSFW:** ${o.nsfw} → ${n.nsfw}`);
    if (o.rateLimitPerUser !== n.rateLimitPerUser) d.push(`**Yavaş mod:** ${o.rateLimitPerUser}sn → ${n.rateLimitPerUser}sn`);
    if (o.bitrate !== n.bitrate) d.push(`**Bitrate:** ${o.bitrate} → ${n.bitrate}`);
    if (o.userLimit !== n.userLimit) d.push(`**Kullanıcı limiti:** ${o.userLimit} → ${n.userLimit}`);
    const perm = c => c.permissionOverwrites.cache.map(p => `${p.id}:${p.allow.bitfield}:${p.deny.bitfield}`).sort().join(',');
    if (perm(o) !== perm(n)) d.push(`**İzinler (permission overwrites) değişti**`);
    if (o.rawPosition !== n.rawPosition && d.length === 0) d.push(`**Sıra değişti:** ${o.rawPosition} → ${n.rawPosition}`);
    return d;
}

// --- 1. YENİ ÜYE / ŞÜPHELİ HESAP ---
client.on('guildMemberAdd', async (member) => {
    const kurulusTarihi = member.user.createdAt;
    const farkGun = Math.floor((new Date() - kurulusTarihi) / 86400000);
    const isSuspicious = farkGun < 7;
    const timeString = `<t:${Math.floor(kurulusTarihi.getTime() / 1000)}:R>`;

    let description = `**Sunucuya Katılan:** ${member} (${member.user.tag})\n**Hesap ID:** \`${member.id}\`\n**Hesap Kuruluş:** ${timeString} (${farkGun} gün önce)\n`;
    const embed = new EmbedBuilder().setTimestamp().setThumbnail(member.user.displayAvatarURL({ dynamic: true }));

    if (isSuspicious) {
        embed.setColor('#FF0000').setTitle('🚨 ŞÜPHELİ HESAP GİRİŞİ!').setDescription(description + `\n⚠️ **DİKKAT:** Bu hesap sadece **${farkGun} gün önce** açılmış!`);
    } else {
        embed.setColor('#00FF00').setTitle('👋 Yeni Bir Üye Katıldı').setDescription(description + `\n✅ Bu hesap güvenilir görünüyor.`);
    }
    logGonder(member.guild, embed);
});

// --- 2. ROL VERME / ALMA KORUMASI ---
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    if (addedRoles.size === 0 && removedRoles.size === 0) return;

    const entry = await findEntry(newMember.guild, [AuditLogEvent.MemberRoleUpdate], newMember.id);
    const executor = entry?.executor;
    if (executor?.id === client.user.id) return;

    let desc = `**İşlem Gören:** ${newMember} (${newMember.user.tag})\n**İşlemi Yapan:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\n\n`;
    if (addedRoles.size > 0) desc += `✅ **Verilen Roller:** ${addedRoles.map(r => `<@&${r.id}>`).join(', ')}\n`;
    if (removedRoles.size > 0) desc += `❌ **Alınan Roller:** ${removedRoles.map(r => `<@&${r.id}>`).join(', ')}\n`;

    if (await yetkisizMi(newMember.guild, executor)) {
        try { await newMember.roles.set(oldMember.roles.cache); } catch (e) {}
        const sonuc = await cezala(newMember.guild, executor.id, "VIP rolü olmadan rol verme/alma.");
        desc += `\n🚨 **KORUMA DEVREDE:** Roller geri alındı. **Ceza:** ${sonuc}`;
        logGonder(newMember.guild, new EmbedBuilder().setColor('#FF0000').setTitle('⛔ YETKİSİZ ROL İŞLEMİ (Guard)').setDescription(desc).setTimestamp(), true);
    } else {
        logGonder(newMember.guild, new EmbedBuilder().setColor('#00FFFF').setTitle('📝 Rol Güncellemesi').setDescription(desc).setTimestamp());
    }
});

// --- 3. MESAJLAR: KÜFÜR, LİNK, SPAM, GUARD PANEL ---
client.on('messageCreate', async (message) => {
    yedegeEkle(message); // kanal silinirse geri yüklemek için yedekle

    if (message.author.bot || !message.guild) return;
    const hasAuthorizedRole = isVip(message.member);

    // GUARD PANEL
    if (message.content === '!guardpanel') {
        if (!hasAuthorizedRole) return message.reply({ content: "HOP! ⛔ Bu paneli açmak için VIP rozetin yok." });

        const embed = new EmbedBuilder()
            .setColor('#2B2D31')
            .setTitle('🛡️ Gardiyan Yargı Paneli ⚖️')
            .setDescription("Aşağıdaki menüden birini seçerek ona **28 güne kadar** timeout uygulayabilirsin.")
            .setThumbnail(client.user.displayAvatarURL())
            .setFooter({ text: 'Sadece VIP yetkililere özeldir.' });

        const userSelect = new UserSelectMenuBuilder().setCustomId('guard_panel_user').setPlaceholder('Kurbanı seçmek için tıkla... 🕵️‍♂️');
        await message.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(userSelect)] });
        return;
    }

    if (hasAuthorizedRole) return; // VIP: küfür/link/spam muaf

    // KÜFÜR KORUMASI
    const temizMetin = message.content.toLowerCase().replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-9]/g, '');
    const yasakliKelimeler = ['amk', 'aq', 'amq', 'sik', 'siktir', 'orospu', 'orospucocugu', 'oevladi', 'pic', 'got', 'yarrak', 'yarak', 'ibne', 'anani', 'amcik', 'kahpe', 'orospi', 'sikik', 'sikis', 'siker', 'ananin', 'avradini', 'ananinkami', 'gotveren', 'pezevenk', 'orosbunun', 'orosbucocugu', 'sikisken', 'amcikoglusu', 'yarrakbasi'];
    const normalTemizMetin = message.content.toLowerCase().replace(/\s+/g, '');

    if (yasakliKelimeler.some(k => temizMetin.includes(k) || normalTemizMetin.includes(k))) {
        try {
            botSildi.add(message.id);
            await message.delete();
            await message.member.timeout(10 * 60 * 1000, "Küfür ve argo kullanımı.");
        } catch (err) {}
        logGonder(message.guild, new EmbedBuilder().setColor('#FF0055').setTitle('🛡️ Küfür Filtresi Devrede!')
            .setDescription(`**Kişi:** ${message.author} (\`${message.author.id}\`)\n**Kanal:** ${message.channel}\n**Mesaj:** ${kisalt(message.content)}\n**Ceza:** Mesaj silindi, 10 dk timeout 🧊`).setTimestamp());
        return;
    }

    // LİNK KORUMASI
    const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.gg\/[^\s]+)/i;
    if (urlRegex.test(message.content)) {
        try {
            botSildi.add(message.id);
            await message.delete();
            await message.member.timeout(10 * 60 * 1000, "İzinsiz link paylaşımı.");
        } catch (err) {}
        logGonder(message.guild, new EmbedBuilder().setColor('#FF0055').setTitle('🚨 Kaçak Link Tespit Edildi!')
            .setDescription(`**Kişi:** ${message.author} (\`${message.author.id}\`)\n**Kanal:** ${message.channel}\n**Mesaj:** ${kisalt(message.content)}\n**Ceza:** Link silindi, 10 dk timeout 🧊`).setTimestamp());
        return;
    }

    // SPAM KORUMASI
    const userId = message.author.id;
    const userSpam = spamMap.get(userId) || { count: 0, lastTime: Date.now(), messages: [] };
    const now = Date.now();

    if (now - userSpam.lastTime < 5000) {
        userSpam.count += 1;
        userSpam.messages.push(message);

        if (userSpam.count >= 10) {
            try {
                userSpam.messages.forEach(m => botSildi.add(m.id));
                await message.channel.bulkDelete(userSpam.messages).catch(() => null);
                await message.member.timeout(10 * 60 * 1000, "Spam yapma.");
            } catch (e) {}
            logGonder(message.guild, new EmbedBuilder().setColor('#FFAA00').setTitle('🛑 Spam Engellendi')
                .setDescription(`**Kişi:** ${message.author} (\`${message.author.id}\`)\n**Kanal:** ${message.channel}\n**Sonuç:** ${userSpam.messages.length} mesaj silindi, 10 dk timeout 🧘‍♂️`).setTimestamp());
            userSpam.count = 0; userSpam.messages = [];
        }
    } else {
        userSpam.count = 1; userSpam.messages = [message];
    }
    userSpam.lastTime = now;
    spamMap.set(userId, userSpam);
});

// --- 4. MESAJ DÜZENLEME (yedek güncel kalsın) / SİLME LOGU ---
client.on('messageUpdate', (eski, yeni) => {
    if (!yeni.guild || typeof yeni.content !== 'string') return;
    const e = mesajYedek.get(yeni.channelId)?.find(x => x.id === yeni.id);
    if (e) e.icerik = yeni.content;
});

client.on('messageDelete', async (message) => {
    if (!message.guild) return;
    yedektenSil(message.channelId, [message.id]); // silinen mesaj kanal geri yüklenirken geri gelmesin
    if (botSildi.has(message.id)) { botSildi.delete(message.id); return; } // bot filtresi zaten logladı
    if (message.author?.bot) return;

    // Kim sildi? (kendi mesajını silen için audit log oluşmaz)
    let silen = "Yazar kendisi veya bilinmiyor";
    await sleep(800);
    const logs = await message.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MessageDelete }).catch(() => null);
    const e = logs?.entries.find(x => Date.now() - x.createdTimestamp < 5000 && x.extra?.channel?.id === message.channelId && (!message.author || x.target.id === message.author.id));
    if (e) silen = `<@${e.executor.id}>`;

    const embed = new EmbedBuilder().setColor('#E67E22').setTitle('🗑️ Mesaj Silindi')
        .setDescription(
            `**Yazar:** ${message.author ? `${message.author} (\`${message.author.id}\`)` : 'Bilinmiyor (eski mesaj)'}\n` +
            `**Kanal:** <#${message.channelId}>\n**Silen:** ${silen}\n` +
            `**İçerik:** ${kisalt(message.content)}` +
            (message.attachments?.size ? `\n**Ek dosya:** ${message.attachments.size} adet` : '')
        ).setTimestamp();
    logGonder(message.guild, embed);
});

client.on('messageDeleteBulk', async (messages, channel) => {
    if (!channel.guild) return;
    yedektenSil(channel.id, [...messages.keys()]);
    const bot = [...messages.values()].every(m => botSildi.has(m.id));
    messages.forEach(m => botSildi.delete(m.id));
    if (bot) return;
    logGonder(channel.guild, new EmbedBuilder().setColor('#E67E22').setTitle('🗑️ Toplu Mesaj Silindi')
        .setDescription(`**Kanal:** ${channel}\n**Silinen mesaj sayısı:** ${messages.size}`).setTimestamp());
});

// --- 5. GUARD PANEL MENÜ ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isUserSelectMenu() && !interaction.isStringSelectMenu()) return;

    if (!isVip(interaction.member)) {
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
        await interaction.reply({ content: `✅ <@${targetId}> seçildi. Ceza süresini belirle:`, components: [new ActionRowBuilder().addComponents(durationSelect)], ephemeral: true });
    }
    else if (interaction.customId.startsWith('guard_panel_duration_')) {
        const targetId = interaction.customId.split('_')[3];
        const duration = interaction.values[0];
        const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!targetMember) return interaction.reply({ content: "Sanık firar etmiş! (Sunucuda bulunamadı).", ephemeral: true });

        const map = { '10m': [10 * 60000, "10 Dakika"], '1h': [3600000, "1 Saat"], '1d': [86400000, "1 Gün"], '1w': [604800000, "1 Hafta"], '28d': [28 * 86400000, "28 Gün (1 Ay)"] };
        const [ms, text] = map[duration];

        try {
            await targetMember.timeout(ms, `Guard Panel: ${interaction.user.tag}`);
            await interaction.update({ content: `⚖️ **ADALET YERİNİ BULDU!** <@${targetId}>, **${text}** timeout aldı.`, components: [] });
            logGonder(interaction.guild, new EmbedBuilder().setColor('#8A2BE2').setTitle('🎛️ Guard Panel Ceza Verdi')
                .setDescription(`**VIP:** ${interaction.user}\n**Ceza alan:** <@${targetId}>\n**Süre:** ${text}`).setTimestamp());
        } catch (e) {
            await interaction.update({ content: "❌ Tüh! Yetkim yetmedi.", components: [] });
        }
    }
});

// --- 6. KANAL OLUŞTURMA (log + yetkisizse anında sil + timeout) ---
client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    const entry = await findEntry(channel.guild, [AuditLogEvent.ChannelCreate], channel.id);
    const executor = entry?.executor;

    if (await yetkisizMi(channel.guild, executor)) {
        const adi = channel.name;
        await channel.delete("Yetkisiz kanal oluşturma.").catch(() => {});
        const sonuc = await cezala(channel.guild, executor.id, "Yetkisiz kanal oluşturma.");
        logGonder(channel.guild, new EmbedBuilder().setColor('#FF0000').setTitle('🚨 YETKİSİZ KANAL OLUŞTURMA ENGELLENDİ')
            .setDescription(`**Açan:** <@${executor.id}>\n**Kanal:** \`${adi}\`\n**Sonuç:** Kanal anında silindi. **Ceza:** ${sonuc}`).setTimestamp(), true);
    } else {
        logGonder(channel.guild, new EmbedBuilder().setColor('#2ECC71').setTitle('📁 Yeni Kanal Açıldı')
            .setDescription(`**Açan:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\n**Kanal:** ${channel} (\`${channel.name}\`)`).setTimestamp());
    }
});

// --- 7. KANAL SİLME (yetkisizse kanalı + mesajları geri aç, timeout ver) ---
client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    const entry = await findEntry(channel.guild, [AuditLogEvent.ChannelDelete], channel.id);
    const executor = entry?.executor;

    if (executor?.id === client.user.id) return; // botun kendi silmesi (yetkisiz kanal oluşturma temizliği)

    if (await yetkisizMi(channel.guild, executor)) {
        let sonucYazi = "Kanal geri açılamadı";
        try {
            const yeni = await channel.clone({ reason: "Yetkisiz silme: geri açıldı." });
            await yeni.setPosition(channel.rawPosition).catch(() => {});
            sonucYazi = `Kanal geri açıldı: ${yeni}`;
            const n = await kanalGeriYukle(channel, yeni);
            if (n) sonucYazi += `, **${n} mesaj** geri yüklendi`;
        } catch (e) {}
        const sonuc = await cezala(channel.guild, executor.id, "Yetkisiz kanal silme.");
        logGonder(channel.guild, new EmbedBuilder().setColor('#FF0000').setTitle('🚨 YETKİSİZ KANAL SİLME')
            .setDescription(`**Silen:** <@${executor.id}>\n**Kanal:** \`${channel.name}\`\n**Sonuç:** ${sonucYazi}\n**Ceza:** ${sonuc}`).setTimestamp(), true);
    } else {
        mesajYedek.delete(channel.id);
        logGonder(channel.guild, new EmbedBuilder().setColor('#FFA500').setTitle('🗑️ Kanal Silindi')
            .setDescription(`**Silen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\n**Kanal:** \`${channel.name}\``).setTimestamp());
    }
});

// --- 8. KANAL DÜZENLEME / YÖNETME (yetkisizse anında geri al + timeout) ---
client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const degisimler = kanalDegisimleri(oldChannel, newChannel);
    if (degisimler.length === 0) return;

    const entry = await findEntry(newChannel.guild, [
        AuditLogEvent.ChannelUpdate, AuditLogEvent.ChannelOverwriteCreate,
        AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteDelete
    ], newChannel.id);
    const executor = entry?.executor;

    if (executor?.id === client.user.id) return; // botun kendi geri alması
    if (!executor && degisimler.length === 1 && degisimler[0].startsWith('**Sıra değişti')) return; // komşu kanal kayması: gürültü

    let desc = `**Kanal:** ${newChannel} (\`${newChannel.id}\`)\n**Düzenleyen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\n\n${degisimler.join('\n')}`;

    if (await yetkisizMi(newChannel.guild, executor)) {
        try {
            await newChannel.edit({
                name: oldChannel.name,
                parent: oldChannel.parentId,
                position: oldChannel.rawPosition,
                topic: oldChannel.topic,
                nsfw: oldChannel.nsfw,
                rateLimitPerUser: oldChannel.rateLimitPerUser,
                bitrate: oldChannel.bitrate,
                userLimit: oldChannel.userLimit,
                permissionOverwrites: oldChannel.permissionOverwrites.cache.map(o => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })),
                reason: "Yetkisiz kanal düzenleme: geri alındı."
            });
            desc += `\n\n♻️ **Değişiklik geri alındı.**`;
        } catch (e) { desc += `\n\n⚠️ Geri alınamadı (bot yetkisi/rol sırası kontrol et).`; }
        const sonuc = await cezala(newChannel.guild, executor.id, "Yetkisiz kanal düzenleme.");
        desc += `\n**Ceza:** ${sonuc}`;
        logGonder(newChannel.guild, new EmbedBuilder().setColor('#FF0000').setTitle('🚨 YETKİSİZ KANAL DÜZENLEME ENGELLENDİ').setDescription(desc).setTimestamp(), true);
    } else {
        logGonder(newChannel.guild, new EmbedBuilder().setColor('#3498DB').setTitle('🔧 Kanal Düzenlendi').setDescription(desc).setTimestamp());
    }
});

// --- 9. ROL OLUŞTURMA / SİLME / DÜZENLEME (sadece log) ---
client.on('roleCreate', async (role) => {
    const entry = await findEntry(role.guild, [AuditLogEvent.RoleCreate], role.id);
    const executor = entry?.executor;
    if (executor?.id === client.user.id) return;
    logGonder(role.guild, new EmbedBuilder().setColor('#2ECC71').setTitle('🆕 Rol Oluşturuldu')
        .setDescription(`**Oluşturan:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\n**Rol:** ${role}`).setTimestamp());
});

client.on('roleDelete', async (role) => {
    const entry = await findEntry(role.guild, [AuditLogEvent.RoleDelete], role.id);
    const executor = entry?.executor;
    if (executor?.id === client.user.id) return;
    logGonder(role.guild, new EmbedBuilder().setColor('#FFA500').setTitle('🗑️ Rol Silindi')
        .setDescription(`**Silen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\n**Rol:** \`${role.name}\``).setTimestamp());
});

client.on('roleUpdate', async (oldRole, newRole) => {
    const d = [];
    if (oldRole.name !== newRole.name) d.push(`**İsim:** \`${oldRole.name}\` → \`${newRole.name}\``);
    if (oldRole.color !== newRole.color) d.push(`**Renk değişti**`);
    if (oldRole.hoist !== newRole.hoist) d.push(`**Ayrı gösterme:** ${oldRole.hoist} → ${newRole.hoist}`);
    if (oldRole.mentionable !== newRole.mentionable) d.push(`**Etiketlenebilir:** ${oldRole.mentionable} → ${newRole.mentionable}`);
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) d.push(`**Yetkiler değişti**`);
    if (d.length === 0) return;

    const entry = await findEntry(newRole.guild, [AuditLogEvent.RoleUpdate], newRole.id);
    const executor = entry?.executor;
    if (executor?.id === client.user.id) return;
    logGonder(newRole.guild, new EmbedBuilder().setColor('#3498DB').setTitle('🔧 Rol Düzenlendi')
        .setDescription(`**Rol:** ${newRole}\n**Düzenleyen:** ${executor ? `<@${executor.id}>` : 'Bilinmiyor'}\n\n${d.join('\n')}`).setTimestamp());
});

// --- 10. TIMEOUT VE BAN OLAYLARI ---
client.on('guildAuditLogEntryCreate', async (auditLog, guild) => {
    if (auditLog.action === AuditLogEvent.MemberUpdate) {
        const timeoutChange = auditLog.changes.find(c => c.key === 'communication_disabled_until');
        if (timeoutChange && auditLog.executor?.id !== client.user.id) {
            logGonder(guild, new EmbedBuilder().setColor('#8A2BE2').setTitle(timeoutChange.new ? '🛋️ Timeout Başladı' : '🕊️ Timeout Kalktı')
                .setDescription(`**Yetkili:** <@${auditLog.executor.id}>\n**Kişi:** <@${auditLog.target.id}>`).setTimestamp());
        }
    }

    if (auditLog.action === AuditLogEvent.MemberBanRemove) {
        logGonder(guild, new EmbedBuilder().setColor('#00FF7F').setTitle('🕊️ Ban Kaldırıldı')
            .setDescription(`**Affeden:** <@${auditLog.executor.id}>\n**Affedilen:** <@${auditLog.target.id}>`).setTimestamp());
    }

    if (auditLog.action === AuditLogEvent.MemberBanAdd) {
        const executorMember = await guild.members.fetch(auditLog.executor.id).catch(() => null);
        if (!executorMember || executorMember.user.bot) return;

        if (isVip(executorMember)) {
            return logGonder(guild, new EmbedBuilder().setColor('#FF1493').setTitle('🔨 VIP Ban Attı')
                .setDescription(`**VIP:** ${executorMember}\n**Banlanan:** <@${auditLog.target.id}>\n*VIP olduğu için limite takılmaz.*`).setTimestamp());
        }

        const today = new Date().toDateString();
        if (dailyBans.date !== today) dailyBans = { count: 0, date: today };
        dailyBans.count++;

        if (dailyBans.count > 2) {
            try { await guild.members.unban(auditLog.target.id, "Limit Aşımı"); } catch (e) {}
            const sonuc = await cezala(guild, executorMember.id, "Günde 2'den fazla ban.");
            logGonder(guild, new EmbedBuilder().setColor('#FF0000').setTitle('🚨 BAN LİMİTİ AŞILDI (MAX 2)')
                .setDescription(`**Yetkili:** ${executorMember}\nSon ban geri çekildi. **Ceza:** ${sonuc}`).setTimestamp(), true);
        } else {
            logGonder(guild, new EmbedBuilder().setColor('#FF4500').setTitle('🔨 Ban Atıldı')
                .setDescription(`**Yetkili:** ${executorMember}\n**Banlanan:** <@${auditLog.target.id}>\n**Kullanılan Hak:** ${dailyBans.count}/2 ⚠️`).setTimestamp());
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

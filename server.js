const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Максимальний ліміт для передачі медіафайлів (100MB)
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// ==========================================
// НАЛАШТУВАННЯ СЕРВЕРНОГО КОНТРОЛЮ ГОЛОСУ
// ==========================================
const ALLOW_VOICE_EFFECTS = false; // Якщо FALSE — сервер повністю блокує та вирізає зміну голосу!

// Посилання на твій розгорнутий Google Apps Script
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzXBhB0gUudmya00QTzlsYPsxTTPlds04wbN7te0555w3RTvseg3YMYlRENJasaXHFNRg/exec";

// Дані для стабільних WebRTC дзвінків від Metered.ca
const METERED_RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "cc09a57d4063ee260e675fae",
            credential: "c1Pc28HiQXoD/Adt"
        },
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "cc09a57d4063ee260e675fae",
            credential: "c1Pc28HiQXoD/Adt"
        }
    ]
};

let userProfiles = {};
let messagesDatabase = {};
let groupsDatabase = {}; // <-- НОВА глобальна база даних для груп та каналів
let activeConnections = {};
const userRateLimits = {}; // Для серверного антиспаму

// --- ЗАВАНТАЖЕННЯ БАЗИ ДАНИХ ---
function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const rawData = fs.readFileSync(DB_FILE, 'utf8');
            if (rawData.trim()) {
                const parsed = JSON.parse(rawData);
                messagesDatabase = parsed.messagesDatabase || {};
                userProfiles = parsed.userProfiles || {};
                groupsDatabase = parsed.groupsDatabase || {}; // <-- Завантаження груп з файлу
                
                if (!messagesDatabase.scheduled) messagesDatabase.scheduled = [];
                console.log(`[БД] Успішно завантажено. Користувачів: ${Object.keys(userProfiles).length}, Груп/Каналів: ${Object.keys(groupsDatabase).length}`);
            }
        } else {
            messagesDatabase = { scheduled: [] };
            userProfiles = {};
            groupsDatabase = {};
            saveDatabase();
        }
    } catch (e) {
        console.error('[БД] Помилка завантаження файлу бази:', e.message);
        messagesDatabase = { scheduled: [] };
        userProfiles = {};
        groupsDatabase = {};
    }
}

// --- СИНХРОННЕ ЗБЕРЕЖЕННЯ ДАНИХ ---
function saveDatabase() {
    try {
        const dataToSave = { messagesDatabase, userProfiles, groupsDatabase }; // <-- Синхронізуємо також і групи
        fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
    } catch (err) {
        console.error('[БД] Помилка запису на диск:', err.message);
    }
}

loadDatabase();

// Налаштування роутингу статичних файлів
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

// --- ПЕРЕВІРКА ТА ВІДПРАВКА ВІДКЛАДЕНИХ ПОВІДОМЛЕНЬ ЗА ТАЙМЕРОМ ---
setInterval(() => {
    const now = Date.now();
    if (messagesDatabase.scheduled && messagesDatabase.scheduled.length > 0) {
        const dueMessages = messagesDatabase.scheduled.filter(m => new Date(m.scheduledTime).getTime() <= now);
        
        if (dueMessages.length > 0) {
            messagesDatabase.scheduled = messagesDatabase.scheduled.filter(m => new Date(m.scheduledTime).getTime() > now);
            
            dueMessages.forEach(msg => {
                delete msg.scheduledTime;
                
                if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = [];
                messagesDatabase[msg.room].push(msg);

                [msg.from, msg.to].forEach(user => {
                    if (!userProfiles[user]) userProfiles[user] = { chatList: [], displayName: user, bio: '', avatar: '' };
                    if (!userProfiles[user].chatList) userProfiles[user].chatList = [];
                    const partner = user === msg.from ? msg.to : msg.from;
                    if (!userProfiles[user].chatList.includes(partner)) {
                        userProfiles[user].chatList.push(partner);
                    }
                });

                io.to(msg.room).emit('chat_message', msg);
                
                if (activeConnections[msg.to]) {
                    io.to(activeConnections[msg.to]).emit('restore_chats', userProfiles[msg.to].chatList);
                }
                if (activeConnections[msg.from]) {
                    io.to(activeConnections[msg.from]).emit('restore_chats', userProfiles[msg.from].chatList);
                }
            });
            saveDatabase();
        }
    }
}, 1000);

// --- РОБОТА З СОКЕТАМИ (SOCKET.IO) ---
io.on('connection', (socket) => {
    let sessionUser = null;

    // Вхід користувача в мережу (Online Ping)
    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        sessionUser = data.username;
        activeConnections[sessionUser] = socket.id;

        if (!userProfiles[sessionUser]) {
            userProfiles[sessionUser] = { chatList: [], displayName: sessionUser, bio: '', avatar: '', banner: '', glowColor: 'blue', lastSeen: Date.now() };
        }
        userProfiles[sessionUser].lastSeen = Date.now();

        if (!userProfiles[sessionUser].chatList) userProfiles[sessionUser].chatList = [];

        saveDatabase();

        io.emit('online_list', Object.keys(activeConnections));
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);
        socket.emit('rtc_config', METERED_RTC_CONFIG);

        Object.keys(userProfiles).forEach(username => {
            socket.emit('profile_broadcast', { username, data: userProfiles[username] });
        });
    });

    // Маршрутизація WebRTC сигналів для дзвінків
    socket.on('webrtc_signal', (data) => {
        if (!data || !data.target || !sessionUser) return;
        const targetSocketId = activeConnections[data.target];
        if (targetSocketId) {
            io.to(targetSocketId).emit('webrtc_signal', { ...data, sender: sessionUser });
        }
    });

    // Запит профілю конкретного користувача
    socket.on('request_profile', (data) => {
        if (!data || !data.username) return;
        const uProfile = userProfiles[data.username];
        if (uProfile) {
            socket.emit('profile_broadcast', { username: data.username, data: uProfile });
        }
    });

    // Перевірка існування користувача через локальну базу та Google Apps Script
    socket.on('check_user_exists', async (data) => {
        if (!data || !data.username) return;
        let exists = !!userProfiles[data.username];
        let profile = exists ? userProfiles[data.username] : null;

        if (!exists && GOOGLE_SCRIPT_URL.startsWith('http')) {
            try {
                const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=check&username=${encodeURIComponent(data.username)}`);
                if (res.ok) {
                    const responseText = await res.text();
                    try {
                        const gasData = JSON.parse(responseText);
                        if (gasData.exists) {
                            exists = true;
                            profile = gasData.profile || { displayName: data.username, avatar: '', bio: '' };
                            userProfiles[data.username] = { chatList: [], ...profile };
                            saveDatabase();
                        }
                    } catch (parseErr) {
                        console.error(`[GAS JSON Помилка] Надійшов невалідний текст`);
                    }
                }
            } catch (err) {
                console.error("Помилка запиту до Google Script:", err);
            }
        }

        socket.emit('user_exists_result', { 
            username: data.username, 
            exists,
            profile: profile ? {
                displayName: profile.displayName || data.username,
                avatar: profile.avatar || '',
                bio: profile.bio || '',
                banner: profile.banner || '',
                glowColor: profile.glowColor || 'blue',
                lastSeen: profile.lastSeen || null
            } : null
        });
    });

    // Локальний + Хмарний пошук користувачів та відкритих груп
    socket.on('search_users', async (data) => {
        if (!data || typeof data.query !== 'string') return;
        const query = data.query.toLowerCase().trim();
        if (!query) return;

        let results = [];
        let foundUsernames = new Set();
        
        Object.keys(userProfiles).forEach(username => {
            const p = userProfiles[username];
            if (!p) return; 
            if (String(username).toLowerCase().includes(query) || String(p.displayName || '').toLowerCase().includes(query)) {
                foundUsernames.add(username);
                results.push({
                    username: username,
                    displayName: p.displayName || username,
                    avatar: p.avatar || '',
                    bio: p.bio || '',
                    banner: p.banner || '',
                    glowColor: p.glowColor || 'blue'
                });
            }
        });

        if (GOOGLE_SCRIPT_URL.startsWith('http')) {
            try {
                const response = await fetch(`${GOOGLE_SCRIPT_URL}?action=search&query=${encodeURIComponent(query)}`);
                if (response.ok) {
                    const responseText = await response.text();
                    try {
                        const googleResults = JSON.parse(responseText);
                        if (Array.isArray(googleResults)) {
                            googleResults.forEach(gu => {
                                if (!foundUsernames.has(gu.username)) {
                                    results.push({
                                        username: gu.username,
                                        displayName: gu.displayName || gu.username,
                                        avatar: gu.avatar || '',
                                        bio: gu.bio || '',
                                        banner: '',
                                        glowColor: 'blue'
                                    });
                                    foundUsernames.add(gu.username);
                                }
                            });
                        }
                    } catch (parseErr) {
                        console.error("[GAS Пошук] Не вдалося розпарсити JSON");
                    }
                }
            } catch (error) {
                console.error("Помилка підключення до Google Таблиць під час пошуку:", error);
            }
        }

        socket.emit('search_results', { query: data.query, results });
    });

    // Глобальний пошук повідомлень, людей та груп всередині клієнта
    socket.on('global_search', (data) => {
        if (!data || typeof data.query !== 'string' || !sessionUser) return;
        const query = data.query.toLowerCase().trim();
        if (!query) {
            socket.emit('global_search_results', { query: data.query, users: [], messages: [] });
            return;
        }
        
        const foundUsers = [];
        const foundMessages = [];

        Object.keys(userProfiles).forEach(username => {
            const p = userProfiles[username];
            if (!p) return;
            if (String(username).toLowerCase().includes(query) || String(p.displayName || '').toLowerCase().includes(query)) {
                foundUsers.push({ username, displayName: p.displayName || username, avatar: p.avatar || '', bio: p.bio || '' });
            }
        });

        // Інтеграція груп у глобальний пошук
        Object.keys(groupsDatabase).forEach(groupId => {
            const g = groupsDatabase[groupId];
            if (g && g.members[sessionUser]) { 
                if (g.name.toLowerCase().includes(query) || (g.description && g.description.toLowerCase().includes(query))) {
                    foundUsers.push({ username: groupId, displayName: g.name, avatar: g.avatar, isGroup: true, type: g.type });
                }
            }
        });

        Object.keys(messagesDatabase).forEach(room => {
            if (room.includes(sessionUser) || room.startsWith('group_')) {
                // Якщо це група, перевіряємо чи є користувач її учасником
                if (room.startsWith('group_') && (!groupsDatabase[room] || !groupsDatabase[room].members[sessionUser])) return;

                const roomMsgs = messagesDatabase[room] || [];
                roomMsgs.forEach(msg => {
                    if (msg && msg.text && typeof msg.text === 'string' && msg.text.toLowerCase().includes(query)) {
                        const partner = room.startsWith('group_') ? room : (msg.from === sessionUser ? msg.to : msg.from);
                        foundMessages.push({ id: msg.id, room: room, partner: partner, from: msg.from, text: msg.text, timestamp: msg.timestamp });
                    }
                });
            }
        });
        foundMessages.sort((a, b) => b.timestamp - a.timestamp);
        socket.emit('global_search_results', { query: data.query, users: foundUsers, messages: foundMessages });
    });

    // Оновлення розширених налаштувань профілю
    socket.on('update_profile', (data) => {
        if (!sessionUser || !data) return;
        if (!userProfiles[sessionUser]) userProfiles[sessionUser] = { chatList: [] };
        
        const profileData = data.data || data;
        userProfiles[sessionUser].displayName = profileData.displayName || sessionUser;
        userProfiles[sessionUser].bio = profileData.bio || '';
        userProfiles[sessionUser].avatar = profileData.avatar || ''; 
        userProfiles[sessionUser].banner = profileData.banner || ''; 
        userProfiles[sessionUser].glowColor = profileData.glowColor || 'blue'; 
        
        saveDatabase();
        io.emit('profile_broadcast', { username: sessionUser, data: userProfiles[sessionUser] });
    });

    // Вхід користувача в кімнату чату (Працює і для приватних чатів, і для груп)
    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);
        
        const pinnedKey = data.room + '_pinned';
        if (messagesDatabase[pinnedKey] && messagesDatabase[pinnedKey].length > 0) {
            socket.emit('pin_message', { room: data.room, pinned: messagesDatabase[pinnedKey] });
        }

        // Якщо користувач заходить у групу/канал, відправляємо конфіг та статус
        if (data.room.startsWith('group_') && groupsDatabase[data.room]) {
            socket.emit('group_info', groupsDatabase[data.room]);
            sendGroupOnlineCount(data.room);
        }
    });

    // Запит історії листування
    socket.on('request_history', (data) => {
        if (!data || !data.room) return;
        socket.emit('room_history', messagesDatabase[data.room] || []);
    });

    // Опрацювання повідомлень + МОДИФІКАЦІЯ ДЛЯ ГРУП/КАНАЛІВ + АНТИСПАМ
    socket.on('chat_message', (msg) => {
        if (!msg || !msg.room || !msg.from) return;

        // --- СЕРВЕРНИЙ АНТИСПАМ ---
        const now = Date.now();
        if (!userRateLimits[msg.from]) userRateLimits[msg.from] = [];
        userRateLimits[msg.from] = userRateLimits[msg.from].filter(t => now - t < 3000);
        if (userRateLimits[msg.from].length >= 5) {
            console.log(`[Антиспам] Блокування повідомлень від користувача: ${msg.from}`);
            return;
        }
        userRateLimits[msg.from].push(now);

        // === СЕРВЕРНА ПЕРЕВІРКА ЗМІНИ ГОЛОСУ ===
        if (!ALLOW_VOICE_EFFECTS) {
            if (msg.voiceEffect || msg.audioEffect) {
                delete msg.voiceEffect;
                delete msg.audioEffect;
            }
            if (msg.meta) {
                delete msg.meta.voiceEffect;
                delete msg.meta.audioEffect;
            }
        }

        const isGroup = msg.room.startsWith('group_');

        if (isGroup) {
            const group = groupsDatabase[msg.room];
            if (!group) return;

            // Перевірка на бан користувача в цій групі
            if (group.blocked && group.blocked.includes(msg.from)) return;

            const memberInfo = group.members[msg.from];
            if (!memberInfo) return; // Користувача немає в групі

            // Перевірка на мут (Заглушення користувача модератором)
            if (memberInfo.mutedUntil && memberInfo.mutedUntil > now) {
                socket.emit('group_error', { message: 'Ви заглушені (мут) адміністрацією!' });
                return;
            }

            // Перевірка прав для КАНАЛУ (публікація)
            if (group.type === 'channel') {
                const hasPostPermission = ['owner', 'co_owner', 'senior_admin', 'admin'].includes(memberInfo.role) || 
                                          (memberInfo.permissions && memberInfo.permissions.publish);
                if (!hasPostPermission) {
                    console.log(`[Блокування] Спроба звичайного юзера написати в канал: ${msg.from}`);
                    return; 
                }
            }

            if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = [];
            messagesDatabase[msg.room].push(msg);
            saveDatabase();

            // Трансляція повідомлення всім учасникам кімнати (Групи)
            io.to(msg.room).emit('chat_message', msg);

        } else {
            // === ОРИГІНАЛЬНА ЛОГІКА ДЛЯ ПРИВАТНИХ ЧАТІВ ===
            if (!msg.to) return;

            // Обробка відкладеного повідомлення
            if (msg.scheduledTime && new Date(msg.scheduledTime).getTime() > Date.now()) {
                if (!messagesDatabase.scheduled) messagesDatabase.scheduled = [];
                messagesDatabase.scheduled.push(msg);
                saveDatabase();
                return;
            }

            if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = [];
            messagesDatabase[msg.room].push(msg);

            // Таймер автовидалення секретних повідомлень
            if (msg.disappearTime && parseInt(msg.disappearTime) > 0) {
                setTimeout(() => {
                    if (messagesDatabase[msg.room]) {
                        messagesDatabase[msg.room] = messagesDatabase[msg.room].filter(m => m.id !== msg.id);
                        saveDatabase();
                        io.to(msg.room).emit('delete_message', { room: msg.room, msgId: msg.id });
                    }
                }, parseInt(msg.disappearTime) * 1000);
            }

            // Синхронізація списків діалогів
            [msg.from, msg.to].forEach(user => {
                if (!userProfiles[user]) userProfiles[user] = { chatList: [] };
                if (!userProfiles[user].chatList) userProfiles[user].chatList = [];
                const partner = user === msg.from ? msg.to : msg.from;
                if (!userProfiles[user].chatList.includes(partner)) {
                    userProfiles[user].chatList.push(partner);
                }
            });

            saveDatabase();

            io.emit('profile_broadcast', { username: msg.from, data: userProfiles[msg.from] });
            io.emit('profile_broadcast', { username: msg.to, data: userProfiles[msg.to] });
            
            const targetSocketId = activeConnections[msg.to];
            if (targetSocketId) {
                io.to(targetSocketId).emit('restore_chats', userProfiles[msg.to].chatList);
                io.to(targetSocketId).emit('chat_message', msg);
            }
            socket.to(msg.room).emit('chat_message', msg);
        }
    });

    socket.on('typing', (data) => {
        if (data && data.room) socket.to(data.room).emit('typing', data);
    });

    socket.on('user_activity', (data) => {
        if (data && data.room) {
            socket.to(data.room).emit('user_activity', data);
        }
    });

    socket.on('sync_chat_list', (data) => {
        if (sessionUser && data && data.chatList) {
            if (!userProfiles[sessionUser]) userProfiles[sessionUser] = { chatList: [] };
            userProfiles[sessionUser].chatList = data.chatList;
            saveDatabase();
        }
    });

    socket.on('mark_read', (data) => {
        if (!data || !data.room || !data.reader) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            messagesDatabase[data.room].forEach(m => { if (m && m.from !== data.reader) m.status = 'read'; });
            saveDatabase();
        }
        socket.to(data.room).emit('messages_read', data);
    });

    socket.on('edit_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            const msg = messagesDatabase[data.room].find(m => m && m.id === data.msgId);
            if (msg) { msg.text = data.newText; msg.edited = true; saveDatabase(); }
        }
        socket.to(data.room).emit('edit_message', data);
    });

    // МОДИФІКОВАНО: Видалення повідомлень за ієрархією (Младший адмін не може видаляти повідомлення адмінів)
    socket.on('delete_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        
        if (data.room.startsWith('group_')) {
            const group = groupsDatabase[data.room];
            if (!group || !sessionUser) return;

            const myRole = group.members[sessionUser]?.role;
            const msgList = messagesDatabase[data.room] || [];
            const msg = msgList.find(m => m.id === data.msgId);
            if (!msg) return;

            const targetUserRole = group.members[msg.from]?.role || 'member';
            const roleWeights = { 'owner': 5, 'co_owner': 4, 'senior_admin': 3, 'admin': 2, 'moderator': 1, 'member': 0 };

            let canDelete = false;
            if (msg.from === sessionUser) {
                canDelete = true; // Своє власне повідомлення можна видалити завжди
            } else if (['owner', 'co_owner', 'senior_admin'].includes(myRole)) {
                canDelete = true; // Старша адмінстрація видаляє все
            } else if (myRole === 'admin') { // Младший админ за твоєю логікою
                // Може видаляти повідомлення учасників та модерів, але НЕ вищих або рівних адмінів
                if (roleWeights[targetUserRole] < 2) {
                    canDelete = true;
                }
            }

            if (canDelete) {
                messagesDatabase[data.room] = messagesDatabase[data.room].filter(m => m.id !== data.msgId);
                saveDatabase();
                io.to(data.room).emit('delete_message', data);
            } else {
                socket.emit('group_error', { message: 'Ви не можете видалити повідомлення цього адміністратора!' });
            }
        } else {
            // Звичайний чат 1-на-1
            if (Array.isArray(messagesDatabase[data.room])) {
                messagesDatabase[data.room] = messagesDatabase[data.room].filter(m => m && m.id !== data.msgId);
                saveDatabase();
            }
            socket.to(data.room).emit('delete_message', data);
        }
    });

    socket.on('message_reaction', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            const msg = messagesDatabase[data.room].find(m => m && m.id === data.msgId);
            if (msg) { msg.reactions = data.reactions || {}; saveDatabase(); }
        }
        socket.to(data.room).emit('message_reaction', data);
    });

    socket.on('pin_message', (data) => {
        if (!data || !data.room) return;
        const pinnedKey = data.room + '_pinned';
        if (!messagesDatabase[pinnedKey]) messagesDatabase[pinnedKey] = [];

        if (data.action === 'remove') {
            const targetId = data.msgId || (data.pinData ? data.pinData.id : null) || (data.msg ? data.msg.id : null);
            if (targetId) {
                messagesDatabase[pinnedKey] = messagesDatabase[pinnedKey].filter(p => p.id !== targetId);
            }
        } else if (data.action === 'add') {
            const activeMsg = data.msg || data.pinData;
            if (activeMsg && !messagesDatabase[pinnedKey].some(p => p.id === activeMsg.id)) {
                messagesDatabase[pinnedKey].push(activeMsg);
            }
        } else if (data.pinned) {
            messagesDatabase[pinnedKey] = data.pinned;
        }

        saveDatabase();
        io.to(data.room).emit('pin_message', { room: data.room, pinned: messagesDatabase[pinnedKey] });
    });

    socket.on('clear_chat_history', (data) => {
        if (!data || !data.room) return;
        if (messagesDatabase[data.room]) {
            messagesDatabase[data.room] = [];
            saveDatabase();
        }
        io.to(data.room).emit('chat_history_cleared', { room: data.room });
    });


    // =========================================================================
    // БЛОК ОБРОБКИ СИСТЕМИ ГРУП ТА КАНАЛІВ (ОБРОБКА ВСІХ ПРАВ ТА РОЛЕЙ)
    // =========================================================================

    // 1. Створення групи або каналу
    socket.on('create_group', (data) => {
        if (!sessionUser || !data.name) return;
        
        const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        
        groupsDatabase[groupId] = {
            id: groupId,
            type: data.type, // 'group' або 'channel'
            name: data.name,
            description: data.desc || '',
            avatar: data.avatar || '',
            themeColor: data.themeColor || '#0088cc', // Колір повідомлень
            wallpaper: data.wallpaper || '', // Шпалери чату
            owner: sessionUser, // Творець
            blocked: [], // Список заблокованих (бан)
            members: {
                [sessionUser]: { 
                    role: 'owner', 
                    joinedAt: Date.now(),
                    permissions: { publish: true, edit_profile: true, change_settings: true, add_members: true }
                }
            },
            settings: {
                showMembers: true // Перемикач показу учасників (true/false)
            }
        };

        if (!userProfiles[sessionUser].chatList) userProfiles[sessionUser].chatList = [];
        userProfiles[sessionUser].chatList.push(groupId);
        saveDatabase();

        socket.join(groupId);
        io.to(groupId).emit('group_info', groupsDatabase[groupId]);
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);
        sendGroupOnlineCount(groupId);
    });

    // 2. Дії модерації та налаштувань (Kick, Mute, Повноваження адмінів)
    socket.on('group_action', (data) => {
        const { groupId, action, targetUser, role, permissions, themeColor, wallpaper, showMembers, desc, name } = data;
        const group = groupsDatabase[groupId];
        if (!group || !sessionUser) return;

        const myRole = group.members[sessionUser]?.role;
        const targetCurrentRole = group.members[targetUser]?.role || 'member';

        const roleWeights = { 'owner': 5, 'co_owner': 4, 'senior_admin': 3, 'admin': 2, 'moderator': 1, 'member': 0 };
        const myWeight = roleWeights[myRole] || 0;
        const targetWeight = roleWeights[targetCurrentRole] || 0;

        // Валідація ієрархії: не-власник не може карати тих, хто вище або рівний за рангом
        if (['kick', 'block', 'mute', 'set_role'].includes(action) && sessionUser !== group.owner) {
            if (myWeight <= targetWeight) {
                socket.emit('group_error', { message: 'У вас недостатньо прав (порушення ієрархії ролей)!' });
                return;
            }
        }

        // ЗАГЛУШЕННЯ (Мут) — дозволено модератору (1) і вище
        if (action === 'mute' && myWeight >= 1) {
            if (group.members[targetUser]) {
                group.members[targetUser].mutedUntil = Date.now() + (parseInt(data.muteTimeMinutes || 60) * 60000);
            }
        }

        // ВИДАЛЕННЯ З ГРУПИ (Кік) — дозволено старшому адміну (3) і вище
        if (action === 'kick' && myWeight >= 3) {
            delete group.members[targetUser];
            const targetSocket = activeConnections[targetUser];
            if (targetSocket) io.to(targetSocket).emit('group_kicked', { groupId });
        }

        // БЛОКУВАННЯ ДОСТУПУ (Бан) — дозволено старшому адміну (3) і вище
        if (action === 'block' && myWeight >= 3) {
            if (!group.blocked) group.blocked = [];
            if (!group.blocked.includes(targetUser)) group.blocked.push(targetUser);
            delete group.members[targetUser];
            const targetSocket = activeConnections[targetUser];
            if (targetSocket) io.to(targetSocket).emit('group_kicked', { groupId });
        }

        // ПРИЗНАЧЕННЯ РОЛЕЙ ТА ПЕРМІСІЙ — дозволено тільки власнику (5) або співвласнику (4)
        if (action === 'set_role' && myWeight >= 4) {
            if (group.members[targetUser]) {
                group.members[targetUser].role = role; 
                if (permissions) group.members[targetUser].permissions = permissions;
            }
        }

        // ДОДАВАННЯ УЧАСНИКІВ
        if (action === 'add_member') {
            const hasAddPermission = myWeight >= 2 || (group.members[sessionUser]?.permissions && group.members[sessionUser].permissions.add_members);
            if (hasAddPermission) {
                if (group.blocked && group.blocked.includes(targetUser)) {
                    socket.emit('group_error', { message: 'Цей користувач забанений в цій групі!' });
                    return;
                }
                if (!group.members[targetUser]) {
                    group.members[targetUser] = { role: 'member', joinedAt: Date.now() };
                    if (!userProfiles[targetUser]) userProfiles[targetUser] = { chatList: [] };
                    if (!userProfiles[targetUser].chatList) userProfiles[targetUser].chatList = [];
                    if (!userProfiles[targetUser].chatList.includes(groupId)) userProfiles[targetUser].chatList.push(groupId);
                    
                    const targetSocket = activeConnections[targetUser];
                    if (targetSocket) io.to(targetSocket).emit('restore_chats', userProfiles[targetUser].chatList);
                }
            }
        }

        // ОНОВЛЕННЯ НАЛАШТУВАНЬ (Кастомізація кольору, шпалер, опис, назва, видимість списку учасників)
        if (action === 'update_settings') {
            const canEditProfile = myWeight >= 3 || (group.members[sessionUser]?.permissions && group.members[sessionUser].permissions.edit_profile);
            const canChangeSettings = myWeight >= 4 || (group.members[sessionUser]?.permissions && group.members[sessionUser].permissions.change_settings);
            
            if (canEditProfile) {
                if (name) group.name = name;
                if (desc) group.description = desc;
                if (data.avatar) group.avatar = data.avatar;
            }
            if (canChangeSettings) {
                if (themeColor) group.themeColor = themeColor;
                if (wallpaper) group.wallpaper = wallpaper;
                if (showMembers !== undefined) group.settings.showMembers = showMembers;
            }
        }

        saveDatabase();
        io.to(groupId).emit('group_info', group);
        sendGroupOnlineCount(groupId);
    });

    // 3. Видалення акаунту (каналу/групи) — ТІЛЬКИ ДЛЯ ТОГО, ХТО СТВОРИВ (Власник)
    socket.on('delete_group', (data) => {
        const { groupId } = data;
        const group = groupsDatabase[groupId];
        if (!group || !sessionUser) return;

        if (group.owner !== sessionUser) {
            socket.emit('group_error', { message: 'Видалення неможливе! Ви не є творцем цього каналу або групи!' });
            return;
        }

        // Очищаємо чат-листи у всіх учасників чату в реальному часі
        Object.keys(group.members).forEach(member => {
            if (userProfiles[member] && userProfiles[member].chatList) {
                userProfiles[member].chatList = userProfiles[member].chatList.filter(id => id !== groupId);
                const targetSocket = activeConnections[member];
                if (targetSocket) {
                    io.to(targetSocket).emit('restore_chats', userProfiles[member].chatList);
                    io.to(targetSocket).emit('group_deleted', { groupId });
                }
            }
        });

        delete groupsDatabase[groupId];
        if (messagesDatabase[groupId]) delete messagesDatabase[groupId];
        if (messagesDatabase[groupId + '_pinned']) delete messagesDatabase[groupId + '_pinned'];
        
        saveDatabase();
    });

    // Допоміжна функція для підрахунку людей в мережі та передачі списку (якщо активовано показ)
    function sendGroupOnlineCount(groupId) {
        const group = groupsDatabase[groupId];
        if (!group) return;

        const totalCount = Object.keys(group.members).length;
        let onlineCount = 0;

        Object.keys(group.members).forEach(member => {
            if (activeConnections[member]) onlineCount++;
        });

        // Визначаємо, чи може поточний юзер бачити список людей (згідно твоїх налаштувань показ/приховання)
        const isInfoVisible = group.settings.showMembers || ['owner', 'co_owner', 'senior_admin', 'admin', 'moderator'].includes(group.members[sessionUser]?.role);

        io.to(groupId).emit('group_online_status', {
            groupId,
            onlineCount,
            totalCount,
            members: isInfoVisible ? Object.keys(group.members).map(m => ({
                username: m,
                role: group.members[m].role,
                isOnline: !!activeConnections[m]
            })) : null
        });
    }

    socket.on('disconnect', () => {
        if (sessionUser) {
            delete activeConnections[sessionUser];
            if (userProfiles[sessionUser]) {
                userProfiles[sessionUser].lastSeen = Date.now();
                saveDatabase();
                io.emit('profile_broadcast', { username: sessionUser, data: { lastSeen: userProfiles[sessionUser].lastSeen } });
            }
            io.emit('online_list', Object.keys(activeConnections));
            
            // Оновлюємо статус "в мережі" для всіх груп, де був юзер
            Object.keys(groupsDatabase).forEach(groupId => {
                if (groupsDatabase[groupId].members[sessionUser]) {
                    sendGroupOnlineCount(groupId);
                }
            });
        }
    });
});

server.listen(PORT, () => console.log(`=== Сервер BurmaldaGram запущено без помилок на порту ${PORT} ===`));

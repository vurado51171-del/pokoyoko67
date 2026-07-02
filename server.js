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
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyDPbd2dYEJmsECYI5Uc-lbwB9wL5ffM6zSkWcTOnPAhLaZUEP5C3Gbv_ui8MtaeLFcXQ/exec";

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
                
                if (!messagesDatabase.scheduled) messagesDatabase.scheduled = [];
                console.log(`[БД] Успішно завантажено. Користувачів: ${Object.keys(userProfiles).length}`);
            }
        } else {
            messagesDatabase = { scheduled: [] };
            userProfiles = {};
            saveDatabase();
        }
    } catch (e) {
        console.error('[БД] Помилка завантаження файлу бази:', e.message);
        messagesDatabase = { scheduled: [] };
        userProfiles = {};
    }
}

// --- СИНХРОННЕ ЗБЕРЕЖЕННЯ ДАНИХ ДЛЯ УНИКНЕННЯ КОНФЛІКТІВ ЗАПИСУ ---
function saveDatabase() {
    try {
        const dataToSave = { messagesDatabase, userProfiles };
        fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
    } catch (err) {
        console.error('[БД] Помилка запису на диск:', err.message);
    }
}

loadDatabase();

// Налаштування роутингу статичних файлів
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// ВИПРАВЛЕНИЙ РОУТИНГ СТОРІНОК (Більше не зациклює!)
// ==========================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); // Головна сторінка входу (Логін)
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html')); // Сторінка самого чату
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

                // Підтримка груп для відкладених повідомлень
                if (msg.to && msg.to.startsWith('ht.')) {
                    const groupMembers = (userProfiles[msg.to] && userProfiles[msg.to].members) || [msg.from];
                    groupMembers.forEach(user => {
                        if (!userProfiles[user]) userProfiles[user] = { chatList: [], displayName: user, bio: '', avatar: '' };
                        if (!userProfiles[user].chatList) userProfiles[user].chatList = [];
                        if (!userProfiles[user].chatList.includes(msg.to)) {
                            userProfiles[user].chatList.push(msg.to);
                        }
                        if (activeConnections[user]) {
                            io.to(activeConnections[user]).emit('restore_chats', userProfiles[user].chatList);
                        }
                    });
                    io.to(msg.room).emit('chat_message', msg);
                } else {
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
        userProfiles[sessionUser].lastSeen = Date.now(); // Оновлюємо статус

        if (!userProfiles[sessionUser].chatList) userProfiles[sessionUser].chatList = [];

        // === ДОДАТКОВО: Автоматичне сканування та додавання груп, де користувач є учасником ===
        Object.keys(userProfiles).forEach(id => {
            if (id.startsWith('ht.') && userProfiles[id].members && userProfiles[id].members.includes(sessionUser)) {
                if (!userProfiles[sessionUser].chatList.includes(id)) {
                    userProfiles[sessionUser].chatList.push(id);
                }
            }
        });

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

        if (!exists && GOOGLE_SCRIPT_URL.startsWith('http') && !data.username.startsWith('ht.')) {
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
                lastSeen: profile.lastSeen || null,
                members: profile.members || [], // Зберігаємо список учасників для груп
                isGroup: profile.isGroup || data.username.startsWith('ht.') // Прапорець групи
            } : null
        });
    });

    // Локальний + Хмарний пошук користувачів
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

    // Глобальний пошук повідомлень та людей всередині клієнта
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

        Object.keys(messagesDatabase).forEach(room => {
            if (room.includes(sessionUser) || (userProfiles[room] && userProfiles[room].members && userProfiles[room].members.includes(sessionUser))) {
                const roomMsgs = messagesDatabase[room] || [];
                roomMsgs.forEach(msg => {
                    if (msg && msg.text && typeof msg.text === 'string' && msg.text.toLowerCase().includes(query)) {
                        const partner = msg.from === sessionUser ? msg.to : msg.from;
                        foundMessages.push({ id: msg.id, room: room, partner: partner, from: msg.from, text: msg.text, timestamp: msg.timestamp });
                    }
                });
            }
        });
        foundMessages.sort((a, b) => b.timestamp - a.timestamp);
        socket.emit('global_search_results', { query: data.query, users: foundUsers, messages: foundMessages });
    });

    // Оновлення розширених налаштувань профілю (Кастомізація)
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

    // Вхід користувача в кімнату чату
    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);
        const pinnedKey = data.room + '_pinned';
        if (messagesDatabase[pinnedKey] && messagesDatabase[pinnedKey].length > 0) {
            socket.emit('pin_message', { room: data.room, pinned: messagesDatabase[pinnedKey] });
        }
    });

    // Запит історії листування
    socket.on('request_history', (data) => {
        if (!data || !data.room) return;
        socket.emit('room_history', messagesDatabase[data.room] || []);
    });

    // Опрацювання повідомлень + ЗАЛІЗОБЕТОННИЙ КОНТРОЛЬ ЗМІНИ ГОЛОСУ + АНТИСПАМ
    socket.on('chat_message', (msg) => {
        if (!msg || !msg.room || !msg.from || !msg.to) return;

        // --- СЕРВЕРНИЙ АНТИСПАМ ---
        const now = Date.now();
        if (!userRateLimits[msg.from]) userRateLimits[msg.from] = [];
        userRateLimits[msg.from] = userRateLimits[msg.from].filter(t => now - t < 3000);
        if (userRateLimits[msg.from].length >= 5) {
            console.log(`[Антиспам] Блокування повідомлень від користувача: ${msg.from}`);
            return; // Ігноруємо спам
        }
        userRateLimits[msg.from].push(now);

        // === СЕРВЕРНА ПЕРЕВІРКА: Якщо ефекти вимкнені, видаляємо модифікацію голосу ===
        if (!ALLOW_VOICE_EFFECTS) {
            if (msg.voiceEffect || msg.audioEffect) {
                console.log(`[Сервер] Заблоковано несанкціоновану зміну голосу від: ${msg.from}`);
                delete msg.voiceEffect;
                delete msg.audioEffect;
            }
            if (msg.meta) {
                delete msg.meta.voiceEffect;
                delete msg.meta.audioEffect;
            }
        }

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

        // === РОЗУМНА СИНХРОНІЗАЦІЯ ДЛЯ ГРУП ТА КАНАЛІВ (ht.xxxxx) ===
        if (msg.to.startsWith('ht.')) {
            if (!userProfiles[msg.to]) {
                userProfiles[msg.to] = { 
                    displayName: msg.groupName || msg.to, 
                    bio: msg.groupBio || '', 
                    avatar: msg.groupAvatar || '', 
                    banner: msg.groupBanner || '', 
                    glowColor: msg.groupGlow || 'blue', 
                    members: msg.members || [msg.from],
                    isGroup: true 
                };
            }
            
            // Якщо клієнт передав актуальний список учасників, оновлюємо його на сервері
            if (msg.members && Array.isArray(msg.members)) {
                userProfiles[msg.to].members = msg.members;
            }
            if (msg.groupName) userProfiles[msg.to].displayName = msg.groupName;
            if (msg.groupBio) userProfiles[msg.to].bio = msg.groupBio;
            if (msg.groupAvatar) userProfiles[msg.to].avatar = msg.groupAvatar;
            if (msg.groupGlow) userProfiles[msg.to].glowColor = msg.groupGlow;

            const groupMembers = userProfiles[msg.to].members || [msg.from];
            
            // Додаємо групу в chatList КОЖНОГО учасника, щоб вона миттєво з'являлася в бічній панелі
            groupMembers.forEach(user => {
                if (!userProfiles[user]) userProfiles[user] = { chatList: [], displayName: user, bio: '', avatar: '', banner: '', glowColor: 'blue', lastSeen: Date.now() };
                if (!userProfiles[user].chatList) userProfiles[user].chatList = [];
                if (!userProfiles[user].chatList.includes(msg.to)) {
                    userProfiles[user].chatList.push(msg.to);
                }
            });

            saveDatabase();

            // Транслюємо оновлені метадані групи (аватар, опис, сяйво)
            io.emit('profile_broadcast', { username: msg.to, data: userProfiles[msg.to] });

            // Надсилаємо повідомлення та оновлений список чатів усім підключеним учасникам групи
            groupMembers.forEach(user => {
                const targetSocketId = activeConnections[user];
                if (targetSocketId) {
                    io.to(targetSocketId).emit('restore_chats', userProfiles[user].chatList);
                    if (user !== msg.from) {
                        io.to(targetSocketId).emit('chat_message', msg);
                    }
                }
            });
            
            socket.to(msg.room).emit('chat_message', msg);
        } else {
            // Звичайна логіка синхронізації приватних чатів (1-на-1)
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

    // Передача статусів активності ("записує аудіо", "обирає стікер" і т.д.)
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

    socket.on('delete_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            messagesDatabase[data.room] = messagesDatabase[data.room].filter(m => m && m.id !== data.msgId);
            saveDatabase();
        }
        socket.to(data.room).emit('delete_message', data);
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

    // Очищення історії чату для обох співрозмовників
    socket.on('clear_chat_history', (data) => {
        if (!data || !data.room) return;
        if (messagesDatabase[data.room]) {
            messagesDatabase[data.room] = [];
            saveDatabase();
        }
        io.to(data.room).emit('chat_history_cleared', { room: data.room });
    });

    // === НОВІ ПОДІЇ ДЛЯ КОМПЛЕКСНОГО КЕРУВАННЯ ГРУПАМИ З КЛІЄНТА ===
    socket.on('create_group', (data) => {
        if (!data || !data.groupId) return;
        const gId = data.groupId;
        userProfiles[gId] = {
            displayName: data.displayName || data.name || gId,
            bio: data.bio || data.description || '',
            avatar: data.avatar || '',
            banner: data.banner || '',
            glowColor: data.glowColor || 'blue',
            members: data.members || [sessionUser],
            isGroup: true
        };
        userProfiles[gId].members.forEach(member => {
            if (!userProfiles[member]) userProfiles[member] = { chatList: [] };
            if (!userProfiles[member].chatList) userProfiles[member].chatList = [];
            if (!userProfiles[member].chatList.includes(gId)) userProfiles[member].chatList.push(gId);
            
            const memberSocket = activeConnections[member];
            if (memberSocket) io.to(memberSocket).emit('restore_chats', userProfiles[member].chatList);
        });
        saveDatabase();
        io.emit('profile_broadcast', { username: gId, data: userProfiles[gId] });
    });

    socket.on('update_group', (data) => {
        if (!data || !data.groupId) return;
        const gId = data.groupId;
        if (!userProfiles[gId]) userProfiles[gId] = { members: [sessionUser], isGroup: true };
        
        userProfiles[gId].displayName = data.displayName || data.name || userProfiles[gId].displayName || gId;
        userProfiles[gId].bio = data.bio || data.description || userProfiles[gId].bio || '';
        userProfiles[gId].avatar = data.avatar || userProfiles[gId].avatar || '';
        userProfiles[gId].banner = data.banner || userProfiles[gId].banner || '';
        userProfiles[gId].glowColor = data.glowColor || userProfiles[gId].glowColor || 'blue';
        if (data.members && Array.isArray(data.members)) userProfiles[gId].members = data.members;

        userProfiles[gId].members.forEach(member => {
            if (!userProfiles[member]) userProfiles[member] = { chatList: [] };
            if (!userProfiles[member].chatList) userProfiles[member].chatList = [];
            if (!userProfiles[member].chatList.includes(gId)) userProfiles[member].chatList.push(gId);
            
            const memberSocket = activeConnections[member];
            if (memberSocket) io.to(memberSocket).emit('restore_chats', userProfiles[member].chatList);
        });
        saveDatabase();
        io.emit('profile_broadcast', { username: gId, data: userProfiles[gId] });
    });

    socket.on('add_group_member', (data) => {
        if (!data || !data.groupId || !data.username) return;
        const gId = data.groupId;
        const newMember = data.username;
        if (!userProfiles[gId]) return;
        if (!userProfiles[gId].members) userProfiles[gId].members = [];
        if (!userProfiles[gId].members.includes(newMember)) userProfiles[gId].members.push(newMember);

        if (!userProfiles[newMember]) userProfiles[newMember] = { chatList: [] };
        if (!userProfiles[newMember].chatList) userProfiles[newMember].chatList = [];
        if (!userProfiles[newMember].chatList.includes(gId)) userProfiles[newMember].chatList.push(gId);

        saveDatabase();
        io.emit('profile_broadcast', { username: gId, data: userProfiles[gId] });
        const memberSocket = activeConnections[newMember];
        if (memberSocket) io.to(memberSocket).emit('restore_chats', userProfiles[newMember].chatList);
    });

    socket.on('disconnect', () => {
        if (sessionUser) {
            delete activeConnections[sessionUser];
            if (userProfiles[sessionUser]) {
                userProfiles[sessionUser].lastSeen = Date.now(); // Оновлюємо статус при виході
                saveDatabase();
                io.emit('profile_broadcast', { username: sessionUser, data: { lastSeen: userProfiles[sessionUser].lastSeen } });
            }
            io.emit('online_list', Object.keys(activeConnections));
        }
    });
});

server.listen(PORT, () => console.log(`=== Сервер BurmaldaGram запущено без помилок на порту ${PORT} ===`));

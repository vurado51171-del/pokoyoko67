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
let activeConnections = {};
let groupsAndChannels = {}; // ДОДАНО: Сховище для груп та каналів
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
                groupsAndChannels = parsed.groupsAndChannels || {}; // ДОДАНО
                
                if (!messagesDatabase.scheduled) messagesDatabase.scheduled = [];
                console.log(`[БД] Успішно завантажено. Користувачів: ${Object.keys(userProfiles).length}, Груп/Каналів: ${Object.keys(groupsAndChannels).length}`);
            }
        } else {
            messagesDatabase = { scheduled: [] };
            userProfiles = {};
            groupsAndChannels = {};
            saveDatabase();
        }
    } catch (e) {
        console.error('[БД] Помилка завантаження файлу бази:', e.message);
        messagesDatabase = { scheduled: [] };
        userProfiles = {};
        groupsAndChannels = {};
    }
}

// --- СИНХРОННЕ ЗБЕРЕЖЕННЯ ДАНИХ ---
function saveDatabase() {
    try {
        const dataToSave = { messagesDatabase, userProfiles, groupsAndChannels }; // ДОДАНО
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

// --- ПЕРЕВІРКА ТА ВІДПРАВКА ВІДКЛАДЕНИХ ПОВІДОМЛЕНЬ ---
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

                const isGroupChat = groupsAndChannels[msg.room] !== undefined;

                if (!isGroupChat) {
                    [msg.from, msg.to].forEach(user => {
                        if (!userProfiles[user]) userProfiles[user] = { chatList: [], displayName: user, bio: '', avatar: '' };
                        if (!userProfiles[user].chatList) userProfiles[user].chatList = [];
                        const partner = user === msg.from ? msg.to : msg.from;
                        if (!userProfiles[user].chatList.includes(partner)) {
                            userProfiles[user].chatList.push(partner);
                        }
                    });

                    if (activeConnections[msg.to]) {
                        io.to(activeConnections[msg.to]).emit('restore_chats', userProfiles[msg.to].chatList);
                    }
                    if (activeConnections[msg.from]) {
                        io.to(activeConnections[msg.from]).emit('restore_chats', userProfiles[msg.from].chatList);
                    }
                }

                io.to(msg.room).emit('chat_message', msg);
            });
            saveDatabase();
        }
    }
}, 1000);

// --- СИНХРОНІЗАЦІЯ ГРУП (ДОПОМІЖНА ФУНКЦІЯ) ---
function syncUserCGs(username, socketObj = null) {
    if (!activeConnections[username] && !socketObj) return;
    const userCGs = {};
    const targetSocketId = socketObj ? socketObj.id : activeConnections[username];
    const actualSocket = socketObj || io.sockets.sockets.get(targetSocketId);

    Object.keys(groupsAndChannels).forEach(cgId => {
        const cg = groupsAndChannels[cgId];
        if (cg.members.includes(username) || cg.owner === username) {
            userCGs[cgId] = cg;
            if (actualSocket) {
                actualSocket.join(cgId); // Автоматично приєднуємо сокет до кімнати групи
            }
        }
    });

    if (targetSocketId) {
        io.to(targetSocketId).emit('cg_sync', userCGs);
    }
}

// --- РОБОТА З СОКЕТАМИ (SOCKET.IO) ---
io.on('connection', (socket) => {
    let sessionUser = null;

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

        // ДОДАНО: Синхронізація каналів/груп для користувача
        syncUserCGs(sessionUser, socket);

        Object.keys(userProfiles).forEach(username => {
            socket.emit('profile_broadcast', { username, data: userProfiles[username] });
        });
    });

    // ==========================================
    // ЛОГІКА КАНАЛІВ ТА ГРУП
    // ==========================================
    
    // Створення нової групи/каналу
    socket.on('cg_create', (payload) => {
        if (!payload || !payload.id) return;
        groupsAndChannels[payload.id] = payload;
        saveDatabase();
        
        // Оновлюємо дані для всіх учасників
        payload.members.forEach(member => {
            syncUserCGs(member);
        });
    });

    // Модерація в групі/каналі
    socket.on('cg_moderate', (data) => {
        const { cgId, actor, target, action, durationMs, newRole } = data;
        const cg = groupsAndChannels[cgId];
        if (!cg) return;

        switch (action) {
            case 'mute':
                cg.muted[target] = Date.now() + durationMs;
                break;
            case 'unmute':
                delete cg.muted[target];
                break;
            case 'kick':
                cg.members = cg.members.filter(m => m !== target);
                ['admins', 'seniorMods', 'juniorMods'].forEach(roleArray => {
                    cg[roleArray] = cg[roleArray].filter(m => m !== target);
                });
                break;
            case 'ban':
                cg.banned[target] = durationMs ? Date.now() + durationMs : null;
                cg.members = cg.members.filter(m => m !== target);
                ['admins', 'seniorMods', 'juniorMods'].forEach(roleArray => {
                    cg[roleArray] = cg[roleArray].filter(m => m !== target);
                });
                break;
            case 'promote':
            case 'demote':
                ['admins', 'seniorMods', 'juniorMods'].forEach(roleArray => {
                    cg[roleArray] = cg[roleArray].filter(m => m !== target);
                });
                if (newRole === 'admin') cg.admins.push(target);
                else if (newRole === 'seniorMod') cg.seniorMods.push(target);
                else if (newRole === 'juniorMod') cg.juniorMods.push(target);
                break;
        }

        saveDatabase();
        cg.members.forEach(member => syncUserCGs(member));
        if (['kick', 'ban'].includes(action)) syncUserCGs(target); // Щоб видалити з UI у жертви
    });

    // ==========================================
    // СТАНДАРТНІ ФУНКЦІЇ (Діалоги, Пошук тощо)
    // ==========================================

    socket.on('webrtc_signal', (data) => {
        if (!data || !data.target || !sessionUser) return;
        const targetSocketId = activeConnections[data.target];
        if (targetSocketId) {
            io.to(targetSocketId).emit('webrtc_signal', { ...data, sender: sessionUser });
        }
    });

    socket.on('request_profile', (data) => {
        if (!data || !data.username) return;
        const uProfile = userProfiles[data.username];
        if (uProfile) {
            socket.emit('profile_broadcast', { username: data.username, data: uProfile });
        }
    });

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
            if (room.includes(sessionUser) || groupsAndChannels[room]) { // Додано пошук в групах
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

    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);
        const pinnedKey = data.room + '_pinned';
        if (messagesDatabase[pinnedKey] && messagesDatabase[pinnedKey].length > 0) {
            socket.emit('pin_message', { room: data.room, pinned: messagesDatabase[pinnedKey] });
        }
    });

    socket.on('request_history', (data) => {
        if (!data || !data.room) return;
        socket.emit('room_history', messagesDatabase[data.room] || []);
    });

    socket.on('chat_message', (msg) => {
        if (!msg || !msg.room || !msg.from || !msg.to) return;

        const now = Date.now();
        if (!userRateLimits[msg.from]) userRateLimits[msg.from] = [];
        userRateLimits[msg.from] = userRateLimits[msg.from].filter(t => now - t < 3000);
        if (userRateLimits[msg.from].length >= 5) {
            console.log(`[Антиспам] Блокування повідомлень від користувача: ${msg.from}`);
            return; 
        }
        userRateLimits[msg.from].push(now);

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

        if (msg.scheduledTime && new Date(msg.scheduledTime).getTime() > Date.now()) {
            if (!messagesDatabase.scheduled) messagesDatabase.scheduled = [];
            messagesDatabase.scheduled.push(msg);
            saveDatabase();
            return;
        }

        if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = [];
        messagesDatabase[msg.room].push(msg);

        if (msg.disappearTime && parseInt(msg.disappearTime) > 0) {
            setTimeout(() => {
                if (messagesDatabase[msg.room]) {
                    messagesDatabase[msg.room] = messagesDatabase[msg.room].filter(m => m.id !== msg.id);
                    saveDatabase();
                    io.to(msg.room).emit('delete_message', { room: msg.room, msgId: msg.id });
                }
            }, parseInt(msg.disappearTime) * 1000);
        }

        const isGroupChat = groupsAndChannels[msg.room] !== undefined; // ОНОВЛЕНО: Перевірка на Групу

        if (!isGroupChat) {
            // Звичайна логіка 1-на-1
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
        } else {
            // Якщо це група, зберігаємо і розсилаємо без додавання групи у список друзів
            saveDatabase();
        }

        socket.to(msg.room).emit('chat_message', msg);
    });

    socket.on('typing', (data) => {
        if (data && data.room) socket.to(data.room).emit('typing', data);
    });

    socket.on('user_activity', (data) => {
        if (data && data.room) socket.to(data.room).emit('user_activity', data);
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

    socket.on('clear_chat_history', (data) => {
        if (!data || !data.room) return;
        if (messagesDatabase[data.room]) {
            messagesDatabase[data.room] = [];
            saveDatabase();
        }
        io.to(data.room).emit('chat_history_cleared', { room: data.room });
    });

    socket.on('disconnect', () => {
        if (sessionUser) {
            delete activeConnections[sessionUser];
            if (userProfiles[sessionUser]) {
                userProfiles[sessionUser].lastSeen = Date.now();
                saveDatabase();
                io.emit('profile_broadcast', { username: sessionUser, data: { lastSeen: userProfiles[sessionUser].lastSeen } });
            }
            io.emit('online_list', Object.keys(activeConnections));
        }
    });
});

server.listen(PORT, () => console.log(`=== Сервер BurmaldaGram запущено з підтримкою Груп/Каналів на порту ${PORT} ===`));

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Максимальний ліміт для передачі медіафайлів (100MB).
// УВАГА: Великі аватарки в Base64 будуть вантажитися довго. В ідеалі їх треба стискати на фронтенді.
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// ============================================================================
// 🛑 НАЛАШТУВАННЯ: ВСТАВ СВОЇ ДАНІ ТУТ
// ============================================================================

// 1. Посилання на твій розгорнутий Google Apps Script.
// Якщо поки не налаштував, залиш пусті лапки "".
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyDPbd2dYEJmsECYI5Uc-lbwB9wL5ffM6zSkWcTOnPAhLaZUEP5C3Gbv_ui8MtaeLFcXQ/exec";

// 2. Дані для стабільних дзвінків від Metered.ca
// Заміни "ТВІЙ_USERNAME" та "ТВІЙ_ПАСВОРД" на ті, що дали після реєстрації.
const METERED_RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "ТВІЙ_USERNAME", // <-- Вставляти сюди
            credential: "ТВІЙ_ПАСВОРД" // <-- Вставляти сюди
        },
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "ТВІЙ_USERNAME", // <-- Вставляти сюди
            credential: "ТВІЙ_ПАСВОРД" // <-- Вставляти сюди
        }
    ]
};

// ============================================================================

let userProfiles = {};
let messagesDatabase = {};
let activeConnections = {};

// --- НАДІЙНЕ ЗАВАНТАЖЕННЯ БАЗИ ---
function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const rawData = fs.readFileSync(DB_FILE, 'utf8');
            if (rawData.trim()) {
                const parsed = JSON.parse(rawData);
                messagesDatabase = parsed.messagesDatabase || {};
                userProfiles = parsed.userProfiles || {};
                console.log(`[БД] Базу успішно завантажено. Юзерів у системі (локально): ${Object.keys(userProfiles).length}`);
            }
        }
    } catch (e) {
        console.error('[БД] Помилка завантаження файлу бази:', e.message);
    }
}

// --- ФОНОВЕ ЗБЕРЕЖЕННЯ ДАНИХ ---
function saveDatabase() {
    const dataToSave = { messagesDatabase, userProfiles };
    fs.writeFile(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf8', (err) => {
        if (err) console.error('[БД] Помилка запису на диск:', err.message);
    });
}

loadDatabase();

app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));

io.on('connection', (socket) => {
    let sessionUser = null;

    // Вхід користувача
    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        sessionUser = data.username;
        activeConnections[sessionUser] = socket.id;

        if (!userProfiles[sessionUser]) {
            userProfiles[sessionUser] = { chatList: [], displayName: sessionUser, bio: '', avatar: '' };
        }
    
        if (!userProfiles[sessionUser].chatList) userProfiles[sessionUser].chatList = [];

        saveDatabase();

        io.emit('online_list', Object.keys(activeConnections));
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);
        socket.emit('rtc_config', METERED_RTC_CONFIG);

        Object.keys(userProfiles).forEach(username => {
            socket.emit('profile_broadcast', { username, data: userProfiles[username] });
        });
    });

    // Маршрутизація сигналів дзвінків (WebRTC)
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

    // Перевірка юзера (Локальна база + Google Apps Script)
    socket.on('check_user_exists', async (data) => {
        if (!data || !data.username) return;
        let exists = !!userProfiles[data.username];
        let profile = exists ? userProfiles[data.username] : null;

        // Перевірка в Google Таблицях, якщо вказано URL
        if (!exists && GOOGLE_SCRIPT_URL.startsWith('http')) {
            try {
                const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=check&username=${encodeURIComponent(data.username)}`);
                const responseText = await res.text(); // Спочатку читаємо як текст

                if (res.ok) {
                    try {
                        const gasData = JSON.parse(responseText);
                        if (gasData.exists) {
                            exists = true;
                            profile = gasData.profile || { displayName: data.username, avatar: '', bio: '' };
                            // Зберігаємо знайденого юзера в локальний кеш
                            userProfiles[data.username] = { chatList: [], ...profile };
                            saveDatabase();
                        }
                    } catch (parseErr) {
                        console.error(`[ПОМИЛКА GAS у check_user_exists] Очікувався JSON, але прийшло:`, responseText.substring(0, 300));
                    }
                } else {
                    console.error("[ПОМИЛКА GAS у check_user_exists] Статус HTTP:", res.status);
                }
            } catch (err) {
                console.error("Помилка запиту до Google Script (check):", err);
            }
        }

        socket.emit('user_exists_result', { 
            username: data.username, 
            exists,
            profile: profile ? {
                displayName: profile.displayName || data.username,
                avatar: profile.avatar || '',
                bio: profile.bio || ''
            } : null
        });
    });

    // ЗАЛІЗОБЕТОННИЙ ПОШУК (З підключенням до Google Apps Script)
    socket.on('search_users', async (data) => {
        if (!data || typeof data.query !== 'string') return;
        const query = data.query.toLowerCase().trim();
        if (!query) return;

        let results = [];
        let foundUsernames = new Set();
        
        // 1. Жорсткий перебір локальної бази
        Object.keys(userProfiles).forEach(username => {
            const p = userProfiles[username];
            if (!p) return; 
            
            const safeUsername = String(username).toLowerCase();
            const safeDisplayName = String(p.displayName || '').toLowerCase();
            
            if (safeUsername.includes(query) || safeDisplayName.includes(query)) {
                foundUsernames.add(username);
                results.push({
                    username: username,
                    displayName: p.displayName || username,
                    avatar: p.avatar || '',
                    bio: p.bio || ''
                });
            }
        });

        // 2. Запит до Google Apps Script (якщо лінка є)
        if (GOOGLE_SCRIPT_URL.startsWith('http')) {
            try {
                const response = await fetch(`${GOOGLE_SCRIPT_URL}?action=search&query=${encodeURIComponent(query)}`);
                const responseText = await response.text(); // Спочатку читаємо як текст
                
                if (response.ok) {
                    try {
                        const googleResults = JSON.parse(responseText);
                        
                        if (Array.isArray(googleResults)) {
                            googleResults.forEach(gu => {
                                if (!foundUsernames.has(gu.username)) {
                                    results.push({
                                        username: gu.username,
                                        displayName: gu.displayName || gu.username,
                                        avatar: gu.avatar || '',
                                        bio: gu.bio || ''
                                    });
                                    foundUsernames.add(gu.username);
                                }
                            });
                        }
                    } catch (parseErr) {
                        console.error("[ПОМИЛКА GAS у search_users] Google повернув не JSON! Ось що прийшло:", responseText.substring(0, 300));
                    }
                } else {
                    console.error("[ПОМИЛКА GAS у search_users] Статус HTTP:", response.status);
                }
            } catch (error) {
                console.error("Помилка під час підключення до Google Таблиць:", error);
            }
        }

        socket.emit('search_results', { query: data.query, results });
    });

    // Глобальний пошук (тільки локальний, бо повідомлення лежать на сервері)
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
            const safeUsername = String(username).toLowerCase();
            const safeDisplayName = String(p.displayName || '').toLowerCase();
    
            if (safeUsername.includes(query) || safeDisplayName.includes(query)) {
                foundUsers.push({
                    username: username,
                    displayName: p.displayName || username,
                    avatar: p.avatar || '',
                    bio: p.bio || ''
                });
            }
        });

        Object.keys(messagesDatabase).forEach(room => {
            if (room.includes(sessionUser)) {
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

    // Редагування профілю
    socket.on('update_profile', (data) => {
        if (!sessionUser || !data) return;
        if (!userProfiles[sessionUser]) userProfiles[sessionUser] = { chatList: [] };
        
        const profileData = data.data || data;
        userProfiles[sessionUser].displayName = profileData.displayName || sessionUser;
        userProfiles[sessionUser].bio = profileData.bio || '';
        userProfiles[sessionUser].avatar = profileData.avatar || ''; 
      
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

        if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = [];
        messagesDatabase[msg.room].push(msg);

        if (!userProfiles[msg.from]) userProfiles[msg.from] = { chatList: [] };
        if (!userProfiles[msg.to]) userProfiles[msg.to] = { chatList: [] };
        if (!userProfiles[msg.from].chatList) userProfiles[msg.from].chatList = [];
        if (!userProfiles[msg.to].chatList) userProfiles[msg.to].chatList = [];

        if (!userProfiles[msg.from].chatList.includes(msg.to)) userProfiles[msg.from].chatList.push(msg.to);
        if (!userProfiles[msg.to].chatList.includes(msg.from)) userProfiles[msg.to].chatList.push(msg.from);

        saveDatabase();

        io.emit('profile_broadcast', { username: msg.from, data: userProfiles[msg.from] });
        io.emit('profile_broadcast', { username: msg.to, data: userProfiles[msg.to] });
        
        const targetSocketId = activeConnections[msg.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('restore_chats', userProfiles[msg.to].chatList);
            io.to(targetSocketId).emit('chat_message', msg);
        }
        socket.to(msg.room).emit('chat_message', msg);
    });

    socket.on('typing', (data) => {
        if (data && data.room) socket.to(data.room).emit('typing', data);
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

    socket.on('clear_history', (data) => {
        if (!data || !data.room) return;
        if (messagesDatabase[data.room]) {
            messagesDatabase[data.room] = [];
            saveDatabase();
        }
        socket.to(data.room).emit('clear_history', data);
    });

    socket.on('disconnect', () => {
        if (sessionUser) {
            delete activeConnections[sessionUser];
            io.emit('online_list', Object.keys(activeConnections));
        }
    });
});

server.listen(PORT, () => console.log(`=== Фінальний сервер BurmaldaGram запущено на порту ${PORT} ===`));

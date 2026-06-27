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
const ALLOW_VOICE_EFFECTS = false; // Якщо FALSE — сервер повністю блокує та вирізає зміну голосу

// Посилання на розгорнутий Google Apps Script
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzXBhB0gUudmya00QTzlsYPsxTTPlds04wbN7te0555w3RTvseg3YMYlRENJasaXHFNRg/exec";

// Дані для стабільних WebRTC дзвінків від Metered.ca (вирішує проблему "лише на одному Wi-Fi")
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
let groupsDatabase = {}; // Нова БД для груп та каналів
let activeConnections = {};
const userRateLimits = {};

// --- ЗАВАНТАЖЕННЯ БАЗИ ДАНИХ ---
function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const rawData = fs.readFileSync(DB_FILE, 'utf8');
            if (rawData.trim()) {
                const parsed = JSON.parse(rawData);
                messagesDatabase = parsed.messagesDatabase || {};
                userProfiles = parsed.userProfiles || {};
                groupsDatabase = parsed.groupsDatabase || {};
                
                if (!messagesDatabase.scheduled) messagesDatabase.scheduled = [];
                console.log(`[БД] Успішно завантажено. Користувачів: ${Object.keys(userProfiles).length}, Груп: ${Object.keys(groupsDatabase).length}`);
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
        const dataToSave = { messagesDatabase, userProfiles, groupsDatabase };
        fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
    } catch (err) {
        console.error('[БД] Помилка запису на диск:', err.message);
    }
}

loadDatabase();

app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

// --- ВІДКЛАДЕНІ ПОВІДОМЛЕННЯ ---
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
                    if (!userProfiles[user]) userProfiles[user] = { chatList: [], archivedChats: [], displayName: user };
                    if (!userProfiles[user].chatList.includes(msg.room)) {
                        userProfiles[user].chatList.push(msg.room);
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

// --- РОБОТА З СОКЕТАМИ ---
io.on('connection', (socket) => {
    let sessionUser = null;

    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        sessionUser = data.username;
        activeConnections[sessionUser] = socket.id;

        if (!userProfiles[sessionUser]) {
            userProfiles[sessionUser] = { chatList: [], archivedChats: [], displayName: sessionUser, bio: '', avatar: '', banner: '', glowColor: 'blue', lastSeen: Date.now() };
        }
        userProfiles[sessionUser].lastSeen = Date.now(); 

        saveDatabase();

        io.emit('online_list', Object.keys(activeConnections));
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);
        socket.emit('rtc_config', METERED_RTC_CONFIG);

        Object.keys(userProfiles).forEach(username => {
            socket.emit('profile_broadcast', { username, data: userProfiles[username] });
        });
    });

    // ==========================================
    // НАДІЙНА МАРШРУТИЗАЦІЯ WEBRTC (ДЛЯ ДЗВІНКІВ НА ВІДСТАНІ)
    // ==========================================
    socket.on('webrtc_signal', (data) => {
        if (!data || !data.target || !sessionUser) return;
        const targetSocketId = activeConnections[data.target];
        if (targetSocketId) {
            // Пересилаємо ICE-кандидати та SDP описи без змін
            io.to(targetSocketId).emit('webrtc_signal', { 
                ...data, 
                sender: sessionUser 
            });
        }
    });

    // ==========================================
    // ЛОГІКА ГРУП ТА КАНАЛІВ
    // ==========================================
    socket.on('create_group', (data) => {
        if (!sessionUser || !data.groupId || !data.type) return;
        
        groupsDatabase[data.groupId] = {
            id: data.groupId,
            name: data.name || 'Нова група',
            type: data.type, // 'group' або 'channel'
            members: {
                [sessionUser]: { role: 'owner' } // Ролі: owner, admin, senior_mod, junior_mod, member
            },
            banned: [],
            createdAt: Date.now()
        };
        
        if (!userProfiles[sessionUser].chatList.includes(data.groupId)) {
            userProfiles[sessionUser].chatList.push(data.groupId);
        }
        
        saveDatabase();
        socket.emit('group_created', groupsDatabase[data.groupId]);
    });

    socket.on('update_group_role', (data) => {
        if (!sessionUser || !data.groupId || !data.targetUser || !data.newRole) return;
        const group = groupsDatabase[data.groupId];
        
        if (group && group.members[sessionUser]) {
            const myRole = group.members[sessionUser].role;
            // Тільки власники та адміни можуть змінювати ролі
            if (myRole === 'owner' || (myRole === 'admin' && data.newRole !== 'owner')) {
                if (!group.members[data.targetUser]) {
                    group.members[data.targetUser] = { role: data.newRole };
                } else {
                    group.members[data.targetUser].role = data.newRole;
                }
                saveDatabase();
                io.to(data.groupId).emit('group_updated', group);
            }
        }
    });

    // ==========================================
    // ОБРОБКА ПОВІДОМЛЕНЬ
    // ==========================================
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

        // --- КОНТРОЛЬ ЗМІНИ ГОЛОСУ ---
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

        // Автовидалення
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
        const isGroup = !!groupsDatabase[msg.room];
        
        if (!isGroup && msg.to) {
            [msg.from, msg.to].forEach(user => {
                if (!userProfiles[user]) userProfiles[user] = { chatList: [] };
                const partner = user === msg.from ? msg.to : msg.from;
                if (!userProfiles[user].chatList.includes(partner)) {
                    userProfiles[user].chatList.push(partner);
                }
            });
            
            const targetSocketId = activeConnections[msg.to];
            if (targetSocketId) {
                io.to(targetSocketId).emit('restore_chats', userProfiles[msg.to].chatList);
                io.to(targetSocketId).emit('chat_message', msg);
            }
        }

        saveDatabase();
        socket.to(msg.room).emit('chat_message', msg);
    });

    // Усі інші стандартні події (typing, check_user_exists, search_users) залишаються без змін
    socket.on('check_user_exists', async (data) => {
        // Твоя логіка з fetch до GOOGLE_SCRIPT_URL
        if (!data || !data.username) return;
        let exists = !!userProfiles[data.username];
        let profile = exists ? userProfiles[data.username] : null;

        if (!exists && GOOGLE_SCRIPT_URL.startsWith('http')) {
            try {
                const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=check&username=${encodeURIComponent(data.username)}`);
                if (res.ok) {
                    const gasData = await res.json();
                    if (gasData.exists) {
                        exists = true;
                        profile = gasData.profile || { displayName: data.username, avatar: '', bio: '' };
                        userProfiles[data.username] = { chatList: [], ...profile };
                        saveDatabase();
                    }
                }
            } catch (err) {
                console.error("Помилка запиту до Google Script:", err);
            }
        }

        socket.emit('user_exists_result', { username: data.username, exists, profile });
    });

    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);
        const pinnedKey = data.room + '_pinned';
        if (messagesDatabase[pinnedKey] && messagesDatabase[pinnedKey].length > 0) {
            socket.emit('pin_message', { room: data.room, pinned: messagesDatabase[pinnedKey] });
        }
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

server.listen(PORT, () => console.log(`=== Сервер Burmalda Messenger запущено на порту ${PORT} ===`));

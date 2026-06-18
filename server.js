const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Максимальний ліміт для кружечків та фото (100MB)
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

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
                console.log(`[БД] База успішно завантажена. Користувачів: ${Object.keys(userProfiles).length}`);
            }
        }
    } catch (e) {
        console.error('[БД] Помилка завантаження:', e.message);
    }
}

// --- СИНХРОННО-АСИНХРОННЕ ЗБЕРЕЖЕННЯ (БЕЗ ЗАВИСАНЬ) ---
function saveDatabase() {
    const dataToSave = { messagesDatabase, userProfiles };
    // Використовуємо звичайний writeFile, щоб сервер на Render не "падав" під час листування
    fs.writeFile(DB_FILE, JSON.stringify(dataToSave), 'utf8', (err) => {
        if (err) console.error('[БД] Помилка запису файлу:', err.message);
    });
}

loadDatabase();

app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));

io.on('connection', (socket) => {
    let sessionUser = null;

    // Вхід користувача в мережу
    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        sessionUser = data.username;
        activeConnections[sessionUser] = socket.id;

        if (!userProfiles[sessionUser]) {
            userProfiles[sessionUser] = { chatList: [], displayName: sessionUser, bio: '', avatar: '' };
        }
        if (!userProfiles[sessionUser].chatList) userProfiles[sessionUser].chatList = [];

        saveDatabase();

        // Повідомляємо всіх про статус онлайн
        io.emit('online_list', Object.keys(activeConnections));
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);

        // Передаємо ПОВНІ профілі (з аватарками), щоб у фронтенда не було затримок із відображенням
        Object.keys(userProfiles).forEach(username => {
            socket.emit('profile_broadcast', { username, data: userProfiles[username] });
        });
    });

    // Окремий запит профілю (про всяк випадок, якщо фронтенд його смикає)
    socket.on('request_profile', (data) => {
        if (!data || !data.username) return;
        const uProfile = userProfiles[data.username];
        if (uProfile) {
            socket.emit('profile_broadcast', { username: data.username, data: uProfile });
        }
    });

    // Перевірка існування користувача
    socket.on('check_user_exists', (data) => {
        if (!data || !data.username) return;
        const uProfile = userProfiles[data.username];
        const exists = !!uProfile;
        socket.emit('user_exists_result', { 
            username: data.username, 
            exists,
            profile: exists ? {
                displayName: uProfile.displayName || data.username,
                avatar: uProfile.avatar || '',
                bio: uProfile.bio || ''
            } : null
        });
    });

    // СТАРТИЙ ЛОКАЛЬНИЙ ПОШУК (Повертаємо так, як очікує твій файл 17)
    socket.on('search_users', (data) => {
        if (!data || !data.query) return;
        const query = data.query.toLowerCase().trim();
        const results = [];
        
        Object.keys(userProfiles).forEach(username => {
            const p = userProfiles[username] || {};
            const dName = (p.displayName || '').toLowerCase();
            if (username.toLowerCase().includes(query) || dName.includes(query)) {
                results.push({
                    username: username,
                    displayName: p.displayName || username,
                    avatar: p.avatar || '',
                    bio: p.bio || ''
                });
            }
        });
        socket.emit('search_results', { query: data.query, results });
    });

    // Оновлення особистого профілю
    socket.on('update_profile', (data) => {
        if (!sessionUser || !data) return;
        if (!userProfiles[sessionUser]) userProfiles[sessionUser] = { chatList: [] };
        
        const profileData = data.data || data;
        userProfiles[sessionUser].displayName = profileData.displayName || sessionUser;
        userProfiles[sessionUser].bio = profileData.bio || '';
        userProfiles[sessionUser].avatar = profileData.avatar || ''; 
        
        saveDatabase();
        
        // Одразу бродкастимо всім оновлені дані, щоб аватарка змінилася миттєво
        io.emit('profile_broadcast', { username: sessionUser, data: userProfiles[sessionUser] });
    });

    // === ПЕРЕВІРЕНИЙ ФІКС ДЗВІНКІВ (WebRTC) ===
    socket.on('webrtc_signal', (data) => {
        if (!data || !data.target) return;
        const targetSocketId = activeConnections[data.target];
        if (targetSocketId) {
            // Передаємо пакет СУВОРО у первісному вигляді, без додавання зайвих полів, щоб WebRTC на фронті не падав
            io.to(targetSocketId).emit('webrtc_signal', data);
        }
    });

    // Вхід в кімнату чату
    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);
        const pinnedKey = data.room + '_pinned';
        if (messagesDatabase[pinnedKey] && messagesDatabase[pinnedKey].length > 0) {
            socket.emit('pin_message', { room: data.room, pinned: messagesDatabase[pinnedKey] });
        }
    });

    // Історія чату
    socket.on('request_history', (data) => {
        if (!data || !data.room) return;
        socket.emit('room_history', messagesDatabase[data.room] || []);
    });

    // Надсилання повідомлення
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

        // Оновлюємо списки чатів у клієнтів
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

    // Обробка закріплень повідомлень
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

    socket.on('disconnect', () => {
        if (sessionUser) {
            delete activeConnections[sessionUser];
            io.emit('online_list', Object.keys(activeConnections));
        }
    });
});

server.listen(PORT, () => console.log(`=== Запущено залізобетонну версію BurmaldaGram на порту ${PORT} ===`));

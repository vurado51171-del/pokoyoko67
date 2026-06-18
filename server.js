const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Максимальний ліміт пакетів (100MB) для великих аватарок та кружків
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

let userProfiles = {};
let messagesDatabase = {};
let activeConnections = {}; 

// --- ШВИДКОДІЙНЕ АСИНХРОННЕ ЗАВАНТАЖЕННЯ БД ---
function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const rawData = fs.readFileSync(DB_FILE, 'utf8');
            if (rawData.trim()) {
                const parsed = JSON.parse(rawData);
                messagesDatabase = parsed.messagesDatabase || {};
                userProfiles = parsed.userProfiles || {};
                console.log(`[БД] Успішно завантажено. Профілів: ${Object.keys(userProfiles).length}`);
            }
        }
    } catch (e) {
        console.error('[БД] Помилка читання, спроба відновити з .tmp...', e.message);
        try {
            const tmpFile = DB_FILE + '.tmp';
            if (fs.existsSync(tmpFile)) {
                const parsed = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
                messagesDatabase = parsed.messagesDatabase || {};
                userProfiles = parsed.userProfiles || {};
                console.log('[БД] Відновлено з резервної копії .tmp');
            }
        } catch (err) {
            console.error('[КРИТ] Не вдалося прочитати базу:', err.message);
        }
    }
}

// ПОВНІСТЮ АСИНХРОННЕ НЕБЛОКУЮЧЕ ЗБЕРЕЖЕННЯ (Сервер більше не висне через аватарки!)
let isSaving = false;
let saveQueued = false;

function saveDatabase() {
    if (isSaving) {
        saveQueued = true;
        return;
    }
    isSaving = true;

    const dataToSave = { messagesDatabase, userProfiles };
    const tempFile = DB_FILE + '.tmp';

    // Фоновий асинхронний запис, який не зупиняє роботу Node.js
    fs.writeFile(tempFile, JSON.stringify(dataToSave), 'utf8', (err) => {
        if (err) {
            console.error('[БД] Помилка фонового запису:', err.message);
            isSaving = false;
            return;
        }
        
        // Атомарна швидка підміна файлу
        fs.rename(tempFile, DB_FILE, (renameErr) => {
            isSaving = false;
            if (renameErr) {
                console.error('[БД] Помилка перейменування:', renameErr.message);
            }
            if (saveQueued) {
                saveQueued = false;
                saveDatabase();
            }
        });
    });
}

loadDatabase();

app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));

io.on('connection', (socket) => {
    let sessionUser = null;

    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        sessionUser = data.username;
        activeConnections[sessionUser] = socket.id;

        let isChanged = false;
        if (!userProfiles[sessionUser]) {
            userProfiles[sessionUser] = { chatList: [], displayName: sessionUser, bio: '', avatar: '' };
            isChanged = true;
        }
        if (!userProfiles[sessionUser].chatList) { userProfiles[sessionUser].chatList = []; isChanged = true; }
        if (!userProfiles[sessionUser].avatar) { userProfiles[sessionUser].avatar = ''; isChanged = true; }

        if (isChanged) saveDatabase();

        io.emit('online_list', Object.keys(activeConnections));
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);

        // Передача профілів
        Object.keys(userProfiles).forEach(username => {
            socket.emit('profile_broadcast', { username, data: userProfiles[username] });
        });
    });

    socket.on('request_profile', (data) => {
        if (!data || !data.username) return;
        const uProfile = userProfiles[data.username];
        if (uProfile) {
            socket.emit('profile_broadcast', { username: data.username, data: uProfile });
        }
    });

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

    // МИТТЄВИЙ ПОШУК (Оптимізовано)
    socket.on('search_users', (data) => {
        if (!data || !data.query) return;
        const query = data.query.toLowerCase().trim();
        
        if (!query) {
            socket.emit('search_results', { query: data.query, results: [] });
            return;
        }

        const results = [];
        const keys = Object.keys(userProfiles);
        
        for (let i = 0; i < keys.length; i++) {
            const username = keys[i];
            const profile = userProfiles[username] || {};
            const displayName = (profile.displayName || '').toLowerCase();
            
            if (username.toLowerCase().includes(query) || displayName.includes(query)) {
                results.push({
                    username: username,
                    displayName: profile.displayName || username,
                    avatar: profile.avatar || '',
                    bio: profile.bio || ''
                });
            }
        }
        socket.emit('search_results', { query: data.query, results });
    });

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

        if (!userProfiles[msg.from]) userProfiles[msg.from] = { chatList: [], displayName: msg.from, bio: '', avatar: '' };
        if (!userProfiles[msg.to]) userProfiles[msg.to] = { chatList: [], displayName: msg.to, bio: '', avatar: '' };

        if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = [];
        messagesDatabase[msg.room].push(msg);

        if (!userProfiles[msg.from].chatList.includes(msg.to)) userProfiles[msg.from].chatList.push(msg.to);
        if (!userProfiles[msg.to].chatList.includes(msg.from)) userProfiles[msg.to].chatList.push(msg.from);

        saveDatabase();

        io.emit('profile_broadcast', { username: msg.from, data: userProfiles[msg.from] });
        io.emit('profile_broadcast', { username: msg.to, data: userProfiles[msg.to] });

        const targetSocketId = activeConnections[msg.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('restore_chats', userProfiles[msg.to].chatList);
            const targetSocketInstance = io.sockets.sockets.get(targetSocketId);
            const isAlreadyInRoom = targetSocketInstance && targetSocketInstance.rooms.has(msg.room);

            if (!isAlreadyInRoom) {
                io.to(targetSocketId).emit('chat_message', msg);
            }
        }
        socket.to(msg.room).emit('chat_message', msg);
    });

    socket.on('typing', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('typing', data);
    });

    socket.on('sync_chat_list', (data) => {
        if (sessionUser && data && data.chatList) {
            if (!userProfiles[sessionUser]) userProfiles[sessionUser] = { chatList: [] };
            userProfiles[sessionUser].chatList = data.chatList;
            saveDatabase();
        }
    });

    socket.on('webrtc_signal', (data) => {
        if (!data || !data.target) return;
        const targetSocketId = activeConnections[data.target];
        if (targetSocketId) io.to(targetSocketId).emit('webrtc_signal', data);
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

    // === ЗАЛІЗОБЕТОННІ ЗАКРІПЛЕННЯ (Універсальний фікс) ===
    socket.on('pin_message', (data) => {
        if (!data || !data.room) return;
        const pinnedKey = data.room + '_pinned';
        
        if (!messagesDatabase[pinnedKey]) messagesDatabase[pinnedKey] = [];

        // Визначаємо дію (додати чи видалити)
        if (data.action === 'remove') {
            // Шукаємо ID будь-яким можливим способом з пакету клієнта
            const targetId = data.msgId || (data.pinData ? data.pinData.id : null) || (data.msg ? data.msg.id : null);
            if (targetId) {
                messagesDatabase[pinnedKey] = messagesDatabase[pinnedKey].filter(p => p.id !== targetId);
            }
        } else if (data.action === 'add') {
            // Приймаємо об'єкт повідомлення як з поля msg, так і з pinData
            const activeMsg = data.msg || data.pinData;
            if (activeMsg && !messagesDatabase[pinnedKey].some(p => p.id === activeMsg.id)) {
                messagesDatabase[pinnedKey].push(activeMsg);
            }
        } else if (data.pinned) {
            messagesDatabase[pinnedKey] = data.pinned;
        }

        saveDatabase();
        // Разом з кімнатою оновлюємо глобально всіх у ній
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

server.listen(PORT, () => {
    console.log(`=== Швидкісний сервер запущено на порту ${PORT} ===`);
});

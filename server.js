const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Оптимальний ліміт для передачі медіа (50MB)
const io = new Server(server, { maxHttpBufferSize: 5e7 });
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

let userProfiles = {};
let messagesDatabase = {};
let activeConnections = {}; 

// --- АСИНХРОННЕ ЗАВАНТАЖЕННЯ БД ---
function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const rawData = fs.readFileSync(DB_FILE, 'utf8');
            if (rawData.trim()) {
                const parsed = JSON.parse(rawData);
                messagesDatabase = parsed.messagesDatabase || {};
                userProfiles = parsed.userProfiles || {};
                console.log(`[БД] База успішно завантажена. Юзерів: ${Object.keys(userProfiles).length}`);
            }
        }
    } catch (e) {
        console.error('[БД] Помилка читання:', e.message);
    }
}

// ОПТИМІЗОВАНЕ ФОНОВЕ ЗБЕРЕЖЕННЯ
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

    fs.writeFile(tempFile, JSON.stringify(dataToSave), 'utf8', (err) => {
        if (err) {
            isSaving = false;
            return;
        }
        fs.rename(tempFile, DB_FILE, () => {
            isSaving = false;
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
        
        if (isChanged) saveDatabase();

        // Сповіщаємо всіх про оновлення списку онлайн
        io.emit('online_list', Object.keys(activeConnections));
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);

        // ВИПРАВЛЕННЯ ДЛЯ ПОШУКУ ТА ДЗВІНКІВ:
        // Розсилаємо профілі УСІХ користувачів, але БЕЗ важких аватарок, щоб клієнт знав, хто є в базі
        Object.keys(userProfiles).forEach(username => {
            const p = userProfiles[username];
            io.emit('profile_broadcast', { 
                username, 
                data: { 
                    displayName: p.displayName || username, 
                    bio: p.bio || '', 
                    chatList: p.chatList || [],
                    avatar: p.avatar ? "HAS_AVATAR" : "" // Прапорець наявності, замість мегабайтного тексту
                } 
            });
        });
    });

    // Окремий запит ПОВНОГО профілю (разом із аватаркою) — викликається клієнтом при відкритті чату
    socket.on('request_profile', (data) => {
        if (!data || !data.username) return;
        const uProfile = userProfiles[data.username];
        if (uProfile) {
            socket.emit('profile_broadcast', { username: data.username, data: uProfile });
        }
    });

    // МОМЕНТАЛЬНИЙ ПОШУК З ПІДКАЗКАМИ
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

    // ГЛОБАЛЬНИЙ ПОШУК (ЛЮДИ + ТЕКСТ ПОВІДОМЛЕНЬ)
    socket.on('global_search', (data) => {
        if (!data || !data.query || !sessionUser) return;
        const query = data.query.toLowerCase().trim();
        
        const foundUsers = [];
        const foundMessages = [];

        Object.keys(userProfiles).forEach(username => {
            const p = userProfiles[username] || {};
            const dName = (p.displayName || '').toLowerCase();
            if (username.toLowerCase().includes(query) || dName.includes(query)) {
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
                    if (msg && msg.text && msg.text.toLowerCase().includes(query)) {
                        const partner = msg.from === sessionUser ? msg.to : msg.from;
                        foundMessages.push({
                            id: msg.id,
                            room: room,
                            partner: partner,
                            from: msg.from,
                            text: msg.text,
                            timestamp: msg.timestamp
                        });
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
        
        saveDatabase();
        
        // Одразу надсилаємо всім оновлений профіль (тут з аватаркою, бо це один юзер)
        io.emit('profile_broadcast', { username: sessionUser, data: userProfiles[sessionUser] });
    });

    // === ФІКС ДЗВІНКІВ (WebRTC сигнали) ===
    socket.on('webrtc_signal', (data) => {
        if (!data || !data.target) return;
        const targetSocketId = activeConnections[data.target];
        if (targetSocketId) {
            // Перенаправляємо сигнал (оффер, ансер або айс-кандидат) конкретному отримувачу
            io.to(targetSocketId).emit('webrtc_signal', {
                ...data,
                sender: sessionUser // Обов'язково додаємо, хто дзвонить
            });
        }
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

        if (!userProfiles[msg.from].chatList.includes(msg.to)) userProfiles[msg.from].chatList.push(msg.to);
        if (!userProfiles[msg.to].chatList.includes(msg.from)) userProfiles[msg.to].chatList.push(msg.from);

        saveDatabase();

        const targetSocketId = activeConnections[msg.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('restore_chats', userProfiles[msg.to].chatList);
            io.to(targetSocketId).emit('chat_message', msg);
        }
        socket.to(msg.room).emit('chat_message', msg);
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

    socket.on('typing', (data) => {
        if (data && data.room) socket.to(data.room).emit('typing', data);
    });

    socket.on('mark_read', (data) => {
        if (!data || !data.room || !data.reader) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            messagesDatabase[data.room].forEach(m => { if (m && m.from !== data.reader) m.status = 'read'; });
            saveDatabase();
        }
        socket.to(data.room).emit('messages_read', data);
    });

    socket.on('disconnect', () => {
        if (sessionUser) {
            delete activeConnections[sessionUser];
            io.emit('online_list', Object.keys(activeConnections));
        }
    });
});

server.listen(PORT, () => console.log(`=== Фінальний оптимізований сервер BurmaldaGram на порту ${PORT} ===`));

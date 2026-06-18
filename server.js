const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Ліміт 100MB для кружків, фото та аватарок
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

let userProfiles = {};
let messagesDatabase = {};
let activeConnections = {}; 

// --- НАДІЙНЕ ЗАВАНТАЖЕННЯ БАЗИ ДАНИХ ---
function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const rawData = fs.readFileSync(DB_FILE, 'utf8');
            if (rawData.trim()) {
                const parsed = JSON.parse(rawData);
                messagesDatabase = parsed.messagesDatabase || {};
                userProfiles = parsed.userProfiles || {};
                console.log(`[БД] Успішно завантажено. Користувачів в базі: ${Object.keys(userProfiles).length}`);
            }
        }
    } catch (e) {
        console.error('[БД] Помилка при завантаженні бази даних:', e.message);
    }
}

// --- ШВИДКЕ АСИНХРОННЕ ЗБЕРЕЖЕННЯ (БЕЗ ЛАГІВ ТА ЗАВИСАНЬ) ---
function saveDatabase() {
    try {
        const dataToSave = { messagesDatabase, userProfiles };
        // fs.writeFile працює у фоні і не зупиняє роботу чату ні на мілісекунду
        fs.writeFile(DB_FILE, JSON.stringify(dataToSave), 'utf8', (err) => {
            if (err) {
                console.error('[БД] Помилка фонового запису на диск:', err.message);
            }
        });
    } catch (e) {
        console.error('[БД] Помилка серіалізації JSON:', e.message);
    }
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

        let isChanged = false;
        if (!userProfiles[sessionUser]) {
            userProfiles[sessionUser] = { chatList: [], displayName: sessionUser, bio: '', avatar: '' };
            isChanged = true;
        }
        if (!userProfiles[sessionUser].chatList) { 
            userProfiles[sessionUser].chatList = []; 
            isChanged = true; 
        }
        
        if (isChanged) saveDatabase();

        // Надсилаємо оновлений список онлайн усім
        io.emit('online_list', Object.keys(activeConnections));
        // Відновлюємо список чатів для користувача
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);

        // Повертаємо оригінальну повну розсилку профілів (щоб працювали аватарки та дзвінки)
        Object.keys(userProfiles).forEach(username => {
            io.emit('profile_broadcast', { username, data: userProfiles[username] });
        });
    });

    // Запит профілю
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

    // Швидкий пошук користувачів для підказок
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

    // Новий Глобальний пошук (Люди + Повідомлення)
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

    // Оновлення особистого профілю (Аватарка, Біо, Нікнейм)
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

    // --- ЗАЛІЗОБЕТОННІ WebRTC ДЗВІНКИ ---
    socket.on('webrtc_signal', (data) => {
        if (!data || !data.target) return;
        const targetSocketId = activeConnections[data.target];
        if (targetSocketId) {
            // Пересилаємо точний сокет-пакет отримувачу без змін структури
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

    // Запит історії повідомлень
    socket.on('request_history', (data) => {
        if (!data || !data.room) return;
        socket.emit('room_history', messagesDatabase[data.room] || []);
    });

    // Надсилання нового повідомлення
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

        // Оновлюємо профілі у всіх клієнтів, щоб синхронізувати списки
        io.emit('profile_broadcast', { username: msg.from, data: userProfiles[msg.from] });
        io.emit('profile_broadcast', { username: msg.to, data: userProfiles[msg.to] });

        const targetSocketId = activeConnections[msg.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('restore_chats', userProfiles[msg.to].chatList);
            io.to(targetSocketId).emit('chat_message', msg);
        }
        socket.to(msg.room).emit('chat_message', msg);
    });

    // Статус "Друкує..."
    socket.on('typing', (data) => {
        if (data && data.room) socket.to(data.room).emit('typing', data);
    });

    // Синхронізація списку чатів
    socket.on('sync_chat_list', (data) => {
        if (sessionUser && data && data.chatList) {
            if (!userProfiles[sessionUser]) userProfiles[sessionUser] = { chatList: [] };
            userProfiles[sessionUser].chatList = data.chatList;
            saveDatabase();
        }
    });

    // Позначити як прочитане
    socket.on('mark_read', (data) => {
        if (!data || !data.room || !data.reader) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            messagesDatabase[data.room].forEach(m => { if (m && m.from !== data.reader) m.status = 'read'; });
            saveDatabase();
        }
        socket.to(data.room).emit('messages_read', data);
    });

    // Редагування повідомлення
    socket.on('edit_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            const msg = messagesDatabase[data.room].find(m => m && m.id === data.msgId);
            if (msg) { msg.text = data.newText; msg.edited = true; saveDatabase(); }
        }
        socket.to(data.room).emit('edit_message', data);
    });

    // Видалення повідомлення
    socket.on('delete_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            messagesDatabase[data.room] = messagesDatabase[data.room].filter(m => m && m.id !== data.msgId);
            saveDatabase();
        }
        socket.to(data.room).emit('delete_message', data);
    });

    // Реакції на повідомлення
    socket.on('message_reaction', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            const msg = messagesDatabase[data.room].find(m => m && m.id === data.msgId);
            if (msg) { msg.reactions = data.reactions || {}; saveDatabase(); }
        }
        socket.to(data.room).emit('message_reaction', data);
    });

    // Закріплення та відкріплення повідомлень
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

    // Очищення історії чату
    socket.on('clear_history', (data) => {
        if (!data || !data.room) return;
        if (messagesDatabase[data.room]) {
            messagesDatabase[data.room] = [];
            saveDatabase();
        }
        socket.to(data.room).emit('clear_history', data);
    });

    // Відключення користувача
    socket.on('disconnect', () => {
        if (sessionUser) {
            delete activeConnections[sessionUser];
            io.emit('online_list', Object.keys(activeConnections));
        }
    });
});

server.listen(PORT, () => console.log(`=== Стабільний сервер BurmaldaGram запущено на порту ${PORT} ===`));

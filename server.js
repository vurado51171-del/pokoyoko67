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

// --- СЮДИ ВСТАВ ПОСИЛАННЯ З GOOGLE APPS SCRIPT ---
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxE_OSiBrSYlcNLCsp9W6pKP80x7IClsOVz2yvruKDpY4wECMgK76x5dLFdVoqvq06DvA/exec"; 

let userProfiles = {};
let messagesDatabase = {};
let activeConnections = {}; 

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

function saveDatabase() {
    try {
        const dataToSave = { messagesDatabase, userProfiles };
        fs.writeFile(DB_FILE, JSON.stringify(dataToSave), 'utf8', (err) => {
            if (err) console.error('[БД] Помилка фонового запису на диск:', err.message);
        });
    } catch (e) {
        console.error('[БД] Помилка серіалізації JSON:', e.message);
    }
}

// --- БЕЗПЕЧНА ІНІЦІАЛІЗАЦІЯ ПРОФІЛЮ (Щоб не стирало аватарки) ---
function initProfile(username) {
    if (!username) return false;
    let changed = false;
    if (!userProfiles[username]) {
        userProfiles[username] = { chatList: [], displayName: username, bio: '', avatar: '' };
        changed = true;
    }
    // Відновлення полів, якщо вони якось затерлись
    if (typeof userProfiles[username].avatar === 'undefined') { userProfiles[username].avatar = ''; changed = true; }
    if (typeof userProfiles[username].displayName === 'undefined') { userProfiles[username].displayName = username; changed = true; }
    if (typeof userProfiles[username].bio === 'undefined') { userProfiles[username].bio = ''; changed = true; }
    if (!userProfiles[username].chatList) { userProfiles[username].chatList = []; changed = true; }
    
    return changed;
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

        const isChanged = initProfile(sessionUser);
        if (isChanged) saveDatabase();

        io.emit('online_list', Object.keys(activeConnections));
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);

        Object.keys(userProfiles).forEach(username => {
            io.emit('profile_broadcast', { username, data: userProfiles[username] });
        });
    });

    socket.on('request_profile', (data) => {
        if (!data || !data.username) return;
        const uProfile = userProfiles[data.username];
        if (uProfile) {
            socket.emit('profile_broadcast', { username: data.username, data: uProfile });
        }
    });

    // --- РОЗУМНИЙ ПОШУК (Локально + Google Sheets через Apps Script) ---
    socket.on('search_users', async (data) => {
        if (!data || typeof data.query !== 'string') return;
        const query = data.query.toLowerCase().trim();
        
        const results = [];
        const seenUsernames = new Set();

        Object.keys(userProfiles).forEach(username => {
            const p = userProfiles[username] || {};
            const dName = (p.displayName || '').toLowerCase();
            if (username.toLowerCase().includes(query) || dName.includes(query)) {
                results.push({
                    username: username,
                    displayName: p.displayName || username,
                    avatar: p.avatar || '',
                    bio: p.bio || '',
                    isOnline: !!activeConnections[username]
                });
                seenUsernames.add(username.toLowerCase());
            }
        });

        socket.emit('search_results', { query: data.query, results });

        if (GAS_WEB_APP_URL && GAS_WEB_APP_URL.startsWith("http")) {
            try {
                const response = await fetch(GAS_WEB_APP_URL, {
                    method: 'POST',
                    body: JSON.stringify({ action: 'search_users', query: query }),
                    headers: { 'Content-Type': 'application/json' }
                });
                const gasData = await response.json();
                
                if (gasData.status === 'success' && gasData.data) {
                    let hasNew = false;
                    gasData.data.forEach(user => {
                        if (!seenUsernames.has(user.username.toLowerCase())) {
                            results.push({
                                username: user.username,
                                displayName: user.displayName,
                                avatar: '',
                                bio: 'Знайдено в базі',
                                isOnline: false
                            });
                            seenUsernames.add(user.username.toLowerCase());
                            hasNew = true;
                        }
                    });
                    
                    if (hasNew) {
                        socket.emit('search_results', { query: data.query, results });
                    }
                }
            } catch (err) {
                console.error('[GAS Search] Помилка:', err.message);
            }
        }
    });

    // --- ПЕРЕВІРКА ІСНУВАННЯ КОРИСТУВАЧА ---
    socket.on('check_user_exists', async (data) => {
        if (!data || !data.username) return;
        const target = data.username.toLowerCase().trim();
        
        const localMatch = Object.keys(userProfiles).find(u => u.toLowerCase() === target);
        if (localMatch) {
            const uProfile = userProfiles[localMatch];
            socket.emit('user_exists_result', { 
                username: localMatch, 
                exists: true,
                profile: { displayName: uProfile.displayName || localMatch, avatar: uProfile.avatar || '', bio: uProfile.bio || '' }
            });
            return;
        }

        if (GAS_WEB_APP_URL && GAS_WEB_APP_URL.startsWith("http")) {
            try {
                const response = await fetch(GAS_WEB_APP_URL, {
                    method: 'POST',
                    body: JSON.stringify({ action: 'check_user', targetUser: target }),
                    headers: { 'Content-Type': 'application/json' }
                });
                const gasData = await response.json();

                if (gasData.status === 'success' && gasData.exists) {
                    socket.emit('user_exists_result', { 
                        username: gasData.username || data.username, 
                        exists: true,
                        profile: { displayName: gasData.username || data.username, avatar: '', bio: '' }
                    });
                    return;
                }
            } catch (err) {
                console.error('[GAS Check] Помилка:', err.message);
            }
        }

        socket.emit('user_exists_result', { username: data.username, exists: false, profile: null });
    });

    // --- БЕЗПЕЧНЕ ОНОВЛЕННЯ ПРОФІЛЮ ---
    socket.on('update_profile', (data) => {
        if (!sessionUser || !data) return;
        initProfile(sessionUser); // Захист структури
        
        const profileData = data.data || data;
        
        // Зберігаємо тільки те, що реально прийшло, не затираючи пустими рядками
        if (profileData.displayName !== undefined) userProfiles[sessionUser].displayName = profileData.displayName || sessionUser;
        if (profileData.bio !== undefined) userProfiles[sessionUser].bio = profileData.bio;
        if (profileData.avatar !== undefined) userProfiles[sessionUser].avatar = profileData.avatar; 
        
        saveDatabase();
        io.emit('profile_broadcast', { username: sessionUser, data: userProfiles[sessionUser] });
    });

    // Глобальний пошук (повідомлення)
    socket.on('global_search', (data) => {
        if (!data || !data.query || !sessionUser) return;
        const query = data.query.toLowerCase().trim();
        
        const foundUsers = [];
        const foundMessages = [];

        Object.keys(userProfiles).forEach(username => {
            const p = userProfiles[username] || {};
            const dName = (p.displayName || '').toLowerCase();
            if (username.toLowerCase().includes(query) || dName.includes(query)) {
                foundUsers.push({ username, displayName: p.displayName || username, avatar: p.avatar || '', bio: p.bio || '' });
            }
        });

        Object.keys(messagesDatabase).forEach(room => {
            if (room.includes(sessionUser)) {
                const roomMsgs = messagesDatabase[room] || [];
                roomMsgs.forEach(msg => {
                    if (msg && msg.text && msg.text.toLowerCase().includes(query)) {
                        const partner = msg.from === sessionUser ? msg.to : msg.from;
                        foundMessages.push({ id: msg.id, room: room, partner: partner, from: msg.from, text: msg.text, timestamp: msg.timestamp });
                    }
                });
            }
        });

        foundMessages.sort((a, b) => b.timestamp - a.timestamp);
        socket.emit('global_search_results', { query: data.query, users: foundUsers, messages: foundMessages });
    });

    // --- ЗАЛІЗОБЕТОННІ WebRTC ДЗВІНКИ ---
    socket.on('webrtc_signal', (data) => {
        if (!data || !data.target) return;
        const targetSocketId = activeConnections[data.target];
        if (targetSocketId) {
            io.to(targetSocketId).emit('webrtc_signal', data);
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

    // --- БЕЗПЕЧНЕ ВІДПРАВЛЕННЯ ПОВІДОМЛЕННЯ ---
    socket.on('chat_message', (msg) => {
        if (!msg || !msg.room || !msg.from || !msg.to) return;

        if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = [];
        messagesDatabase[msg.room].push(msg);

        initProfile(msg.from);
        initProfile(msg.to);

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
            initProfile(sessionUser);
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

server.listen(PORT, () => console.log(`=== Стабільний сервер BurmaldaGram запущено на порту ${PORT} ===`));

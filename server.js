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

// --- ГЛОБАЛЬНІ НАЛАШТУВАННЯ СЕРВЕРА ---
const ALLOW_VOICE_EFFECTS = true; // Якщо false — сервер повністю блокуватиме зміну голосу в аудіо повідомленнях

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

// --- НАДІЙНЕ ЗАВАНТАЖЕННЯ БАЗИ ---
function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const rawData = fs.readFileSync(DB_FILE, 'utf8');
            if (rawData.trim()) {
                const parsed = JSON.parse(rawData);
                messagesDatabase = parsed.messagesDatabase || {};
                userProfiles = parsed.userProfiles || {};
                
                // Перевірка наявності черги відкладених повідомлень
                if (!messagesDatabase.scheduled) messagesDatabase.scheduled = [];
                
                console.log(`[БД] Базу успішно завантажено. Користувачів у системі: ${Object.keys(userProfiles).length}`);
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

// --- ФОНОВЕ ЗБЕРЕЖЕННЯ ДАНИХ ---
function saveDatabase() {
    const dataToSave = { messagesDatabase, userProfiles };
    fs.writeFile(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf8', (err) => {
        if (err) console.error('[БД] Помилка запису на диск:', err.message);
    });
}

loadDatabase();

// Налаштування роутингу статичних файлів
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// Обробка головної сторінки (підтримка як index.html, так і chat.html)
const getChatPage = (req, res) => {
    if (fs.existsSync(path.join(__dirname, 'index.html'))) {
        res.sendFile(path.join(__dirname, 'index.html'));
    } else {
        res.sendFile(path.join(__dirname, 'chat.html'));
    }
};
app.get('/', getChatPage);
app.get('/chat', getChatPage);

// --- ПЕРЕВІРКА ТА ВІДПРАВКА ВІДКЛАДЕНИХ ПОВІДОМЛЕНЬ ЗА ТАЙМЕРОМ ---
setInterval(() => {
    const now = Date.now();
    if (messagesDatabase.scheduled && messagesDatabase.scheduled.length > 0) {
        const dueMessages = messagesDatabase.scheduled.filter(m => new Date(m.scheduledTime).getTime() <= now);
        
        if (dueMessages.length > 0) {
            // Залишаємо в черзі тільки майбутні повідомлення
            messagesDatabase.scheduled = messagesDatabase.scheduled.filter(m => new Date(m.scheduledTime).getTime() > now);
            
            dueMessages.forEach(msg => {
                // Видаляємо маркер планування перед збереженням в основну історію
                delete msg.scheduledTime;
                
                if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = [];
                messagesDatabase[msg.room].push(msg);

                // Оновлюємо списки чатів для обох сторін
                [msg.from, msg.to].forEach(user => {
                    if (!userProfiles[user]) userProfiles[user] = { chatList: [], displayName: user, bio: '', avatar: '' };
                    if (!userProfiles[user].chatList) userProfiles[user].chatList = [];
                    const partner = user === msg.from ? msg.to : msg.from;
                    if (!userProfiles[user].chatList.includes(partner)) {
                        userProfiles[user].chatList.push(partner);
                    }
                });

                // Надсилаємо повідомлення в кімнату
                io.to(msg.room).emit('chat_message', msg);
                
                // Оновлюємо інтерфейси користувачів, якщо вони в мережі
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
            userProfiles[sessionUser] = { chatList: [], displayName: sessionUser, bio: '', avatar: '', banner: '', glowColor: 'blue' };
        }
    
        if (!userProfiles[sessionUser].chatList) userProfiles[sessionUser].chatList = [];

        saveDatabase();

        // Оповіщення всіх про оновлений список онлайн користувачів
        io.emit('online_list', Object.keys(activeConnections));
        
        // Повертаємо користувачу його список активних чатів
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);
        
        // Передаємо конфігурацію для WebRTC дзвінків
        socket.emit('rtc_config', METERED_RTC_CONFIG);

        // Передаємо профілі користувачів для рендерингу аватарок та ніків
        Object.keys(userProfiles).forEach(username => {
            socket.emit('profile_broadcast', { username, data: userProfiles[username] });
        });
    });

    // Маршрутизація WebRTC сигналів для аудіо/відеодзвінків
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
                const responseText = await res.text();

                if (res.ok) {
                    try {
                        const gasData = JSON.parse(responseText);
                        if (gasData.exists) {
                            exists = true;
                            profile = gasData.profile || { displayName: data.username, avatar: '', bio: '' };
                            userProfiles[data.username] = { chatList: [], ...profile };
                            saveDatabase();
                        }
                    } catch (parseErr) {
                        console.error(`[GAS JSON Помилка] Надійшов невалидний текст:`, responseText.substring(0, 200));
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
                glowColor: profile.glowColor || 'blue'
            } : null
        });
    });

    // Залізобетонний пошук користувачів (Локальний + Хмара Google)
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
                const responseText = await response.text();
                
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

    // Глобальний всеохоплюючий пошук повідомлень та людей всередині клієнта
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

    // Опрацювання та надсилання повідомлень (з підтримкою перевірки зміни голосу)
    socket.on('chat_message', (msg) => {
        if (!msg || !msg.room || !msg.from || !msg.to) return;

        // === СЕРВЕРНИЙ КОНТРОЛЬ ЗМІНИ ГОЛОСУ ===
        if (!ALLOW_VOICE_EFFECTS || msg.disableVoiceEffectsOnServer === true) {
            if (msg.voiceEffect || msg.audioEffect) {
                console.log(`[Сервер] Заблоковано спробу зміни голосу для користувача ${msg.from}`);
                delete msg.voiceEffect;
                delete msg.audioEffect;
                if (msg.meta) { delete msg.meta.voiceEffect; delete msg.meta.audioEffect; }
            }
        }

        // Обробка відкладеного повідомлення
        if (msg.scheduledTime && new Date(msg.scheduledTime).getTime() > Date.now()) {
            if (!messagesDatabase.scheduled) messagesDatabase.scheduled = [];
            messagesDatabase.scheduled.push(msg);
            saveDatabase();
            return;
        }

        // Стандартне збереження в базу даних
        if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = [];
        messagesDatabase[msg.room].push(msg);

        // Автоматичне очищення зникне через X секунд (якщо увімкнено Secret Таймер)
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

        // Розсилка оновлень структури профілів
        io.emit('profile_broadcast', { username: msg.from, data: userProfiles[msg.from] });
        io.emit('profile_broadcast', { username: msg.to, data: userProfiles[msg.to] });
        
        // Доставка повідомлення отримувачу та відправнику
        const targetSocketId = activeConnections[msg.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('restore_chats', userProfiles[msg.to].chatList);
            io.to(targetSocketId).emit('chat_message', msg);
        }
        socket.to(msg.room).emit('chat_message', msg);
    });

    // Сумісність зі старою подією друку
    socket.on('typing', (data) => {
        if (data && data.room) socket.to(data.room).emit('typing', data);
    });

    // ПОДІЯ АКТИВНОСТІ: Стягує статуси "записує кружок", "записує аудіо", "обирає стікер"
    socket.on('user_activity', (data) => {
        if (data && data.room) {
            socket.to(data.room).emit('user_activity', data);
        }
    });

    // Ручна синхронізація списку чатів
    socket.on('sync_chat_list', (data) => {
        if (sessionUser && data && data.chatList) {
            if (!userProfiles[sessionUser]) userProfiles[sessionUser] = { chatList: [] };
            userProfiles[sessionUser].chatList = data.chatList;
            saveDatabase();
        }
    });

    // Позначення повідомлень як прочитаних
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

    // Видалення повідомлення (зокрема підтримка масового виділення)
    socket.on('delete_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            messagesDatabase[data.room] = messagesDatabase[data.room].filter(m => m && m.id !== data.msgId);
            saveDatabase();
        }
        socket.to(data.room).emit('delete_message', data);
    });

    // Додавання емодзі-реакцій на блоки повідомлень
    socket.on('message_reaction', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            const msg = messagesDatabase[data.room].find(m => m && m.id === data.msgId);
            if (msg) { msg.reactions = data.reactions || {}; saveDatabase(); }
        }
        socket.to(data.room).emit('message_reaction', data);
    });

    // Закріплення та відкріплення повідомлень (Мульти-пін менеджер)
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

    // Повне очищення історії діалогу
    socket.on('clear_history', (data) => {
        if (!data || !data.room) return;
        if (messagesDatabase[data.room]) {
            messagesDatabase[data.room] = [];
            saveDatabase();
        }
        socket.to(data.room).emit('clear_history', data);
    });

    // Обробка відключення клієнта (офлайн статус)
    socket.on('disconnect', () => {
        if (sessionUser) {
            delete activeConnections[sessionUser];
            io.emit('online_list', Object.keys(activeConnections));
        }
    });
});

// Запуск сервера
server.listen(PORT, () => console.log(`=== Повний преміум-сервер BurmaldaGram запущено на порту ${PORT} ===`));

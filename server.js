const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Максимальний ліміт для передачі медіафайлів (100MB) [cite: 3]
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const PORT = process.env.PORT || 3000; [cite: 4]
const DB_FILE = path.join(__dirname, 'database.json');

// --- ДАНІ TURN-СЕРВЕРА ВІД METERED --- [cite: 4]
const METERED_RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, [cite: 4]
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:80", [cite: 5]
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ]
};

let userProfiles = {}; [cite: 6]
let messagesDatabase = {}; [cite: 6]
let activeConnections = {}; [cite: 6]

// --- НАДІЙНЕ ЗАВАНТАЖЕННЯ БАЗИ --- [cite: 7]
function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) { [cite: 7]
            const rawData = fs.readFileSync(DB_FILE, 'utf8'); [cite: 7]
            if (rawData.trim()) { [cite: 8]
                const parsed = JSON.parse(rawData); [cite: 8]
                messagesDatabase = parsed.messagesDatabase || {}; [cite: 9]
                userProfiles = parsed.userProfiles || {}; [cite: 9]
                console.log(`[БД] Базу успішно завантажено. Юзерів у системі: ${Object.keys(userProfiles).length}`); [cite: 9]
            }
        }
    } catch (e) {
        console.error('[БД] Помилка завантаження файлу бази:', e.message); [cite: 10]
    }
}

// --- ФОНОВЕ ЗБЕРЕЖЕННЯ ДАНИХ (БЕЗ ЛАГІВ СЕРВЕРА) --- [cite: 11]
function saveDatabase() {
    const dataToSave = { messagesDatabase, userProfiles }; [cite: 11]
    fs.writeFile(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf8', (err) => { [cite: 12]
        if (err) console.error('[БД] Помилка запису на диск:', err.message); [cite: 12]
    });
}

loadDatabase(); [cite: 13]

// Статика: роздаємо файли з коріння та папки public [cite: 13]
app.use(express.static(__dirname)); [cite: 13]
app.use(express.static(path.join(__dirname, 'public'))); [cite: 13]

// Маршрути для chat.html [cite: 14]
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'chat.html'))); [cite: 14]
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'chat.html'))); [cite: 14]

io.on('connection', (socket) => { [cite: 15]
    let sessionUser = null; [cite: 15]

    // Вхід користувача в мережу
    socket.on('online_ping', (data) => { [cite: 15]
        if (!data || !data.username) return; [cite: 15]
        sessionUser = data.username; [cite: 15]
        activeConnections[sessionUser] = socket.id; [cite: 15]

        if (!userProfiles[sessionUser]) { [cite: 15]
            userProfiles[sessionUser] = { chatList: [], displayName: sessionUser, bio: '', avatar: '' }; [cite: 15]
        }
        
        if (!userProfiles[sessionUser].chatList) userProfiles[sessionUser].chatList = []; [cite: 16]

        saveDatabase(); [cite: 16]

        // Список онлайн та історія чатів
        io.emit('online_list', Object.keys(activeConnections)); [cite: 16]
        socket.emit('restore_chats', userProfiles[sessionUser].chatList); [cite: 16]

        // Передаємо налаштування WebRTC клієнту
        socket.emit('rtc_config', METERED_RTC_CONFIG); [cite: 16]

        // Розсилка профілів для аватарок
        Object.keys(userProfiles).forEach(username => { [cite: 16]
            socket.emit('profile_broadcast', { username, data: userProfiles[username] }); [cite: 17]
        });
    });

    // Маршрутизація сигналів дзвінків (WebRTC) + Фікс ідентифікації відправника 
    socket.on('webrtc_signal', (data) => { [cite: 18]
        if (!data || !data.target || !sessionUser) return; [cite: 18]
        const targetSocketId = activeConnections[data.target]; [cite: 18]
        if (targetSocketId) { [cite: 18]
            // Обов'язково прокидаємо sender, щоб отримувач знав, від кого дзвінок/ice-кандидат
            io.to(targetSocketId).emit('webrtc_signal', { [cite: 18]
                ...data, [cite: 19]
                sender: sessionUser  [cite: 19]
            });
        }
    });

    // Запит конкретного профілю
    socket.on('request_profile', (data) => { [cite: 20]
        if (!data || !data.username) return; [cite: 20]
        const uProfile = userProfiles[data.username]; [cite: 20]
        if (uProfile) { [cite: 20]
            socket.emit('profile_broadcast', { username: data.username, data: uProfile }); [cite: 20]
        }
    });

    // Перевірка існування користувача
    socket.on('check_user_exists', (data) => { [cite: 21]
        if (!data || !data.username) return; [cite: 21]
        const uProfile = userProfiles[data.username]; [cite: 21]
        const exists = !!uProfile; [cite: 21]
        socket.emit('user_exists_result', {  [cite: 21]
            username: data.username, 
            exists,
            profile: exists ? { [cite: 21]
                displayName: uProfile.displayName || data.username, [cite: 22]
                avatar: uProfile.avatar || '', [cite: 22]
                bio: uProfile.bio || '' [cite: 22]
            } : null
        });
    });

    // Швидкі підказки при пошуку
    socket.on('search_users', (data) => { [cite: 23]
        if (!data || !data.query) return; [cite: 23]
        const query = data.query.toLowerCase().trim(); [cite: 23]
        const results = []; [cite: 23]
        
        Object.keys(userProfiles).forEach(username => { [cite: 23]
            const p = userProfiles[username] || {}; [cite: 23]
            const dName = (p.displayName || '').toLowerCase(); [cite: 23]
            
            if (username.toLowerCase().includes(query) || dName.includes(query)) { [cite: 24]
                results.push({ [cite: 24]
                    username: username, [cite: 24]
                    displayName: p.displayName || username, [cite: 24]
                    avatar: p.avatar || '', [cite: 24]
                    bio: p.bio || '' [cite: 25]
                });
            }
        });
        socket.emit('search_results', { query: data.query, results }); [cite: 25]
    });

    // Глобальний пошук (люди + повідомлення)
    socket.on('global_search', (data) => { [cite: 26]
        if (!data || !data.query || !sessionUser) return; [cite: 26]
        const query = data.query.toLowerCase().trim(); [cite: 26]
        
        const foundUsers = []; [cite: 26]
        const foundMessages = []; [cite: 26]

        Object.keys(userProfiles).forEach(username => { [cite: 26]
            const p = userProfiles[username] || {}; [cite: 26]
            const dName = (p.displayName || '').toLowerCase(); [cite: 27]
            
            if (username.toLowerCase().includes(query) || dName.includes(query)) { [cite: 27]
                foundUsers.push({ [cite: 27]
                    username: username, [cite: 27]
                    displayName: p.displayName || username, [cite: 27]
                    avatar: p.avatar || '', [cite: 28]
                    bio: p.bio || '' [cite: 28]
                });
            }
        });

        Object.keys(messagesDatabase).forEach(room => { [cite: 28]
            if (room.includes(sessionUser)) { [cite: 29]
                const roomMsgs = messagesDatabase[room] || []; [cite: 29]
                roomMsgs.forEach(msg => { [cite: 29]
                    if (msg && msg.text && msg.text.toLowerCase().includes(query)) { [cite: 29]
                        const partner = msg.from === sessionUser ? msg.to : msg.from; [cite: 29, 30]
                        foundMessages.push({ [cite: 30]
                            id: msg.id, [cite: 31]
                            room: room, [cite: 31]
                            partner: partner, [cite: 31]
                            from: msg.from, [cite: 31]
                            text: msg.text, [cite: 31]
                            timestamp: msg.timestamp [cite: 31]
                        });
                    }
                });
            }
        });

        foundMessages.sort((a, b) => b.timestamp - a.timestamp); [cite: 33]
        socket.emit('global_search_results', { query: data.query, users: foundUsers, messages: foundMessages }); [cite: 34]
    });

    // Редагування профілю
    socket.on('update_profile', (data) => { [cite: 35]
        if (!sessionUser || !data) return; [cite: 35]
        if (!userProfiles[sessionUser]) userProfiles[sessionUser] = { chatList: [] }; [cite: 35]
        
        const profileData = data.data || data; [cite: 35]
        userProfiles[sessionUser].displayName = profileData.displayName || sessionUser; [cite: 35]
        userProfiles[sessionUser].bio = profileData.bio || ''; [cite: 35]
        userProfiles[sessionUser].avatar = profileData.avatar || '';  [cite: 35]
        
        saveDatabase(); [cite: 36]
        io.emit('profile_broadcast', { username: sessionUser, data: userProfiles[sessionUser] }); [cite: 36]
    });

    // Кімнати та робота з закріпленими повідомленнями
    socket.on('join_room', (data) => { [cite: 37]
        if (!data || !data.room) return; [cite: 37]
        socket.join(data.room); [cite: 37]
        const pinnedKey = data.room + '_pinned'; [cite: 37]
        if (messagesDatabase[pinnedKey] && messagesDatabase[pinnedKey].length > 0) { [cite: 37]
            socket.emit('pin_message', { room: data.room, pinned: messagesDatabase[pinnedKey] }); [cite: 37]
        }
    });

    socket.on('request_history', (data) => { [cite: 38]
        if (!data || !data.room) return; [cite: 38]
        socket.emit('room_history', messagesDatabase[data.room] || []); [cite: 38]
    });

    // Обробка повідомлень
    socket.on('chat_message', (msg) => { [cite: 39]
        if (!msg || !msg.room || !msg.from || !msg.to) return; [cite: 39]

        if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = []; [cite: 39]
        messagesDatabase[msg.room].push(msg); [cite: 39]

        if (!userProfiles[msg.from]) userProfiles[msg.from] = { chatList: [] }; [cite: 39]
        if (!userProfiles[msg.to]) userProfiles[msg.to] = { chatList: [] }; [cite: 39]
        if (!userProfiles[msg.from].chatList) userProfiles[msg.from].chatList = []; [cite: 39]
        if (!userProfiles[msg.to].chatList) userProfiles[msg.to].chatList = []; [cite: 39]

        if (!userProfiles[msg.from].chatList.includes(msg.to)) userProfiles[msg.from].chatList.push(msg.to); [cite: 40]
        if (!userProfiles[msg.to].chatList.includes(msg.from)) userProfiles[msg.to].chatList.push(msg.from); [cite: 40]

        saveDatabase(); [cite: 40]

        io.emit('profile_broadcast', { username: msg.from, data: userProfiles[msg.from] }); [cite: 40]
        io.emit('profile_broadcast', { username: msg.to, data: userProfiles[msg.to] }); [cite: 40]
        
        const targetSocketId = activeConnections[msg.to]; [cite: 41]
        if (targetSocketId) { [cite: 41]
            io.to(targetSocketId).emit('restore_chats', userProfiles[msg.to].chatList); [cite: 41]
            io.to(targetSocketId).emit('chat_message', msg); [cite: 42]
        }
        socket.to(msg.room).emit('chat_message', msg); [cite: 42]
    });

    socket.on('typing', (data) => { [cite: 43]
        if (data && data.room) socket.to(data.room).emit('typing', data); [cite: 43]
    });

    socket.on('sync_chat_list', (data) => { [cite: 44]
        if (sessionUser && data && data.chatList) { [cite: 44]
            if (!userProfiles[sessionUser]) userProfiles[sessionUser] = { chatList: [] }; [cite: 44]
            userProfiles[sessionUser].chatList = data.chatList; [cite: 44]
            saveDatabase(); [cite: 44]
        }
    });

    socket.on('mark_read', (data) => { [cite: 45]
        if (!data || !data.room || !data.reader) return; [cite: 45]
        if (Array.isArray(messagesDatabase[data.room])) { [cite: 45]
            messagesDatabase[data.room].forEach(m => { if (m && m.from !== data.reader) m.status = 'read'; }); [cite: 45]
            saveDatabase(); [cite: 45]
        }
        socket.to(data.room).emit('messages_read', data); [cite: 45]
    });

    socket.on('edit_message', (data) => { [cite: 46]
        if (!data || !data.room || !data.msgId) return; [cite: 46]
        if (Array.isArray(messagesDatabase[data.room])) { [cite: 46]
            const msg = messagesDatabase[data.room].find(m => m && m.id === data.msgId); [cite: 46]
            if (msg) { msg.text = data.newText; msg.edited = true; saveDatabase(); } [cite: 46]
        }
        socket.to(data.room).emit('edit_message', data); [cite: 46]
    });

    socket.on('delete_message', (data) => { [cite: 47]
        if (!data || !data.room || !data.msgId) return; [cite: 47]
        if (Array.isArray(messagesDatabase[data.room])) { [cite: 47]
            messagesDatabase[data.room] = messagesDatabase[data.room].filter(m => m && m.id !== data.msgId); [cite: 47]
            saveDatabase(); [cite: 47]
        }
        socket.to(data.room).emit('delete_message', data); [cite: 47]
    });

    socket.on('message_reaction', (data) => { [cite: 48]
        if (!data || !data.room || !data.msgId) return; [cite: 48]
        if (Array.isArray(messagesDatabase[data.room])) { [cite: 48]
            const msg = messagesDatabase[data.room].find(m => m && m.id === data.msgId); [cite: 48]
            if (msg) { msg.reactions = data.reactions || {}; saveDatabase(); } [cite: 48]
        }
        socket.to(data.room).emit('message_reaction', data); [cite: 48]
    });

    socket.on('pin_message', (data) => { [cite: 49]
        if (!data || !data.room) return; [cite: 49]
        const pinnedKey = data.room + '_pinned'; [cite: 49]
        if (!messagesDatabase[pinnedKey]) messagesDatabase[pinnedKey] = []; [cite: 49]

        if (data.action === 'remove') { [cite: 49]
            const targetId = data.msgId || (data.pinData ? data.pinData.id : null) || (data.msg ? data.msg.id : null); [cite: 49]
            if (targetId) { [cite: 49]
                messagesDatabase[pinnedKey] = messagesDatabase[pinnedKey].filter(p => p.id !== targetId); [cite: 50]
            }
        } else if (data.action === 'add') { [cite: 50]
            const activeMsg = data.msg || data.pinData; [cite: 50]
            if (activeMsg && !messagesDatabase[pinnedKey].some(p => p.id === activeMsg.id)) { [cite: 50]
                messagesDatabase[pinnedKey].push(activeMsg); [cite: 50]
            }
        } else if (data.pinned) { [cite: 51]
            messagesDatabase[pinnedKey] = data.pinned; [cite: 51]
        }

        saveDatabase(); [cite: 51]
        io.to(data.room).emit('pin_message', { room: data.room, pinned: messagesDatabase[pinnedKey] }); [cite: 51]
    });

    socket.on('clear_history', (data) => { [cite: 52]
        if (!data || !data.room) return; [cite: 52]
        if (messagesDatabase[data.room]) { [cite: 52]
            messagesDatabase[data.room] = []; [cite: 52]
            saveDatabase(); [cite: 52]
        }
        socket.to(data.room).emit('clear_history', data); [cite: 52]
    });

    socket.on('disconnect', () => { [cite: 53]
        if (sessionUser) { [cite: 53]
            delete activeConnections[sessionUser]; [cite: 53]
            io.emit('online_list', Object.keys(activeConnections)); [cite: 53]
        }
    });
}); // Тут виправлено закриття блоку io.on [cite: 54]

server.listen(PORT, () => console.log(`=== Фінальний сервер BurmaldaGram запустищено на порту ${PORT} ===`)); [cite: 54]

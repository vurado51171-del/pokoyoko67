const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Роздача статичних файлів (індексний HTML, стилі та твій script.js мають лежати в папці 'public')
app.use(express.static(path.join(__dirname, 'public')));

// Бази даних в оперативній пам'яті (In-Memory DB)
const messages = {};       // Кімната -> масив повідомлень
const profiles = {};       // Юзернейм -> дані профілю
const pinnedMessages = {}; // Кімната -> масив закріплених об'єктів
const onlineUsers = new Map(); // socket.id -> юзернейм

// Помічник для визначення співрозмовника з назви кімнати (room_user1_user2)
function getPartner(roomName, currentUser) {
    if (!roomName.startsWith('room_')) return currentUser;
    const parts = roomName.replace('room_', '').split('_');
    return parts[0] === currentUser ? parts[1] : parts[0];
}

io.on('connection', (socket) => {
    console.log(`Клієнт підключився: ${socket.id}`);

    // Відразу надсилаємо RTC налаштування для дзвінків через PeerJS
    socket.emit('rtc_config', {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    // Обробка активності та статусу "в мережі"
    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        onlineUsers.set(socket.id, data.username);
        
        if (!profiles[data.username]) {
            profiles[data.username] = { displayName: data.username };
        }
        profiles[data.username].lastSeen = Date.now();
        
        // Розсилаємо усім оновлений список користувачів онлайн
        io.emit('online_list', Array.from(new Set(onlineUsers.values())));
    });

    // Синхронізація контактів
    socket.on('sync_contacts', (data) => {
        if (!data || !data.chats) return;
        socket.emit('contacts_synced', data.chats);
    });

    // Вхід користувача в кімнату чату
    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);
    });

    // Запит історії повідомлень кімнати
    socket.on('request_history', (data) => {
        if (!data || !data.room) return;
        const history = messages[data.room] || [];
        socket.emit('room_history', history);
        
        // Синхронізуємо закріплені повідомлення для цієї кімнати
        if (pinnedMessages[data.room]) {
            socket.emit('pin_message', { room: data.room, pinned: pinnedMessages[data.room] });
        }
    });

    // Обробка нових повідомлень (текст, фото, стікери, аудіо, опитування)
    socket.on('chat_message', (msg) => {
        if (!msg || !msg.room) return;
        if (!messages[msg.room]) messages[msg.room] = [];
        
        // Перевірка на дублікати
        if (!messages[msg.room].some(m => m.id === msg.id)) {
            messages[msg.room].push(msg);
        }
        // Пересилаємо повідомлення всім учасникам кімнати
        io.to(msg.room).emit('chat_message', msg);
    });

    // Редагування повідомлення
    socket.on('edit_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messages[data.room]) {
            const msg = messages[data.room].find(m => m.id === data.msgId);
            if (msg) {
                msg.text = data.newText;
                msg.edited = true;
            }
        }
        io.to(data.room).emit('edit_message', data);
    });

    // Видалення повідомлення
    socket.on('delete_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messages[data.room]) {
            messages[data.room] = messages[data.room].filter(m => m.id !== data.msgId);
        }
        if (pinnedMessages[data.room]) {
            pinnedMessages[data.room] = pinnedMessages[data.room].filter(p => p.id !== data.msgId);
        }
        io.to(data.room).emit('delete_message', data);
    });

    // Очищення всієї історії чату
    socket.on('clear_chat_history', (data) => {
        if (!data || !data.room) return;
        delete messages[data.room];
        delete pinnedMessages[data.room];
        io.to(data.room).emit('chat_history_cleared', data);
    });

    // Позначення повідомлень як прочитаних
    socket.on('mark_read', (data) => {
        if (!data || !data.room || !data.reader) return;
        if (messages[data.room]) {
            messages[data.room].forEach(msg => {
                if (msg.from !== data.reader) {
                    msg.status = 'read';
                }
            });
        }
        io.to(data.room).emit('messages_read', data);
    });

    // Додавання/видалення реакцій
    socket.on('message_reaction', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messages[data.room]) {
            const msg = messages[data.room].find(m => m.id === data.msgId);
            if (msg) {
                msg.reactions = data.reactions || {};
            }
        }
        io.to(data.room).emit('message_reaction', data);
    });

    // Голосування в опитуваннях та вікторинах
    socket.on('poll_vote', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messages[data.room]) {
            const msg = messages[data.room].find(m => m.id === data.msgId);
            if (msg) {
                msg.votes = data.votes || {};
            }
        }
        io.to(data.room).emit('poll_vote', data);
    });

    // Керування закріпленими повідомленнями
    socket.on('pin_message', (data) => {
        if (!data || !data.room || !data.action || !data.pinData) return;
        if (!pinnedMessages[data.room]) pinnedMessages[data.room] = [];

        if (data.action === 'add') {
            if (!pinnedMessages[data.room].some(p => p.id === data.pinData.id)) {
                pinnedMessages[data.room].push(data.pinData);
            }
        } else if (data.action === 'remove') {
            pinnedMessages[data.room] = pinnedMessages[data.room].filter(p => p.id !== data.pinData.id);
        }

        io.to(data.room).emit('pin_message', {
            room: data.room,
            action: data.action,
            pinData: data.pinData,
            pinned: pinnedMessages[data.room]
        });
    });

    // Трансляція статусів користувача (друкує, записує аудіо/відео тощо)
    socket.on('user_activity', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('user_activity', data);
    });

    // Оновлення картки профілю користувача
    socket.on('update_profile', (profileUpdate) => {
        if (!profileUpdate || !profileUpdate.username) return;
        profiles[profileUpdate.username] = {
            ...profiles[profileUpdate.username],
            ...profileUpdate.data,
            lastSeen: Date.now()
        };
        io.emit('profile_broadcast', {
            username: profileUpdate.username,
            data: profiles[profileUpdate.username]
        });
    });

    // Запит профілю конкретного користувача під час відкриття чату
    socket.on('request_profile', (data) => {
        if (!data || !data.username) return;
        if (profiles[data.username]) {
            socket.emit('profile_broadcast', {
                username: data.username,
                data: profiles[data.username]
            });
        }
    });

    // Глобальний пошук повідомлень за текстом
    socket.on('global_search', (data) => {
        if (!data || !data.query) return;
        const queryStr = data.query.toLowerCase();
        const searchResults = [];
        const currentUser = onlineUsers.get(socket.id);

        if (!currentUser) return;

        for (const [room, roomMsgs] of Object.entries(messages)) {
            if (room.includes(currentUser)) {
                roomMsgs.forEach(msg => {
                    if (msg.type === 'text' && msg.text.toLowerCase().includes(queryStr)) {
                        searchResults.push({
                            id: msg.id,
                            room: msg.room,
                            from: msg.from,
                            text: msg.text,
                            partner: getPartner(msg.room, currentUser),
                            timestamp: msg.timestamp
                        });
                    }
                });
            }
        }
        socket.emit('global_search_results', { messages: searchResults });
    });

    // Пошук користувачів по базі профілів
    socket.on('search_users', (data) => {
        if (!data || !data.query) return;
        const queryStr = data.query.toLowerCase();
        const results = [];

        for (const [username, profile] of Object.entries(profiles)) {
            const dispName = (profile.displayName || '').toLowerCase();
            if (username.toLowerCase().includes(queryStr) || dispName.includes(queryStr)) {
                results.push({
                    username: username,
                    displayName: profile.displayName || username,
                    avatar: profile.avatar || '',
                    bio: profile.bio || '',
                    glowColor: profile.glowColor || ''
                });
            }
        }
        socket.emit('search_results', { results });
    });

    // Обробка виходу користувача з мережі
    socket.on('disconnect', () => {
        const username = onlineUsers.get(socket.id);
        if (username) {
            if (profiles[username]) {
                profiles[username].lastSeen = Date.now();
            }
            onlineUsers.delete(socket.id);
            io.emit('online_list', Array.from(new Set(onlineUsers.values())));
        }
        console.log(`Клієнт відключився: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер успішно запущено на порту ${PORT}`);
});

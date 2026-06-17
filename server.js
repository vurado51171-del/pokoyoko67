const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Збільшуємо ліміт пам'яті для Socket.io до 100MB для передачі кружків, фото та голосових
const io = new Server(server, { maxHttpBufferSize: 1e8 }); 

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

let userProfiles = {};
let messagesDatabase = {};
let activeConnections = {}; // username -> socket.id

// --- ЗАВАНТАЖЕННЯ ТА ЗБЕРЕЖЕННЯ БД ---
function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const rawData = fs.readFileSync(DB_FILE, 'utf8');
            const parsed = JSON.parse(rawData);
            messagesDatabase = parsed.messagesDatabase || {};
            userProfiles = parsed.userProfiles || {};
            console.log('--- База даних BurmaldaGram успішно завантажена ---');
        } else {
            console.log('--- Створена нова чиста БД ---');
        }
    } catch (e) {
        console.error('Помилка при читанні бази даних:', e);
    }
}

function saveDatabase() {
    try {
        const dataToSave = { messagesDatabase, userProfiles };
        fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
    } catch (e) {
        console.error('Помилка при збереженні бази даних:', e);
    }
}

loadDatabase();

// Раздача статики (вкажи папку, де лежить твій HTML, наприклад 'public')
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    let sessionUser = null;

    // 1. Авторизація / Пінг онлайн статусу
    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        sessionUser = data.username;
        activeConnections[sessionUser] = socket.id;

        // Перевіряємо та створюємо профіль, якщо нового юзера немає в БД
        if (!userProfiles[sessionUser]) {
            userProfiles[sessionUser] = { chatList: [], displayName: sessionUser, bio: '' };
        }
        if (!userProfiles[sessionUser].chatList) {
            userProfiles[sessionUser].chatList = [];
        }

        // Відправляємо список онлайн-користувачів усім
        io.emit('online_list', Object.keys(activeConnections));

        // СИНХРОНІЗАЦІЯ: Повертаємо користувачу його список чатів з бази даних
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);

        // Разово розсилаємо інфо про профілі
        Object.keys(userProfiles).forEach(username => {
            socket.emit('profile_broadcast', { username, data: userProfiles[username] });
        });
    });

    // 2. Перевірка існування користувача через пошук
    socket.on('check_user_exists', (data) => {
        if (!data || !data.username) return;
        const exists = userProfiles[data.username] ? true : false;
        socket.emit('user_exists_result', { username: data.username, exists });
    });

    // 3. Вхід в кімнату чату + підвантаження закріплень
    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);

        // Якщо в кімнаті є закріплені повідомлення, відправляємо їх користувачу, який зайшов
        const pinnedKey = data.room + '_pinned';
        if (messagesDatabase[pinnedKey] && messagesDatabase[pinnedKey].length > 0) {
            socket.emit('pin_message', { room: data.room, pinned: messagesDatabase[pinnedKey] });
        }
    });

    // 4. Запит історії повідомлень (Синхронізація пристроїв)
    socket.on('request_history', (data) => {
        if (!data || !data.room) return;
        const history = messagesDatabase[data.room] || [];
        socket.emit('room_history', history);
    });

    // 5. Обробка та збереження повідомлень
    socket.on('chat_message', (msg) => {
        if (!msg || !msg.room || !msg.from || !msg.to) return;

        // Зберігаємо повідомлення в базу кімнати
        if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = [];
        messagesDatabase[msg.room].push(msg);

        // АВТО-ДОДАВАННЯ ЧАТУ В КОНТАКТИ ОБОХ СТОРІН
        if (userProfiles[msg.from]) {
            if (!userProfiles[msg.from].chatList) userProfiles[msg.from].chatList = [];
            if (!userProfiles[msg.from].chatList.includes(msg.to)) {
                userProfiles[msg.from].chatList.push(msg.to);
            }
        }
        if (userProfiles[msg.to]) {
            if (!userProfiles[msg.to].chatList) userProfiles[msg.to].chatList = [];
            if (!userProfiles[msg.to].chatList.includes(msg.from)) {
                userProfiles[msg.to].chatList.push(msg.from);
                // Якщо отримувач зараз онлайн, оновлюємо йому список чатів миттєво
                const targetSocket = activeConnections[msg.to];
                if (targetSocket) {
                    io.to(targetSocket).emit('restore_chats', userProfiles[msg.to].chatList);
                }
            }
        }

        saveDatabase();

        // Пересилаємо повідомлення всім у кімнаті, крім самого відправника
        socket.to(msg.room).emit('chat_message', msg);
    });

    // 6. Синхронізація списку чатів вручну (наприклад, при видаленні)
    socket.on('sync_chat_list', (data) => {
        if (sessionUser && data && data.chatList) {
            if (!userProfiles[sessionUser]) userProfiles[sessionUser] = {};
            userProfiles[sessionUser].chatList = data.chatList;
            saveDatabase();
        }
    });

    // 7. СИГНАЛІНГ ДЛЯ ДЗВІНКІВ (WebRTC)
    socket.on('webrtc_signal', (data) => {
        if (!data || !data.target) return;
        const targetSocketId = activeConnections[data.target];
        if (targetSocketId) {
            // Пересилаємо сигнал (offer, answer, ice-candidate, end) прямо на socket потрібного юзера
            io.to(targetSocketId).emit('webrtc_signal', data);
        }
    });

    // 8. Прочитання повідомлень
    socket.on('mark_read', (data) => {
        if (!data || !data.room || !data.reader) return;
        if (messagesDatabase[data.room]) {
            messagesDatabase[data.room].forEach(m => {
                if (m.from !== data.reader) m.status = 'read';
            });
            saveDatabase();
        }
        socket.to(data.room).emit('messages_read', data);
    });

    // 9. Редагування повідомлень
    socket.on('edit_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messagesDatabase[data.room]) {
            const msg = messagesDatabase[data.room].find(m => m.id === data.msgId);
            if (msg) {
                msg.text = data.newText;
                msg.edited = true;
                saveDatabase();
            }
        }
        socket.to(data.room).emit('edit_message', data);
    });

    // 10. Видалення повідомлень
    socket.on('delete_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messagesDatabase[data.room]) {
            messagesDatabase[data.room] = messagesDatabase[data.room].filter(m => m.id !== data.msgId);
            saveDatabase();
        }
        socket.to(data.room).emit('delete_message', data);
    });

    // 11. Реакції
    socket.on('message_reaction', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messagesDatabase[data.room]) {
            const msg = messagesDatabase[data.room].find(m => m.id === data.msgId);
            if (msg) {
                msg.reactions = data.reactions || {};
                saveDatabase();
            }
        }
        socket.to(data.room).emit('message_reaction', data);
    });

    // 12. Мульти-Закріплення повідомлень (Збереження в базу)
    socket.on('pin_message', (data) => {
        if (!data || !data.room) return;
        const pinnedKey = data.room + '_pinned';
        messagesDatabase[pinnedKey] = data.pinned || [];
        saveDatabase();
        socket.to(data.room).emit('pin_message', data);
    });

    // 13. Статус "пише..."
    socket.on('typing', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('typing_status', data);
    });

    // 14. Оновлення профілю (Нікнейм, Аватар, Біо)
    socket.on('update_profile', (packet) => {
        if (packet && packet.username && packet.data) {
            if (!userProfiles[packet.username]) userProfiles[packet.username] = { chatList: [] };
            userProfiles[packet.username] = { ...userProfiles[packet.username], ...packet.data };
            saveDatabase();
            socket.broadcast.emit('profile_broadcast', packet);
        }
    });

    // 15. Відключення користувача
    socket.on('disconnect', () => {
        if (sessionUser) {
            delete activeConnections[sessionUser];
            io.emit('online_list', Object.keys(activeConnections));
        }
    });
});

server.listen(PORT, () => {
    console.log(`=== BurmaldaGram Server Premium запущено на порту ${PORT} ===`);
});

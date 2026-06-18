const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Збільшено ліміт для відеокружків та фото до 100MB
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

let userProfiles = {};
let messagesDatabase = {};
let activeConnections = {}; 

// --- ЗАВАНТАЖЕННЯ ТА ЗБЕРЕЖЕННЯ БД ---
function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const rawData = fs.readFileSync(DB_FILE, 'utf8');
            const parsed = JSON.parse(rawData);
            messagesDatabase = parsed.messagesDatabase || {};
            userProfiles = parsed.userProfiles || {};
            console.log('--- База даних успішно завантажена ---');
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
        console.error('Помилка при збереженні бази даних. Можливо файл занадто великий:', e.message);
    }
}

loadDatabase();

// Роздача статичних файлів месенджера
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));

// --- ОБРОБКА SOCKET.IO З'ЄДНАНЬ ---
io.on('connection', (socket) => {
    let sessionUser = null;

    // Вхід користувача в мережу (Ping / Авторизація)
    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        sessionUser = data.username;
        activeConnections[sessionUser] = socket.id;

        // Ініціалізація профілю, якщо користувач новий
        if (!userProfiles[sessionUser]) {
            userProfiles[sessionUser] = { chatList: [], displayName: sessionUser, bio: '', avatar: '' };
        }
        if (!userProfiles[sessionUser].chatList) {
            userProfiles[sessionUser].chatList = [];
        }

        // Надсилаємо оновлений список онлайн-користувачів та відновлюємо чати
        io.emit('online_list', Object.keys(activeConnections));
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);

        // Транслюємо збережені профілі всіх користувачів для відображення аватарок та імен
        Object.keys(userProfiles).forEach(username => {
            socket.emit('profile_broadcast', { username, data: userProfiles[username] });
        });
    });

    // Перевірка існування користувача при пошуку
    socket.on('check_user_exists', (data) => {
        if (!data || !data.username) return;
        const exists = !!userProfiles[data.username];
        socket.emit('user_exists_result', { username: data.username, exists });
    });

    // Оновлення особистих даних профілю (Ім'я, Біо, Аватарка)
    socket.on('update_profile', (data) => {
        if (!sessionUser || !data) return;
        if (!userProfiles[sessionUser]) {
            userProfiles[sessionUser] = { chatList: [] };
        }
        
        userProfiles[sessionUser].displayName = data.displayName || sessionUser;
        userProfiles[sessionUser].bio = data.bio || '';
        userProfiles[sessionUser].avatar = data.avatar || '';
        
        saveDatabase();
        // Сповіщаємо всіх користувачів про зміни профілю
        io.emit('profile_broadcast', { username: sessionUser, data: userProfiles[sessionUser] });
    });

    // Вхід користувача в кімнату чату
    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);
        
        // Передаємо історію закріплених повідомлень кімнати, якщо вони є
        const pinnedKey = data.room + '_pinned';
        if (messagesDatabase[pinnedKey] && messagesDatabase[pinnedKey].length > 0) {
            socket.emit('pin_message', { room: data.room, pinned: messagesDatabase[pinnedKey] });
        }
    });

    // Запит історії повідомлень конкретної кімнати
    socket.on('request_history', (data) => {
        if (!data || !data.room) return;
        socket.emit('room_history', messagesDatabase[data.room] || []);
    });

    // Надсилання нового повідомлення (текст, медіа, стікери, кружки)
    socket.on('chat_message', (msg) => {
        if (!msg || !msg.room || !msg.from || !msg.to) return;

        // Перевірка надійності структур даних профілів
        if (!userProfiles[msg.from]) userProfiles[msg.from] = { chatList: [], displayName: msg.from, bio: '', avatar: '' };
        if (!userProfiles[msg.to]) userProfiles[msg.to] = { chatList: [], displayName: msg.to, bio: '', avatar: '' };

        if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = [];
        messagesDatabase[msg.room].push(msg);

        // Автоматичне додавання користувачів до списків чатів один одного
        if (!userProfiles[msg.from].chatList.includes(msg.to)) {
            userProfiles[msg.from].chatList.push(msg.to);
        }
        if (!userProfiles[msg.to].chatList.includes(msg.from)) {
            userProfiles[msg.to].chatList.push(msg.from);
            const targetSocket = activeConnections[msg.to];
            if (targetSocket) {
                io.to(targetSocket).emit('restore_chats', userProfiles[msg.to].chatList);
            }
        }

        saveDatabase();
        // Передаємо повідомлення співрозмовнику в кімнату
        socket.to(msg.room).emit('chat_message', msg);
    });

    // Статус введення тексту ("користувач друкує...")
    socket.on('typing', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('typing', data);
    });

    // Синхронізація сортування та списку чатів
    socket.on('sync_chat_list', (data) => {
        if (sessionUser && data && data.chatList) {
            if (!userProfiles[sessionUser]) userProfiles[sessionUser] = { chatList: [] };
            userProfiles[sessionUser].chatList = data.chatList;
            saveDatabase();
        }
    });

    // Сигнал WebRTC для голосових та відеодзвінків
    socket.on('webrtc_signal', (data) => {
        if (!data || !data.target) return;
        const targetSocketId = activeConnections[data.target];
        if (targetSocketId) {
            io.to(targetSocketId).emit('webrtc_signal', data);
        }
    });

    // Позначення повідомлень як прочитаних
    socket.on('mark_read', (data) => {
        if (!data || !data.room || !data.reader) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            messagesDatabase[data.room].forEach(m => { 
                if (m && m.from !== data.reader) m.status = 'read'; 
            });
            saveDatabase();
        }
        socket.to(data.room).emit('messages_read', data);
    });

    // Редагування повідомлення
    socket.on('edit_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            const msg = messagesDatabase[data.room].find(m => m && m.id === data.msgId);
            if (msg) { 
                msg.text = data.newText; 
                msg.edited = true; 
                saveDatabase(); 
            }
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

    // Додавання/зміна емодзі-реакцій на повідомлення
    socket.on('message_reaction', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (Array.isArray(messagesDatabase[data.room])) {
            const msg = messagesDatabase[data.room].find(m => m && m.id === data.msgId);
            if (msg) { 
                msg.reactions = data.reactions || {}; 
                saveDatabase(); 
            }
        }
        socket.to(data.room).emit('message_reaction', data);
    });

    // Закріплення та відкріплення повідомлень (динамічна обробка дій клієнта)
    socket.on('pin_message', (data) => {
        if (!data || !data.room) return;
        const pinnedKey = data.room + '_pinned';
        
        if (!messagesDatabase[pinnedKey]) {
            messagesDatabase[pinnedKey] = [];
        }

        // Якщо клієнт надіслав запит на видалення конкретного закріплення
        if (data.action === 'remove') {
            if (data.pinData && data.pinData.id) {
                messagesDatabase[pinnedKey] = messagesDatabase[pinnedKey].filter(p => p.id !== data.pinData.id);
            } else if (data.msgId) {
                messagesDatabase[pinnedKey] = messagesDatabase[pinnedKey].filter(p => p.id !== data.msgId);
            }
        } 
        // Якщо клієнт надіслав запит на додавання окремого повідомлення
        else if (data.action === 'add' && data.msg) {
            if (!messagesDatabase[pinnedKey].some(p => p.id === data.msg.id)) {
                messagesDatabase[pinnedKey].push(data.msg);
            }
        } 
        // Якщо прилетів одразу готовий масив закріплених повідомлень
        else if (data.pinned) {
            messagesDatabase[pinnedKey] = data.pinned;
        }

        saveDatabase();
        // Надсилаємо оновлений масив усім учасникам кімнати (включно з відправником)
        io.to(data.room).emit('pin_message', { room: data.room, pinned: messagesDatabase[pinnedKey] });
    });

    // Очищення історії чату на сервері
    socket.on('clear_history', (data) => {
        if (!data || !data.room) return;
        if (messagesDatabase[data.room]) {
            messagesDatabase[data.room] = [];
            saveDatabase();
        }
        socket.to(data.room).emit('clear_history', data);
    });

    // Обробка відключення користувача з мережі
    socket.on('disconnect', () => {
        if (sessionUser) {
            delete activeConnections[sessionUser];
            io.emit('online_list', Object.keys(activeConnections));
        }
    });
});

// Запуск сервера на порту
server.listen(PORT, () => {
    console.log(`=== Сервер BurmaldaGram запущено на порту ${PORT} ===`);
});

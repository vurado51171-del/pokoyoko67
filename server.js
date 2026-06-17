const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
// Збільшуємо ліміт для передачі фотографій
const io = new Server(server, { maxHttpBufferSize: 1e8 }); 

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

let userProfiles = {};
let messagesDatabase = {};
let activeConnections = {}; 

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
        console.error('Помилка при записі бази даних:', e);
    }
}

loadDatabase();

app.use(express.static(__dirname));

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/chat', (req, res) => { res.sendFile(path.join(__dirname, 'chat.html')); });

function getOnlineUsersList() {
    return Array.from(new Set(Object.values(activeConnections)));
}

io.on('connection', (socket) => {
    console.log(`Нове підключення: ${socket.id}`);

    // --- Авторизація та синхронізація профілю ---
    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        socket.username = data.username;
        activeConnections[socket.id] = data.username;
        
        // Створюємо профіль, якщо його ще немає
        if (!userProfiles[data.username]) {
            userProfiles[data.username] = { chatList: [], displayName: data.username, bio: '', avatar: '' };
            saveDatabase();
        }

        io.emit('online_list', getOnlineUsersList());
        
        // Відправляємо користувачу його список чатів із бази даних сервера
        socket.emit('restore_chats', userProfiles[data.username].chatList || []);
    });

    // --- Розумний пошук (перевірка існування акаунта) ---
    socket.on('check_user_exists', (data) => {
        const target = data.username;
        // Користувач існує, якщо він є в БД або зараз онлайн
        const exists = !!userProfiles[target] || Object.values(activeConnections).includes(target);
        socket.emit('user_exists_result', { exists, username: target });
        
        if (exists && socket.username) {
            // Зберігаємо чат в БД сервера
            if (!userProfiles[socket.username].chatList) userProfiles[socket.username].chatList = [];
            if (!userProfiles[socket.username].chatList.includes(target)) {
                userProfiles[socket.username].chatList.push(target);
                saveDatabase();
            }
        }
    });

    // --- Синхронізація видалення чату ---
    socket.on('sync_chat_list', (data) => {
        if (socket.username && data.chatList) {
            if (!userProfiles[socket.username]) userProfiles[socket.username] = {};
            userProfiles[socket.username].chatList = data.chatList;
            saveDatabase();
        }
    });

    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);
    });

    // --- Обробка повідомлень ---
    socket.on('chat_message', (data) => {
        if (!data || !data.room) return;
        const room = data.room;

        const packetToSend = { 
            id: data.id, room: data.room, from: data.from, to: data.to, 
            text: data.text, type: data.type || 'text', replyTo: data.replyTo || null,
            timestamp: data.timestamp || Date.now(), reactions: data.reactions || {},
            status: data.status || 'sent', edited: false
        };

        // Сервер не пише картинки в БД, тільки текст
        if (packetToSend.type !== 'image') {
            if (!messagesDatabase[room]) messagesDatabase[room] = [];
            if (!messagesDatabase[room].some(m => m.id === packetToSend.id)) {
                messagesDatabase[room].push(packetToSend);
                saveDatabase();
            }
        }

        // Автоматично додаємо діалог в профіль обом користувачам при першому повідомленні
        if (packetToSend.from && packetToSend.to) {
            const sender = packetToSend.from;
            const receiver = packetToSend.to;
            
            [sender, receiver].forEach(user => {
                if (!userProfiles[user]) userProfiles[user] = { chatList: [] };
                if (!userProfiles[user].chatList) userProfiles[user].chatList = [];
                const partner = (user === sender) ? receiver : sender;
                
                if (!userProfiles[user].chatList.includes(partner)) {
                    userProfiles[user].chatList.push(partner);
                    saveDatabase();
                }
            });
        }

        socket.to(room).emit('chat_message', packetToSend);

        // Пряма відправка незнайомцям (якщо не в кімнаті)
        if (data.to) {
            for (let [sId, uname] of Object.entries(activeConnections)) {
                if (uname === data.to) io.to(sId).emit('chat_message', packetToSend);
            }
        }
    });

    // --- Редагування повідомлення ---
    socket.on('edit_message', (data) => {
        if (!data || !data.room || !data.msgId || !data.newText) return;
        const room = data.room;
        
        if (messagesDatabase[room]) {
            const msg = messagesDatabase[room].find(m => m.id === data.msgId);
            if (msg && msg.from === socket.username) {
                msg.text = data.newText;
                msg.edited = true;
                saveDatabase();
                
                // Відправляємо оновлення в кімнату
                socket.to(room).emit('edit_message', { room, msgId: data.msgId, newText: data.newText });
                
                // Пряма відправка, якщо співрозмовник онлайн, але вийшов в меню
                const users = room.replace('room_', '').split('_');
                const receiver = users.find(u => u !== socket.username);
                if (receiver) {
                    for (let [sId, uname] of Object.entries(activeConnections)) {
                        if (uname === receiver) io.to(sId).emit('edit_message', { room, msgId: data.msgId, newText: data.newText });
                    }
                }
            }
        }
    });

    // --- Прочитання повідомлень ---
    socket.on('mark_read', (data) => {
        if (!data || !data.room || !data.reader) return;
        const { room, reader } = data;
        let updated = false;
        if (messagesDatabase[room]) {
            messagesDatabase[room].forEach(msg => {
                if (msg.from !== reader && msg.status !== 'read') {
                    msg.status = 'read'; updated = true;
                }
            });
            if (updated) saveDatabase();
        }
        socket.to(room).emit('messages_read', data);

        const users = room.replace('room_', '').split('_');
        const senderNick = users[0] === reader ? users[1] : users[0];
        for (let [sId, uname] of Object.entries(activeConnections)) {
            if (uname === senderNick) io.to(sId).emit('messages_read', data);
        }
    });

    // --- Видалення ---
    socket.on('delete_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messagesDatabase[data.room]) {
            messagesDatabase[data.room] = messagesDatabase[data.room].filter(m => m.id !== data.msgId);
            saveDatabase();
        }
        socket.to(data.room).emit('delete_message', data);
    });

    // --- Інше (Реакції, Закріплення, Тайпінг, Профілі) ---
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

    socket.on('pin_message', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('pin_message', data);
    });

    socket.on('typing', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('typing_status', data);
    });

    socket.on('update_profile', (packet) => {
        if (packet && packet.username && packet.data) {
            if (!userProfiles[packet.username]) userProfiles[packet.username] = { chatList: [] };
            userProfiles[packet.username] = { ...userProfiles[packet.username], ...packet.data };
            saveDatabase();
            socket.broadcast.emit('profile_broadcast', packet);
        }
    });

    socket.on('disconnect', () => {
        if (socket.id in activeConnections) delete activeConnections[socket.id];
        io.emit('online_list', getOnlineUsersList());
    });
});

server.listen(PORT, () => { console.log(`Сервер BurmaldaGram на порту ${PORT}`); });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Збільшуємо ліміт пам'яті для Socket.io до 100MB, щоб фотографії, голосові та відео-кружки передавалися без помилок
const io = new Server(server, { maxHttpBufferSize: 1e8 }); 

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

let userProfiles = {};
let messagesDatabase = {};
let activeConnections = {}; 

// --- Завантаження та збереження БД ---
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
        
        if (!userProfiles[data.username]) {
            userProfiles[data.username] = { chatList: [], displayName: data.username, bio: '', avatar: '' };
            saveDatabase();
        }

        io.emit('online_list', getOnlineUsersList());
        socket.emit('restore_chats', userProfiles[data.username].chatList || []);
    });

    // --- Розумний пошук юзерів ---
    socket.on('check_user_exists', (data) => {
        const target = data.username;
        const exists = !!userProfiles[target] || Object.values(activeConnections).includes(target);
        socket.emit('user_exists_result', { exists, username: target });
        
        if (exists && socket.username) {
            if (!userProfiles[socket.username].chatList) userProfiles[socket.username].chatList = [];
            if (!userProfiles[socket.username].chatList.includes(target)) {
                userProfiles[socket.username].chatList.push(target);
                saveDatabase();
            }
        }
    });

    // --- Синхронізація списку чатів при видаленні ---
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

        // Записуємо в БД тільки текстові повідомлення (щоб медіа-бази не перевантажили JSON)
        if (packetToSend.type === 'text') {
            if (!messagesDatabase[room]) messagesDatabase[room] = [];
            if (!messagesDatabase[room].some(m => m.id === packetToSend.id)) {
                messagesDatabase[room].push(packetToSend);
                saveDatabase();
            }
        }

        // Авто-додавання чату обом користувачам
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

        // Пряма відправка незнайомцям
        if (data.to) {
            for (let [sId, uname] of Object.entries(activeConnections)) {
                if (uname === data.to) io.to(sId).emit('chat_message', packetToSend);
            }
        }
    });

    // --- Дзвінки (WebRTC Сигналізація) ---
    socket.on('webrtc_signal', (data) => {
        if (!data || !data.target) return;
        
        // Знаходимо socket.id співрозмовника і відправляємо йому сигнал дзвінка
        for (let [sId, uname] of Object.entries(activeConnections)) {
            if (uname === data.target) {
                io.to(sId).emit('webrtc_signal', data);
                break;
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
                
                socket.to(room).emit('edit_message', { room, msgId: data.msgId, newText: data.newText });
                
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
            if (!userProfiles[packet.username])

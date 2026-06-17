const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
            console.log('--- База данных BurmaldaGram успешно загружена ---');
        } else {
            console.log('--- Создана новая чистая БД ---');
        }
    } catch (e) {
        console.error('Ошибка при чтении базы данных:', e);
    }
}

function saveDatabase() {
    try {
        const dataToSave = { messagesDatabase, userProfiles };
        fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
    } catch (e) {
        console.error('Ошибка при записи базы данных:', e);
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
    console.log(`Новое подключение: ${socket.id}`);

    // Авторизация онлайна
    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        socket.username = data.username;
        activeConnections[socket.id] = data.username;
        io.emit('online_list', getOnlineUsersList());
    });

    // Вход в комнату
    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);
    });

    // Обработка сообщений
    socket.on('chat_message', (data) => {
        if (!data || !data.room) return;
        const room = data.room;

        const packetToSend = { 
            id: data.id,
            room: data.room, 
            from: data.from, 
            text: data.text, 
            type: data.type || 'text', 
            replyTo: data.replyTo || null,
            timestamp: data.timestamp || Date.now(),
            reactions: data.reactions || {}
        };

        // ТРЕБОВАНИЕ: Если это картинка (image), сервер её в базу данных НЕ ПИШЕТ
        if (packetToSend.type !== 'image') {
            if (!messagesDatabase[room]) messagesDatabase[room] = [];
            if (!messagesDatabase[room].some(m => m.id === packetToSend.id)) {
                messagesDatabase[room].push(packetToSend);
                saveDatabase();
            }
        }

        // Пересылаем сообщение второму человеку в реальном времени
        socket.to(room).emit('chat_message', packetToSend);
    });

    // Реакции (работают на лету и для текста, и для несохраняемых медиа)
    socket.on('message_reaction', (data) => {
        if (!data || !data.room || !data.msgId) return;
        const { room, msgId, reactions } = data;

        if (messagesDatabase[room]) {
            const msg = messagesDatabase[room].find(m => m.id === msgId);
            if (msg) {
                msg.reactions = reactions || {};
                saveDatabase();
            }
        }
        socket.to(room).emit('message_reaction', data);
    });

    // Удаление сообщений
    socket.on('delete_message', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('delete_message', data);
    });

    // Закрепление сообщений
    socket.on('pin_message', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('pin_message', data);
    });

    // Индикатор набора текста
    socket.on('typing', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('typing_status', data);
    });

    // Обновление профиля
    socket.on('update_profile', (packet) => {
        if (packet && packet.username && packet.data) {
            userProfiles[packet.username] = packet.data;
            saveDatabase();
            socket.broadcast.emit('profile_broadcast', packet);
        }
    });

    socket.on('disconnect', () => {
        if (socket.id in activeConnections) {
            delete activeConnections[socket.id];
        }
        io.emit('online_list', getOnlineUsersList());
    });
});

server.listen(PORT, () => { console.log(`СерверBurmaldaGram на порту ${PORT}`); });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

let userProfiles = {};
let onlineUsers = [];
// Хранилище сообщений на сервере, чтобы ничего не пропадало, пока тебя нет в сети
let messagesDatabase = {}; 

app.use(express.static(__dirname));

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/chat', (req, res) => { res.sendFile(path.join(__dirname, 'chat.html')); });

io.on('connection', (socket) => {
    console.log('Новое подключение к BurmaldaGram');

    socket.on('store user', (username) => {
        if (!username) return;
        socket.username = username;
        if (!onlineUsers.includes(username)) onlineUsers.push(username);
        io.emit('online users', onlineUsers);

        // ИСПРАВЛЕНИЕ: Ищем все комнаты, где есть сообщения для этого пользователя, чтобы вернуть диалоги
        let userDialogs = [];
        for (let roomName in messagesDatabase) {
            if (roomName.split('_').includes(username)) {
                const partner = roomName.replace(username, '').replace('_', '');
                if (partner && !userDialogs.includes(partner)) {
                    userDialogs.push(partner);
                }
            }
        }
        // Отправляем пользователю список его активных диалогов, которые помнит сервер
        socket.emit('server dialogs list', userDialogs);
    });

    // Когда пользователь заходит в чат с кем-то
    socket.on('join room', (partnerName) => {
        if (!socket.username || !partnerName) return;
        const roomName = [socket.username, partnerName].sort().join('_');
        socket.join(roomName);

        // Отдаем пользователю ВСЮ историю из памяти сервера, даже если он был офлайн
        if (messagesDatabase[roomName]) {
            socket.emit('server history', messagesDatabase[roomName]);
        } else {
            socket.emit('server history', []);
        }
    });

    socket.on('private chat message', (data) => {
        if (!data) return;
        const room = data.room;
        const text = data.text;
        const user = data.user || socket.username; 
        const msgId = data.msgId || ('msg-' + Date.now());
        const isRead = data.isRead || false;

        if (!room || !text) return;

        const packetToSend = { room, text, user, msgId, isRead, time: data.time || Date.now() };

        // Сохраняем на сервере только реальный текст (игнорируем сигналы печати/прочтения)
        if (text !== '[TYPING_SIGNAL]' && text !== '[READ_SIGNAL]') {
            if (!messagesDatabase[room]) messagesDatabase[room] = [];
            
            // Защита от дублирования сообщений в базе
            if (!messagesDatabase[room].some(m => m.msgId === msgId)) {
                messagesDatabase[room].push(packetToSend);
            }
            // Показываем чат у собеседника на лету, если он сейчас в сети
            socket.to(room).emit('force join room', room);
        }

        // Пересылаем сообщение участникам комнаты
        io.to(room).emit('chat message', packetToSend);
    });

    socket.on('request profiles', () => { socket.emit('all profiles data', userProfiles); });
    socket.on('update profile', (packet) => {
        if (packet && packet.user && packet.data) {
            userProfiles[packet.user] = packet.data;
            socket.broadcast.emit('broadcast profile update', packet);
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            onlineUsers = onlineUsers.filter(user => user !== socket.username);
            io.emit('online users', onlineUsers);
        }
    });
});

server.listen(PORT, () => { console.log(`BurmaldaGram запущен на порту ${PORT}`); });

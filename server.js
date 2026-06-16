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

// Раздаем статические файлы (стили, картинки) прямо из корня проекта
app.use(express.static(__dirname));

// Главная страница авторизации
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Страница чата
app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

// Socket.io логика
io.on('connection', (socket) => {
    console.log('Новое подключение');

    socket.on('store user', (username) => {
        if (!username) return;
        socket.username = username;
        if (!onlineUsers.includes(username)) {
            onlineUsers.push(username);
        }
        io.emit('online users', onlineUsers);
    });

    socket.on('join room', (partnerName) => {
        if (!socket.username || !partnerName) return;
        const roomName = [socket.username, partnerName].sort().join('_');
        socket.join(roomName);
        socket.broadcast.emit('force join room', roomName);
    });

    socket.on('private chat message', (data) => {
        if (!data) return;
        const room = data.room;
        const text = data.text;
        const user = data.user || socket.username; 
        const msgId = data.msgId || ('msg-' + Date.now());
        const isRead = data.isRead || false;

        if (!room || !text) return;

        const packetToSend = { room, text, user, msgId, isRead };
        io.to(room).emit('chat message', packetToSend);
    });

    socket.on('request profiles', () => {
        socket.emit('all profiles data', userProfiles);
    });

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

server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});

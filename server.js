const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Хранилище активных профилей пользователей (ник -> данные профиля)
let userProfiles = {};
// Список пользователей, которые сейчас онлайн
let onlineUsers = [];

// ИСПРАВЛЕНО: Теперь раздаем статические файлы прямо из КОРНЯ проекта, а не из public!
app.use(express.static(__dirname));

// Главная страница (авторизация/вход)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ИСПРАВЛЕНО: Явно прописываем маршрут для чата, чтобы по ссылке /chat?auth=... открывался chat.html из корня
app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

// Работа со Socket.io
io.on('connection', (socket) => {
    console.log('Новое подключение к серверу');

    // 1. Авторизация и сохранение пользователя в онлайн-список
    socket.on('store user', (username) => {
        if (!username) return;
        socket.username = username;
        
        if (!onlineUsers.includes(username)) {
            onlineUsers.push(username);
        }
        
        // Отправляем всем обновленный список тех, кто онлайн
        io.emit('online users', onlineUsers);
        console.log(`Пользователь ${username} вошел в сеть`);
    });

    // 2. Вход пользователя в комнату тет-а-тет чата
    socket.on('join room', (partnerName) => {
        if (!socket.username || !partnerName) return;
        
        // Генерируем уникальное имя комнаты, сортируя ники по алфавиту
        const roomName = [socket.username, partnerName].sort().join('_');
        
        socket.join(roomName);
        console.log(`[Room] ${socket.username} зашел в комнату: ${roomName}`);
        
        // На всякий случай заставляем второго пользователя тоже зайти в эту комнату
        socket.broadcast.emit('force join room', roomName);
    });

    // 3. Универсальный обработчик приватных сообщений (понимает любые форматы)
    socket.on('private chat message', (data) => {
        if (!data) return;

        const room = data.room;
        const text = data.text;
        const user = data.user || socket.username; 
        const msgId = data.msgId || ('msg-' + Date.now());
        const isRead = data.isRead || false;

        if (!room || !text) return;

        const packetToSend = {
            room: room,
            text: text,
            user: user,
            msgId: msgId,
            isRead: isRead
        };

        // Рассылаем сообщение всем в комнате
        io.to(room).emit('chat message', packetToSend);
    });

    // 4. Запрос всех профилей при входе в чат
    socket.on('request profiles', () => {
        socket.emit('all profiles data', userProfiles);
    });

    // 5. Обновление и синхронизация профиля
    socket.on('update profile', (packet) => {
        if (packet && packet.user && packet.data) {
            userProfiles[packet.user] = packet.data;
            socket.broadcast.emit('broadcast profile update', packet);
        }
    });

    // 6. Обработка отключения пользователя от сети
    socket.on('disconnect', () => {
        if (socket.username) {
            onlineUsers = onlineUsers.filter(user => user !== socket.username);
            io.emit('online users', onlineUsers);
            console.log(`Пользователь ${socket.username} отключился`);
        }
    });
});

// Запуск сервера
server.listen(PORT, () => {
    console.log(`Сервер успешно запущен на порту ${PORT}`);
});

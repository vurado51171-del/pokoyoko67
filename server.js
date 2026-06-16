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

// Указываем, что статические файлы (HTML, CSS, JS) лежат в папке public
app.use(express.static(path.join(__dirname, 'public')));

// Главный маршрут
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
        // (например, "andrey_ostap" всегда будет одинаковым для обоих)
        const roomName = [socket.username, partnerName].sort().join('_');
        
        socket.join(roomName);
        console.log(`[Room] ${socket.username} зашел в комнату: ${roomName}`);
        
        // На всякий случай заставляем второго пользователя тоже зайти в эту комнату
        socket.broadcast.emit('force join room', roomName);
    });

    // 3. ИСПРАВЛЕННЫЙ ОБРАБОТЧИК ПРИВАТНЫХ СООБЩЕНИЙ
    socket.on('private chat message', (data) => {
        if (!data) return;

        // Сервер теперь всеяден: он вытащит данные, даже если фронтенд прислал целый msgPacket
        const room = data.room;
        const text = data.text;
        const user = data.user || socket.username; 
        const msgId = data.msgId || ('msg-' + Date.now());
        const isRead = data.isRead || false;

        // Если нет комнаты или текста, отменяем отправку
        if (!room || !text) return;

        // Собираем стандартизированный чистый пакет для отправки в сеть
        const packetToSend = {
            room: room,
            text: text,
            user: user,
            msgId: msgId,
            isRead: isRead
        };

        // Рассылаем сообщение абсолютно всем участникам этой комнаты (и тебе, и другу)
        io.to(room).emit('chat message', packetToSend);
    });

    // 4. Запрос всех профилей при входе в чат
    socket.on('request profiles', () => {
        socket.emit('all profiles data', userProfiles);
    });

    // 5. Обновление и синхронизация профиля (аватарка, ник, статус)
    socket.on('update profile', (packet) => {
        if (packet && packet.user && packet.data) {
            userProfiles[packet.user] = packet.data;
            // Рассылаем изменения всем остальным пользователям мессенджера
            socket.broadcast.emit('broadcast profile update', packet);
        }
    });

    // 6. Обработка отключения пользователя от сети
    socket.on('disconnect', () => {
        if (socket.username) {
            onlineUsers = onlineUsers.filter(user => user !== socket.username);
            // Говорим всем, что юзер вышел в офлайн
            io.emit('online users', onlineUsers);
            console.log(`Пользователь ${socket.username} отключился`);
        }
    });
});

// Запуск сервера
server.listen(PORT, () => {
    console.log(`Сервер Бурмалда Мессенджера успешно запущен на порту ${PORT}`);
    console.log(`Ссылка для проверки локально: http://localhost:${PORT}`);
});

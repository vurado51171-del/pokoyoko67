const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Если твои HTML-файлы лежат в папке public — оставляем.
// Если файлы лежат прямо в корне проекта (рядом с этим сервером), эту строку можно удалить:
app.use(express.static(__dirname + '/public'));

// Хранилище пользователей онлайн (для вывода статусов)
let onlineUsers = {};

// 1. РОУТ: Главная страница (Форма входа)
app.get('/', (req, res) => {
    // Если файлы в корне, замени на: res.sendFile(__dirname + '/index.html');
    res.sendFile(__dirname + '/public/index.html');
});

// 2. РОУТ: Страница чата (САМ МЕССЕНДЖЕР)
// Теперь сервер будет отдавать именно chat.html, никаких накладок!
app.get('/chat', (req, res) => {
    // Если файлы в корне, замени на: res.sendFile(__dirname + '/chat.html');
    res.sendFile(__dirname + '/public/chat.html');
});

// 3. РАБОТА С ВЕБ-СОКЕТАМИ (Socket.io)
io.on('connection', (socket) => {
    
    // Когда пользователь успешно заходит в чат и передает свой ник
    socket.on('store user', (username) => {
        if (!username) return;
        
        socket.username = username;
        onlineUsers[username] = socket.id; // Привязываем ник к ID сокета

        // Отправляем всем обновленный список людей онлайн
        io.emit('online users', Object.keys(onlineUsers));
        console.log(`[Burmalda] Пользователь ${username} вошел в сеть.`);
    });

    // Обработка входа в приватную комнату
    socket.on('join room', (partnerName) => {
        if (!socket.username || !partnerName) return;

        // Создаем уникальное имя комнаты (сортируем ники, чтобы у обоих была одна комната)
        const roomName = [socket.username, partnerName].sort().join('_');
        socket.join(roomName);

        // Магия: принудительно подключаем собеседника к этой же комнате, если он онлайн
        const partnerSocketId = onlineUsers[partnerName];
        if (partnerSocketId) {
            io.to(partnerSocketId).emit('force join room', roomName);
        }
    });

    // Получение и пересылка приватного сообщения
    socket.on('private chat message', (data) => {
        if (!socket.username || !data.room || !data.text) return;

        const messageData = {
            room: data.room,
            user: socket.username,
            text: data.text,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        // Отправляем сообщение строго внутри приватной комнаты
        io.to(data.room).emit('chat message', messageData);
    });

    // Отключение пользователя от сети
    socket.on('disconnect', () => {
        if (socket.username) {
            console.log(`[Burmalda] Пользователь ${socket.username} отключился.`);
            delete onlineUsers[socket.username];
            // Обновляем список онлайн для всех оставшихся
            io.emit('online users', Object.keys(onlineUsers));
        }
    });
});

// Запуск сервера на порту Render или локальном 3000
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`========= BURMALDA SERVER RUNNING ON PORT ${PORT} =========`);
});

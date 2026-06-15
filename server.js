const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Пам'ять сервера для збереження людей в онлайні: { id_сокета: "Нік" }
const activeUsers = {};

// 1. Головна сторінка — показує реєстрацію та введення пароля
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/register.html');
});

// 2. Сторінка чату — сюди перекидає після успішної авторизації
app.get('/chat', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Логіка WebSocket з'єднань
io.on('connection', (socket) => {
    console.log('Пользователь подключился');

    // Коли користувач входить у чат, прив'язуємо його нік до сокета
    socket.on('store user', (nick) => {
        activeUsers[socket.id] = nick;
        io.emit('online users', Object.values(activeUsers)); // Розсилаємо всім список онлайн
    });

    // Створення приватної кімнати між двома користувачами
    socket.on('join room', (targetNick) => {
        const myNick = activeUsers[socket.id];
        if (!myNick) return;

        // Генеруємо унікальну назву кімнати (наприклад, "Andriy_Burmalda")
        const roomName = [myNick, targetNick].sort().join('_');
        socket.join(roomName);

        // Шукаємо сокет нашого друга, щоб автоматично підключити його до цієї ж кімнати
        const targetSocketId = Object.keys(activeUsers).find(key => activeUsers[key] === targetNick);
        if (targetSocketId) {
            io.to(targetSocketId).emit('force join room', roomName);
        }
    });

    // Пересилання повідомлення СУТО всередині приватної кімнати
    socket.on('private chat message', ({ room, text }) => {
        const sender = activeUsers[socket.id] || 'Аноним';
        io.to(room).emit('chat message', { room, user: sender, text: text });
    });

    socket.on('disconnect', () => {
        delete activeUsers[socket.id];
        io.emit('online users', Object.values(activeUsers));
        console.log('Пользователь отключился');
    });
});

// Стартуємо сервер
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Сервер запущен! Порт: ${PORT}`);
});

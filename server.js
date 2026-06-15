const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Коли людина просто заходить на сайт (головна сторінка), показуємо реєстрацію
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/register.html');
});

// Новий маршрут: сюди людину перекине після того, як її нік збережеться в таблиці
app.get('/chat', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Логіка роботи з WebSocket-соединениями
io.on('connection', (socket) => {
    console.log('Пользователь подключился');

    // Слухаємо повідомлення від клієнта (тепер воно прилітає як об'єкт з ніком і текстом)
    socket.on('chat message', (msg) => {
        // Пересилаємо цей об'єкт усім підключеним користувачам
        io.emit('chat message', msg);
    });

    // Коли користувач закриває вкладку
    socket.on('disconnect', () => {
        console.log('Пользователь отключился');
    });
});

// Старт сервера на порту Render або 3000 для локальних тестів
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Сервер запущен! Порт: ${PORT}`);
});

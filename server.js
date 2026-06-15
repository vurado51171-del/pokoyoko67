  const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Указываем серверу отдавать файл index.html, когда кто-то заходит на http://localhost:3000
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Логика работы с WebSocket-соединениями
io.on('connection', (socket) => {
    console.log('Пользователь подключился');

    // Когда сервер получает событие 'chat message' от кого-то
    socket.on('chat message', (msg) => {
        // Он пересылает это сообщение ВСЕМ подключенным пользователям
        io.emit('chat message', msg);
    });

    // Когда пользователь закрывает вкладку
    socket.on('disconnect', () => {
        console.log('Пользователь отключился');
    });
});

// Стартуем сервер
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Сервер запущен! Открой в браузере: http://localhost:${PORT}`);
});

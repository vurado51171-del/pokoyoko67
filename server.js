const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Хранилище профилей (аватарки и био) на сервере в памяти
const globalProfiles = {};
// Хранилище онлайн пользователей { socketId: username }
const activeUsers = {};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

io.on('connection', (socket) => {
    
    // Регистрация пользователя при входе
    socket.on('store user', (username) => {
        socket.username = username;
        activeUsers[socket.id] = username;
        
        // Отправляем всем обновленный список онлайн-пользователей
        io.emit('online users', Object.values(activeUsers));
    });

    // Запрос всей базы профилей при загрузке страницы устройства
    socket.on('request profiles', () => {
        socket.emit('all profiles data', globalProfiles);
    });

    // Принимаем обновление профиля и пересылаем остальным устройствам
    socket.on('update profile', (packet) => {
        if (packet && packet.user) {
            globalProfiles[packet.user] = packet.data;
            // Рассылаем всем, кроме автора изменения
            socket.broadcast.emit('broadcast profile update', packet);
        }
    });

    // Обработка сообщений (включая сигналы печати и прочтения)
    socket.on('private chat message', (data) => {
        if (data && data.room) {
            socket.join(data.room);
            io.to(data.room).emit('chat message', data);
        }
    });

    // Вход в комнату чата
    socket.on('join room', (partner) => {
        if (socket.username) {
            const room = [socket.username, partner].sort().join('_');
            socket.join(room);
            // Форсируем подключение партнера к комнате, если он онлайн
            for (let id in activeUsers) {
                if (activeUsers[id] === partner) {
                    io.to(id).emit('force join room', room);
                }
            }
        }
    });

    // Отключение пользователя
    socket.on('disconnect', () => {
        delete activeUsers[socket.id];
        io.emit('online users', Object.values(activeUsers));
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});

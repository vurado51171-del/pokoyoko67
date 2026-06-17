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
            console.log('--- База даних BurmaldaGram успішно завантажена ---');
        } else {
            console.log('--- Створена нова чиста БД ---');
        }
    } catch (e) {
        console.error('Помилка при читанні бази даних:', e);
    }
}

function saveDatabase() {
    try {
        const dataToSave = { messagesDatabase, userProfiles };
        fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
    } catch (e) {
        console.error('Помилка при записі бази даних:', e);
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
    console.log(`Нове підключення: ${socket.id}`);

    // Авторизація онлайну
    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        socket.username = data.username;
        activeConnections[socket.id] = data.username;
        io.emit('online_list', getOnlineUsersList());
    });

    // Вхід у кімнату
    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);
    });

    // Обробка повідомлень (ВИПРАВЛЕНО: Пряма доставка незнайомцям)
    socket.on('chat_message', (data) => {
        if (!data || !data.room) return;
        const room = data.room;

        const packetToSend = { 
            id: data.id,
            room: data.room, 
            from: data.from, 
            to: data.to, 
            text: data.text, 
            type: data.type || 'text', 
            replyTo: data.replyTo || null,
            timestamp: data.timestamp || Date.now(),
            reactions: data.reactions || {},
            status: data.status || 'sent'
        };

        // Сервер не пише картинки в БД
        if (packetToSend.type !== 'image') {
            if (!messagesDatabase[room]) messagesDatabase[room] = [];
            if (!messagesDatabase[room].some(m => m.id === packetToSend.id)) {
                messagesDatabase[room].push(packetToSend);
                saveDatabase();
            }
        }

        // Пересилаємо повідомлення тим, хто в кімнаті
        socket.to(room).emit('chat_message', packetToSend);

        // ПРЯМА ВІДПРАВКА: Якщо отримувач онлайн, але ще не додав нас у друзі (не зайшов у кімнату)
        if (data.to) {
            for (let [sId, uname] of Object.entries(activeConnections)) {
                if (uname === data.to) {
                    io.to(sId).emit('chat_message', packetToSend);
                }
            }
        }
    });

    // Обробка прочитання повідомлень (ВИПРАВЛЕНО: Система галочок)
    socket.on('mark_read', (data) => {
        if (!data || !data.room || !data.reader) return;
        const { room, reader } = data;
        
        let updated = false;
        if (messagesDatabase[room]) {
            messagesDatabase[room].forEach(msg => {
                if (msg.from !== reader && msg.status !== 'read') {
                    msg.status = 'read';
                    updated = true;
                }
            });
            if (updated) saveDatabase();
        }

        // Відправляємо подію "прочитано" всім, хто відкрив чат
        socket.to(room).emit('messages_read', data);

        // Відправляємо подію "прочитано" відправнику напряму, якщо він сидить у меню
        const users = room.replace('room_', '').split('_');
        const senderNick = users[0] === reader ? users[1] : users[0];
        for (let [sId, uname] of Object.entries(activeConnections)) {
            if (uname === senderNick) {
                io.to(sId).emit('messages_read', data);
            }
        }
    });

    // Реакції
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

    // Видалення
    socket.on('delete_message', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('delete_message', data);
    });

    // Закріплення
    socket.on('pin_message', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('pin_message', data);
    });

    // Індикатор набору тексту
    socket.on('typing', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('typing_status', data);
    });

    // Оновлення профілю
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

server.listen(PORT, () => { console.log(`Сервер BurmaldaGram на порту ${PORT}`); });

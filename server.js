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

        let userDialogs = [];
        for (let roomName in messagesDatabase) {
            if (roomName.split('_').includes(username)) {
                const partner = roomName.replace(username, '').replace('_', '');
                if (partner && !userDialogs.includes(partner)) {
                    userDialogs.push(partner);
                }
            }
        }
        socket.emit('server dialogs list', userDialogs);
    });

    socket.on('join room', (partnerName) => {
        if (!socket.username || !partnerName) return;
        const roomName = [socket.username, partnerName].sort().join('_');
        socket.join(roomName);

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

        const packetToSend = { 
            room, 
            text, 
            user, 
            msgId, 
            isRead, 
            time: data.time || Date.now(),
            reactions: data.reactions || {} // Инициализируем пустое поле реакций
        };

        if (text !== '[TYPING_SIGNAL]' && text !== '[READ_SIGNAL]') {
            if (!messagesDatabase[room]) messagesDatabase[room] = [];
            
            if (!messagesDatabase[room].some(m => m.msgId === msgId)) {
                messagesDatabase[room].push(packetToSend);
            }
            socket.to(room).emit('force join room', room);
        }

        io.to(room).emit('chat message', packetToSend);
    });

    // НОВОЕ: Обработка отправки/изменения реакции
    socket.on('message_reaction', (data) => {
        if (!data || !data.room || !data.msgId) return;
        const { room, msgId, reaction, username } = data;

        if (messagesDatabase[room]) {
            // Ищем сообщение в базе данных сервера
            const msg = messagesDatabase[room].find(m => m.msgId === msgId);
            if (msg) {
                if (!msg.reactions) msg.reactions = {};

                // Удаляем старую реакцию этого пользователя под этим сообщением
                Object.keys(msg.reactions).forEach(emoji => {
                    if (Array.isArray(msg.reactions[emoji])) {
                        msg.reactions[emoji] = msg.reactions[emoji].filter(u => u !== username);
                        if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
                    }
                });

                // Если прилетел эмодзи (а не null для отмены), добавляем голос юзера
                if (reaction) {
                    if (!msg.reactions[reaction]) msg.reactions[reaction] = [];
                    msg.reactions[reaction].push(username);
                }

                // Отправляем всем участникам комнаты обновленное состояние сообщения
                io.to(room).emit('update_message_data', { room, msgId, reactions: msg.reactions });
            }
        }
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

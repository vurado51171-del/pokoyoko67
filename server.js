const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });
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

    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        socket.username = data.username;
        activeConnections[socket.id] = data.username;
        
        if (!userProfiles[data.username]) {
            userProfiles[data.username] = { 
                chatList: [], displayName: data.username, bio: '', avatar: '', blockedUsers: [] 
            };
            saveDatabase();
        }

        io.emit('online_list', getOnlineUsersList());
        socket.emit('restore_chats', userProfiles[data.username].chatList || []);
    });

    socket.on('check_user_exists', (data) => {
        const target = data.username;
        const exists = !!userProfiles[target] || Object.values(activeConnections).includes(target);
        socket.emit('user_exists_result', { exists, username: target });
    
        if (exists && socket.username) {
            if (!userProfiles[socket.username].chatList) userProfiles[socket.username].chatList = [];
            if (!userProfiles[socket.username].chatList.includes(target)) {
                userProfiles[socket.username].chatList.push(target);
                saveDatabase();
            }
        }
    });

    socket.on('sync_chat_list', (data) => {
        if (socket.username && data.chatList) {
            if (!userProfiles[socket.username]) userProfiles[socket.username] = {};
            userProfiles[socket.username].chatList = data.chatList;
            saveDatabase();
        }
    });

    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);
    });

    socket.on('block_user', (data) => {
        if (!socket.username || !data.target) return;
        
        if (!userProfiles[socket.username]) userProfiles[socket.username] = { chatList: [], blockedUsers: [] };
        if (!userProfiles[socket.username].blockedUsers) userProfiles[socket.username].blockedUsers = [];

        const roomSorted = [socket.username, data.target].sort(); 
        const room = `room_${roomSorted[0]}_${roomSorted[1]}`;

        if (data.blocked) {
            if (!userProfiles[socket.username].blockedUsers.includes(data.target)) {
                userProfiles[socket.username].blockedUsers.push(data.target);
                saveDatabase();
            }
            for (let [sId, uname] of Object.entries(activeConnections)) {
                if (uname === data.target) io.to(sId).emit('user_blocked_you', { room: room, blocked: true });
            }
        } else {
            userProfiles[socket.username].blockedUsers = userProfiles[socket.username].blockedUsers.filter(u => u !== data.target);
            saveDatabase();
            for (let [sId, uname] of Object.entries(activeConnections)) {
                if (uname === data.target) io.to(sId).emit('user_blocked_you', { room: room, blocked: false });
            }
        }
    });

    socket.on('chat_message', (data) => {
        if (!data || !data.room) return;
        const room = data.room;

        const packetToSend = { 
            id: data.id, room: data.room, from: data.from, to: data.to, 
            text: data.text, type: data.type || 'text', replyTo: data.replyTo || null,
            timestamp: data.timestamp || Date.now(), reactions: data.reactions || {},
            status: data.status || 'sent', edited: false
        };

        if (packetToSend.to && userProfiles[packetToSend.to] && userProfiles[packetToSend.to].blockedUsers) {
            if (userProfiles[packetToSend.to].blockedUsers.includes(packetToSend.from)) { return; }
        }

        if (packetToSend.type === 'text' && typeof packetToSend.text === 'string') {
            packetToSend.text = packetToSend.text.replace(/[&<>'"]/g, tag => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
            }[tag] || tag));
        }

        if (packetToSend.type === 'text' || packetToSend.type === 'sticker') {
            if (!messagesDatabase[room]) messagesDatabase[room] = [];
            if (!messagesDatabase[room].some(m => m.id === packetToSend.id)) {
                messagesDatabase[room].push(packetToSend);
                saveDatabase();
            }
        }

        if (packetToSend.from && packetToSend.to) {
            const sender = packetToSend.from;
            const receiver = packetToSend.to;
            
            [sender, receiver].forEach(user => {
                if (!userProfiles[user]) userProfiles[user] = { chatList: [] };
                if (!userProfiles[user].chatList) userProfiles[user].chatList = [];
                const partner = (user === sender) ? receiver : sender;
                if (!userProfiles[user].chatList.includes(partner)) {
                    userProfiles[user].chatList.push(partner);
                    saveDatabase();
                }
            });
        }

        socket.to(room).emit('chat_message', packetToSend);
        if (data.to) {
            for (let [sId, uname] of Object.entries(activeConnections)) {
                if (uname === data.to) io.to(sId).emit('chat_message', packetToSend);
            }
        }
    });

    socket.on('edit_message', (data) => {
        if (!data || !data.room || !data.msgId || !data.newText) return;
        const room = data.room;
        
        if (messagesDatabase[room]) {
            const msg = messagesDatabase[room].find(m => m.id === data.msgId);
            if (msg && msg.from === socket.username) {
                msg.text = typeof data.newText === 'string' ? data.newText.replace(/[&<>'"]/g, tag => ({
                    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
                }[tag] || tag)) : data.newText;
                msg.edited = true;
                saveDatabase();
                
                socket.to(room).emit('edit_message', { room, msgId: data.msgId, newText: msg.text });
                
                const users = room.replace('room_', '').split('_');
                const receiver = users.find(u => u !== socket.username);
                if (receiver) {
                    for (let [sId, uname] of Object.entries(activeConnections)) {
                        if (uname === receiver) io.to(sId).emit('edit_message', { room, msgId: data.msgId, newText: msg.text });
                    }
                }
            }
        }
    });

    socket.on('mark_read', (data) => {
        if (!data || !data.room || !data.reader) return;
        const { room, reader } = data;
        let updated = false;
        if (messagesDatabase[room]) {
            messagesDatabase[room].forEach(msg => {
                if (msg.from !== reader && msg.status !== 'read') {
                    msg.status = 'read'; updated = true;
                }
            });
            if (updated) saveDatabase();
        }
        socket.to(room).emit('messages_read', data);

        const users = room.replace('room_', '').split('_');
        const senderNick = users[0] === reader ? users[1] : users[0];
        for (let [sId, uname] of Object.entries(activeConnections)) {
            if (uname === senderNick) io.to(sId).emit('messages_read', data);
        }
    });

    socket.on('delete_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messagesDatabase[data.room]) {
            messagesDatabase[data.room] = messagesDatabase[data.room].filter(m => m.id !== data.msgId);
            saveDatabase();
        }
        socket.to(data.room).emit('delete_message', data);
    });

    socket.on('message_reaction', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messagesDatabase[data.room]) {
            const msg = messagesDatabase[data.room].find(m => m.id === data.msgId);
            if (msg) { msg.reactions = data.reactions || {}; saveDatabase(); }
        }
        socket.to(data.room).emit('message_reaction', data);
    });

    socket.on('pin_message', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('pin_message', data);
    });

    socket.on('typing', (data) => {
        if (!data || !data.room) return;
        socket.to(data.room).emit('typing_status', data);
    });

    socket.on('update_profile', (packet) => {
        if (packet && packet.username && packet.data) {
            if (!userProfiles[packet.username]) userProfiles[packet.username] = { chatList: [] };
            userProfiles[packet.username] = { ...userProfiles[packet.username], ...packet.data };
            saveDatabase();
            socket.broadcast.emit('profile_broadcast', packet);
        }
    });

    // --- WebRTC СИГНАЛІНГ ДЛЯ ДЗВІНКІВ ---
    socket.on('call_request', (data) => socket.to(data.room).emit('call_request', data));
    socket.on('call_accept', (data) => socket.to(data.room).emit('call_accept', data));
    socket.on('call_offer', (data) => socket.to(data.room).emit('call_offer', data));
    socket.on('call_answer', (data) => socket.to(data.room).emit('call_answer', data));
    socket.on('call_ice_candidate', (data) => socket.to(data.room).emit('call_ice_candidate', data));
    socket.on('call_end', (data) => socket.to(data.room).emit('call_end', data));
    socket.on('call_reject', (data) => socket.to(data.room).emit('call_reject', data)); // Додано подію відхилення

    socket.on('disconnect', () => {
        if (socket.id in activeConnections) delete activeConnections[socket.id];
        io.emit('online_list', getOnlineUsersList());
    });
});

server.listen(PORT, () => { console.log(`Сервер BurmaldaGram на порту ${PORT}`); });

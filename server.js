const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Ліміт 100MB для кружків, фото та голосових
const io = new Server(server, { maxHttpBufferSize: 1e8 }); 

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

let userProfiles = {};
let messagesDatabase = {};
let activeConnections = {}; // username -> socket.id

// --- ЗАВАНТАЖЕННЯ ТА ЗБЕРЕЖЕННЯ БД ---
function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const rawData = fs.readFileSync(DB_FILE, 'utf8');
            const parsed = JSON.parse(rawData);
            messagesDatabase = parsed.messagesDatabase || {};
            userProfiles = parsed.userProfiles || {};
            console.log('--- База даних успішно завантажена ---');
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
        console.error('Помилка при збереженні бази даних:', e);
    }
}

loadDatabase();

// --- МАРШРУТИЗАЦІЯ (Ось тут виправлено помилку Cannot GET) ---

// Дозволяємо Express шукати статичні файли в колірні сайту та в папці public (якщо вона є)
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// Якщо користувач переходить на головну сторінку (http://.../)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

// Якщо користувач переходить на сторінку чату (http://.../chat)
app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});


// --- SOCKET.IO ЛОГІКА ---
io.on('connection', (socket) => {
    let sessionUser = null;

    socket.on('online_ping', (data) => {
        if (!data || !data.username) return;
        sessionUser = data.username;
        activeConnections[sessionUser] = socket.id;

        if (!userProfiles[sessionUser]) {
            userProfiles[sessionUser] = { chatList: [], displayName: sessionUser, bio: '' };
        }
        if (!userProfiles[sessionUser].chatList) {
            userProfiles[sessionUser].chatList = [];
        }

        io.emit('online_list', Object.keys(activeConnections));
        socket.emit('restore_chats', userProfiles[sessionUser].chatList);

        Object.keys(userProfiles).forEach(username => {
            socket.emit('profile_broadcast', { username, data: userProfiles[username] });
        });
    });

    socket.on('check_user_exists', (data) => {
        if (!data || !data.username) return;
        const exists = userProfiles[data.username] ? true : false;
        socket.emit('user_exists_result', { username: data.username, exists });
    });

    socket.on('join_room', (data) => {
        if (!data || !data.room) return;
        socket.join(data.room);

        const pinnedKey = data.room + '_pinned';
        if (messagesDatabase[pinnedKey] && messagesDatabase[pinnedKey].length > 0) {
            socket.emit('pin_message', { room: data.room, pinned: messagesDatabase[pinnedKey] });
        }
    });

    socket.on('request_history', (data) => {
        if (!data || !data.room) return;
        const history = messagesDatabase[data.room] || [];
        socket.emit('room_history', history);
    });

    socket.on('chat_message', (msg) => {
        if (!msg || !msg.room || !msg.from || !msg.to) return;

        if (!userProfiles[msg.from]) userProfiles[msg.from] = { chatList: [], displayName: msg.from, bio: '' };
        if (!userProfiles[msg.to]) userProfiles[msg.to] = { chatList: [], displayName: msg.to, bio: '' };
        if (!userProfiles[msg.from].chatList) userProfiles[msg.from].chatList = [];
        if (!userProfiles[msg.to].chatList) userProfiles[msg.to].chatList = [];

        if (!messagesDatabase[msg.room]) messagesDatabase[msg.room] = [];
        messagesDatabase[msg.room].push(msg);

        if (!userProfiles[msg.from].chatList.includes(msg.to)) {
            userProfiles[msg.from].chatList.push(msg.to);
        }
        if (!userProfiles[msg.to].chatList.includes(msg.from)) {
            userProfiles[msg.to].chatList.push(msg.from);
            const targetSocket = activeConnections[msg.to];
            if (targetSocket) {
                io.to(targetSocket).emit('restore_chats', userProfiles[msg.to].chatList);
            }
        }

        saveDatabase();
        socket.to(msg.room).emit('chat_message', msg);
    });

    socket.on('sync_chat_list', (data) => {
        if (sessionUser && data && data.chatList) {
            if (!userProfiles[sessionUser]) userProfiles[sessionUser] = { chatList: [] };
            userProfiles[sessionUser].chatList = data.chatList;
            saveDatabase();
        }
    });

    socket.on('webrtc_signal', (data) => {
        if (!data || !data.target) return;
        const targetSocketId = activeConnections[data.target];
        if (targetSocketId) {
            io.to(targetSocketId).emit('webrtc_signal', data);
        }
    });

    socket.on('mark_read', (data) => {
        if (!data || !data.room || !data.reader) return;
        if (messagesDatabase[data.room] && Array.isArray(messagesDatabase[data.room])) {
            messagesDatabase[data.room].forEach(m => {
                if (m && m.from !== data.reader) m.status = 'read';
            });
            saveDatabase();
        }
        socket.to(data.room).emit('messages_read', data);
    });

    socket.on('edit_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messagesDatabase[data.room] && Array.isArray(messagesDatabase[data.room])) {
            const msg = messagesDatabase[data.room].find(m => m && m.id === data.msgId);
            if (msg) {
                msg.text = data.newText;
                msg.edited = true;
                saveDatabase();
            }
        }
        socket.to(data.room).emit('edit_message', data);
    });

    socket.on('delete_message', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messagesDatabase[data.room] && Array.isArray(messagesDatabase[data.room])) {
            messagesDatabase[data.room] = messagesDatabase[data.room].filter(m => m && m.id !== data.msgId);
            saveDatabase();
        }
        socket.to(data.room).emit('delete_message', data);
    });

    socket.on('message_reaction', (data) => {
        if (!data || !data.room || !data.msgId) return;
        if (messagesDatabase[data.room] && Array.isArray(messagesDatabase[data.room])) {
            const msg = messagesDatabase[data.room].find(m => m && m.id === data.msgId);
            if (msg) {
                msg.reactions = data.reactions || {};
                saveDatabase();
            }
        }
        socket.to(data.room).emit('message_reaction', data);
    });

    socket.on('pin_message', (data) => {
        if (!data || !data.room) return;
        const pinnedKey = data.room + '_pinned';
        messagesDatabase[pinnedKey] = data.pinned || [];
        saveDatabase();
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

    socket.on('disconnect', () => {
        if (sessionUser) {
            delete activeConnections[sessionUser];
            io.emit('online_list', Object.keys(activeConnections));
        }
    });
});

server.listen(PORT, () => {
    console.log(`=== Сервер BurmaldaGram запущено на порту ${PORT} ===`);
});

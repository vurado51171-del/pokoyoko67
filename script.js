// Базові налаштування
let currentTheme = localStorage.getItem('burmalda_theme') || 'theme-dark';
document.body.className = currentTheme;
const urlParams = new URLSearchParams(window.location.search);
const authToken = urlParams.get('auth');
let myNick = 'Анонім';
let authorized = false;

// Декодування токена
if (authToken) {
    try {
        const decoded = decodeURIComponent(atob(authToken));
        const parts = decoded.split('_');
        myNick = parts[0]; 
        authorized = true;
    } catch (e) { console.error("Помилка авторизації:", e); }
}

if (!authorized) { 
    alert('Доступ заблоковано!'); window.location.href = '/'; 
} else { 
    document.body.style.display = 'flex'; 
}

const socket = io();
let currentRoom = null;
let currentActiveChatPartner = null;
let onlineUsers = [];
let savedMessages = {};
let localProfiles = {};
let activeChats = []; // Тепер це буде братися з сервера!

// --- СИНХРОНІЗАЦІЯ З СЕРВЕРОМ ---
socket.on('connect', () => { 
    socket.emit('online_ping', { username: myNick }); 
    socket.emit('login_account', myNick); // Просимо сервер віддати наші контакти
});

socket.on('account_data_loaded', (data) => {
    activeChats = data.contacts || [];
    localProfiles = { ...localProfiles, ...(data.profiles || {}) };
    renderChatsList();
});

function saveActiveChats() {
    // Зберігаємо не в localStorage, а на сервері!
    socket.emit('save_contacts', { username: myNick, contacts: activeChats });
    renderChatsList();
}

function openChatWith(username) { 
    currentActiveChatPartner = username;
    const roomSorted = [myNick, username].sort(); 
    currentRoom = `room_${roomSorted[0]}_${roomSorted[1]}`; 
    
    document.body.classList.add('chat-opened'); 
    document.getElementById('no-chat-placeholder').style.display = 'none'; 
    document.getElementById('chat-area').style.display = 'flex'; 
    
    socket.emit('join_room', { room: currentRoom, user: myNick });
    
    if (!activeChats.includes(username)) { 
        activeChats.push(username); 
        saveActiveChats(); 
    }
    document.getElementById('chat-title-text').innerHTML = `<span>${username}</span>`;
    loadMessagesHistory();
}

// --- ЛОГІКА ЗАПИСУ КРУЖЕЧКІВ ТА АУДІО ---
let mediaRecorder = null;
let recordedChunks = [];
let currentRecordType = null;
let recordTimerInterval;
let recordSeconds = 0;

async function startMediaRecording(type) {
    currentRecordType = type;
    const isVideo = type === 'video_circle';
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true, 
            video: isVideo ? { facingMode: "user" } : false 
        });
        
        document.getElementById('form').style.display = 'none';
        const overlay = document.getElementById('record-overlay');
        overlay.style.display = 'flex';
        
        const preview = document.getElementById('record-preview');
        preview.srcObject = stream;
        
        if (isVideo) {
            preview.className = 'record-preview-circle'; // Великий розмір
            preview.style.display = 'block';
        } else {
            preview.style.display = 'none'; // Ховаємо, якщо аудіо
        }

        mediaRecorder = new MediaRecorder(stream);
        recordedChunks = [];
        recordSeconds = 0;
        document.getElementById('record-timer').textContent = '00:00';
        
        recordTimerInterval = setInterval(() => {
            recordSeconds++;
            const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
            const s = String(recordSeconds % 60).padStart(2, '0');
            document.getElementById('record-timer').textContent = `${m}:${s}`;
        }, 1000);

        mediaRecorder.ondataavailable = e => { if(e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            clearInterval(recordTimerInterval);
            stream.getTracks().forEach(t => t.stop());
            preview.srcObject = null;
            
            if (!window.cancelCurrentRecord) {
                const mimeType = type === 'video_circle' ? 'video/webm' : 'audio/webm';
                const blob = new Blob(recordedChunks, { type: mimeType });
                const reader = new FileReader();
                reader.onloadend = () => { sendSpecialMessage(reader.result, type); };
                reader.readAsDataURL(blob);
            }
            window.cancelCurrentRecord = false;
            closeRecordUI();
        };
        mediaRecorder.start();
    } catch(e) {
        alert('Помилка доступу до камери/мікрофона');
        console.error(e);
        closeRecordUI();
    }
}

function pauseResumeRecord() {
    if (!mediaRecorder) return;
    const btn = document.getElementById('btn-pause-record');
    
    if (mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
        clearInterval(recordTimerInterval);
        btn.textContent = '▶';
    } else if (mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
        recordTimerInterval = setInterval(() => {
            recordSeconds++;
            const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
            const s = String(recordSeconds % 60).padStart(2, '0');
            document.getElementById('record-timer').textContent = `${m}:${s}`;
        }, 1000);
        btn.textContent = '⏸';
    }
}

function deleteRecord() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        window.cancelCurrentRecord = true;
        mediaRecorder.stop();
    } else { closeRecordUI(); }
}

function finishAndSendRecord() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') { mediaRecorder.stop(); }
}

function closeRecordUI() {
    clearInterval(recordTimerInterval);
    document.getElementById('record-overlay').style.display = 'none';
    document.getElementById('form').style.display = 'flex';
    currentRecordType = null;
}

function sendSpecialMessage(dataStr, type) {
    if (!currentRoom) return;
    const msgId = type + '_' + Date.now();
    const msgPayload = { id: msgId, room: currentRoom, from: myNick, to: currentActiveChatPartner, text: dataStr, type: type, timestamp: Date.now() };
    
    if (!savedMessages[currentRoom]) savedMessages[currentRoom] = [];
    savedMessages[currentRoom].push(msgPayload);
    
    socket.emit('chat_message', msgPayload); 
    appendSingleMessage(msgPayload);
    document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
}

document.getElementById('form').onsubmit = (e) => { 
    e.preventDefault();
    const input = document.getElementById('input');
    const val = input.value.trim(); if (!val || !currentRoom) return; 
    
    const msgPayload = { id: 'msg_' + Date.now(), room: currentRoom, from: myNick, to: currentActiveChatPartner, text: val, type: 'text', timestamp: Date.now() };
    if (!savedMessages[currentRoom]) savedMessages[currentRoom] = [];
    savedMessages[currentRoom].push(msgPayload);

    socket.emit('chat_message', msgPayload); 
    appendSingleMessage(msgPayload);
    input.value = '';
    document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
};

function appendSingleMessage(msg) {
    const ul = document.getElementById('messages');
    const liWrapper = document.createElement('div');
    liWrapper.className = `msg-container ${msg.from === myNick ? 'my-wrapper' : ''}`;
    
    const li = document.createElement('li');
    if (msg.from === myNick) li.className = 'my-msg'; 

    if (['video_circle', 'audio', 'image', 'sticker'].includes(msg.type)) li.classList.add('msg-transparent');

    if (msg.type === 'video_circle') {
        li.innerHTML = `<video src="${msg.text}" autoplay loop muted class="circle-video"></video>`;
    } else if (msg.type === 'audio') {
        li.innerHTML = `<audio controls src="${msg.text}"></audio>`;
    } else {
        li.textContent = msg.text;
    }
    
    liWrapper.appendChild(li);
    ul.appendChild(liWrapper);
}

socket.on('chat_message', (msg) => { 
    if (!savedMessages[msg.room]) savedMessages[msg.room] = [];
    savedMessages[msg.room].push(msg);
    if (msg.room === currentRoom) {
        appendSingleMessage(msg);
        document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
    }
    if (!activeChats.includes(msg.from) && msg.from !== myNick) {
        activeChats.push(msg.from);
        saveActiveChats();
    }
});

function renderChatsList() {
    const list = document.getElementById('chats-list');
    list.innerHTML = '';
    activeChats.forEach(user => {
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.textContent = user;
        div.onclick = () => openChatWith(user);
        list.appendChild(div);
    });
}

function loadMessagesHistory() {
    document.getElementById('messages').innerHTML = '';
    const history = savedMessages[currentRoom] || [];
    history.forEach(msg => appendSingleMessage(msg));
}

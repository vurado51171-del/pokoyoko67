// --- Ініціалізація DOM-елементів ---
const searchInput = document.getElementById('search-input');
const input = document.getElementById('message-input');
const button = document.getElementById('send-button');
const settingsModal = document.getElementById('settings-modal');
const messagesContainer = document.getElementById('chat-messages');
const dialogsList = document.getElementById('dialogs-list');
const chatHeaderTitle = document.getElementById('chat-header-title');

// --- Глобальні змінні стану ---
let socket;
let currentChat = null;
let onlineUsers = [];
let localProfiles = JSON.parse(localStorage.getItem('burmalda_profiles')) || {};
let messagesData = JSON.parse(localStorage.getItem(getStorageKey('burmalda_messages'))) || {};
let pinnedMessages = JSON.parse(localStorage.getItem(getStorageKey('burmalda_pinned'))) || {};

// Змінні для WebRTC та медіа
let mediaRecorder;
let recordedChunks = [];
let localStream = null;
let peerConnection = null;

// --- Ініціалізація Socket.io ---
try {
    socket = io(); // Підключення до сервера
    
    socket.emit('user_login', myNick);

    socket.on('online_users', (users) => {
        onlineUsers = users;
        renderChatsList();
        if (currentChat) updateChatTitle();
    });

    socket.on('receive_message', (msg) => {
        if (!messagesData[msg.chatId]) messagesData[msg.chatId] = [];
        messagesData[msg.chatId].push(msg);
        saveMessages();
        
        if (currentChat === msg.from || currentChat === msg.chatId) {
            appendMessageToDOM(msg);
            scrollToBottom();
        }
        renderChatsList();
    });

    socket.on('user_typing', (data) => {
        if (currentChat === data.nick) {
            showTypingIndicator(data.nick);
        }
    });

} catch (error) {
    console.warn("Socket.io не ініціалізовано. Перевірте підключення до сервера.");
}

// --- Допоміжні функції профілю ---
function getVisibleName(nick) {
    if (localProfiles[nick] && localProfiles[nick].customName) {
        return localProfiles[nick].customName;
    }
    return nick;
}

function getAvatarHTML(nick) {
    const data = localProfiles[nick] || {};
    const color = data.glowColor || 'white';
    if (data.avatar) {
        return `<img src="${data.avatar}" class="avatar-img" style="box-shadow: 0 0 10px ${GLOW_COLORS[color]}; border: 2px solid ${GLOW_COLORS[color]}; width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">`;
    }
    const letter = nick.charAt(0).toUpperCase();
    return `<div class="avatar-stub" style="box-shadow: 0 0 10px ${GLOW_COLORS[color]}; border: 2px solid ${GLOW_COLORS[color]}; background: rgba(255,255,255,0.1); backdrop-filter: blur(5px); color: ${GLOW_COLORS[color]}; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold;">${letter}</div>`;
}

// --- Рендер та UI ---
function renderChatsList() {
    if (!dialogsList) return;
    dialogsList.innerHTML = '';
    const filter = searchInput ? searchInput.value.toLowerCase() : '';
    
    // Збираємо всіх користувачів, з ким є історія + онлайн
    const allContacts = new Set([...onlineUsers, ...Object.keys(messagesData)]);
    allContacts.delete(myNick);

    let hasVisible = false;

    allContacts.forEach(contact => {
        const visibleName = getVisibleName(contact);
        if (filter && !visibleName.toLowerCase().includes(filter) && !contact.toLowerCase().includes(filter)) return;
        
        hasVisible = true;
        const isOnline = onlineUsers.includes(contact);
        const li = document.createElement('li');
        li.className = 'dialog-item';
        if (currentChat === contact) li.classList.add('active-dialog');
        
        li.innerHTML = `
            ${getAvatarHTML(contact)}
            <div class="dialog-info">
                <div class="dialog-name">${visibleName}</div>
                <div class="dialog-status" style="color: ${isOnline ? 'var(--neon-green)' : 'var(--text-muted)'}; font-size: 12px;">
                    ${isOnline ? translations[currentLang].chatStatusOnline : translations[currentLang].chatStatusOffline}
                </div>
            </div>
        `;
        li.onclick = () => openChat(contact);
        dialogsList.appendChild(li);
    });

    if (!hasVisible) {
        dialogsList.innerHTML = `<div style="text-align: center; color: var(--text-muted); margin-top: 20px;">${translations[currentLang].emptyList}</div>`;
    }
}

function openChat(contactNick) {
    if (contactNick === myNick) {
        alert(translations[currentLang].selfChatError);
        return;
    }
    currentChat = contactNick;
    document.getElementById('placeholder-screen').style.display = 'none';
    document.getElementById('chat-main').style.display = 'flex';
    
    renderChatsList(); // Оновлюємо активний клас
    updateChatTitle();
    loadMessagesHistory();
    
    // Адаптив: на мобільних приховуємо список діалогів
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').style.display = 'none';
    }
}

function updateChatTitle() {
    if (!chatHeaderTitle || !currentChat) return;
    const isOnline = onlineUsers.includes(currentChat);
    const visibleName = getVisibleName(currentChat);
    
    chatHeaderTitle.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;" onclick="openProfile('${currentChat}')">
            ${getAvatarHTML(currentChat)}
            <div>
                <div style="font-weight: bold; text-shadow: 0 0 5px rgba(255,255,255,0.5);">${visibleName}</div>
                <div style="font-size: 12px; color: ${isOnline ? 'var(--neon-green)' : 'var(--text-muted)'};">
                    ${isOnline ? translations[currentLang].chatStatusOnline : translations[currentLang].chatStatusOffline}
                </div>
            </div>
        </div>
    `;
}

// --- Повідомлення ---
function saveMessages() {
    localStorage.setItem(getStorageKey('burmalda_messages'), JSON.stringify(messagesData));
}

function loadMessagesHistory() {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';
    const chatHistory = messagesData[currentChat] || [];
    chatHistory.forEach(msg => appendMessageToDOM(msg));
    scrollToBottom();
}

function appendMessageToDOM(msg) {
    const msgDiv = document.createElement('div');
    const isMe = msg.from === myNick;
    msgDiv.className = `message ${isMe ? 'message-out' : 'message-in'}`;
    msgDiv.id = `msg-${msg.id}`;
    
    // Форматування тексту
    let contentHTML = msg.text.replace(/\n/g, '<br>');
    if (msg.mediaUrl) {
        if (msg.mediaType === 'image') contentHTML += `<img src="${msg.mediaUrl}" class="msg-image" onclick="openFullscreen('${msg.mediaUrl}')">`;
        if (msg.mediaType === 'video-circle') contentHTML += `<video src="${msg.mediaUrl}" class="msg-video-circle" autoplay loop muted playsinline></video>`;
        if (msg.mediaType === 'audio') contentHTML += `<audio src="${msg.mediaUrl}" controls class="msg-audio"></audio>`;
    }

    msgDiv.innerHTML = `
        <div class="msg-bubble">
            ${contentHTML}
            <span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
    `;
    
    // Контекстне меню по правому кліку/довгому тапу
    msgDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.pageX, e.pageY, msg, isMe);
    });

    messagesContainer.appendChild(msgDiv);
}

function sendMessage() {
    if (!currentChat) return;
    const text = input.value.trim();
    if (!text) return;

    const msg = {
        id: Date.now().toString(),
        chatId: currentChat,
        from: myNick,
        to: currentChat,
        text: text,
        timestamp: Date.now()
    };

    if (!messagesData[currentChat]) messagesData[currentChat] = [];
    messagesData[currentChat].push(msg);
    saveMessages();
    appendMessageToDOM(msg);
    scrollToBottom();
    
    if (socket) socket.emit('send_message', msg);
    input.value = '';
    input.focus();
}

// --- WebRTC (Кружочки та Аудіо) ---
async function startVideoCircle() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
        // Логіка запису кружечка (MediaRecorder)
        startRecording('video-circle');
    } catch (err) {
        console.error("Помилка доступу до камери (WebRTC):", err);
        alert("Не вдалося отримати доступ до камери.");
    }
}

async function startAudioRecording() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        startRecording('audio');
    } catch (err) {
        console.error("Помилка доступу до мікрофона:", err);
    }
}

function startRecording(type) {
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(localStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => processMediaData(type);
    mediaRecorder.start();
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
}

function processMediaData(type) {
    const blob = new Blob(recordedChunks, { type: type === 'video-circle' ? 'video/webm' : 'audio/webm' });
    const reader = new FileReader();
    reader.onloadend = () => {
        const msg = {
            id: Date.now().toString(),
            chatId: currentChat,
            from: myNick,
            to: currentChat,
            text: "",
            mediaUrl: reader.result,
            mediaType: type,
            timestamp: Date.now()
        };
        if (socket) socket.emit('send_message', msg);
        if (!messagesData[currentChat]) messagesData[currentChat] = [];
        messagesData[currentChat].push(msg);
        saveMessages();
        appendMessageToDOM(msg);
        scrollToBottom();
    };
    reader.readAsDataURL(blob);
}

// --- Утиліти ---
function scrollToBottom() {
    if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function compressImage(file, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1200;
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Обробники подій
if (button) button.addEventListener('click', sendMessage);
if (input) {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        } else if (socket && currentChat) {
            socket.emit('typing', { from: myNick, to: currentChat });
        }
    });
}
if (searchInput) searchInput.addEventListener('input', renderChatsList);

// Первинний запуск
applyLanguage(); // Виклик функції з style.js для застосування поточних перекладів

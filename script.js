// Ініціалізація основних змінних та DOM-елементів
let socket;
try {
    socket = io();
} catch(e) {
    console.warn("Socket.io не знайдено, працюємо в автономному режимі:", e);
    socket = { emit: () => {}, on: () => {} };
}

let onlineUsers = [];
let localProfiles = JSON.parse(localStorage.getItem('burmalda_profiles') || '{}');
let chatsList = JSON.parse(localStorage.getItem(getStorageKey('burmalda_chats')) || '[]');
let messagesHistory = JSON.parse(localStorage.getItem(getStorageKey('burmalda_messages')) || '{}');
let pinnedMessages = JSON.parse(localStorage.getItem(getStorageKey('burmalda_pinned')) || '{}');

let currentChatUser = null;
let replyToId = null;
let editingMessageId = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecordingAudio = false;

// DOM елементи
const searchInput = document.getElementById('search-input');
const input = document.getElementById('message-input');
const button = document.getElementById('btn-send');
const messagesContainer = document.getElementById('messages-container');
const chatsListContainer = document.getElementById('chats-list');
const settingsModal = document.getElementById('settings-modal');
const chatTitleEl = document.getElementById('chat-title-text');
const chatStatusEl = document.getElementById('chat-status-text');

// Хелпери для відображення імен та аватарів
function getVisibleName(username) {
    if (!username) return 'Анонім';
    return localProfiles[username]?.nickname || username;
}

function getAvatarHTML(username) {
    const uData = localProfiles[username] || {};
    if (uData.avatar) {
        return `<div class="user-avatar-img" style="background-image: url(${uData.avatar});"></div>`;
    }
    const firstLetter = username.charAt(0).toUpperCase();
    return `<div class="user-avatar-placeholder">${firstLetter}</div>`;
}

function compressImage(file, callback) {
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const MAX_WIDTH = 400;
            const MAX_HEIGHT = 400;

            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Логіка чатів та повідомлень
function renderChatsList() {
    if (!chatsListContainer) return;
    chatsListContainer.innerHTML = '';
    
    if (chatsList.length === 0) {
        chatsListContainer.innerHTML = `<div class="empty-list-text">${translations[currentLang].emptyList}</div>`;
        return;
    }

    chatsList.forEach(user => {
        const isOnline = onlineUsers.includes(user);
        const activeClass = (currentChatUser === user) ? 'active' : '';
        const statusDot = isOnline ? `<span class="online-dot">●</span>` : '';
        
        const item = document.createElement('div');
        item.className = `chat-item ${activeClass}`;
        item.innerHTML = `
            ${getAvatarHTML(user)}
            <div class="chat-item-info">
                <div class="chat-item-name">${getVisibleName(user)} ${statusDot}</div>
                <div class="chat-item-preview">${user}</div>
            </div>
        `;
        item.onclick = () => selectChat(user);
        chatsListContainer.appendChild(item);
    });
}

function selectChat(username) {
    if (username === myNick) {
        alert(translations[currentLang].selfChatError);
        return;
    }
    currentChatUser = username;
    
    const placeholder = document.getElementById('chat-placeholder');
    const area = document.getElementById('chat-area');
    if (placeholder) placeholder.style.display = 'none';
    if (area) area.style.display = 'flex';
    
    const sidePanel = document.getElementById('side-panel');
    if (window.innerWidth <= 768 && sidePanel && area) {
        sidePanel.style.display = 'none';
        area.style.style.display = 'flex';
    }

    updateChatTitle();
    loadMessagesHistory();
    renderChatsList();
    renderPinnedBanner();
}

function updateChatTitle() {
    if (!currentChatUser) return;
    if (chatTitleEl) chatTitleEl.textContent = getVisibleName(currentChatUser);
    if (chatStatusEl) {
        const isOnline = onlineUsers.includes(currentChatUser);
        chatStatusEl.textContent = isOnline ? translations[currentLang].chatStatusOnline : translations[currentLang].chatStatusOffline;
        chatStatusEl.style.color = isOnline ? '#4cd964' : '#888';
    }
}

function loadMessagesHistory() {
    if (!messagesContainer || !currentChatUser) return;
    messagesContainer.innerHTML = '';
    
    const history = messagesHistory[currentChatUser] || [];
    history.forEach(msg => {
        const msgEl = document.createElement('div');
        const isMy = msg.sender === myNick;
        msgEl.className = `message ${isMy ? 'my' : 'incoming'}`;
        msgEl.id = `msg-${msg.id}`;
        
        let replyMarkup = '';
        if (msg.replyTo) {
            replyMarkup = `<div class="message-reply-preview">${translations[currentLang].replyPrefix}${msg.replyToText || '...'}</div>`;
        }

        let contentMarkup = `<div class="message-text">${msg.text}</div>`;
        if (msg.type === 'sticker') {
            contentMarkup = `<div class="message-sticker"><img src="${msg.text}" alt="sticker" /></div>`;
        } else if (msg.type === 'audio') {
            contentMarkup = `<audio src="${msg.text}" controls class="message-audio"></audio>`;
        } else if (msg.type === 'circle') {
            contentMarkup = `<video src="${msg.text}" controls class="message-circle-video"></video>`;
        }

        msgEl.innerHTML = `
            ${replyMarkup}
            ${contentMarkup}
            <div class="message-time">${msg.time} ${msg.edited ? '✏️' : ''}</div>
        `;
        
        msgEl.oncontextmenu = (e) => showContextMenu(e, msg, isMy);
        messagesContainer.appendChild(msgEl);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Робота зі стікерами
const STICKERS_PACK = [
    '⚡', '🔥', '👑', '🤡', '🐸', '🐱', '🐶', '❤️', '💩', '🗿', '🍷', '💬'
];

function renderStickersList() {
    const container = document.getElementById('stickers-container');
    if (!container) return;
    container.innerHTML = '';
    STICKERS_PACK.forEach(st => {
        const btn = document.createElement('button');
        btn.className = 'sticker-btn';
        btn.textContent = st;
        btn.onclick = () => sendSticker(st);
        container.appendChild(btn);
    });
}

function sendSticker(stickerCode) {
    if (!currentChatUser) return;
    const msg = {
        id: 'st_' + Date.now(),
        sender: myNick,
        text: stickerCode,
        type: 'sticker',
        time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    };
    saveAndEmitMessage(msg);
}

function saveAndEmitMessage(msg) {
    if (!messagesHistory[currentChatUser]) messagesHistory[currentChatUser] = [];
    messagesHistory[currentChatUser].push(msg);
    localStorage.setItem(getStorageKey('burmalda_messages'), JSON.stringify(messagesHistory));
    
    socket.emit('private_message', { to: currentChatUser, message: msg });
    loadMessagesHistory();
}

// Надіслати текстове повідомлення
function sendMessage() {
    if (!input || !currentChatUser) return;
    const text = input.value.trim();
    if (!text) return;

    if (editingMessageId) {
        const history = messagesHistory[currentChatUser] || [];
        const msg = history.find(m => m.id === editingMessageId);
        if (msg) {
            msg.text = text;
            msg.edited = true;
            localStorage.setItem(getStorageKey('burmalda_messages'), JSON.stringify(messagesHistory));
            socket.emit('edit_message', { to: currentChatUser, msgId: editingMessageId, newText: text });
        }
        editingMessageId = null;
        if (button) button.textContent = translations[currentLang].btnSend;
    } else {
        let replyText = null;
        if (replyToId) {
            const history = messagesHistory[currentChatUser] || [];
            const rMsg = history.find(m => m.id === replyToId);
            if (rMsg) replyText = rMsg.text.substring(0, 30);
        }

        const msg = {
            id: 'msg_' + Date.now(),
            sender: myNick,
            text: text,
            type: 'text',
            replyTo: replyToId,
            replyToText: replyText,
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        };
        saveAndEmitMessage(msg);
        cancelReply();
    }
    input.value = '';
}

// Функціонал реплаю та контекстного меню
function cancelReply() {
    replyToId = null;
    const preview = document.getElementById('reply-preview-container');
    if (preview) preview.style.display = 'none';
}

function showContextMenu(e, msg, isMy) {
    e.preventDefault();
    removeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'custom-context-menu';
    menu.style.top = `${e.pageY}px`;
    menu.style.left = `${e.pageX}px`;

    const t = translations[currentLang];
    
    // Опція Відповіді
    const optReply = document.createElement('div');
    optReply.textContent = t.ctxReply;
    optReply.onclick = () => {
        replyToId = msg.id;
        const preview = document.getElementById('reply-preview-container');
        const txt = document.getElementById('reply-preview-text');
        if (preview && txt) {
            txt.textContent = msg.text;
            preview.style.display = 'flex';
        }
        removeContextMenu();
    };
    menu.appendChild(optReply);

    // Опції для власних повідомлень (Редагування/Видалення)
    if (isMy && msg.type === 'text') {
        const optEdit = document.createElement('div');
        optEdit.textContent = t.ctxEdit;
        optEdit.onclick = () => {
            editingMessageId = msg.id;
            if (input) input.value = msg.text;
            if (button) button.textContent = "✏️";
            removeContextMenu();
        };
        menu.appendChild(optEdit);
    }

    // Закріплення повідомлення
    const isPinned = pinnedMessages[currentChatUser] === msg.id;
    const optPin = document.createElement('div');
    optPin.textContent = isPinned ? t.ctxUnpin : t.ctxPin;
    optPin.onclick = () => {
        if (isPinned) {
            delete pinnedMessages[currentChatUser];
        } else {
            pinnedMessages[currentChatUser] = msg.id;
        }
        localStorage.setItem(getStorageKey('burmalda_pinned'), JSON.stringify(pinnedMessages));
        renderPinnedBanner();
        removeContextMenu();
    };
    menu.appendChild(optPin);

    document.body.appendChild(menu);
    document.addEventListener('click', removeContextMenu);
}

function removeContextMenu() {
    const existing = document.querySelector('.custom-context-menu');
    if (existing) existing.remove();
    document.removeEventListener('click', removeContextMenu);
}

function renderPinnedBanner() {
    const banner = document.getElementById('pinned-message-banner');
    const textEl = document.getElementById('pinned-banner-text');
    if (!banner || !textEl || !currentChatUser) return;

    const pinId = pinnedMessages[currentChatUser];
    if (!pinId) {
        banner.style.display = 'none';
        return;
    }

    const history = messagesHistory[currentChatUser] || [];
    const msg = history.find(m => m.id === pinId);
    if (msg) {
        textEl.textContent = `${translations[currentLang].pinnedLabel}: ${msg.text}`;
        banner.style.display = 'flex';
        banner.onclick = () => {
            const target = document.getElementById(`msg-${pinId}`);
            if (target) target.scrollIntoView({ behavior: 'smooth' });
        };
    } else {
        banner.style.display = 'none';
    }
}

// Запис аудіоповідомлень
window.toggleAudioRecord = function() {
    const recordBtn = document.getElementById('btn-voice');
    if (!isRecordingAudio) {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunks, { type: 'audio/ogg' });
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64Audio = reader.result;
                    const msg = {
                        id: 'aud_' + Date.now(),
                        sender: myNick,
                        text: base64Audio,
                        type: 'audio',
                        time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
                    };
                    saveAndEmitMessage(msg);
                };
                reader.readAsDataURL(blob);
            };
            mediaRecorder.start();
            isRecordingAudio = true;
            if (recordBtn) recordBtn.style.color = '#ff3b30';
        }).catch(err => console.error("Доступ до мікрофона заборонено:", err));
    } else {
        if (mediaRecorder) mediaRecorder.stop();
        isRecordingAudio = false;
        if (recordBtn) recordBtn.style.color = '';
    }
};

// Запис відеоповідомлень ("кружечків")
window.sendVideoCircle = function(inputEl) {
    const file = inputEl.files[0];
    if (!file || !currentChatUser) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const msg = {
            id: 'circ_' + Date.now(),
            sender: myNick,
            text: e.target.result,
            type: 'circle',
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        };
        saveAndEmitMessage(msg);
    };
    reader.readAsDataURL(file);
};

// Пошук та додавання контактів
window.searchContact = function() {
    if (!searchInput) return;
    const query = searchInput.value.trim();
    if (!query) return;

    if (query === myNick) {
        alert(translations[currentLang].selfChatError);
        return;
    }

    if (!chatsList.includes(query)) {
        chatsList.push(query);
        localStorage.setItem(getStorageKey('burmalda_chats'), JSON.stringify(chatsList));
    }
    selectChat(query);
};

// Налаштування та робота з профілем
window.openSettings = function(username) {
    const targetUser = username || myNick;
    if (!settingsModal) return;

    const infoNickEl = document.getElementById('info-nick');
    const infoNameEl = document.getElementById('info-name');
    const infoBioEl = document.getElementById('info-bio');
    const infoTimeEl = document.getElementById('info-session-time');
    const myControls = document.getElementById('my-profile-controls');

    if (infoNickEl) infoNickEl.textContent = targetUser;
    
    const uData = localProfiles[targetUser] || {};
    if (infoNameEl) infoNameEl.value = uData.nickname || targetUser;
    if (infoBioEl) infoBioEl.value = uData.bio || '';
    if (infoTimeEl) infoTimeEl.textContent = targetUser === myNick ? sessionTimeString : '---';

    const isMe = (targetUser === myNick);
    if (myControls) myControls.style.display = isMe ? 'block' : 'none';
    if (infoNameEl) infoNameEl.disabled = !isMe;
    if (infoBioEl) infoBioEl.disabled = !isMe;

    applyBanner(targetUser);
    settingsModal.classList.add('active');
    applyLanguage();
};

window.closeSettings = function() {
    if (settingsModal) settingsModal.classList.remove('active');
};

window.saveProfileData = function() {
    const infoNameEl = document.getElementById('info-name');
    const infoBioEl = document.getElementById('info-bio');
    
    if (!localProfiles[myNick]) localProfiles[myNick] = {};
    if (infoNameEl) localProfiles[myNick].nickname = infoNameEl.value.trim();
    if (infoBioEl) localProfiles[myNick].bio = infoBioEl.value.trim();

    localStorage.setItem('burmalda_profiles', JSON.stringify(localProfiles));
    socket.emit('update_profile', { username: myNick, profile: localProfiles[myNick] });
    
    applyLanguage();
    if (currentChatUser) updateChatTitle();
};

window.uploadAvatar = function(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    compressImage(file, (compressedBase64) => {
        if (!localProfiles[myNick]) localProfiles[myNick] = {};
        localProfiles[myNick].avatar = compressedBase64;
        localStorage.setItem('burmalda_profiles', JSON.stringify(localProfiles));
        socket.emit('update_profile', { username: myNick, profile: localProfiles[myNick] });
        applyLanguage();
    });
};

window.uploadBanner = function(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    compressImage(file, (compressedBase64) => {
        if (!localProfiles[myNick]) localProfiles[myNick] = {};
        localProfiles[myNick].banner = compressedBase64;
        localStorage.setItem('burmalda_profiles', JSON.stringify(localProfiles));
        applyBanner(myNick);
        socket.emit('update_profile', { username: myNick, profile: localProfiles[myNick] });
    });
};

window.logoutSession = function() {
    localStorage.removeItem(getStorageKey('burmalda_bg_image'));
    window.location.href = '/';
};

window.backToDialogs = function() {
    const sidePanel = document.getElementById('side-panel');
    const area = document.getElementById('chat-area');
    if (sidePanel && area) {
        sidePanel.style.display = 'flex';
        area.style.display = 'none';
    }
};

// Робота з сокетами (Мережеві івенти)
socket.on('connect', () => {
    socket.emit('register_user', { username: myNick });
});

socket.on('update_users_list', (users) => {
    onlineUsers = users;
    renderChatsList();
    updateChatTitle();
});

socket.on('receive_private_message', (data) => {
    const sender = data.sender;
    if (!messagesHistory[sender]) messagesHistory[sender] = [];
    messagesHistory[sender].push(data.message);
    localStorage.setItem(getStorageKey('burmalda_messages'), JSON.stringify(messagesHistory));

    if (!chatsList.includes(sender)) {
        chatsList.push(sender);
        localStorage.setItem(getStorageKey('burmalda_chats'), JSON.stringify(chatsList));
        renderChatsList();
    }

    if (currentChatUser === sender) {
        loadMessagesHistory();
    }
});

socket.on('receive_edit_message', (data) => {
    const sender = data.sender;
    const history = messagesHistory[sender] || [];
    const msg = history.find(m => m.id === data.msgId);
    if (msg) {
        msg.text = data.newText;
        msg.edited = true;
        localStorage.setItem(getStorageKey('burmalda_messages'), JSON.stringify(messagesHistory));
        if (currentChatUser === sender) loadMessagesHistory();
    }
});

socket.on('profile_updated', (data) => {
    localProfiles[data.username] = data.profile;
    localStorage.setItem('burmalda_profiles', JSON.stringify(localProfiles));
    renderChatsList();
    if (currentChatUser === data.username) updateChatTitle();
});

// Первинна ініціалізація при завантаженні DOM
document.addEventListener('DOMContentLoaded', () => {
    applyLanguage();
    renderChatsList();
    renderStickersList();

    if (button) button.addEventListener('click', sendMessage);
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    }
});

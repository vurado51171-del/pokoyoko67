function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

const audioSend = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
const audioReceiveInChat = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
const audioReceiveOutChat = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
audioSend.volume = 0.5; audioReceiveInChat.volume = 0.6; audioReceiveOutChat.volume = 0.8;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, type, duration, vol) {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq;
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + duration);
    osc.stop(audioCtx.currentTime + duration);
}

let ringInterval;
function startRingtone() {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    ringInterval = setInterval(() => {
        playTone(480, 'sine', 1.5, 0.1); setTimeout(() => playTone(440, 'sine', 1.5, 0.1), 1600);
    }, 3500);
    playTone(480, 'sine', 1.5, 0.1); setTimeout(() => playTone(440, 'sine', 1.5, 0.1), 1600);
}
function stopRingtone() { clearInterval(ringInterval); }

const translations = {
    uk: { searchPlaceholder: "Введіть ім'я...", dialogsTitle: "Ваші діалоги", placeholderText: "BurmaldaGram Premium<br><span style='font-size: 13px; color: var(--text-muted);'>Зберігайте спогади локально</span>", backBtn: "⬅ Назад", inputPlaceholder: "Напишіть...", btnSend: "Надіслати", settingsTitle: "⚙️ Мої налаштування", profileTitle: "Профіль користувача", profile: "Профіль", status: "Статус", bioPlaceholder: "Про вас...", bioEmpty: "Не заповнено", uploadBtn: "📤 Завантажити аватар", logoutBtn: "🚪 Вийти", chatStatusOnline: "онлайн", chatStatusOffline: "офлайн", ctxReply: "↩️ Відповісти", ctxEdit: "✏️ Редагувати", ctxDelete: "🗑️ Видалити", ctxPin: "📌 Закріпити", ctxDeleteMy: "🗑️ Видалити", online: "онлайн", offline: "офлайн", emptyList: "Немає чатів. Почніть пошук!", selfChatError: "Неможливо чатити з собою!", replyPrefix: "Відповідь на:", loginTime: "Час входу:", themeTitle: "Тема:", blockedMeText: "Цей користувач вас заблокував" },
    ru: { searchPlaceholder: "Введите имя...", dialogsTitle: "Диалоги", placeholderText: "BurmaldaGram Premium<br><span style='font-size: 13px; color: var(--text-muted);'>Сохраняйте воспоминания локально</span>", backBtn: "⬅ Назад", inputPlaceholder: "Напишите...", btnSend: "Отправить", settingsTitle: "⚙️ Мои настройки", profileTitle: "Профиль пользователя", profile: "Профиль", status: "Статус", bioPlaceholder: "О вас...", bioEmpty: "Не заполнено", uploadBtn: "📤 Загрузить аватар", logoutBtn: "🚪 Выход", chatStatusOnline: "онлайн", chatStatusOffline: "офлайн", ctxReply: "↩️ Ответить", ctxEdit: "✏️ Редактировать", ctxDelete: "🗑️ Удалить", ctxPin: "📌 Закрепить", ctxDeleteMy: "🗑️ Удалить", online: "онлайн", offline: "офлайн", emptyList: "Нет чатов. Начните поиск!", selfChatError: "Нельзя чатить с собой!", replyPrefix: "Ответ на:", loginTime: "Время входа:", themeTitle: "Тема:", blockedMeText: "Этот пользователь вас заблокировал" },
    en: { searchPlaceholder: "Search...", dialogsTitle: "Chats", placeholderText: "BurmaldaGram Premium<br><span style='font-size: 13px; color: var(--text-muted);'>Save memories locally</span>", backBtn: "⬅ Back", inputPlaceholder: "Message...", btnSend: "Send", settingsTitle: "⚙️ Settings", profileTitle: "User Profile", profile: "Profile", status: "Status", bioPlaceholder: "About you...", bioEmpty: "Not filled", uploadBtn: "📤 Upload Avatar", logoutBtn: "🚪 Logout", chatStatusOnline: "online", chatStatusOffline: "offline", ctxReply: "↩️ Reply", ctxEdit: "✏️ Edit", ctxDelete: "🗑️ Delete", ctxPin: "📌 Pin", ctxDeleteMy: "🗑️ Delete", online: "online", offline: "offline", emptyList: "No chats. Start searching!", selfChatError: "Cannot chat with yourself!", replyPrefix: "Reply to:", loginTime: "Login time:", themeTitle: "Theme:", blockedMeText: "This user blocked you" }
};

const GLOW_COLORS = {
    'green': '#4cd964',
    'red': '#ff3b30',
    'blue': '#0088cc',
    'dark': '#333333',
    'white': '#ffffff',
    'yellow': '#ffcc00'
};

const urlParams = new URLSearchParams(window.location.search);
const authToken = urlParams.get('auth');
let myNick = localStorage.getItem('burmalda_my_nick') || 'Анонім';
let authorized = false;
let sessionTimeString = 'Невідомо';

if (authToken) {
    try {
        const decoded = decodeURIComponent(atob(authToken));
        const parts = decoded.split('_');
        myNick = parts[0]; 
        const loginTime = parseInt(parts[1]);
        if (!isNaN(loginTime)) sessionTimeString = new Date(loginTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + " " + new Date(loginTime).toLocaleDateString();
        if (Date.now() - loginTime < 86400000 && myNick) authorized = true;
    } catch (e) { console.error("Помилка авторизації:", e); }
} else {
    if (myNick && myNick !== 'Анонім') {
        authorized = true;
        sessionTimeString = new Date().toLocaleTimeString();
    }
}

if (!authorized) { 
    alert('Доступ заблоковано!'); 
    window.location.href = '/'; 
} else { 
    const mainBody = document.getElementById('main-body');
    if (mainBody) mainBody.style.display = 'flex';
}

function getStorageKey(key) { return `${key}_${myNick}`; }

let currentLang = localStorage.getItem('burmalda_lang') || 'uk';
let currentTheme = localStorage.getItem('burmalda_theme') || 'theme-dark';
let isPrivacyMode = localStorage.getItem(getStorageKey('burmalda_privacy')) === 'true';
let replyTargetMsgId = null;
let editTargetMsgId = null;
let messageToForward = null;
let activeChats = JSON.parse(localStorage.getItem(getStorageKey('burmalda_chat_list'))) || [];
let glowingChats = JSON.parse(localStorage.getItem(getStorageKey('burmalda_glow_chats'))) || {};
let pinnedMessages = JSON.parse(localStorage.getItem(getStorageKey('burmalda_pinned_data'))) || {};
let currentPinIndex = 0;
let chatSettings = JSON.parse(localStorage.getItem(getStorageKey('burmalda_chat_settings'))) || {};
let myCustomStickers = JSON.parse(localStorage.getItem(getStorageKey('burmalda_custom_stickers'))) || [];
const ALL_EMOJIS = ['👍','❤️','😂','😮','😢','🙏','😎','🔥','💯','🎉','💩','👽','👻','🤡','🤝','💪','👀','🧠','Ukraine','🍉'];

let isMultiSelectMode = false;
let selectedMessages = new Set();
let currentPaginationLimit = 30; 
let myMessageTimestamps = [];

let chatBackgroundImage = localStorage.getItem(getStorageKey('burmalda_bg_image')) || '';
let chatBackgroundBlur = localStorage.getItem(getStorageKey('burmalda_bg_blur')) || '0';

document.body.className = currentTheme;
const themeSelect = document.getElementById('theme-select');
if (themeSelect) themeSelect.value = currentTheme;

let socket;
if (typeof io !== 'undefined') {
    socket = io();
} else {
    console.warn("Socket.io не підключено. Чат працює в офлайн-режимі.");
    socket = { on: () => {}, emit: () => {} };
}

let currentRoom = null;
let currentActiveChatPartner = null;
let onlineUsers = [];
let savedMessages = {};

function safeSaveHistory() {
    try { localStorage.setItem(getStorageKey('burmalda_msg_history'), JSON.stringify(savedMessages)); } 
    catch(e) { console.warn("localStorage переповнено! Дані не збережено локально."); }
}

try {
    const rawHistory = localStorage.getItem(getStorageKey('burmalda_msg_history'));
    if (rawHistory) savedMessages = typeof rawHistory === 'string' ? JSON.parse(rawHistory) : rawHistory;
} catch (e) { savedMessages = {}; }

let localProfiles = JSON.parse(localStorage.getItem('burmalda_profiles_data')) || {};

const searchToggleBtn = document.getElementById('search-toggle-btn');
const searchFrame = document.getElementById('search-frame');
const searchInput = document.getElementById('search-input');
const searchDropdown = document.getElementById('search-results-dropdown');
const chatsList = document.getElementById('chats-list');
const chatPlaceholder = document.getElementById('no-chat-placeholder');
const chatArea = document.getElementById('chat-area');
const chatTitleText = document.getElementById('chat-title-text');
const typingStatusEl = document.getElementById('chat-typing-status');
const messagesContainer = document.getElementById('messages');
const input = document.getElementById('input');
const button = document.getElementById('button');
const contextMenu = document.getElementById('global-context-menu');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const pinnedMessageBar = document.getElementById('pinned-message-bar');
const pinnedBarTextContent = document.getElementById('pinned-bar-text-content');
const pinCounterBadge = document.getElementById('pin-counter-badge');
const stickerMenu = document.getElementById('sticker-menu');

input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('form').dispatchEvent(new Event('submit', { cancelable: true }));
    } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = input.value.substring(0, start) + "\n" + input.value.substring(end);
        input.selectionStart = input.selectionEnd = start + 1;
    }
});

settingsToggleBtn.onclick = () => { openMyProfile(); };
settingsCloseBtn.onclick = () => { settingsModal.classList.remove('active'); };

document.getElementById('btn-back').onclick = () => { 
    if (document.body.classList.contains('chat-opened')) window.history.back();
};

window.onpopstate = function(event) { 
    if (document.body.classList.contains('chat-opened')) { 
        document.body.classList.remove('chat-opened');
        currentActiveChatPartner = null; currentRoom = null;
        chatArea.style.display = 'none'; chatPlaceholder.style.display = 'block'; 
        const cleanUrl = window.location.pathname + '?auth=' + (urlParams.get('auth') || '');
        window.history.replaceState({}, "", cleanUrl); 
        renderChatsList(); 
    } 
};

const activityLabels = {
    'typing': "пише...", 'searching_sticker': "шукає стікер...",
    'recording_audio': "записує аудіо...", 'recording_video': "знімає відео..."
};

function emitActivity(activityType) {
    if (!currentRoom || isPrivacyMode) return;
    socket.emit('user_activity', { room: currentRoom, user: myNick, activity: activityType });
}

function openImageViewer(src) {
    document.getElementById('image-viewer-img').src = src;
    document.getElementById('image-viewer-modal').classList.add('active');
}
function closeImageViewer() {
    document.getElementById('image-viewer-modal').classList.remove('active');
    document.getElementById('image-viewer-img').src = '';
}

function formatDateDivider(ts) { return new Date(ts).toLocaleDateString(currentLang, {day: 'numeric', month: 'long'}); }

function saveActiveChats() {
    localStorage.setItem(getStorageKey('burmalda_chat_list'), JSON.stringify(activeChats));
    socket.emit('sync_contacts', { user: myNick, chats: activeChats });
}

function getVisibleName(username) { 
    if (!username) return "Невідомо";
    const uData = localProfiles[username];
    if (uData && uData.displayName && uData.displayName.trim() !== '') return uData.displayName.trim(); 
    return username;
}

function getAvatarHTML(username, cssClass = 'avatar') { 
    if (!username) return `<div class="${cssClass}"></div>`;
    const uData = localProfiles[username] || {};
    const isOnline = onlineUsers.includes(username);
    
    let glowC = uData.glowColor ? GLOW_COLORS[uData.glowColor] : (isOnline ? 'var(--accent)' : 'rgba(128,128,128,0.5)');
    if(!isOnline && !uData.glowColor) glowC = 'rgba(128,128,128,0.5)';
    const glowStyle = `box-shadow: 0 0 12px ${glowC}; border: 2px solid ${glowC};`;
    
    if (uData.avatar && uData.avatar.startsWith('data:image')) { 
        return `<img src="${uData.avatar}" class="${cssClass}" id="av-node-${username}" alt="" style="${glowStyle}">`;
    } 
    const visibleName = getVisibleName(username);
    const firstLetter = visibleName ? visibleName.charAt(0) : '?';
    const placeholderClass = cssClass === 'avatar' ? 'avatar-placeholder' : 'modal-avatar-placeholder';
    const colors = ['#0088cc', '#4cd964', '#ff3b30', '#ffcc00', '#5856d6', '#ff2d55', '#af52de'];
    let charCodeSum = 0;
    for (let i = 0; i < username.length; i++) charCodeSum += username.charCodeAt(i);
    const pickedColor = colors[charCodeSum % colors.length];
    return `<div class="${placeholderClass}" id="av-node-${username}" style="background-color: ${pickedColor}; ${glowStyle}">${firstLetter}</div>`;
}

function getTinyAvatarHTML(username) {
    if (!username) return '';
    const uData = localProfiles[username] || {};
    if (uData.avatar && uData.avatar.startsWith('data:image')) {
        return `<img src="${uData.avatar}" style="width:16px;height:16px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,255,255,0.2);" title="${escapeHTML(getVisibleName(username))}">`;
    }
    const visibleName = getVisibleName(username);
    const firstLetter = visibleName ? visibleName.charAt(0) : '?';
    const colors = ['#0088cc', '#4cd964', '#ff3b30', '#ffcc00', '#5856d6', '#ff2d55', '#af52de'];
    let charCodeSum = 0;
    for (let i = 0; i < username.length; i++) charCodeSum += username.charCodeAt(i);
    const pickedColor = colors[charCodeSum % colors.length];
    return `<div style="width:16px;height:16px;border-radius:50%;background-color:${pickedColor};color:#fff;font-size:9px;display:flex;align-items:center;justify-content:center;font-weight:bold;">${firstLetter}</div>`;
}

function applyCustomBackground() {
    const mainChat = document.getElementById('chat-main');
    if (mainChat) {
        if (chatBackgroundImage) {
            mainChat.style.backgroundImage = `url(${chatBackgroundImage})`;
            mainChat.style.backgroundSize = 'cover';
            mainChat.style.backgroundPosition = 'center';
        } else {
            mainChat.style.backgroundImage = '';
        }
    }
}

function applyLanguage() { 
    const t = translations[currentLang];
    document.getElementById('lang-select').value = currentLang;
    document.getElementById('my-profile-name').innerHTML = `${getAvatarHTML(myNick)} <span>${getVisibleName(myNick)}</span>`;
    searchInput.placeholder = t.searchPlaceholder; document.getElementById('lbl-dialogs').textContent = t.dialogsTitle; 
    document.getElementById('placeholder-text').innerHTML = t.placeholderText; document.getElementById('btn-back').textContent = t.backBtn;
    input.placeholder = t.inputPlaceholder; button.textContent = t.btnSend;
    
    renderChatsList(); loadMessagesHistory(); 
    applyCustomBackground();
    updateChatTitle();
}

function changeLanguage(lang) { currentLang = lang; localStorage.setItem('burmalda_lang', lang); applyLanguage(); }
function changeTheme(themeVal) { currentTheme = themeVal; document.body.className = themeVal; localStorage.setItem('burmalda_theme', themeVal); }

function openMyProfile() { 
    const t = translations[currentLang]; document.getElementById('info-nick').textContent = myNick; 
    const myData = localProfiles[myNick] || { avatar: '', bio: '', displayName: '', banner: '', glowColor: '' }; 
    document.getElementById('profile-display-name').disabled = false; document.getElementById('profile-display-name').value = myData.displayName || myNick; 
    document.getElementById('profile-desc').disabled = false;
    document.getElementById('profile-desc').value = myData.bio || ''; document.getElementById('profile-desc').placeholder = t.bioEmpty; 
    
    applyLanguage(); settingsModal.classList.add('active');
}

function renderChatsList() { 
    chatsList.innerHTML = '';
    
    let filteredChats = activeChats.filter(c => {
        const folder = chatSettings[c]?.folder || 'all';
        return folder !== 'archive';
    });
    
    if (filteredChats.length === 0) { 
        chatsList.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:14px;">${translations[currentLang].emptyList}</div>`;
    } else {
        const sortedChats = filteredChats.sort((a, b) => { const pinA = chatSettings[a]?.pinned ? 1 : 0; const pinB = chatSettings[b]?.pinned ? 1 : 0; return pinB - pinA; });
        sortedChats.forEach(user => renderChatDOM(user, chatsList));
    }
}

function renderChatDOM(user, targetContainer) {
    if(!targetContainer) return;
    const isOnline = onlineUsers.includes(user);
    let statusText = isOnline ? translations[currentLang].chatStatusOnline : translations[currentLang].chatStatusOffline; 
    
    const prefs = chatSettings[user] || {};
    const activeClass = (currentActiveChatPartner === user) ? 'active' : '';
    const item = document.createElement('div');
    item.className = `chat-item ${activeClass}`;
    
    item.innerHTML = `<div class="chat-info-block">${getAvatarHTML(user)}<div><div style="font-weight:600; font-size:14px;">${escapeHTML(getVisibleName(user))}</div><div style="font-size:12px; color:var(--text-muted);">${statusText}</div></div></div>`;
    item.onclick = () => { openChatWith(user); };
    targetContainer.appendChild(item);
}

function openChatWith(username) { 
    currentActiveChatPartner = username; const roomSorted = [myNick, username].sort(); currentRoom = `room_${roomSorted[0]}_${roomSorted[1]}`; 
    document.body.classList.add('chat-opened');
    chatPlaceholder.style.display = 'none'; chatArea.style.display = 'flex'; 
    updateChatTitle();
    socket.emit('request_history', { room: currentRoom });
    socket.emit('request_profile', { username: username });
    socket.emit('join_room', { room: currentRoom, user: myNick });
    socket.emit('mark_read', { room: currentRoom, reader: myNick });
    
    loadMessagesHistory(); renderChatsList();
}

function updateChatTitle() {
    if (!currentActiveChatPartner) return;
    const isOnline = onlineUsers.includes(currentActiveChatPartner);
    let statusHtml = '';
    if (isOnline) {
        statusHtml = '<small style="color:#4cd964; font-size:11px;">● онлайн</small>';
    } else {
        statusHtml = '<small style="color:var(--text-muted); font-size:11px;">офлайн</small>';
    }
    chatTitleText.innerHTML = `${getAvatarHTML(currentActiveChatPartner)} <span>${escapeHTML(getVisibleName(currentActiveChatPartner))} ${statusHtml}</span>`;
}

function loadMessagesHistory() { 
    if (!currentRoom) return;
    messagesContainer.innerHTML = '';
    let history = savedMessages[currentRoom] || [];
    
    let lastDate = null;
    history.forEach(msg => { 
        const msgDate = formatDateDivider(msg.timestamp);
        if (msgDate !== lastDate) { 
            const div = document.createElement('div'); 
            div.className = 'date-divider'; 
            div.textContent = msgDate; 
            messagesContainer.appendChild(div); 
            lastDate = msgDate;
        }
        appendSingleMessage(msg, true); 
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function appendSingleMessage(msg, isHistoryBuild = false) { 
    const li = document.createElement('li');
    if (msg.from === myNick) li.className = 'my-msg';
    li.innerHTML = `<span>${escapeHTML(msg.text)}</span><small style="opacity:0.6;font-size:10px;margin-left:4px;">${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small>`;
    messagesContainer.appendChild(li);
}

document.getElementById('form').onsubmit = (e) => { 
    e.preventDefault();
    const val = input.value.trim(); if (!val || !currentRoom) return;

    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const msgPayload = { id: msgId, room: currentRoom, from: myNick, to: currentActiveChatPartner, text: val, type: 'text', timestamp: Date.now(), reactions: {}, status: 'sent' };
    
    if (!activeChats.includes(currentActiveChatPartner)) { activeChats.push(currentActiveChatPartner); saveActiveChats(); } 
    if (!savedMessages[currentRoom]) savedMessages[currentRoom] = [];
    savedMessages[currentRoom].push(msgPayload);
    safeSaveHistory();

    socket.emit('chat_message', msgPayload); 
    appendSingleMessage(msgPayload);
    audioSend.play().catch(e=>console.log(e));
    input.value = '';
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    renderChatsList();
};

function showContextMenu(e, options) { 
    contextMenu.innerHTML = '';
    options.forEach(opt => { 
        const b = document.createElement('button'); 
        b.textContent = opt.text; 
        if (opt.class) b.className = opt.class; 
        b.onclick = () => { contextMenu.style.display = 'none'; opt.action(); };
        contextMenu.appendChild(b);
    });
    contextMenu.style.display = 'block';
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
}

document.onclick = (e) => { 
    contextMenu.style.display = 'none'; 
};

socket.on('chat_message', (msg) => { 
    if (!activeChats.includes(msg.from)) { activeChats.push(msg.from); saveActiveChats(); }
    if (!savedMessages[msg.room]) savedMessages[msg.room] = [];
    if (!savedMessages[msg.room].some(m => m.id === msg.id)) { 
        savedMessages[msg.room].push(msg); 
        safeSaveHistory();
        if (currentRoom === msg.room) { 
            appendSingleMessage(msg); 
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
    renderChatsList();
    audioReceiveInChat.play().catch(e=>console.log(e));
});

socket.on('online_list', (users) => { onlineUsers = users; applyLanguage(); });
socket.on('profile_broadcast', (profileUpdate) => { 
    localProfiles[profileUpdate.username] = { ...localProfiles[profileUpdate.username], ...profileUpdate.data }; 
    localStorage.setItem('burmalda_profiles_data', JSON.stringify(localProfiles)); 
    updateChatTitle();
    renderChatsList();
});

function logout() { localStorage.removeItem('burmalda_auth_token'); window.location.href = '/'; }

applyLanguage();
const initialChatPartner = urlParams.get('chat');
if (initialChatPartner && activeChats.includes(initialChatPartner)) openChatWith(initialChatPartner);

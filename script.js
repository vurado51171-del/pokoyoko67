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

// ВИПРАВЛЕНО: Замість prompt() використовуємо localStorage або модальне вікно
let myNick = localStorage.getItem('burmalda_my_nick') || 'Анонім';
let authorized = false;
let sessionTimeString = 'Невідомо';

// Перевірка авторизації
if (authToken) {
    try {
        const decoded = decodeURIComponent(atob(authToken));
        const parts = decoded.split('_');
        myNick = parts[0]; 
        const loginTime = parseInt(parts[1]);
        if (!isNaN(loginTime)) sessionTimeString = new Date(loginTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + " " + new Date(loginTime).toLocaleDateString();
        if (Date.now() - loginTime < 86400000 && myNick) authorized = true;
    } catch (e) { console.error("Помилка авторизації:", e); }
} else if (myNick && myNick !== 'Анонім') {
    authorized = true;
    sessionTimeString = new Date().toLocaleTimeString();
}

// Якщо не авторизовано - перенаправити на вхід
if (!authorized && myNick === 'Анонім') { 
    window.location.href = '/'; 
} else {
    // Покажемо HTML
    const mainBody = document.getElementById('main-body');
    if (mainBody) mainBody.style.display = 'flex';
}

function getStorageKey(key) { return `${key}_${myNick}`; }

let currentLang = localStorage.getItem('burmalda_lang') || 'uk';
let currentTheme = localStorage.getItem('burmalda_theme') || 'light';
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

// ВИПРАВЛЕНО: Безпечна установка теми
try {
    document.body.className = currentTheme;
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) themeSelect.value = currentTheme;
} catch(e) { console.warn("Помилка при установці теми"); }

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
let localProfiles = JSON.parse(localStorage.getItem('burmalda_profiles_data')) || {};

function safeSaveHistory() {
    try { localStorage.setItem(getStorageKey('burmalda_msg_history'), JSON.stringify(savedMessages)); } 
    catch(e) { console.warn("localStorage переповнено! Дані не збережено локально."); }
}

try {
    const rawHistory = localStorage.getItem(getStorageKey('burmalda_msg_history'));
    if (rawHistory) savedMessages = typeof rawHistory === 'string' ? JSON.parse(rawHistory) : rawHistory;
} catch (e) { savedMessages = {}; }

// ВИПРАВЛЕНО: Безпечне отримання елементів з перевіркою існування
const getElement = (id) => {
    const el = document.getElementById(id);
    if (!el) console.warn(`Елемент #${id} не знайдений`);
    return el;
};

const searchToggleBtn = getElement('btn-search-toggle') || document.createElement('button');
const searchFrame = getElement('search-frame') || document.createElement('div');
const searchInput = getElement('search-input') || document.createElement('input');
const searchDropdown = getElement('search-dropdown') || document.createElement('div');
const chatsList = getElement('chats-list') || document.createElement('div');
const chatPlaceholder = getElement('no-chat-placeholder') || document.createElement('div');
const chatArea = getElement('chat-area') || document.createElement('div');
const chatTitleText = getElement('chat-title') || document.createElement('h2');
const typingStatusEl = getElement('chat-typing-status') || document.createElement('div');
const messagesContainer = getElement('messages-container') || document.createElement('div');
const input = getElement('message-input') || document.createElement('input');
const button = getElement('send-btn') || document.createElement('button');
const contextMenu = getElement('context-menu') || document.createElement('div');
const settingsToggleBtn = getElement('settings-toggle-btn') || document.createElement('button');
const settingsModal = getElement('settings-modal') || document.createElement('div');
const settingsCloseBtn = getElement('settings-close-btn') || document.createElement('button');
const pinnedMessageBar = getElement('pinned-bar') || document.createElement('div');
const pinnedBarTextContent = getElement('pinned-text') || document.createElement('span');
const pinCounterBadge = getElement('pin-counter') || document.createElement('span');
const stickerMenu = getElement('sticker-menu') || document.createElement('div');

// Обробник Enter для надіслання повідомлення
if (input) {
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const form = document.getElementById('form');
            if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
        }
    });
}

if (settingsToggleBtn) settingsToggleBtn.onclick = () => { openMyProfile(); };
if (settingsCloseBtn) settingsCloseBtn.onclick = () => { if (settingsModal) settingsModal.classList.remove('active'); };

const backBtn = getElement('btn-back');
if (backBtn) {
    backBtn.onclick = () => { 
        if (document.body.classList.contains('chat-opened')) window.history.back();
    };
}

window.onpopstate = function(event) { 
    if (document.body.classList.contains('chat-opened')) { 
        document.body.classList.remove('chat-opened');
        currentActiveChatPartner = null; currentRoom = null;
        if (chatArea) chatArea.style.display = 'none';
        if (chatPlaceholder) chatPlaceholder.style.display = 'block'; 
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
    if (!currentRoom) return;
    socket.emit('user_activity', { room: currentRoom, user: myNick, activity: activityType });
}

function openImageViewer(src) {
    const img = getElement('image-viewer-img');
    const modal = getElement('image-viewer-modal');
    if (img) img.src = src;
    if (modal) modal.classList.add('active');
}

function closeImageViewer() {
    const modal = getElement('image-viewer-modal');
    const img = getElement('image-viewer-img');
    if (modal) modal.classList.remove('active');
    if (img) img.src = '';
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

function applyLanguage() { 
    const t = translations[currentLang];
    const langSelect = document.getElementById('lang-select');
    if (langSelect) langSelect.value = currentLang;
    
    const myProfileName = document.getElementById('my-profile-name');
    if (myProfileName) myProfileName.innerHTML = `${getAvatarHTML(myNick)} <span>${getVisibleName(myNick)}</span>`;
    
    if (searchInput) searchInput.placeholder = t.searchPlaceholder;
    const lblDialogs = document.getElementById('lbl-dialogs');
    if (lblDialogs) lblDialogs.textContent = t.dialogsTitle;
    
    const placeholderText = document.getElementById('placeholder-text');
    if (placeholderText) placeholderText.innerHTML = t.placeholderText;
    
    if (backBtn) backBtn.textContent = t.backBtn;
    if (input) input.placeholder = t.inputPlaceholder;
    if (button) button.textContent = t.btnSend;
    
    renderChatsList();
    loadMessagesHistory();
    updateChatTitle();
}

function changeLanguage(lang) { currentLang = lang; localStorage.setItem('burmalda_lang', lang); applyLanguage(); }
function changeTheme(themeVal) { currentTheme = themeVal; document.body.className = themeVal; localStorage.setItem('burmalda_theme', themeVal); }

function openMyProfile() { 
    const t = translations[currentLang];
    const infoNick = document.getElementById('info-nick');
    if (infoNick) infoNick.textContent = myNick;
    
    const myData = localProfiles[myNick] || { avatar: '', bio: '', displayName: '', banner: '', glowColor: '' };
    
    const profileDisplayName = document.getElementById('profile-display-name');
    if (profileDisplayName) {
        profileDisplayName.disabled = false;
        profileDisplayName.value = myData.displayName || myNick;
    }
    
    const profileDesc = document.getElementById('profile-desc');
    if (profileDesc) {
        profileDesc.disabled = false;
        profileDesc.value = myData.bio || '';
        profileDesc.placeholder = t.bioPlaceholder;
    }
    
    applyLanguage();
    if (settingsModal) settingsModal.classList.add('active');
}

function openPartnerProfile() { 
    if (!currentActiveChatPartner) return;
    const t = translations[currentLang];
    const infoNick = document.getElementById('info-nick');
    if (infoNick) infoNick.textContent = currentActiveChatPartner;
    
    const pData = localProfiles[currentActiveChatPartner] || { avatar: '', bio: '', displayName: '', banner: '', glowColor: '' };
    
    const profileDisplayName = document.getElementById('profile-display-name');
    if (profileDisplayName) {
        profileDisplayName.disabled = true;
        profileDisplayName.value = pData.displayName || currentActiveChatPartner;
    }
    
    const profileDesc = document.getElementById('profile-desc');
    if (profileDesc) {
        profileDesc.disabled = true;
        profileDesc.value = pData.bio || '';
        profileDesc.placeholder = t.bioPlaceholder;
    }
    
    applyLanguage();
    if (settingsModal) settingsModal.classList.add('active');
}

function renderChatsList() { 
    if (!chatsList) return;
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
    if(!targetContainer || !user) return;
    const isOnline = onlineUsers.includes(user);
    let statusText = isOnline ? translations[currentLang].chatStatusOnline : translations[currentLang].chatStatusOffline;
    
    const prefs = chatSettings[user] || {};
    const activeClass = (currentActiveChatPartner === user) ? 'active' : '';
    const glowClass = glowingChats[user] ? 'glow-active' : '';
    const item = document.createElement('div');
    item.className = `chat-item ${activeClass} ${glowClass}`;
    
    let flagsHtml = ''; 
    if (prefs.pinned) flagsHtml += '📌'; 
    if (prefs.muted) flagsHtml += '🔇';
    if (prefs.blocked) flagsHtml += '🚫';
    
    item.innerHTML = `<div class="chat-info-block">${getAvatarHTML(user)}<div><div style="font-weight:600; font-size:14px;">${escapeHTML(getVisibleName(user))}</div><div style="font-size:12px; color:var(--text-muted);">${statusText}</div></div><div style="font-size:12px;">${flagsHtml}</div></div>`;
    
    item.onclick = () => { openChatWith(user); };
    targetContainer.appendChild(item);
}

function openChatWith(username) { 
    currentActiveChatPartner = username;
    const roomSorted = [myNick, username].sort();
    currentRoom = `room_${roomSorted[0]}_${roomSorted[1]}`;
    
    document.body.classList.add('chat-opened');
    if (chatPlaceholder) chatPlaceholder.style.display = 'none';
    if (chatArea) chatArea.style.display = 'flex';
    
    updateChatTitle();
    socket.emit('request_history', { room: currentRoom });
    socket.emit('request_profile', { username: username });
    socket.emit('join_room', { room: currentRoom, user: myNick });
    socket.emit('mark_read', { room: currentRoom, reader: myNick });
    
    loadMessagesHistory();
    renderChatsList();
}

function updateChatTitle() {
    if (!currentActiveChatPartner || !chatTitleText) return;
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
    if (!currentRoom || !messagesContainer) return;
    const isAtBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop <= messagesContainer.clientHeight + 50;
    
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
    if(isAtBottom && messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function appendSingleMessage(msg, isHistoryBuild = false) { 
    if (!messagesContainer) return;
    
    const liWrapper = document.createElement('div');
    liWrapper.className = `msg-container ${msg.from === myNick ? 'my-wrapper' : ''}`;
    liWrapper.id = `msg-item-${msg.id}`;
    
    const li = document.createElement('li');
    if (msg.from === myNick) li.className = 'my-msg';
    
    const metaLine = document.createElement('div');
    metaLine.className = 'msg-meta-line';
    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    metaLine.innerHTML = `<span class="msg-time">${timeStr}</span>`;
    
    li.innerHTML = escapeHTML(msg.text || 'Порожнє повідомлення');
    li.appendChild(metaLine);
    
    liWrapper.appendChild(li);
    messagesContainer.appendChild(liWrapper);
}

const form = document.getElementById('form');
if (form) {
    form.onsubmit = (e) => { 
        e.preventDefault();
        const val = input ? input.value.trim() : '';
        if (!val || !currentRoom) return;

        const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const msgPayload = { 
            id: msgId, 
            room: currentRoom, 
            from: myNick, 
            to: currentActiveChatPartner, 
            text: val, 
            type: 'text', 
            timestamp: Date.now(), 
            reactions: {}, 
            status: 'sent'
        };
        
        if (!activeChats.includes(currentActiveChatPartner)) {
            activeChats.push(currentActiveChatPartner);
            saveActiveChats();
        } 
        
        if (!savedMessages[currentRoom]) savedMessages[currentRoom] = [];
        savedMessages[currentRoom].push(msgPayload);
        safeSaveHistory();

        socket.emit('chat_message', msgPayload);
        appendSingleMessage(msgPayload);
        audioSend.play().catch(e=>console.log(e));
        
        if (input) input.value = '';
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
        renderChatsList();
    };
}

function showContextMenu(e, options) { 
    if (!contextMenu) return;
    contextMenu.innerHTML = '';
    options.forEach(opt => {
        const b = document.createElement('button');
        b.textContent = opt.text;
        if (opt.class) b.className = opt.class;
        b.onclick = () => { 
            contextMenu.style.display = 'none';
            opt.action();
        };
        contextMenu.appendChild(b);
    });
    contextMenu.style.display = 'block';
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
}

document.onclick = (e) => { 
    if (contextMenu) contextMenu.style.display = 'none'; 
};

// Обробник Socket.io подій
socket.on('chat_message', (msg) => { 
    if (!activeChats.includes(msg.from)) {
        activeChats.push(msg.from);
        saveActiveChats();
    }
    
    if (!savedMessages[msg.room]) savedMessages[msg.room] = [];
    if (!savedMessages[msg.room].some(m => m.id === msg.id)) {
        savedMessages[msg.room].push(msg);
        safeSaveHistory();
    }
    
    if (currentRoom === msg.room) {
        appendSingleMessage(msg);
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    renderChatsList();
    audioReceiveInChat.play().catch(e=>console.log(e));
});

socket.on('online_list', (users) => { 
    onlineUsers = users;
    applyLanguage();
});

socket.on('profile_broadcast', (profileUpdate) => { 
    localProfiles[profileUpdate.username] = { ...localProfiles[profileUpdate.username], ...profileUpdate.data };
    localStorage.setItem('burmalda_profiles_data', JSON.stringify(localProfiles));
    updateChatTitle();
    renderChatsList();
});

// Ініціалізація при завантаженні
window.addEventListener('DOMContentLoaded', () => {
    console.log('DOM завантажено, ініціалізація чату...');
    applyLanguage();
    renderChatsList();
    
    // З'єднання до сокета
    socket.emit('online_ping', { username: myNick });
    socket.emit('sync_contacts', { user: myNick, chats: activeChats });
});

// Логування
console.log('Script.js завантажено успішно');
console.log('Поточний користувач:', myNick);
console.log('Авторизовано:', authorized);

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
    uk: { searchPlaceholder: "Введіть ім'я...", dialogsTitle: "Ваші діалоги", placeholderText: "BurmaldaGram Premium<br><span style='font-size: 13px; color: var(--text-muted);'>Оберіть чат 🔍</span>", backBtn: "⬅ Назад", inputPlaceholder: "Напишіть повідомлення...", btnSend: "Надіслати", settingsTitle: "⚙️ Налаштування", profileTitle: "👤 Профіль", profile: "Юзернейм:", profileName: "Нік:", status: "Статус:", online: "в мережі", offline: "офлайн", loginTime: "Вхід:", logoutBtn: "Вийти 🚪", emptyList: "Список порожній", selfChatError: "Не можна створювати чат із собою!", ctxReply: "Відповісти ↩", ctxEdit: "Редагувати ✏️", userNotFound: "Не знайдено!", ctxPin: "Закріпити повідомлення 📌", ctxUnpin: "Відкріпити повідомлення 🔓", ctxDeleteMy: "Видалити (своє) 🗑", chatStatusOnline: "● онлайн", chatStatusOffline: "офлайн", typingText: "пише...", uploadBtn: "📁 Завантажити", bioPlaceholder: "Про себе:", bioEmpty: "Пусто", replyPrefix: "Відповідь на: ", pinnedLabel: "Закріплено", blockedMeText: "Цей користувач вас заблокував.", themeTitle: "Тема оформлення:" },
    ru: { searchPlaceholder: "Введите имя...", dialogsTitle: "Диалоги", placeholderText: "BurmaldaGram Premium", backBtn: "⬅ Назад", inputPlaceholder: "Напишите...", btnSend: "Отправить", settingsTitle: "⚙️ Настройки", profileTitle: "👤 Профиль", profile: "Юзернейм:", profileName: "Ник:", status: "Статус:", online: "в сети", offline: "офлайн", loginTime: "Вход:", logoutBtn: "Выйти 🚪", emptyList: "Пусто", selfChatError: "Нельзя с собой!", ctxReply: "Ответить ↩", ctxEdit: "Изменить ✏️", userNotFound: "Не найден!", ctxPin: "Закрепить 📌", ctxUnpin: "Открепить 🔓", ctxDeleteMy: "Удалить 🗑", chatStatusOnline: "● онлайн", chatStatusOffline: "офлайн", typingText: "печатает...", uploadBtn: "📁 Загрузить", bioPlaceholder: "О себе:", bioEmpty: "Пусто", replyPrefix: "Ответ: ", pinnedLabel: "Закреплено", blockedMeText: "Этот пользователь вас заблокировал.", themeTitle: "Тема оформления:" },
    en: { searchPlaceholder: "Search...", dialogsTitle: "Chats", placeholderText: "BurmaldaGram Premium", backBtn: "⬅ Back", inputPlaceholder: "Message...", btnSend: "Send", settingsTitle: "⚙️ Settings", profileTitle: "👤 Profile", profile: "ID:", profileName: "Name:", status: "Status:", online: "online", offline: "offline", loginTime: "Login:", logoutBtn: "Log out 🚪", emptyList: "Empty", selfChatError: "Can't chat with yourself!", ctxReply: "Reply ↩", ctxEdit: "Edit ✏️", userNotFound: "Not found!", ctxPin: "Pin 📌", ctxUnpin: "Unpin 🔓", ctxDeleteMy: "Delete 🗑", chatStatusOnline: "● online", chatStatusOffline: "offline", typingText: "typing...", uploadBtn: "📁 Upload", bioPlaceholder: "Bio:", bioEmpty: "Empty", replyPrefix: "Reply: ", pinnedLabel: "Pinned", blockedMeText: "You are blocked by this user.", themeTitle: "Theme:" }
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
let myNick = 'Анонім';
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
    myNick = prompt("Введіть ваш нікнейм для входу (залиште порожнім для 'Анонім'):") || "Анонім";
    authorized = true;
    sessionTimeString = new Date().toLocaleTimeString();
}

if (!authorized) { 
    alert('Доступ заблоковано!'); 
    window.location.href = '/'; 
} else { 
    document.getElementById('main-body').style.display = 'flex'; 
}

function getStorageKey(key) { return `${key}_${myNick}`; }

let currentLang = localStorage.getItem('burmalda_lang') || 'uk';
let currentTheme = localStorage.getItem('burmalda_theme') || 'theme-dark';
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
document.getElementById('theme-select').value = currentTheme;

let socket;
if (typeof io !== 'undefined') {
    socket = io();
} else {
    console.warn("Socket.io не підключено.");
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

function emitActivity(activityType) {
    if (!currentRoom) return;
    socket.emit('user_activity', { room: currentRoom, user: myNick, activity: activityType });
}

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
    
    let glowC = uData.glowColor ? GLOW_COLORS[uData.glowColor] : (isOnline && !uData.isGroup ? 'var(--accent)' : 'rgba(128,128,128,0.5)');
    if(!isOnline && !uData.glowColor) glowC = 'rgba(128,128,128,0.5)';
    const glowStyle = `box-shadow: 0 0 12px ${glowC}; border: 2px solid ${glowC};`;
    
    if (uData.avatar && uData.avatar.startsWith('data:image')) { 
        return `<img src="${uData.avatar}" class="${cssClass}" id="av-node-${username}" alt="" style="${glowStyle}">`;
    } 
    const visibleName = getVisibleName(username);
    const firstLetter = visibleName ? visibleName.charAt(0) : (uData.isGroup ? '👥' : '?');
    const placeholderClass = cssClass === 'avatar' ? 'avatar-placeholder' : 'modal-avatar-placeholder';
    const colors = ['#0088cc', '#4cd964', '#ff3b30', '#ffcc00', '#5856d6', '#ff2d55', '#af52de'];
    let charCodeSum = 0;
    for (let i = 0; i < username.length; i++) charCodeSum += username.charCodeAt(i);
    const pickedColor = colors[charCodeSum % colors.length];
    return `<div class="${placeholderClass}" id="av-node-${username}" style="background-color: ${pickedColor}; ${glowStyle}">${firstLetter}</div>`;
}

// ============================== ГРУППЫ (GROUPS LOGIC) ==============================

let tempGroupGlow = '';
let tempGroupAvatar = '';
let tempGroupBanner = '';

function openCreateGroupModal() {
    document.getElementById('create-group-modal').classList.add('active');
    tempGroupGlow = ''; tempGroupAvatar = ''; tempGroupBanner = '';
    document.getElementById('group-name-input').value = '';
    document.getElementById('group-desc-input').value = '';
    document.getElementById('group-avatar-preview').style.display = 'none';
    document.getElementById('group-banner-preview').style.display = 'none';
}

function closeCreateGroupModal() {
    document.getElementById('create-group-modal').classList.remove('active');
}

function setTempGroupGlow(color) { tempGroupGlow = color; }

function previewGroupAvatar(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    compressImage(file, (compressedBase64) => {
        tempGroupAvatar = compressedBase64;
        document.getElementById('g-avatar-img').src = tempGroupAvatar;
        document.getElementById('group-avatar-preview').style.display = 'block';
    });
}

function previewGroupBanner(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    compressImage(file, (compressedBase64) => {
        tempGroupBanner = compressedBase64;
        document.getElementById('g-banner-img').src = tempGroupBanner;
        document.getElementById('group-banner-preview').style.display = 'block';
    });
}

function createGroup() {
    const name = document.getElementById('group-name-input').value.trim();
    const desc = document.getElementById('group-desc-input').value.trim();
    if (!name) return alert('Будь ласка, введіть назву групи!');
    
    const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    
    localProfiles[groupId] = {
        isGroup: true,
        displayName: name,
        bio: desc,
        avatar: tempGroupAvatar,
        banner: tempGroupBanner,
        glowColor: tempGroupGlow,
        members: [myNick],
        admin: myNick
    };
    
    localStorage.setItem('burmalda_profiles_data', JSON.stringify(localProfiles));
    activeChats.push(groupId);
    saveActiveChats();
    
    socket.emit('update_profile', { username: groupId, data: localProfiles[groupId] });
    socket.emit('create_group', { groupId: groupId, profile: localProfiles[groupId] });
    
    closeCreateGroupModal();
    renderChatsList();
    openChatWith(groupId);
}

function renderGroupMembers(groupId) {
    const pData = localProfiles[groupId];
    const list = document.getElementById('group-members-list');
    list.innerHTML = '';
    if (!pData || !pData.members) return;
    
    pData.members.forEach(member => {
        const item = document.createElement('div');
        item.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:8px; padding:5px; background:var(--bg-input); border-radius:8px; border: 1px solid var(--border-color);';
        item.innerHTML = `${getAvatarHTML(member, 'avatar')} <span style="font-size:13px; font-weight:bold;">${getVisibleName(member)}</span>`;
        list.appendChild(item);
    });
}

function openAddMemberModal() {
    document.getElementById('add-member-modal').classList.add('active');
    const list = document.getElementById('add-member-list');
    list.innerHTML = '';
    
    const pData = localProfiles[currentActiveChatPartner];
    activeChats.forEach(user => {
        if (user !== currentActiveChatPartner && (!localProfiles[user] || !localProfiles[user].isGroup)) {
            if (pData.members && pData.members.includes(user)) return; 
            
            const item = document.createElement('div');
            item.className = 'forward-user-item'; 
            item.innerHTML = `${getAvatarHTML(user, 'avatar')} <span>${getVisibleName(user)}</span>`;
            item.onclick = () => {
                addGroupMember(currentActiveChatPartner, user);
                closeAddMemberModal();
            };
            list.appendChild(item);
        }
    });
}

function closeAddMemberModal() { 
    document.getElementById('add-member-modal').classList.remove('active'); 
}

function addGroupMember(groupId, userId) {
    const pData = localProfiles[groupId];
    if (!pData.members.includes(userId)) {
        pData.members.push(userId);
        localStorage.setItem('burmalda_profiles_data', JSON.stringify(localProfiles));
        socket.emit('update_profile', { username: groupId, data: pData });
        
        // Системное сообщение (опционально, но полезно)
        const sysMsg = { id: Date.now().toString(), text: `${getVisibleName(myNick)} додав(ла) ${getVisibleName(userId)}`, from: 'system', timestamp: Date.now() };
        if (!savedMessages[currentRoom]) savedMessages[currentRoom] = [];
        savedMessages[currentRoom].push(sysMsg);
        safeSaveHistory();
        
        renderGroupMembers(groupId);
    }
}

// ===================================================================================

function applyCustomBackground() {
    const mainChat = document.getElementById('chat-main');
    if (chatBackgroundImage && mainChat) {
        mainChat.style.backgroundImage = `url(${chatBackgroundImage})`;
        mainChat.style.backgroundSize = 'cover';
        mainChat.style.backgroundPosition = 'center';
    } else if (mainChat) {
        mainChat.style.backgroundImage = '';
    }
}

function applyLanguage() { 
    const t = translations[currentLang];
    document.getElementById('lang-select').value = currentLang;
    document.getElementById('my-profile-name').innerHTML = `${getAvatarHTML(myNick)} <span>${getVisibleName(myNick)}</span>`;
    renderChatsList();
}

function compressImage(file, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            let width = img.width; let height = img.height;
            const maxSize = 1200;
            if (width > height && width > maxSize) { height *= maxSize / width; width = maxSize; }
            else if (height > maxSize) { width *= maxSize / height; height = maxSize; }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', 0.8));
        }
        img.src = e.target.result;
    }
    reader.readAsDataURL(file);
}

window.handleBannerUpload = function(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    compressImage(file, (compressedBase64) => {
        if (!localProfiles[myNick]) localProfiles[myNick] = {};
        localProfiles[myNick].banner = compressedBase64;
        localStorage.setItem('burmalda_profiles_data', JSON.stringify(localProfiles));
        applyBanner(myNick);
    });
};

function handleAvatarUpload(inputEl) { 
    const file = inputEl.files[0];
    if (!file) return;
    compressImage(file, (compressedBase64) => {
        if (!localProfiles[myNick]) localProfiles[myNick] = {};
        localProfiles[myNick].avatar = compressedBase64; 
        localStorage.setItem('burmalda_profiles_data', JSON.stringify(localProfiles)); 
        document.getElementById('modal-avatar-view').innerHTML = getAvatarHTML(myNick, 'modal-avatar'); 
    });
}

function applyBanner(username) {
    const uData = localProfiles[username] || {};
    const bannerEl = document.getElementById('profile-banner-view');
    if (bannerEl) {
        if (uData.banner) {
            bannerEl.style.backgroundImage = `url(${uData.banner})`;
            bannerEl.style.height = '120px';
        } else {
            bannerEl.style.backgroundImage = 'none';
            bannerEl.style.height = '0px';
        }
    }
}

function openMyProfile() { 
    document.getElementById('info-nick').textContent = myNick; 
    const myData = localProfiles[myNick] || {}; 
    document.getElementById('profile-display-name').disabled = false; document.getElementById('profile-display-name').value = myData.displayName || myNick; 
    document.getElementById('profile-desc').disabled = false;
    document.getElementById('profile-desc').value = myData.bio || ''; 
    document.getElementById('modal-avatar-view').innerHTML = getAvatarHTML(myNick, 'modal-avatar'); 
    document.getElementById('info-login-time').textContent = sessionTimeString; 
    document.getElementById('group-members-block').style.display = 'none'; // Не показываем участников для себя
    applyBanner(myNick);
    settingsModal.classList.add('active');
}

function openPartnerProfile() { 
    if (!currentActiveChatPartner) return;
    document.getElementById('info-nick').textContent = currentActiveChatPartner;
    const pData = localProfiles[currentActiveChatPartner] || {};
    document.getElementById('profile-display-name').disabled = true; document.getElementById('profile-display-name').value = pData.displayName || currentActiveChatPartner; 
    document.getElementById('profile-desc').disabled = true; document.getElementById('profile-desc').value = pData.bio || '';
    document.getElementById('modal-avatar-view').innerHTML = getAvatarHTML(currentActiveChatPartner, 'modal-avatar'); 
    
    // Показываем блок участников, если это группа
    if (pData.isGroup) {
        document.getElementById('group-members-block').style.display = 'block';
        renderGroupMembers(currentActiveChatPartner);
    } else {
        document.getElementById('group-members-block').style.display = 'none';
    }

    applyBanner(currentActiveChatPartner);
    settingsModal.classList.add('active');
}

function renderChatsList() { 
    chatsList.innerHTML = '';
    let filteredChats = activeChats.filter(c => {
        const folder = chatSettings[c]?.folder || 'all';
        return folder !== 'archive';
    });
    
    if (filteredChats.length === 0) { 
        chatsList.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:14px;">Список порожній</div>`;
    } else {
        filteredChats.forEach(user => renderChatDOM(user, chatsList));
    }
}

function renderChatDOM(user, targetContainer) {
    if(!targetContainer) return;
    const isOnline = onlineUsers.includes(user);
    const pData = localProfiles[user] || {};
    let statusText = isOnline ? "онлайн" : "офлайн"; 
    
    if (pData.isGroup) {
        statusText = `Учасників: ${(pData.members || []).length}`;
    }

    const activeClass = (currentActiveChatPartner === user) ? 'active' : '';
    const item = document.createElement('div');
    item.className = `chat-item ${activeClass}`;
    
    item.innerHTML = `<div class="chat-info-block">${getAvatarHTML(user)}<div><div style="font-weight:600; font-size:14px;">${escapeHTML(getVisibleName(user))}</div></div></div><div class="status-dot ${isOnline && !pData.isGroup ? 'online' : ''}">${statusText}</div>`;
    
    item.onclick = () => { openChatWith(user); };
    targetContainer.appendChild(item);
}

function openChatWith(username) { 
    currentActiveChatPartner = username; 
    const pData = localProfiles[username] || {};
    
    // Формируем правильную комнату в зависимости от того, группа это или человек
    if (pData.isGroup) {
        currentRoom = `room_${username}`; 
    } else {
        const roomSorted = [myNick, username].sort(); 
        currentRoom = `room_${roomSorted[0]}_${roomSorted[1]}`; 
    }
    
    document.body.classList.add('chat-opened');
    chatPlaceholder.style.display = 'none'; chatArea.style.display = 'flex'; 
    
    chatTitleText.innerHTML = `${getAvatarHTML(currentActiveChatPartner)} <span>${escapeHTML(getVisibleName(currentActiveChatPartner))}</span>`;
    
    socket.emit('join_room', { room: currentRoom, user: myNick });
    
    const prefs = chatSettings[username] || {};
    if (prefs.blocked) { 
        input.disabled = true; input.placeholder = "Користувач заблокований"; button.disabled = true; 
    } else { 
        input.disabled = false; input.placeholder = translations[currentLang].inputPlaceholder; button.disabled = false; 
    }
    
    renderMessagesHistory(); // Функция рендера сообщений (простая реализация для примера)
    input.focus();
}

function renderMessagesHistory() {
    messagesContainer.innerHTML = '';
    const history = savedMessages[currentRoom] || [];
    history.forEach(msg => {
        const li = document.createElement('li');
        const pData = localProfiles[currentActiveChatPartner] || {};
        
        // Логика отображения автора в ГРУППЕ
        if (pData.isGroup && msg.from !== myNick && msg.from !== 'system') {
            const header = document.createElement('div');
            header.className = 'group-msg-header';
            header.innerHTML = `${getAvatarHTML(msg.from, 'group-msg-avatar')} <span>${getVisibleName(msg.from)}</span>`;
            li.appendChild(header);
        }

        const textSpan = document.createElement('span');
        textSpan.textContent = msg.text;
        li.appendChild(textSpan);
        
        if (msg.from === myNick) {
            li.classList.add('my-msg');
            li.classList.add('msg-container');
            li.classList.add('my-wrapper');
        } else {
            li.classList.add('msg-container');
        }
        
        messagesContainer.appendChild(li);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

document.getElementById('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) {
        const msgObj = { id: Date.now().toString(), text: text, from: myNick, timestamp: Date.now() };
        if (!savedMessages[currentRoom]) savedMessages[currentRoom] = [];
        savedMessages[currentRoom].push(msgObj);
        safeSaveHistory();
        
        socket.emit('chat_message', { room: currentRoom, message: msgObj });
        
        input.value = '';
        renderMessagesHistory();
    }
});

socket.on('chat_message', (data) => {
    if (data.room === currentRoom) {
        if (!savedMessages[currentRoom]) savedMessages[currentRoom] = [];
        savedMessages[currentRoom].push(data.message);
        safeSaveHistory();
        renderMessagesHistory();
    }
});

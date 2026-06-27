function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;").replace(/\n/g, '<br>');
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
    uk: { searchPlaceholder: "Введіть ім'я...", dialogsTitle: "Ваші діалоги", placeholderText: "Бурмалда Premium<br><span style='font-size: 13px; color: var(--text-muted);'>Оберіть чат 🔍</span>", backBtn: "⬅ Назад", inputPlaceholder: "Напишіть повідомлення...", btnSend: "Надіслати", settingsTitle: "⚙️ Налаштування", profileTitle: "👤 Профіль", profile: "Юзернейм:", profileName: "Нік:", status: "Статус:", online: "в мережі", offline: "офлайн", loginTime: "Вхід:", logoutBtn: "Вийти 🚪", emptyList: "Список порожній", selfChatError: "Не можна створювати чат із собою!", ctxReply: "Відповісти ↩", ctxEdit: "Редагувати ✏️", userNotFound: "Не знайдено!", ctxPin: "Закріпити повідомлення 📌", ctxUnpin: "Відкріпити повідомлення 🔓", ctxDeleteMy: "Видалити (своє) 🗑", chatStatusOnline: "● онлайн", chatStatusOffline: "офлайн", typingText: "пише...", uploadBtn: "📁 Завантажити", bioPlaceholder: "Про себе:", bioEmpty: "Пусто", replyPrefix: "Відповідь на: ", pinnedLabel: "Закріплено", blockedMeText: "Цей користувач вас заблокував.", themeTitle: "Тема оформлення:" },
    ru: { searchPlaceholder: "Введите имя...", dialogsTitle: "Диалоги", placeholderText: "Бурмалда Premium", backBtn: "⬅ Назад", inputPlaceholder: "Напишите...", btnSend: "Отправить", settingsTitle: "⚙️ Настройки", profileTitle: "👤 Профиль", profile: "Юзернейм:", profileName: "Ник:", status: "Статус:", online: "в сети", offline: "офлайн", loginTime: "Вход:", logoutBtn: "Выйти 🚪", emptyList: "Пусто", selfChatError: "Нельзя с собой!", ctxReply: "Ответить ↩", ctxEdit: "Изменить ✏️", userNotFound: "Не найден!", ctxPin: "Закрепить 📌", ctxUnpin: "Открепить 🔓", ctxDeleteMy: "Удалить 🗑", chatStatusOnline: "● онлайн", chatStatusOffline: "офлайн", typingText: "печатает...", uploadBtn: "📁 Загрузить", bioPlaceholder: "О себе:", bioEmpty: "Пусто", replyPrefix: "Ответ: ", pinnedLabel: "Закреплено", blockedMeText: "Этот пользователь вас заблокировал.", themeTitle: "Тема оформления:" },
    en: { searchPlaceholder: "Search...", dialogsTitle: "Chats", placeholderText: "Бурмалда Premium", backBtn: "⬅ Back", inputPlaceholder: "Message...", btnSend: "Send", settingsTitle: "⚙️ Settings", profileTitle: "👤 Profile", profile: "ID:", profileName: "Name:", status: "Status:", online: "online", offline: "offline", loginTime: "Login:", logoutBtn: "Log out 🚪", emptyList: "Empty", selfChatError: "Can't chat with yourself!", ctxReply: "Reply ↩", ctxEdit: "Edit ✏️", userNotFound: "Not found!", ctxPin: "Pin 📌", ctxUnpin: "Unpin 🔓", ctxDeleteMy: "Delete 🗑", chatStatusOnline: "● online", chatStatusOffline: "offline", typingText: "typing...", uploadBtn: "📁 Upload", bioPlaceholder: "Bio:", bioEmpty: "Empty", replyPrefix: "Reply: ", pinnedLabel: "Pinned", blockedMeText: "You are blocked by this user.", themeTitle: "Theme:" }
};

const GLOW_COLORS = {
    'green': '#4cd964',
    'red': '#ff3b30',
    'blue': '#0088cc',
    'dark': '#333333',
    'white': '#ffffff',
    'yellow': '#ffcc00'
};

function safeJSONParse(dataStr, fallback) {
    try {
        const parsed = JSON.parse(dataStr);
        return parsed !== null && parsed !== undefined ? parsed : fallback;
    } catch (e) {
        return fallback;
    }
}

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
    const mainBody = document.getElementById('main-body');
    if (mainBody) mainBody.style.display = 'flex';
    else document.body.style.display = 'block'; 
}

function getStorageKey(key) { return `${key}_${myNick}`; }

let currentLang = localStorage.getItem('burmalda_lang') || 'uk';
let currentTheme = localStorage.getItem('burmalda_theme') || 'theme-dark';
let isPrivacyMode = localStorage.getItem(getStorageKey('burmalda_privacy')) === 'true';
let replyTargetMsgId = null;
let editTargetMsgId = null;
let messageToForward = null;

let activeChats = safeJSONParse(localStorage.getItem(getStorageKey('burmalda_chat_list')), []);
let glowingChats = safeJSONParse(localStorage.getItem(getStorageKey('burmalda_glow_chats')), {});
let pinnedMessages = safeJSONParse(localStorage.getItem(getStorageKey('burmalda_pinned_data')), {});
let currentPinIndex = 0;
let chatSettings = safeJSONParse(localStorage.getItem(getStorageKey('burmalda_chat_settings')), {});
let myCustomStickers = safeJSONParse(localStorage.getItem(getStorageKey('burmalda_custom_stickers')), []);
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
let savedMessages = safeJSONParse(localStorage.getItem(getStorageKey('burmalda_msg_history')), {});
let localProfiles = safeJSONParse(localStorage.getItem('burmalda_profiles_data'), {});

function isUserOnline(username) {
    if (!onlineUsers.includes(username)) return false;
    if (localProfiles[username] && localProfiles[username].hideOnline) return false;
    return true;
}

function safeSaveHistory() {
    try { localStorage.setItem(getStorageKey('burmalda_msg_history'), JSON.stringify(savedMessages)); } 
    catch(e) { console.warn("localStorage переповнено! Дані не збережено локально."); }
}

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

if (input) {
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                // Дозволяємо перенесення рядка
            } else {
                e.preventDefault();
                const form = document.getElementById('form');
                if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
            }
        }
    });
}

if (settingsToggleBtn) settingsToggleBtn.onclick = () => { openMyProfile(); };
if (settingsCloseBtn) settingsCloseBtn.onclick = () => { if (settingsModal) settingsModal.classList.remove('active'); };

const btnBack = document.getElementById('btn-back');
if (btnBack) {
    btnBack.onclick = () => { 
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
    if (!currentRoom || isPrivacyMode) return;
    socket.emit('user_activity', { room: currentRoom, user: myNick, activity: activityType });
}

function openImageViewer(src) {
    const viewerImg = document.getElementById('image-viewer-img');
    const viewerModal = document.getElementById('image-viewer-modal');
    if (viewerImg && viewerModal) {
        viewerImg.src = src;
        viewerModal.classList.add('active');
    }
}

function closeImageViewer() {
    const viewerImg = document.getElementById('image-viewer-img');
    const viewerModal = document.getElementById('image-viewer-modal');
    if (viewerModal) viewerModal.classList.remove('active');
    if (viewerImg) viewerImg.src = '';
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
    const isOnline = isUserOnline(username);
    
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
    const bgColor = colors[charCodeSum % colors.length];
    
    return `<div class="${placeholderClass}" style="background-color: ${bgColor}; ${glowStyle}" id="av-node-${username}">${firstLetter}</div>`;
}

// =========================================================================
// === СИСТЕМА ГРУП ТА КАНАЛІВ (ДОДАНО НОВЕ, НІЧОГО НЕ ВИДАЛЕНО) ===
// =========================================================================

let myEntities = safeJSONParse(localStorage.getItem(getStorageKey('burmalda_entities')), {});

const ROLES = {
    OWNER: 'owner',       // Власник (Може все, в т.ч. видаляти сутність)
    SR_ADMIN: 'sr_admin', // Старший адмін (Рівень власника, але без права видалення сутності)
    JR_ADMIN: 'jr_admin', // Молодший адмін (Блокування користувачів з групи)
    SR_MOD: 'sr_mod',     // Старший модератор (Видалення чужих повідомлень, мут)
    JR_MOD: 'jr_mod',     // Молодший модератор (Тільки мут/розмут)
    MEMBER: 'member'      // Звичайний учасник
};

function saveEntities() {
    localStorage.setItem(getStorageKey('burmalda_entities'), JSON.stringify(myEntities));
    socket.emit('sync_entities', { user: myNick, entities: myEntities });
}

// 1. Відкриття меню створення через (+)
function showCreateEntityMenu() {
    const existingMenu = document.getElementById('create-entity-menu');
    if (existingMenu) return existingMenu.remove();

    const menu = document.createElement('div');
    menu.id = 'create-entity-menu';
    menu.className = 'popup-menu active';
    menu.style.cssText = `position: absolute; top: 60px; left: 20px; bottom: auto; background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 10px; z-index: 9999; box-shadow: 0 5px 20px rgba(0,0,0,0.6); display: flex; flex-direction: column; width: 220px;`;
    
    menu.innerHTML = `
        <button onclick="openEntityCreatorModal('group')" style="display:block; width:100%; padding:12px 10px; background:none; border:none; color:var(--text-main); text-align:left; cursor:pointer; font-size: 14px; font-weight: bold; border-radius: 6px;" onmouseover="this.style.background='var(--bg-header)'" onmouseout="this.style.background='none'">👥 Створити Групу</button>
        <button onclick="openEntityCreatorModal('channel')" style="display:block; width:100%; padding:12px 10px; background:none; border:none; color:var(--text-main); text-align:left; cursor:pointer; font-size: 14px; font-weight: bold; border-top: 1px solid var(--border-color); border-radius: 6px;" onmouseover="this.style.background='var(--bg-header)'" onmouseout="this.style.background='none'">📢 Створити Канал</button>
    `;
    
    document.body.appendChild(menu);
    
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 100);
}

// 2. Модальне вікно створення Групи/Каналу
function openEntityCreatorModal(type) {
    document.getElementById('create-entity-menu')?.remove();
    
    const existingModal = document.getElementById('entity-creator-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.id = 'entity-creator-modal';
    modal.style.zIndex = '10005';
    
    const title = type === 'group' ? 'Створити Групу 👥' : 'Створити Канал 📢';
    
    modal.innerHTML = `
        <div class="modal-content" style="max-height: 90vh; overflow-y: auto;">
            <div class="modal-title">
                <span>${title}</span>
                <button class="modal-close" onclick="document.getElementById('entity-creator-modal').remove()">&times;</button>
            </div>
            
            <div class="account-property">
                <label>Назва:</label>
                <input type="text" id="entity-name" class="profile-name-input" placeholder="Введіть назву...">
            </div>

            <div class="account-property">
                <label>Опис:</label>
                <textarea id="entity-desc" class="profile-desc-input" placeholder="Короткий опис..."></textarea>
            </div>
            
            <div class="account-property">
                <label>Аватарка (Зображення):</label>
                <input type="file" id="entity-avatar" accept="image/*" class="profile-name-input" style="padding: 6px;">
            </div>
            
            <div class="account-property">
                <label>Банер (Шапка профілю):</label>
                <input type="file" id="entity-banner" accept="image/*" class="profile-name-input" style="padding: 6px;">
            </div>
            
            <div class="account-property">
                <label>Шпалери для чату (Фон):</label>
                <input type="file" id="entity-wallpaper" accept="image/*" class="profile-name-input" style="padding: 6px;">
            </div>
            
            <div class="account-property">
                <label>Колір повідомлень (Стиль):</label>
                <input type="color" id="entity-msg-style" value="#0088cc" style="width: 100%; height: 40px; border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; background: var(--bg-input);">
            </div>
            
            <button class="settings-logout-btn" style="background:var(--accent); margin-top:20px;" onclick="submitCreateEntity('${type}')">✔️ Створити</button>
        </div>
    `;
    document.body.appendChild(modal);
}

// 3. Відправка та збереження нової Групи/Каналу
async function submitCreateEntity(type) {
    const name = document.getElementById('entity-name').value.trim();
    const desc = document.getElementById('entity-desc').value.trim();
    const msgStyle = document.getElementById('entity-msg-style').value;
    
    if (!name) return alert('Назва обов\'язкова!');
    
    const getFileBase64 = (id) => new Promise(resolve => {
        const file = document.getElementById(id).files[0];
        if (!file) return resolve('');
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(file);
    });

    const avatar = await getFileBase64('entity-avatar');
    const banner = await getFileBase64('entity-banner');
    const wallpaper = await getFileBase64('entity-wallpaper');

    const entityId = type + '_' + Date.now() + '_' + myNick;
    
    const newEntity = {
        id: entityId,
        type: type, // 'group' або 'channel'
        name: name,
        desc: desc,
        avatar: avatar,
        banner: banner,
        wallpaper: wallpaper,
        msgStyle: msgStyle,
        owner: myNick,
        members: [myNick],
        roles: { [myNick]: ROLES.OWNER },
        customPerms: {}, 
        muted: {},
        rules: "",
        showMembersToAll: true, // Налаштування приховування учасників
        createdAt: Date.now()
    };

    myEntities[entityId] = newEntity;
    saveEntities();
    
    document.getElementById('entity-creator-modal').remove();
    
    if (!activeChats.includes(entityId)) {
        activeChats.push(entityId);
        saveActiveChats();
    }
    
    socket.emit('entity_created', newEntity);
    
    if (typeof renderChatsList === 'function') renderChatsList();
    
    alert((type === 'group' ? 'Групу' : 'Канал') + ' успішно створено!');
}

// 4. Перевірка прав та муту
function hasPermission(entityId, userId, action) {
    const entity = myEntities[entityId];
    if (!entity) return false; // Якщо це звичайний чат, дозволяємо базові дії залежно від логіки
    
    const role = entity.roles[userId] || ROLES.MEMBER;
    if (role === ROLES.OWNER) return true; // Власник може абсолютно все

    // Перевірка специфічних прав для Каналу
    if (entity.type === 'channel') {
        if (action === 'write' || action === 'edit_msg' || action === 'pin_msg') {
            return ['owner', 'sr_admin', 'jr_admin'].includes(role) || 
                   (entity.customPerms[userId] && entity.customPerms[userId][action]);
        }
        if (entity.customPerms[userId] && entity.customPerms[userId][action]) return true;
        return false;
    }

    // Права для Групи
    switch (role) {
        case ROLES.SR_ADMIN:
            if (action === 'delete_entity') return false; // Тільки власник видаляє групу
            return true;
        case ROLES.JR_ADMIN:
            if (['block_user', 'delete_msg', 'mute_user'].includes(action)) return true;
            return false;
        case ROLES.SR_MOD:
            if (['delete_msg', 'mute_user'].includes(action)) return true;
            return false;
        case ROLES.JR_MOD:
            if (action === 'mute_user') return true;
            return false;
        default: // MEMBER
            return action === 'write'; 
    }
}

function checkMuted(entityId, userId) {
    const entity = myEntities[entityId];
    if (!entity) return false;
    const muteTimestamp = entity.muted[userId];
    if (muteTimestamp && muteTimestamp > Date.now()) return true;
    return false;
}

// 5. Контекстне меню призначення ролей (клік правою кнопкою на повідомлення у групі)
function showRoleMenuForUser(entityId, targetUserId, e) {
    e.preventDefault();
    
    const entity = myEntities[entityId];
    if (!entity || entity.type !== 'group') return;
    
    // Перевіряємо чи маємо ми право керувати ролями
    if (!hasPermission(entityId, myNick, 'manage_roles') && entity.roles[myNick] !== ROLES.OWNER) return;
    
    // Власника або себе не можна редагувати
    if (targetUserId === myNick || entity.owner === targetUserId) {
        return alert("Ви не можете змінити роль цього користувача!");
    }

    // Для SR_ADMIN забороняємо змінювати ролі інших адмінів, якщо він не власник (опціональна логіка)
    if (entity.roles[myNick] === ROLES.SR_ADMIN && ['sr_admin', 'jr_admin'].includes(entity.roles[targetUserId])) {
        return alert("У вас немає прав змінювати роль іншого адміністратора!");
    }

    const existingMenu = document.getElementById('role-context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.id = 'role-context-menu';
    menu.className = 'context-menu';
    menu.style.cssText = `display: block; left: ${e.pageX}px; top: ${e.pageY}px; z-index: 6000; box-shadow: 0 5px 20px rgba(0,0,0,0.8);`;
    
    const roleOptions = [
        { id: ROLES.SR_ADMIN, name: '👑 Старший Адмін (Налаштування)' },
        { id: ROLES.JR_ADMIN, name: '🛡️ Молодший Адмін (Блокування)' },
        { id: ROLES.SR_MOD, name: '🧹 Старший Модератор (Видалення, Мут)' },
        { id: ROLES.JR_MOD, name: '🤐 Молодший Модератор (Тільки Мут)' },
        { id: 'custom_mute', name: '⏳ Видати Мут (1 година)', action: 'mute' },
        { id: 'custom_unmute', name: '🔊 Зняти Мут', action: 'unmute' },
        { id: ROLES.MEMBER, name: '❌ Зняти всі повноваження (Учасник)' }
    ];

    roleOptions.forEach(opt => {
        const btn = document.createElement('button');
        btn.innerText = opt.name;
        
        if (opt.action === 'mute' || opt.action === 'unmute') {
            btn.onclick = () => {
                if (opt.action === 'mute') {
                    if (!hasPermission(entityId, myNick, 'mute_user')) return alert('Немає прав!');
                    entity.muted[targetUserId] = Date.now() + 3600000; // 1 година
                    alert(`Користувач ${targetUserId} замучений на 1 годину.`);
                } else {
                    delete entity.muted[targetUserId];
                    alert(`Мут знято з ${targetUserId}.`);
                }
                saveEntities();
                socket.emit('entity_updated', entity);
                menu.remove();
            };
        } else {
            btn.onclick = () => {
                entity.roles[targetUserId] = opt.id;
                saveEntities();
                socket.emit('entity_updated', entity);
                menu.remove();
                alert(`Користувачу ${targetUserId} призначено роль: ${opt.name}`);
            };
        }
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(evt) {
            if (!menu.contains(evt.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 100);
}

// 6. Відображення профілю Групи / Каналу
function openEntityProfile(entityId) {
    const entity = myEntities[entityId];
    if (!entity) return;

    const isGroup = entity.type === 'group';
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.id = 'entity-profile-modal';
    modal.style.zIndex = '10005';
    
    let membersHTML = '';
    let onlineCount = 0;
    
    // Перевірка видимості учасників для Каналу або прихованої Групи
    let visibleMembers = entity.members;
    if (!isGroup) {
        // Канал: бачимо тільки адмінів та власника, або якщо ми самі адмін
        if (!hasPermission(entityId, myNick, 'manage_roles')) {
            visibleMembers = entity.members.filter(m => entity.roles[m] && entity.roles[m] !== ROLES.MEMBER);
        }
    } else {
        // Група: можна приховати в налаштуваннях
        if (!entity.showMembersToAll && !hasPermission(entityId, myNick, 'manage_roles')) {
            visibleMembers = entity.members.filter(m => entity.roles[m] && entity.roles[m] !== ROLES.MEMBER);
        }
    }

    visibleMembers.forEach(m => {
        if (isUserOnline(m)) onlineCount++;
        let roleBadge = '';
        if (entity.roles[m] && entity.roles[m] !== ROLES.MEMBER) {
            const roleNames = { 'owner':'Власник', 'sr_admin':'Ст.Адмін', 'jr_admin':'Мл.Адмін', 'sr_mod':'Ст.Модер', 'jr_mod':'Мл.Модер' };
            roleBadge = ` <span style="font-size:10px; color:var(--accent); border: 1px solid var(--accent); padding: 1px 4px; border-radius: 4px; margin-left: 5px;">${roleNames[entity.roles[m]]}</span>`;
        }
        membersHTML += `<div class="forward-user-item" style="cursor:default;">${getAvatarHTML(m, 'avatar')} <span style="flex-grow:1; margin-left:10px;">${getVisibleName(m)}</span> ${roleBadge}</div>`;
    });

    const totalCount = entity.members.length;

    modal.innerHTML = `
        <div class="modal-content" style="max-height: 85vh; overflow-y: auto; padding: 0; overflow-x: hidden;">
            ${entity.banner ? `<img src="${entity.banner}" style="width:100%; height:120px; object-fit:cover; border-radius: 12px 12px 0 0;">` : `<div style="width:100%; height:60px; background:var(--bg-header); border-radius: 12px 12px 0 0;"></div>`}
            
            <button class="modal-close" style="position:absolute; top:10px; right:15px; background:rgba(0,0,0,0.5); border-radius:50%; width:30px; height:30px; color:white;" onclick="document.getElementById('entity-profile-modal').remove()">&times;</button>
            
            <div style="padding: 20px; position:relative;">
                <div style="position:absolute; top:-40px; left:20px;">
                    ${entity.avatar ? `<img src="${entity.avatar}" style="width:80px; height:80px; border-radius:50%; object-fit:cover; border: 4px solid var(--bg-panel);">` : `<div class="modal-avatar-placeholder" style="width:80px; height:80px; font-size:34px; background:var(--accent); border: 4px solid var(--bg-panel);">${entity.name.charAt(0)}</div>`}
                </div>
                
                <div style="margin-top: 40px; margin-bottom: 15px;">
                    <h2 style="margin:0; font-size: 20px; display:flex; align-items:center; gap:8px;">${entity.name} ${isGroup ? '👥' : '📢'}</h2>
                    <p style="font-size:13px; color:var(--text-muted); margin: 5px 0;">${entity.desc || 'Опис відсутній'}</p>
                </div>

                <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--text-main); background: var(--bg-input); padding: 12px; border-radius: 8px; margin-bottom: 15px;">
                    <span><strong>Учасників:</strong> ${totalCount}</span>
                    <span style="color:#4cd964;"><strong>В мережі:</strong> ${onlineCount}</span>
                </div>

                ${entity.rules ? `
                <div style="background: rgba(128,128,128,0.1); padding: 12px; border-left: 3px solid var(--accent); border-radius: 4px; margin-bottom: 15px; font-size: 13px;">
                    <strong>Навігація/Правила:</strong><br><div style="margin-top:5px; color:var(--text-muted);">${escapeHTML(entity.rules)}</div>
                </div>` : ''}

                ${hasPermission(entityId, myNick, 'settings') ? `
                <button class="settings-logout-btn" style="background:rgba(128,128,128,0.2); color:var(--text-main); margin-bottom:15px;" onclick="alert('Відкриття налаштувань...')">⚙️ Редагувати профіль ${isGroup ? 'групи' : 'каналу'}</button>
                ` : ''}

                <div style="font-size:12px; text-transform:uppercase; color:var(--accent); font-weight:bold; margin-bottom:10px; border-bottom:1px solid var(--border-color); padding-bottom:5px;">
                    ${isGroup && !entity.showMembersToAll ? 'Адміністрація:' : 'Учасники:'}
                </div>
                
                <div style="max-height: 250px; overflow-y: auto;">
                    ${membersHTML}
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Додавання слухачів при завантаженні
document.addEventListener('DOMContentLoaded', () => {
    // Впроваджуємо кнопку (+) поруч з існуючими кнопками пошуку/налаштувань
    const headerControls = document.querySelector('.header-controls');
    if (headerControls && !document.getElementById('add-entity-btn')) {
        const addBtn = document.createElement('button');
        addBtn.id = 'add-entity-btn';
        addBtn.className = 'search-trigger-btn';
        addBtn.innerHTML = '➕';
        addBtn.title = 'Створити Групу/Канал';
        addBtn.onclick = showCreateEntityMenu;
        
        // Вставляємо першим елементом
        headerControls.insertBefore(addBtn, headerControls.firstChild);
    }
});

// Слухачі оновлень сутностей (Груп/Каналів) через веб-сокет
if (socket) {
    socket.on('entity_created', (data) => {
        if (!myEntities[data.id]) {
            myEntities[data.id] = data;
            saveEntities();
            if (typeof renderChatsList === 'function') renderChatsList();
        }
    });

    socket.on('entity_updated', (data) => {
        if (myEntities[data.id]) {
            myEntities[data.id] = data;
            saveEntities();
            
            // Динамічне оновлення відкритого чату, якщо це оновлена група/канал
            if (currentRoom === data.id) {
                const titleText = document.getElementById('chat-title-text');
                if (titleText) titleText.innerHTML = `${data.avatar ? `<img src="${data.avatar}" style="width:24px; height:24px; border-radius:50%; object-fit:cover;">` : '📢'} ${data.name}`;
                
                if (data.wallpaper && chatArea) {
                    chatArea.style.backgroundImage = `url('${data.wallpaper}')`;
                    chatArea.style.backgroundSize = 'cover';
                } else if (!data.wallpaper && chatArea) {
                    chatArea.style.backgroundImage = 'var(--chat-bg-img)';
                }
            }
            if (typeof renderChatsList === 'function') renderChatsList();
        }
    });
}

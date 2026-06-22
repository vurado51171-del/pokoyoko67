// === Клієнтська логіка BurmaldaGram Premium ===

const socket = io();
let peer;
let localStream = null;
let currentCall = null;

// --- Стан додатка ---

// Якщо був явний вихід, не генеруємо новий ID автоматично, поки користувач не оновить сторінку
if (sessionStorage.getItem('explicit_logout') === 'true') {
    alert("Ви вийшли з акаунту. Для створення нового профілю або входу натисніть ОК.");
    sessionStorage.removeItem('explicit_logout');
}

let myUserId = localStorage.getItem('burmalda_uid') || 'user_' + Math.random().toString(36).substr(2, 9);
localStorage.setItem('burmalda_uid', myUserId);

let state = {
    username: localStorage.getItem('burmalda_username') || 'Покояко_' + myUserId.substr(-4),
    bio: localStorage.getItem('burmalda_bio') || 'Привіт! Я використовую BurmaldaGram.',
    avatar: localStorage.getItem('burmalda_avatar') || null,
    profileColors: JSON.parse(localStorage.getItem('burmalda_colors')) || { banner: '#1a1a1e', ring: '#0088cc', cardBg: '#1c1c21' },
    theme: localStorage.getItem('burmalda_theme') || 'theme-dark',
    lang: localStorage.getItem('burmalda_lang') || 'uk',
    
    chats: {},           // Всі завантажені чати/діалоги
    activeChat: null,    // ID поточного активного співрозмовника
    messages: [],        // Повідомлення поточного чату
    pinnedMessages: {},  // Масив закріплених за юзерами: { partnerId: [msgIds] }
    pinnedIndex: 0,
    
    drafts: JSON.parse(localStorage.getItem('burmalda_drafts')) || {}, // Чорнетки: { userId: "текст" }
    blockedUsers: JSON.parse(localStorage.getItem('burmalda_blocked')) || [], // Заблоковані
    folders: JSON.parse(localStorage.getItem('burmalda_folders')) || {
        all: { name: "Всі", locked: false },
        personal: { name: "Особисте", locked: false },
        work: { name: "Робота", locked: false },
        games: { name: "Ігри", locked: false }
    },
    activeFolder: 'all',
    folderAwaitingUnlock: null,
    
    customStickers: JSON.parse(localStorage.getItem('burmalda_stickers')) || [],
    
    selectedMessages: new Set(), // Масове виділення повідомлень
    selectedChats: new Set(),    // Масове виділення чатів
    
    isRecording: false,
    mediaRecorder: null,
    recordedChunks: [],
    recordTimerInterval: null,
    recordDuration: 0,
    recordMode: null, // 'audio' або 'video_circle'
    currentCameraFacing: 'user',
    
    activeTimerMode: null, // 'scheduled' або 'disappearing'
    timerValue: null,
    
    replyingToMessageId: null
};

// --- Словник локалізації (Мови) ---
const locales = {
    uk: { placeholder: "Оберіть чат...", dialogs: "Діалоги", statusOnline: "В мережі", msgSelected: "Обрано", answerTo: "Відповідь на", inputPlaceholder: "Напишіть повідомлення..." },
    ru: { placeholder: "Выберите чат...", dialogs: "Диалоги", statusOnline: "В сети", msgSelected: "Выбрано", answerTo: "Ответ на", inputPlaceholder: "Напишите сообщение..." },
    en: { placeholder: "Select a chat...", dialogs: "Dialogs", statusOnline: "Online", msgSelected: "Selected", answerTo: "Reply to", inputPlaceholder: "Type a message..." }
};

// === ІНІЦІАЛІЗАЦІЯ ПРИ ЗАВАНТАЖЕННІ ===
window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('main-body').style.display = 'flex';
    
    // Авторизація на сервері сокетів
    socket.emit('auth_user', { uid: myUserId, username: state.username, avatar: state.avatar, bio: state.bio });
    
    initPeer();
    applyThemeAndLang();
    renderFolders();
    renderStickersMenu();
    updateMyProfileUI();
    
    // Завантаження збережених чатів із сервера/локально
    socket.emit('request_chats_list', { uid: myUserId });
    
    // Стрічка подій форм
    document.getElementById('form').addEventListener('submit', handleSendMessageForm);
    document.getElementById('search-input').addEventListener('input', handleGlobalSearch);
    
    // Слідкування за кліками по екрану для закриття меню
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#btn-attach') && !e.target.closest('#attachment-bubble')) {
            document.getElementById('attachment-bubble').classList.remove('active');
        }
        if (!e.target.closest('.search-trigger-btn') && !e.target.closest('#chat-options-menu')) {
            document.getElementById('chat-options-menu').style.display = 'none';
        }
        document.getElementById('global-context-menu').style.display = 'none';
    });

    // Реєстрація подій прокрутки для кнопки "Вниз"
    document.getElementById('messages').addEventListener('scroll', () => {
        const el = document.getElementById('messages');
        const btn = document.getElementById('scroll-to-bottom-btn');
        if (el.scrollHeight - el.scrollTop > 600) {
            btn.style.display = 'flex';
        } else {
            btn.style.display = 'none';
        }
    });
});

// === PEERJS & ДЗВІНКИ ===
function initPeer() {
    peer = new Peer(myUserId, { host: window.location.hostname, port: window.location.port || (window.location.protocol === 'https:' ? 443 : 80), path: '/peerjs' });
    
    peer.on('call', (incomingCall) => {
        if (state.blockedUsers.includes(incomingCall.peer)) {
            incomingCall.close();
            return;
        }
        currentCall = incomingCall;
        showIncomingCallModal(incomingCall.peer);
    });
}

// === ЧОРНЕТКИ (DRAFTS) ===
function handleInputDraftNotify() {
    const inputEl = document.getElementById('input');
    if (!state.activeChat) return;

    if (inputEl.value.trim() !== "") {
        state.drafts[state.activeChat] = inputEl.value;
    } else {
        delete state.drafts[state.activeChat];
    }
    localStorage.setItem('burmalda_drafts', JSON.stringify(state.drafts));
    
    // Оновлюємо бейдж чорнетки в списку без повного рендеру
    updateChatDraftBadgeUI(state.activeChat);
    
    // Оповіщення співрозмовника про друк
    socket.emit('user_typing_event', { from: myUserId, to: state.activeChat, text: inputEl.value ? 'typing' : 'clear' });
}

function updateChatDraftBadgeUI(chatId) {
    const chatItem = document.querySelector(`.chat-item[data-id="${chatId}"]`);
    if (!chatItem) return;
    
    let badge = chatItem.querySelector('.draft-badge');
    if (state.drafts[chatId]) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'draft-badge';
            badge.innerText = 'Draft';
            chatItem.querySelector('.chat-info-block').appendChild(badge);
        }
    } else {
        if (badge) badge.remove();
    }
}

// === КАСТОМІЗАЦІЯ ПРОФІЛЮ ===
function updateMyProfileUI() {
    document.getElementById('my-profile-name').innerText = state.username;
    document.getElementById('profile-display-name').value = state.username;
    document.getElementById('profile-desc').value = state.bio;
    document.getElementById('info-nick').innerText = '@' + myUserId;
    document.getElementById('info-login-time').innerText = new Date().toLocaleTimeString();
    
    // Рендер аватара в налаштуваннях
    const container = document.getElementById('modal-avatar-view');
    container.innerHTML = '';
    if (state.avatar) {
        container.innerHTML = `<img src="${state.avatar}" class="modal-avatar" style="border-color: ${state.profileColors.ring};">`;
    } else {
        container.innerHTML = `<div class="modal-avatar-placeholder" style="border-color: ${state.profileColors.ring}; background:${state.profileColors.ring}">${state.username.substr(0,2)}</div>`;
    }

    // Кольори картки
    document.getElementById('my-profile-banner-element').style.backgroundColor = state.profileColors.banner;
    document.getElementById('my-profile-colors-setup').style.backgroundColor = state.profileColors.cardBg;
    
    document.getElementById('custom-banner-color-picker').value = state.profileColors.banner;
    document.getElementById('custom-avatar-ring-picker').value = state.profileColors.ring;
    document.getElementById('custom-profile-bg-picker').value = state.profileColors.cardBg;
}

function openMyProfile() {
    renderBlockedUsersSettings();
    document.getElementById('settings-modal').classList.add('active');
}

function saveMyDisplayName(val) {
    state.username = val || 'User';
    localStorage.setItem('burmalda_username', state.username);
    document.getElementById('my-profile-name').innerText = state.username;
    socket.emit('update_profile_data', { uid: myUserId, username: state.username, avatar: state.avatar, bio: state.bio });
}

function saveMyBio(val) {
    state.bio = val;
    localStorage.setItem('burmalda_bio', state.bio);
    socket.emit('update_profile_data', { uid: myUserId, username: state.username, avatar: state.avatar, bio: state.bio });
}

function handleAvatarUpload(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        state.avatar = e.target.result;
        localStorage.setItem('burmalda_avatar', state.avatar);
        updateMyProfileUI();
        socket.emit('update_profile_data', { uid: myUserId, username: state.username, avatar: state.avatar, bio: state.bio });
    };
    reader.readAsDataURL(file);
}

function saveProfileColors() {
    state.profileColors.banner = document.getElementById('custom-banner-color-picker').value;
    state.profileColors.ring = document.getElementById('custom-avatar-ring-picker').value;
    state.profileColors.cardBg = document.getElementById('custom-profile-bg-picker').value;
    
    localStorage.setItem('burmalda_colors', JSON.stringify(state.profileColors));
    updateMyProfileUI();
}

// === КЕРУВАННЯ ПАПКАМИ ТА ПАРОЛЯМИ ===
function renderFolders() {
    const bar = document.getElementById('chat-folders-bar');
    // Очистимо старі вкладки (крім кнопки плюс)
    const tabs = bar.querySelectorAll('.folder-tab');
    tabs.forEach(t => t.remove());
    
    Object.keys(state.folders).forEach(key => {
        const f = state.folders[key];
        const tab = document.createElement('div');
        tab.className = `folder-tab ${state.activeFolder === key ? 'active' : ''}`;
        tab.setAttribute('data-folder', key);
        tab.innerHTML = `${f.locked ? '🔒 ' : ''}${f.name}`;
        tab.onclick = () => selectFolderTab(key);
        bar.insertBefore(tab, document.getElementById('btn-add-folder'));
    });
}

function selectFolderTab(folderKey) {
    const f = state.folders[folderKey];
    if (f && f.locked) {
        state.folderAwaitingUnlock = folderKey;
        document.getElementById('folder-pin-input').value = '';
        document.getElementById('folder-pin-modal').classList.add('active');
        return;
    }
    
    state.activeFolder = folderKey;
    renderFolders();
    renderChatsList();
}

function verifyFolderPinAccess() {
    const pinEntered = document.getElementById('folder-pin-input').value;
    const targetFolder = state.folders[state.folderAwaitingUnlock];
    
    if (targetFolder && targetFolder.pin === pinEntered) {
        state.activeFolder = state.folderAwaitingUnlock;
        document.getElementById('folder-pin-modal').classList.remove('active');
        state.folderAwaitingUnlock = null;
        renderFolders();
        renderChatsList();
    } else {
        alert("🚨 Невірний PIN-код доступу!");
    }
}

function openCreateFolderModal() {
    document.getElementById('new-folder-name').value = '';
    document.getElementById('enable-folder-pin-check').checked = false;
    document.getElementById('folder-pin-setup-block').style.display = 'none';
    document.getElementById('new-folder-pin').value = '';
    document.getElementById('create-folder-modal').classList.add('active');
}

function createNewFolder() {
    const name = document.getElementById('new-folder-name').value.trim();
    if (!name) return;
    
    const id = 'folder_' + Math.random().toString(36).substr(2, 5);
    const pinCheck = document.getElementById('enable-folder-pin-check').checked;
    const pinVal = document.getElementById('new-folder-pin').value.trim();
    
    state.folders[id] = {
        name: name,
        locked: pinCheck,
        pin: pinCheck ? pinVal : null,
        chats: []
    };
    
    localStorage.setItem('burmalda_folders', JSON.stringify(state.folders));
    document.getElementById('create-folder-modal').classList.remove('active');
    renderFolders();
}

function openDeleteFolderModal() {
    const container = document.getElementById('delete-folder-list-container');
    container.innerHTML = '';
    
    Object.keys(state.folders).forEach(k => {
        if (['all','personal','work','games'].includes(k)) return; // Дефолтні не видаляємо повністю
        
        const row = document.createElement('div');
        row.className = 'blocked-user-row';
        row.innerHTML = `<span>${state.folders[k].name}</span>
                         <button class="unblock-row-btn" style="color:var(--danger);" onclick="deleteFolderExecution('${k}')">Видалити</button>`;
        container.appendChild(row);
    });
    
    document.getElementById('delete-folder-modal').classList.add('active');
}

function deleteFolderExecution(key) {
    if (state.activeFolder === key) state.activeFolder = 'all';
    delete state.folders[key];
    localStorage.setItem('burmalda_folders', JSON.stringify(state.folders));
    openDeleteFolderModal();
    renderFolders();
    renderChatsList();
}

function openFolderAssignModal() {
    if (!state.activeChat) return;
    const container = document.getElementById('folder-assign-list');
    container.innerHTML = '';
    
    Object.keys(state.folders).forEach(k => {
        const f = state.folders[k];
        const isInFolder = f.chats && f.chats.includes(state.activeChat);
        
        const btn = document.createElement('button');
        btn.className = 'forward-user-item';
        btn.innerHTML = `${f.name} ${isInFolder ? '✅' : ''}`;
        btn.onclick = () => {
            if (!f.chats) f.chats = [];
            if (isInFolder) {
                f.chats = f.chats.filter(id => id !== state.activeChat);
            } else {
                f.chats.push(state.activeChat);
            }
            localStorage.setItem('burmalda_folders', JSON.stringify(state.folders));
            document.getElementById('folder-assign-modal').classList.remove('active');
            renderChatsList();
        };
        container.appendChild(btn);
    });
    
    document.getElementById('folder-assign-modal').classList.add('active');
}

// === МАСОВЕ ВИДІЛЕННЯ ТА КЕРУВАННЯ ЧАТАМИ ===
function toggleMultiChatsMode() {
    document.body.classList.toggle('multi-chats-mode');
    state.selectedChats.clear();
    document.getElementById('multi-chats-count').innerText = '0';
    
    const checkboxes = document.querySelectorAll('.chat-checkbox-select');
    checkboxes.forEach(cb => {
        cb.checked = false;
        cb.onchange = (e) => {
            const cid = cb.getAttribute('data-chat-id');
            if (e.target.checked) state.selectedChats.add(cid);
            else state.selectedChats.delete(cid);
            document.getElementById('multi-chats-count').innerText = state.selectedChats.size;
        };
    });
}

function executeMultiChatsArchive() {
    if (state.selectedChats.size === 0) return;
    state.selectedChats.forEach(cid => {
        if (!state.chats[cid]) return;
        state.chats[cid].archived = !state.chats[cid].archived;
    });
    socket.emit('update_chats_batch_pref', { uid: myUserId, chatIds: Array.from(state.selectedChats), type: 'archive' });
    toggleMultiChatsMode();
    renderChatsList();
    renderArchiveList();
}

function executeMultiChatsDelete() {
    if (state.selectedChats.size === 0) return;
    if (!confirm(`Ви дійсно бажаєте видалити ${state.selectedChats.size} чатів разом із історією?`)) return;
    
    state.selectedChats.forEach(cid => {
        socket.emit('clear_chat_history_sides', { from: myUserId, to: cid });
        delete state.chats[cid];
    });
    toggleMultiChatsMode();
    renderChatsList();
    if (state.activeChat && state.selectedChats.has(state.activeChat)) closeChatArea();
}

// === БЛОКУВАННЯ ТА НАЛАШТУВАННЯ ЧАТІВ ===
function toggleChatPref(partnerId, type) {
    if (!state.chats[partnerId]) state.chats[partnerId] = {};
    
    if (type === 'blocked') {
        const isBlocked = state.blockedUsers.includes(partnerId);
        if (!isBlocked) {
            if (confirm("Заблокувати користувача? Це безповоротно очистить історію повідомлень з обох сторін.")) {
                state.blockedUsers.push(partnerId);
                socket.emit('clear_chat_history_sides', { from: myUserId, to: partnerId });
                socket.emit('block_user_sync', { flagger: myUserId, target: partnerId, action: 'block' });
                closeChatArea();
            }
        } else {
            state.blockedUsers = state.blockedUsers.filter(id => id !== partnerId);
            socket.emit('block_user_sync', { flagger: myUserId, target: partnerId, action: 'unblock' });
        }
        localStorage.setItem('burmalda_blocked', JSON.stringify(state.blockedUsers));
    } else if (type === 'muted') {
        state.chats[partnerId].muted = !state.chats[partnerId].muted;
        alert(state.chats[partnerId].muted ? "Звук сповіщень вимкнено" : "Звук сповіщень увімкнено");
    }
    
    document.getElementById('chat-options-menu').style.display = 'none';
    renderChatsList();
}

function renderBlockedUsersSettings() {
    const container = document.getElementById('blocked-users-list-dom');
    container.innerHTML = '';
    
    if (state.blockedUsers.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted); font-size:11px; text-align:center; padding:10px;">Список порожній</div>`;
        return;
    }
    
    state.blockedUsers.forEach(uid => {
        const row = document.createElement('div');
        row.className = 'blocked-user-row';
        row.innerHTML = `<span>${uid}</span>
                         <button class="unblock-row-btn" onclick="toggleChatPref('${uid}', 'blocked'); renderBlockedUsersSettings();">Розблокувати</button>`;
        container.appendChild(row);
    });
}

// === ШВИДКЕ ВІДПРАВЛЕННЯ У "ЗБЕРЕЖЕНЕ" ===
function sendToSavedDirectly() {
    if (!state.activeChat || state.messages.length === 0) return;
    if (state.activeChat === 'saved') return;
    
    if (confirm("Переслати останнє повідомлення діалогу в ваші нотатки?")) {
        const lastMsg = state.messages[state.messages.length - 1];
        const forwardPayload = {
            id: 'msg_' + Date.now(),
            from: 'saved', 
            to: 'saved',
            text: lastMsg.text,
            media: lastMsg.media,
            mediaType: lastMsg.mediaType,
            sticker: lastMsg.sticker,
            poll: lastMsg.poll,
            forwardFrom: 'Анонімно',
            timestamp: new Date().toISOString()
        };
        socket.emit('secure_send_message', forwardPayload);
        document.getElementById('chat-options-menu').style.display = 'none';
        alert("Збережено!");
    }
}

// === МЕДІА ПЛЕЄР: ШВИДКІСТЬ ПЛАТФОРМИ ===
function changePlaybackSpeed(btn, mediaSelector) {
    const container = btn.closest('.msg-container');
    const mediaEl = container.querySelector(mediaSelector);
    if (!mediaEl) return;
    
    let currentSpeed = parseFloat(mediaEl.playbackRate) || 1.0;
    if (currentSpeed === 1.0) currentSpeed = 1.5;
    else if (currentSpeed === 1.5) currentSpeed = 2.0;
    else currentSpeed = 1.0;
    
    mediaEl.playbackRate = currentSpeed;
    btn.innerText = `${currentSpeed}x`;
}

// === РЕНДЕР ДІАЛОГІВ / ЧАТІВ ===
function renderChatsList() {
    const list = document.getElementById('chats-list');
    list.innerHTML = '';
    
    Object.keys(state.chats).forEach(id => {
        const chat = state.chats[id];
        if (chat.archived) return; // Архівні окремо
        
        // Фільтрація по папках
        if (state.activeFolder !== 'all') {
            const folderObj = state.folders[state.activeFolder];
            if (!folderObj || !folderObj.chats || !folderObj.chats.includes(id)) return;
        }
        
        list.appendChild(createChatItemDOM(id, chat));
    });
}

function renderArchiveList() {
    const container = document.getElementById('archive-list');
    container.innerHTML = '';
    let count = 0;
    
    Object.keys(state.chats).forEach(id => {
        const chat = state.chats[id];
        if (chat.archived) {
            count++;
            container.appendChild(createChatItemDOM(id, chat));
        }
    });
    
    document.getElementById('archive-reveal-zone').style.display = count > 0 ? 'block' : 'none';
}

function createChatItemDOM(id, chat) {
    const isBlocked = state.blockedUsers.includes(id);
    const div = document.createElement('div');
    div.className = `chat-item ${state.activeChat === id ? 'active' : ''} ${isBlocked ? 'blocked' : ''}`;
    div.setAttribute('data-id', id);
    
    const displayName = id === 'saved' ? '💾 Збережене (Нотатки)' : (chat.username || id);
    const initial = displayName.substr(0, 2);
    
    let avatarMarkup = `<div class="avatar-placeholder" style="background:#4a6c9b">${initial}</div>`;
    if (chat.avatar) {
        avatarMarkup = `<img src="${chat.avatar}" class="avatar" style="border-color:${chat.ringColor || 'transparent'}">`;
    }
    
    div.innerHTML = `
        <input type="checkbox" class="chat-checkbox-select" data-chat-id="${id}" onclick="event.stopPropagation();">
        <div class="chat-info-block">
            ${avatarMarkup}
            <div>
                <div style="font-weight:600; font-size:14px;">${displayName}</div>
                <div style="font-size:12px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">
                    ${chat.lastMessage || 'Немає повідомлень'}
                </div>
            </div>
        </div>
        <div class="status-dot ${chat.online ? 'online' : ''}">${chat.online ? '• online' : ''}</div>
    `;
    
    div.onclick = () => {
        if (document.body.classList.contains('multi-chats-mode')) {
            const cb = div.querySelector('.chat-checkbox-select');
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change'));
            return;
        }
        openChatWithUser(id);
    };
    
    // Перевірка наявності чорнетки
    if (state.drafts[id]) {
        const badge = document.createElement('span');
        badge.className = 'draft-badge';
        badge.innerText = 'Draft';
        div.querySelector('.chat-info-block').appendChild(badge);
    }
    
    return div;
}

function toggleArchive() {
    const container = document.getElementById('archive-container');
    container.style.display = container.style.display === 'block' ? 'none' : 'block';
    renderArchiveList();
}

// === ВІДКРИТТЯ ЧАТУ ТА СИНХРОНІЗАЦІЯ ===
function openChatWithUser(partnerId) {
    if (state.blockedUsers.includes(partnerId)) {
        alert("Користувач заблокований. Розблокуйте його в налаштуваннях профілю.");
        return;
    }
    
    state.activeChat = partnerId;
    document.body.classList.add('chat-opened');
    document.getElementById('no-chat-placeholder').style.display = 'none';
    document.getElementById('chat-area').style.display = 'flex';
    
    // Заголовок чату
    const chatData = state.chats[partnerId] || {};
    document.getElementById('chat-title-text').innerText = partnerId === 'saved' ? '💾 Збережене (Нотатки)' : (chatData.username || partnerId);
    
    // Встановлення чорнетки в інпут, якщо є
    document.getElementById('input').value = state.drafts[partnerId] || '';
    
    // Запит історії
    socket.emit('request_chat_history', { from: myUserId, to: partnerId });
    renderChatsList();
}

function closeChatArea() {
    state.activeChat = null;
    document.body.classList.remove('chat-opened');
    document.getElementById('chat-area').style.display = 'none';
    document.getElementById('no-chat-placeholder').style.display = 'flex';
    renderChatsList();
}

document.getElementById('btn-back').onclick = closeChatArea;

// === РЕНДЕР ПОВІДОМЛЕНЬ ТА КОНТЕКСТНЕ МЕНЮ ===
socket.on('receive_chat_history', (data) => {
    state.messages = data.messages || [];
    state.pinnedMessages[state.activeChat] = data.pinnedIds || [];
    renderMessagesTimeline();
    updatePinnedBarUI();
});

function renderMessagesTimeline() {
    const container = document.getElementById('messages');
    container.innerHTML = '';
    
    let lastDateStr = "";
    
    state.messages.forEach(msg => {
        // Перевірка дати для роздільника
        const msgDate = new Date(msg.timestamp);
        const dateStr = msgDate.toLocaleDateString(state.lang, { day: 'numeric', month: 'long' });
        if (dateStr !== lastDateStr) {
            const div = document.createElement('div');
            div.className = 'date-divider';
            div.innerText = dateStr;
            container.appendChild(div);
            lastDateStr = dateStr;
        }
        
        // Рендер самої картки повідомлення
        container.appendChild(createMessageElementDOM(msg));
    });
    
    container.scrollTop = container.scrollHeight;
}

function createMessageElementDOM(msg) {
    const isMy = msg.from === myUserId;
    const wrapper = document.createElement('div');
    wrapper.className = `msg-container ${isMy ? 'my-wrapper' : ''}`;
    wrapper.setAttribute('data-msg-id', msg.id);
    
    // Чекбокс мульти-виділення
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'msg-checkbox';
    cb.checked = state.selectedMessages.has(msg.id);
    cb.onchange = (e) => {
        if (e.target.checked) state.selectedMessages.add(msg.id);
        else state.selectedMessages.delete(msg.id);
        document.getElementById('multi-select-count').innerText = state.selectedMessages.size;
    };
    wrapper.appendChild(cb);
    
    const li = document.createElement('li');
    if (isMy) li.className = 'my-msg';
    
    // Перевірка чи стікер/кружок (для прозорого тла)
    if (msg.sticker || msg.mediaType === 'video_circle') {
        li.classList.add('msg-transparent');
    }
    
    // Переслано або відповідь
    if (msg.forwardFrom) {
        li.innerHTML += `<div class="forward-header">↪️ Переслано від: ${msg.forwardFrom}</div>`;
    }
    if (msg.replyTo) {
        li.innerHTML += `<div class="reply-quote">➔ ${msg.replyTo.text || 'Медіа файл'}</div>`;
    }
    
    // Контент текстовий
    if (msg.text) {
        const textSpan = document.createElement('span');
        textSpan.innerText = msg.text;
        li.appendChild(textSpan);
    }
    
    // Контент: Стікер
    if (msg.sticker) {
        li.innerHTML += `<img src="${msg.sticker}" class="sticker-img">`;
    }
    
    // Контент: Медіа кружечок
    if (msg.media && msg.mediaType === 'video_circle') {
        li.innerHTML += `
            <div class="circle-video-wrapper">
                <video src="${msg.media}" class="circle-video" autoplay loop muted playsinline onclick="toggleExpandCircleVideo(this)"></video>
                <button class="media-speed-btn" onclick="event.stopPropagation(); changePlaybackSpeed(this, 'video')">1x</button>
            </div>
        `;
    } else if (msg.media && msg.mediaType === 'image') {
        li.innerHTML += `<div class="chat-media-wrapper"><img src="${msg.media}" class="chat-media-img" onclick="openImageViewer('${msg.media}')"></div>`;
    } else if (msg.media && msg.mediaType === 'audio') {
        li.innerHTML += `
            <div class="audio-wrapper">
                <audio src="${msg.media}" controls class="audio-msg"></audio>
                <button class="audio-speed-btn" onclick="changePlaybackSpeed(this, 'audio')">1x</button>
            </div>
        `;
    } else if (msg.media) {
        li.innerHTML += `<div style="margin-top:5px;"><a href="${msg.media}" target="_blank" style="color:var(--accent); font-size:13px; font-weight:bold;">📄 Документ (${msg.mediaType || 'файл'})</a></div>`;
    }
    
    // Контент: Опитування (Poll)
    if (msg.poll) {
        li.appendChild(createPollDOM(msg));
    }
    
    // Мета-дані (Час, Статус)
    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const metaLine = document.createElement('div');
    metaLine.className = 'msg-meta-line';
    metaLine.innerHTML = `<span class="msg-time">${timeStr}</span>`;
    if (isMy) {
        metaLine.innerHTML += `<span class="msg-status ${msg.read ? 'read' : ''}">${msg.read ? '✓✓' : '✓'}</span>`;
    }
    li.appendChild(metaLine);
    
    // Відображення реакцій
    if (msg.reactions && Object.keys(msg.reactions).length > 0) {
        const reactHolder = document.createElement('div');
        reactHolder.className = 'reactions-holder';
        Object.keys(msg.reactions).forEach(emoji => {
            const users = msg.reactions[emoji];
            const chip = document.createElement('div');
            chip.className = `reaction-chip ${users.includes(myUserId) ? 'active-my' : ''}`;
            chip.innerHTML = `<span>${emoji}</span> <span>${users.length}</span>`;
            chip.onclick = (e) => { e.stopPropagation(); sendReaction(msg.id, emoji); };
            reactHolder.appendChild(chip);
        });
        li.appendChild(reactHolder);
    }
    
    wrapper.appendChild(li);
    
    // Обробник контекстного меню
    wrapper.oncontextmenu = (e) => {
        e.preventDefault();
        showGlobalContextMenu(e, msg);
    };
    
    return wrapper;
}

// === ОПИТУВАННЯ (POLLS) ===
function createPollDOM(msg) {
    const container = document.createElement('div');
    container.style = "background: rgba(0,0,0,0.15); padding:10px; border-radius:8px; margin-top:5px; min-width:200px;";
    container.innerHTML = `<div style="font-weight:bold; margin-bottom:8px; font-size:13px;">📊 ${msg.poll.question}</div>`;
    
    const totalVotes = Object.values(msg.poll.votes || {}).reduce((a, b) => a + b.length, 0);
    
    msg.poll.options.forEach((opt, idx) => {
        const votesArr = (msg.poll.votes && msg.poll.votes[idx]) || [];
        const hasVoted = votesArr.includes(myUserId);
        const percent = totalVotes > 0 ? Math.round((votesArr.length / totalVotes) * 100) : 0;
        
        const optRow = document.createElement('div');
        optRow.style = "margin-bottom:6px; cursor:pointer; font-size:12px; position:relative; background:rgba(128,128,128,0.05); padding:6px; border-radius:4px; overflow:hidden;";
        optRow.innerHTML = `
            <div style="position:absolute; left:0; top:0; bottom:0; width:${percent}%; background:rgba(0,136,204,0.15); transition:width 0.3s;"></div>
            <div style="position:relative; display:flex; justify-content:space-between; font-weight:${hasVoted ? 'bold' : 'normal'}">
                <span>${hasVoted ? '☑️ ' : '⬜ '}${opt}</span>
                <span>${votesArr.length} (${percent}%)</span>
            </div>
        `;
        optRow.onclick = () => {
            socket.emit('cast_poll_vote', { msgId: msg.id, chatPartner: state.activeChat, optionIdx: idx, uid: myUserId });
        };
        container.appendChild(optRow);
    });
    return container;
}

// === КОНТЕКСТНЕ МЕНЮ ТА РЕАКЦІЇ ===
function showGlobalContextMenu(e, msg) {
    const menu = document.getElementById('global-context-menu');
    menu.innerHTML = '';
    
    // Панель реакцій зверху меню
    const reactions = ['👍', '❤️', '🔥', '😂', '😮', '👏', '✨'];
    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    picker.style.display = 'flex';
    reactions.forEach(r => {
        const span = document.createElement('span');
        span.innerText = r;
        span.onclick = () => { sendReaction(msg.id, r); menu.style.display = 'none'; };
        picker.appendChild(span);
    });
    menu.appendChild(picker);
    
    // Кнопки дій
    menu.innerHTML += `<button onclick="setupReplyAction('${msg.id}')">➔ Відповісти</button>`;
    menu.innerHTML += `<button onclick="openForwardModalSingle('${msg.id}')">↪️ Переслати</button>`;
    menu.innerHTML += `<button onclick="togglePinMessage('${msg.id}')">📌 Закріпити / Відкріпити</button>`;
    menu.innerHTML += `<button class="delete-btn" onclick="deleteMessageSides('${msg.id}')">🗑 Видалити для всіх</button>`;
    
    menu.style.display = 'block';
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 250)}px`;
}

function sendReaction(msgId, emoji) {
    socket.emit('toggle_msg_reaction', { msgId, emoji, uid: myUserId, chatPartner: state.activeChat });
}

function setupReplyAction(msgId) {
    state.replyingToMessageId = msgId;
    const target = state.messages.find(m => m.id === msgId);
    document.getElementById('reply-preview-text').innerText = `Відповідь користувачу: ${target ? (target.text || 'Медіа') : ''}`;
    document.getElementById('reply-preview-bar').style.display = 'flex';
}

function cancelAction() {
    state.replyingToMessageId = null;
    document.getElementById('reply-preview-bar').style.display = 'none';
}

function deleteMessageSides(msgId) {
    if (confirm("Видалити повідомлення назавжди для обох сторін?")) {
        socket.emit('delete_message_global', { msgId, chatPartner: state.activeChat });
    }
}

// === МАСОВЕ ВИДІЛЕННЯ ПОВІДОМЛЕНЬ ===
function toggleMultiSelectMode() {
    document.body.classList.toggle('multi-select-mode');
    const bar = document.getElementById('multi-select-bar');
    
    if (document.body.classList.contains('multi-select-mode')) {
        bar.style.display = 'flex';
        state.selectedMessages.clear();
        document.getElementById('multi-select-count').innerText = '0';
    } else {
        bar.style.display = 'none';
        state.selectedMessages.clear();
        renderMessagesTimeline();
    }
}

function executeMultiDelete() {
    if (state.selectedMessages.size === 0) return;
    if (confirm(`Видалити ${state.selectedMessages.size} обраних повідомлень для всіх?`)) {
        socket.emit('delete_messages_batch', { msgIds: Array.from(state.selectedMessages), chatPartner: state.activeChat });
        toggleMultiSelectMode();
    }
}

function executeMultiSave() {
    if (state.selectedMessages.size === 0) return;
    let count = 0;
    state.selectedMessages.forEach(mid => {
        const orig = state.messages.find(m => m.id === mid);
        if (!orig) return;
        count++;
        socket.emit('secure_send_message', {
            id: 'msg_' + Math.random().toString(36).substr(2,9),
            from: 'saved', to: 'saved',
            text: orig.text, media: orig.media, mediaType: orig.mediaType, sticker: orig.sticker,
            forwardFrom: 'Анонімно', timestamp: new Date().toISOString()
        });
    });
    alert(`Перенесено в збережене: ${count} повідомлень.`);
    toggleMultiSelectMode();
}

// === ЗАКРІПЛЕННЯ ПОВІДОМЛЕНЬ ===
function togglePinMessage(msgId) {
    socket.emit('toggle_pin_event', { msgId, chatPartner: state.activeChat });
}

function updatePinnedBarUI() {
    const arr = state.pinnedMessages[state.activeChat] || [];
    const bar = document.getElementById('pinned-message-bar');
    
    if (arr.length === 0) {
        bar.style.display = 'none';
        return;
    }
    
    bar.style.display = 'flex';
    document.getElementById('pin-counter-badge').innerText = `${state.pinnedIndex + 1}/${arr.length}`;
    
    // Знаходимо текст закріпленого повідомлення
    const targetId = arr[state.pinnedIndex];
    const targetMsg = state.messages.find(m => m.id === targetId);
    document.getElementById('pinned-bar-text-content').innerText = targetMsg ? (targetMsg.text || '[Медіа файл]') : 'Закріплене повідомлення';
}

function cyclePinnedMessages() {
    const arr = state.pinnedMessages[state.activeChat] || [];
    if (arr.length <= 1) return;
    
    state.pinnedIndex = (state.pinnedIndex + 1) % arr.length;
    updatePinnedBarUI();
    
    // Скролимо до повідомлення
    const targetId = arr[state.pinnedIndex];
    const el = document.querySelector(`.msg-container[data-msg-id="${targetId}"]`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.backgroundColor = 'rgba(0,136,204,0.2)';
        setTimeout(() => el.style.backgroundColor = 'transparent', 2000);
    }
}

function requestUnpin(e) {
    e.stopPropagation();
    const arr = state.pinnedMessages[state.activeChat] || [];
    if (arr.length === 0) return;
    const targetId = arr[state.pinnedIndex];
    socket.emit('toggle_pin_event', { msgId: targetId, chatPartner: state.activeChat });
}

// === НАДІСЛАННЯ ПОВІДОМЛЕНЬ ТА ВТИШЕННЯ ТАЙМЕРІВ ===
function handleSendMessageForm(e) {
    e.preventDefault();
    const input = document.getElementById('input');
    const text = input.value.trim();
    if (!text && !state.timerValue) return; // Не шлемо порожнечу
    
    let replyPayload = null;
    if (state.replyingToMessageId) {
        const rMsg = state.messages.find(m => m.id === state.replyingToMessageId);
        if (rMsg) replyPayload = { id: rMsg.id, text: rMsg.text };
    }
    
    const payload = {
        id: 'msg_' + Date.now() + Math.random().toString(36).substr(2,4),
        from: myUserId,
        to: state.activeChat,
        text: text,
        replyTo: replyPayload,
        timestamp: new Date().toISOString(),
        timerMode: state.activeTimerMode,
        timerSec: state.activeTimerMode === 'disappearing' ? state.timerValue : null,
        scheduledTime: state.activeTimerMode === 'scheduled' ? state.timerValue : null
    };
    
    if (state.activeTimerMode === 'scheduled') {
        socket.emit('schedule_message_event', payload);
        alert("Повідомлення відкладено на вказаний час!");
    } else {
        socket.emit('secure_send_message', payload);
    }
    
    // Очищення інпуту та чорнеток
    input.value = '';
    delete state.drafts[state.activeChat];
    localStorage.setItem('burmalda_drafts', JSON.stringify(state.drafts));
    updateChatDraftBadgeUI(state.activeChat);
    
    cancelAction();
    resetTimerSettings();
    socket.emit('user_typing_event', { from: myUserId, to: state.activeChat, text: 'clear' });
}

function resetTimerSettings() {
    state.activeTimerMode = null;
    state.timerValue = null;
    document.getElementById('btn-timer-indicator')?.remove();
}

// === ТАЙМЕРИ ТА ЗНИКАЮЧІ ПОВІДОМЛЕННЯ ===
function openTimerModal() {
    document.getElementById('timer-modal').classList.add('active');
}

function closeTimerModal() {
    document.getElementById('timer-modal').classList.remove('active');
}

function applyTimerSettings() {
    const mode = document.querySelector('input[name="timer_mode"]:checked').value;
    if (mode === 'scheduled') {
        state.activeTimerMode = 'scheduled';
        state.timerValue = document.getElementById('scheduled-time-input').value;
    } else {
        state.activeTimerMode = 'disappearing';
        state.timerValue = parseInt(document.getElementById('disappear-time-select').value);
    }
    
    closeTimerModal();
    // Додамо індикатор до кнопки
    let ind = document.getElementById('btn-timer-indicator');
    if (!ind) {
        ind = document.createElement('span');
        ind.id = 'btn-timer-indicator';
        ind.style = "position:absolute; background:var(--danger); top:0; right:0; width:8px; height:8px; border-radius:50%;";
        document.getElementById('btn-attach').appendChild(ind);
    }
}

// === ПЕРЕСИЛАННЯ (ПОВІДОМЛЕННЯ) ТА АНОНІМНІСТЬ ===
let messageIdToForward = null;

function openForwardModalSingle(msgId) {
    messageIdToForward = msgId;
    const container = document.getElementById('forward-chat-list');
    container.innerHTML = '';
    
    Object.keys(state.chats).forEach(id => {
        const b = document.createElement('button');
        b.className = 'forward-user-item';
        b.innerText = state.chats[id].username || id;
        b.onclick = () => executeSingleForwardAction(id);
        container.appendChild(b);
    });
    
    document.getElementById('forward-modal').classList.add('active');
}

function closeForwardModal() {
    document.getElementById('forward-modal').classList.remove('active');
    messageIdToForward = null;
}

function executeSingleForwardAction(targetChatId) {
    const originalMsg = state.messages.find(m => m.id === messageIdToForward);
    if (!originalMsg) return;
    
    const anonCheck = document.getElementById('forward-anonymous-check').checked;
    
    const payload = {
        id: 'msg_' + Date.now(),
        from: myUserId,
        to: targetChatId,
        text: originalMsg.text,
        media: originalMsg.media,
        mediaType: originalMsg.mediaType,
        sticker: originalMsg.sticker,
        forwardFrom: anonCheck ? 'Анонімний користувач' : (state.username || myUserId),
        timestamp: new Date().toISOString()
    };
    
    socket.emit('secure_send_message', payload);
    closeForwardModal();
    alert("Повідомлення успішно переслано!");
}

function openPollModal() { document.getElementById('poll-modal').classList.add('active'); }
function closePollModal() { document.getElementById('poll-modal').classList.remove('active'); }

function addPollOptionUI() {
    const container = document.getElementById('poll-options-container');
    const optCount = container.querySelectorAll('input').length + 1;
    if (optCount > 8) return alert("Максимум 8 варіантів");
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'profile-name-input poll-opt-input';
    input.placeholder = `Варіант ${optCount}`;
    container.appendChild(input);
}

function sendPoll() {
    const q = document.getElementById('poll-question-input').value.trim();
    const optInputs = document.querySelectorAll('.poll-opt-input');
    let options = [];
    optInputs.forEach(i => { if (i.value.trim()) options.push(i.value.trim()); });
    
    if (!q || options.length < 2) return alert("Введіть питання та хоча б 2 варіанти!");
    
    const payload = {
        id: 'msg_' + Date.now(),
        from: myUserId,
        to: state.activeChat,
        poll: { question: q, options: options, votes: {} },
        timestamp: new Date().toISOString()
    };
    
    socket.emit('secure_send_message', payload);
    closePollModal();
}

// === СТІКЕРИ: КАСТОМНІ ТА МЕНЮ ===
function toggleStickerMenu() {
    const menu = document.getElementById('sticker-menu');
    menu.classList.toggle('active');
    document.getElementById('attachment-bubble').classList.remove('active');
}

function renderStickersMenu() {
    const menu = document.getElementById('sticker-menu');
    menu.innerHTML = '';
    
    // Вбудовані базові смайли-стікери
    const defaultStickers = [
        'https://fonts.gstatic.com/s/e/notoemoji/latest/1f438/512.webp',
        'https://fonts.gstatic.com/s/e/notoemoji/latest/1f437/512.webp', // Чорна золота свиня mascot reference
        'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60e/512.webp',
        'https://fonts.gstatic.com/s/e/notoemoji/latest/1f525/512.webp'
    ];
    
    const allStickers = [...defaultStickers, ...state.customStickers];
    
    allStickers.forEach(src => {
        const img = document.createElement('img');
        img.src = src;
        img.className = 'sticker-item';
        img.onclick = () => {
            socket.emit('secure_send_message', {
                id: 'msg_' + Date.now(), from: myUserId, to: state.activeChat,
                sticker: src, timestamp: new Date().toISOString()
            });
            menu.classList.remove('active');
        };
        menu.appendChild(img);
    });
}

function uploadCustomStickers(input) {
    const files = Array.from(input.files);
    files.forEach(file => {
        const r = new FileReader();
        r.onload = (e) => {
            state.customStickers.push(e.target.result);
            localStorage.setItem('burmalda_stickers', JSON.stringify(state.customStickers));
            renderStickersMenu();
            renderCustomStickersPreview();
        };
        r.readAsDataURL(file);
    });
}

function renderCustomStickersPreview() {
    const p = document.getElementById('my-stickers-preview');
    p.innerHTML = '';
    state.customStickers.forEach(src => {
        const img = document.createElement('img');
        img.src = src;
        img.className = 'pack-item-preview';
        p.appendChild(img);
    });
}

// === МЕДІА ЗАПИСИ (КРУЖЕЧКИ / АУДІО) ===
function toggleAttachmentMenu() {
    document.getElementById('attachment-bubble').classList.toggle('active');
    document.getElementById('sticker-menu').classList.remove('active');
}

function startMediaRecording(mode) {
    state.recordMode = mode;
    state.recordedChunks = [];
    state.recordDuration = 0;
    
    const overlay = document.getElementById('record-overlay');
    const videoPreview = document.getElementById('record-preview');
    const audioIcon = document.getElementById('record-audio-icon');
    
    overlay.style.display = 'flex';
    document.getElementById('record-timer').innerText = "00:00";
    
    const constraints = {
        audio: true,
        video: mode === 'video_circle' ? { facingMode: state.currentCameraFacing, width: 300, height: 300 } : false
    };
    
    if (mode === 'video_circle') {
        videoPreview.style.display = 'block';
        audioIcon.style.display = 'none';
    } else {
        videoPreview.style.display = 'none';
        audioIcon.style.display = 'flex';
    }
    
    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
        localStream = stream;
        if (mode === 'video_circle') {
            videoPreview.srcObject = stream;
        }
        
        state.mediaRecorder = new MediaRecorder(stream);
        state.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) state.recordedChunks.push(e.data); };
        state.mediaRecorder.start(100);
        
        state.isRecording = true;
        videoPreview.classList.add('recording');
        
        state.recordTimerInterval = setInterval(() => {
            state.recordDuration++;
            const m = String(Math.floor(state.recordDuration / 60)).padStart(2, '0');
            const s = String(state.recordDuration % 60).padStart(2, '0');
            document.getElementById('record-timer').innerText = `${m}:${s}`;
        }, 1000);
    }).catch(err => {
        alert("Помилка доступу до камери/мікрофона: " + err);
        deleteRecord();
    });
}

function pauseResumeRecord() {
    if (!state.mediaRecorder) return;
    const btn = document.getElementById('btn-pause-record');
    
    if (state.mediaRecorder.state === 'recording') {
        state.mediaRecorder.pause();
        clearInterval(state.recordTimerInterval);
        btn.innerText = '▶️';
    } else if (state.mediaRecorder.state === 'paused') {
        state.mediaRecorder.resume();
        state.recordTimerInterval = setInterval(() => {
            state.recordDuration++;
            const m = String(Math.floor(state.recordDuration / 60)).padStart(2, '0');
            const s = String(state.recordDuration % 60).padStart(2, '0');
            document.getElementById('record-timer').innerText = `${m}:${s}`;
        }, 1000);
        btn.innerText = '⏸';
    }
}

function switchRecordCamera() {
    if (state.recordMode !== 'video_circle' || !localStream) return;
    state.currentCameraFacing = state.currentCameraFacing === 'user' ? 'environment' : 'user';
    
    // Перезапуск потоку
    localStream.getTracks().forEach(t => t.stop());
    clearInterval(state.recordTimerInterval);
    if (state.mediaRecorder) state.mediaRecorder.stop();
    
    startMediaRecording('video_circle');
}

function deleteRecord() {
    clearInterval(state.recordTimerInterval);
    if (state.mediaRecorder) try { state.mediaRecorder.stop(); } catch(e){}
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    
    document.getElementById('record-overlay').style.display = 'none';
    document.getElementById('record-preview').classList.remove('recording');
    state.isRecording = false;
}

function finishAndSendRecord() {
    clearInterval(state.recordTimerInterval);
    if (!state.mediaRecorder) return;
    
    state.mediaRecorder.onstop = () => {
        const blob = new Blob(state.recordedChunks, { type: state.recordMode === 'video_circle' ? 'video/webm' : 'audio/ogg' });
        const reader = new FileReader();
        reader.onload = (e) => {
            socket.emit('secure_send_message', {
                id: 'msg_' + Date.now(),
                from: myUserId,
                to: state.activeChat,
                media: e.target.result,
                mediaType: state.recordMode,
                timestamp: new Date().toISOString()
            });
        };
        reader.readAsDataURL(blob);
        deleteRecord();
    };
    
    state.mediaRecorder.stop();
}

function toggleExpandCircleVideo(videoEl) {
    const wrapper = videoEl.closest('.circle-video-wrapper');
    wrapper.classList.toggle('expanded');
    videoEl.classList.toggle('expanded');
    
    const speedBtn = wrapper.querySelector('.media-speed-btn');
    if (wrapper.classList.contains('expanded')) {
        videoEl.muted = false;
        speedBtn.style.display = 'block';
    } else {
        videoEl.muted = true;
        speedBtn.style.display = 'none';
    }
}

// === ЗАВАНТАЖЕННЯ ЗВИЧАЙНИХ ФАЙЛІВ ТА ЗОБРАЖЕНЬ ===
function uploadMediaFile(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        socket.emit('secure_send_message', {
            id: 'msg_' + Date.now(), from: myUserId, to: state.activeChat,
            media: e.target.result, mediaType: file.type.startsWith('image/') ? 'image' : 'video',
            timestamp: new Date().toISOString()
        });
        document.getElementById('attachment-bubble').classList.remove('active');
    };
    reader.readAsDataURL(file);
}

function uploadDocumentFile(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        socket.emit('secure_send_message', {
            id: 'msg_' + Date.now(), from: myUserId, to: state.activeChat,
            media: e.target.result, mediaType: file.name.split('.').pop(),
            timestamp: new Date().toISOString()
        });
        document.getElementById('attachment-bubble').classList.remove('active');
    };
    reader.readAsDataURL(file);
}

function openImageViewer(src) {
    const m = document.getElementById('image-viewer-modal');
    document.getElementById('image-viewer-img').src = src;
    m.classList.add('active');
}
function closeImageViewer() {
    document.getElementById('image-viewer-modal').classList.remove('active');
}

// === ПОШУК (ГЛОБАЛЬНИЙ ТА ЛОКАЛЬНИЙ) ===
function handleGlobalSearch() {
    const query = document.getElementById('search-input').value.toLowerCase().trim();
    const dropdown = document.getElementById('search-results-dropdown');
    dropdown.innerHTML = '';
    
    if (!query) { 
        dropdown.style.display = 'none'; 
        return; 
    }
    dropdown.style.display = 'block';
    dropdown.innerHTML = `<div class="search-section-title">Пошук...</div>`;
    
    // Емітимо запит на сервер для пошуку реальних юзерів
    socket.emit('search_users_on_server', { query: query });
}

document.getElementById('search-toggle-btn').onclick = () => {
    const frame = document.getElementById('search-frame');
    frame.classList.toggle('active');
};

// === ПРИЙОМ СИНХРОНІЗАЦІЙ ІЗ СЕРВЕРА (SOCKET LISTENERS) ===
socket.on('search_users_results', (users) => {
    const dropdown = document.getElementById('search-results-dropdown');
    dropdown.innerHTML = `<div class="search-section-title">Знайдені користувачі</div>`;
    
    if (!users || users.length === 0) {
        dropdown.innerHTML += `<div class="search-result-item empty" style="color:var(--text-muted); padding:8px;">Нікого не знайдено</div>`;
        return;
    }
    
    users.forEach(user => {
        // Не показуємо в пошуку самого себе
        if (user.uid === myUserId) return; 
        
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.style = "padding: 10px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05);";
        item.innerHTML = `<strong>${user.username || 'Без імені'}</strong> <span style="font-size:11px; color:var(--text-muted);">@${user.uid}</span>`;
        
        item.onclick = () => {
            openChatWithUser(user.uid);
            dropdown.style.display = 'none';
            document.getElementById('search-input').value = '';
        };
        dropdown.appendChild(item);
    });
});

socket.on('chats_list_update', (serverChats) => {
    // Мержимо дані
    Object.keys(serverChats).forEach(id => {
        if (!state.chats[id]) state.chats[id] = {};
        state.chats[id] = { ...state.chats[id], ...serverChats[id] };
    });
    // Завжди є збережене
    if (!state.chats['saved']) state.chats['saved'] = { username: "Нотатки", archived: false, online: true };
    
    renderChatsList();
    renderArchiveList();
});

socket.on('new_incoming_message', (msg) => {
    // Якщо відкритий цей чат — пушимо
    if (state.activeChat === msg.from || state.activeChat === msg.to) {
        state.messages.push(msg);
        renderMessagesTimeline();
        if (msg.to === myUserId) socket.emit('msg_read_receipt', { msgId: msg.id, from: msg.from });
    }
    
    // Оновлення прев'ю в списку
    const partner = msg.from === myUserId ? msg.to : msg.from;
    if (!state.chats[partner]) state.chats[partner] = {};
    state.chats[partner].lastMessage = msg.text || '[Медіа]';
    
    if (state.chats[partner].muted !== true && msg.from !== myUserId) {
        // Логіка звуку (Audio Context)
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        osc.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.1);
    }
    
    renderChatsList();
});

socket.on('msg_action_sync', () => {
    if (state.activeChat) socket.emit('request_chat_history', { from: myUserId, to: state.activeChat });
});

socket.on('user_typing_broadcast', (data) => {
    if (state.activeChat === data.from) {
        const ind = document.getElementById('chat-typing-status');
        if (data.text === 'typing') ind.style.display = 'block';
        else ind.style.display = 'none';
    }
});

// === ОФОРМЛЕННЯ ТА МОВИ ===
function changeTheme(themeName) {
    const body = document.getElementById('main-body');
    body.className = '';
    body.classList.add(themeName);
    localStorage.setItem('burmalda_theme', themeName);
}

function changeLanguage(langCode) {
    state.lang = langCode;
    localStorage.setItem('burmalda_lang', langCode);
    applyThemeAndLang();
}

function applyThemeAndLang() {
    changeTheme(state.theme);
    document.getElementById('theme-select').value = state.theme;
    document.getElementById('lang-select').value = state.lang;
    
    const l = locales[state.lang] || locales.uk;
    document.getElementById('placeholder-text').innerHTML = `BurmaldaGram Premium<br><span style="font-size: 13px; color: var(--text-muted);">${l.placeholder}</span>`;
    document.getElementById('lbl-dialogs').firstChild.textContent = l.dialogs + " ";
    document.getElementById('input').placeholder = l.inputPlaceholder;
}

document.getElementById('settings-toggle-btn').onclick = openMyProfile;
document.getElementById('settings-close-btn').onclick = () => document.getElementById('settings-modal').classList.remove('active');

function toggleChatMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('chat-options-menu');
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function clearChatHistory() {
    if (confirm("Очистити історію чату? Це видалить повідомлення тільки у вас.")) {
        socket.emit('clear_chat_history_local', { from: myUserId, to: state.activeChat });
        closeChatArea();
    }
}

// Повністю виправлений вихід з профілю
function logout() {
    if (confirm("Вийти з профілю? Всі локальні дані буде видалено.")) {
        // Відключаємо сокет, щоб сервер прибрав нас з online
        socket.disconnect(); 
        
        // Чистимо сесію (всі старі дані зникають)
        localStorage.clear();
        
        // Робимо позначку, щоб сторінка не створила користувача при оновленні автоматично
        sessionStorage.setItem('explicit_logout', 'true');
        
        // Перезавантажуємо сторінку
        window.location.reload();
    }
}

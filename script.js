// ==========================================
// БАЗОВІ ФУНКЦІЇ ТА НАЛАШТУВАННЯ АУДІО КЛІЄНТА
// ==========================================
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
    try {
        if(audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.type = type; osc.frequency.value = freq;
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + duration);
        osc.stop(audioCtx.currentTime + duration);
    } catch(e) { console.log("Audio Context Error", e); }
}

// ==========================================
// СТАН ДОДАТКУ (STATE MANAGEMENT)
// ==========================================
let myUsername = localStorage.getItem('bg_username') || 'user_' + Math.floor(Math.random() * 10000);
localStorage.setItem('bg_username', myUsername);

let myDisplayName = localStorage.getItem('bg_display_name') || myUsername;
let myBio = localStorage.getItem('bg_bio') || 'BurmaldaGram User Premium';
let myAvatar = localStorage.getItem('bg_avatar') || '';
let currentTheme = localStorage.getItem('bg_theme') || 'theme-dark';
let currentLanguage = localStorage.getItem('bg_lang') || 'uk';

// Нові елементи кастомізації профілю
let myBanner = localStorage.getItem('bg_profile_banner') || '';
let myBannerBlur = localStorage.getItem('bg_profile_banner_blur') || '0';
let myProfileBgColor = localStorage.getItem('bg_profile_card_bg') || '#131316';
let myProfileTextColor = localStorage.getItem('bg_profile_card_text') || '#f5f5f7';

// Структури збереження даних чатів
let chatSettings = JSON.parse(localStorage.getItem('bg_chat_settings')) || {}; 
// Фоліо-структура папок: { id: { name: "", password: "..." } }
let customFolders = JSON.parse(localStorage.getItem('bg_custom_folders')) || {};
let archivedChats = JSON.parse(localStorage.getItem('bg_archived_chats')) || []; 
let blockedUsers = JSON.parse(localStorage.getItem('bg_blocked_users')) || []; 

let activeChats = JSON.parse(localStorage.getItem('bg_active_chats')) || {};
let messagesHistory = JSON.parse(localStorage.getItem('bg_messages_history')) || {};
let customStickers = JSON.parse(localStorage.getItem('bg_custom_stickers')) || [];

let currentFolder = 'all';
let currentSelectedChatId = null;
let multiSelectMode = false;
let selectedChatsSet = new Set();
let targetedContextMessageId = null;
let currentChatMenuTargetId = null;

// PeerJS Зв'язок
let peer = null;
let activeConnections = {};
let activeCall = null;
let localStream = null;

// ==========================================
// МОВА ТА ЛОКАЛІЗАЦІЯ (I18N)
// ==========================================
const translations = {
    uk: {
        dialogs: "Ваші діалоги", placeholder: "Оберіть чат або скористайтеся пошуком для початку спілкування 🔍",
        settingsTitle: "⚙️ Налаштування профілю", profileName: "Нікнейм / Відображуване ім'я:",
        uploadBtn: "📁 Завантажити новий аватар", status: "Статус мережі:", online: "в мережі",
        bioTitle: "Про себе / Опис профілю:", themeTitle: "Тема оформлення:", loginTime: "Вхід:"
    },
    en: {
        dialogs: "Your Dialogs", placeholder: "Select a chat or use search to start messaging 🔍",
        settingsTitle: "⚙️ Profile Settings", profileName: "Nickname / Display Name:",
        uploadBtn: "📁 Upload New Avatar", status: "Network Status:", online: "online",
        bioTitle: "About Me / Bio Description:", themeTitle: "Interface Theme:", loginTime: "Logged in:"
    },
    ru: {
        dialogs: "Ваши диалоги", placeholder: "Выберите чат или используйте поиск для начала общения 🔍",
        settingsTitle: "⚙️ Настройки профиля", profileName: "Никнейм / Отображаемое имя:",
        uploadBtn: "📁 Загрузить новый аватар", status: "Статус сети:", online: "в сети",
        bioTitle: "О себе / Описание профиля:", themeTitle: "Тема оформления:", loginTime: "Вход:"
    }
};

function applyLanguage() {
    const t = translations[currentLanguage] || translations.uk;
    const lblDialogs = document.getElementById('lbl-dialogs'); if(lblDialogs) lblDialogs.innerText = t.dialogs;
    const placeholderText = document.getElementById('placeholder-text'); if(placeholderText && !currentSelectedChatId) placeholderText.innerHTML = `BurmaldaGram Premium<br><span style='font-size: 13px; color: var(--text-muted);'>${t.placeholder}</span>`;
    const modalTitleText = document.getElementById('modal-title-text'); if(modalTitleText) modalTitleText.innerText = t.settingsTitle;
    const lblProfileName = document.getElementById('lbl-profile-name'); if(lblProfileName) lblProfileName.innerText = t.profileName;
    const lblUploadBtn = document.getElementById('lbl-upload-btn'); if(lblUploadBtn) lblUploadBtn.innerText = t.uploadBtn;
    const lblStatus = document.getElementById('lbl-status'); if(lblStatus) lblStatus.innerText = t.status;
    const lblOnlineStatus = document.getElementById('lbl-online-status'); if(lblOnlineStatus) lblOnlineStatus.innerText = t.online;
    const lblBioTitle = document.getElementById('lbl-bio-title'); if(lblBioTitle) lblBioTitle.innerText = t.bioTitle;
    const lblThemeTitle = document.getElementById('lbl-theme-title'); if(lblThemeTitle) lblThemeTitle.innerText = t.themeTitle;
    const lblTime = document.getElementById('lbl-time'); if(lblTime) lblTime.innerText = t.loginTime;
}

window.changeLanguage = function(lang) {
    currentLanguage = lang;
    localStorage.setItem('bg_lang', lang);
    applyLanguage();
};

window.changeTheme = function(theme) {
    document.body.className = '';
    document.body.classList.add(theme);
    currentTheme = theme;
    localStorage.setItem('bg_theme', theme);
};

// ==========================================
// ІНІЦІАЛІЗАЦІЯ КОРИСТУВАЧА ТА ПАНЕЛЕЙ
// ==========================================
function initUserInterface() {
    window.changeTheme(currentTheme);
    document.getElementById('theme-select').value = currentTheme;
    document.getElementById('lang-select').value = currentLanguage;
    
    document.getElementById('profile-display-name').value = myDisplayName;
    document.getElementById('profile-desc').value = myBio;
    document.getElementById('info-nick').innerText = `@${myUsername}`;
    document.getElementById('info-login-time').innerText = new Date().toLocaleTimeString();
    
    // Завантаження збереженої кастомізації картки профілю
    document.getElementById('profile-banner-blur-range').value = myBannerBlur;
    document.getElementById('banner-blur-indicator').innerText = myBannerBlur;
    document.getElementById('profile-card-bg-color').value = myProfileBgColor;
    document.getElementById('profile-card-text-color').value = myProfileTextColor;
    
    renderMyProfileHeader();
    renderCustomFolderTabs();
    renderChatsList();
    renderStickersGrid();
    applyLanguage();
    
    document.getElementById('main-body').style.display = 'flex';
}

function renderMyProfileHeader() {
    const headerNode = document.getElementById('my-profile-name');
    let avatarHtml = myAvatar ? `<img src="${myAvatar}" class="avatar">` : `<div class="avatar-placeholder" style="background:#0088cc;">${myDisplayName.charAt(0)}</div>`;
    headerNode.innerHTML = `${avatarHtml} <span>${escapeHTML(myDisplayName)}</span>`;
}

window.openMyProfile = function() {
    // Відображення модалки налаштувань разом з банером
    const avatarView = document.getElementById('modal-avatar-view');
    let avatarHtml = myAvatar ? `<img src="${myAvatar}" class="modal-avatar">` : `<div class="modal-avatar-placeholder" style="background:#0088cc;">${myDisplayName.charAt(0)}</div>`;
    avatarView.innerHTML = avatarHtml;
    
    applyProfileCustomStyles();
    renderSettingsArchiveList();
    renderSettingsBlockedList();
    
    document.getElementById('settings-modal').classList.add('active');
};

function applyProfileCustomStyles() {
    const bannerBg = document.getElementById('profile-banner-bg');
    if (myBanner) {
        bannerBg.style.backgroundImage = `url(${myBanner})`;
    } else {
        bannerBg.style.backgroundImage = 'none';
    }
    bannerBg.style.filter = `blur(${myBannerBlur}px)`;
    
    // Стилізація контенту модалки під обрані кольори
    const modalContent = document.querySelector('#settings-modal .modal-content');
    if (modalContent) {
        modalContent.style.backgroundColor = myProfileBgColor;
        modalContent.style.color = myProfileTextColor;
    }
}

// ==========================================
// СИСТЕМА КАСТОМІЗАЦІЇ ПРОФІЛЮ ТА БАНЕРІВ
// ==========================================
window.handleBannerUpload = function(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            myBanner = e.target.result;
            localStorage.setItem('bg_profile_banner', myBanner);
            applyProfileCustomStyles();
        };
        reader.readAsDataURL(input.files[0]);
    }
};

window.changeBannerBlur = function(val) {
    myBannerBlur = val;
    document.getElementById('banner-blur-indicator').innerText = val;
    localStorage.setItem('bg_profile_banner_blur', val);
    applyProfileCustomStyles();
};

window.changeProfileCardBgColor = function(color) {
    myProfileBgColor = color;
    localStorage.setItem('bg_profile_card_bg', color);
    applyProfileCustomStyles();
};

window.changeProfileCardTextColor = function(color) {
    myProfileTextColor = color;
    localStorage.setItem('bg_profile_card_text', color);
    applyProfileCustomStyles();
};

window.saveMyDisplayName = function(val) {
    if(val.trim()) {
        myDisplayName = val.trim();
        localStorage.setItem('bg_display_name', myDisplayName);
        renderMyProfileHeader();
    }
};

window.saveMyBio = function(val) {
    myBio = val.trim();
    localStorage.setItem('bg_bio', myBio);
};

function handleAvatarUpload(input) {
    if(input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            myAvatar = e.target.result;
            localStorage.setItem('bg_avatar', myAvatar);
            renderMyProfileHeader();
            window.openMyProfile(); // оновити вигляд у модалці
        };
        reader.readAsDataURL(input.files[0]);
    }
}

// ==========================================
// СИСТЕМА ПАПОК ТА ПАРОЛЮВАННЯ ДЛЯ НИХ
// ==========================================
function renderCustomFolderTabs() {
    // Очистити старі кастомні папки (лишаючи базову вкладку "Всі")
    const bar = document.getElementById('chat-folders-bar');
    const tabs = bar.querySelectorAll('.folder-tab');
    tabs.forEach(t => {
        if (t.getAttribute('data-folder') !== 'all') t.remove();
    });
    
    // Відмалювати папки з сховища
    Object.keys(customFolders).forEach(folderId => {
        const folder = customFolders[folderId];
        const tab = document.createElement('div');
        tab.className = 'folder-tab';
        tab.setAttribute('data-folder', folderId);
        
        let lockIndicator = folder.password ? ' <span class="folder-lock-icon">🔒</span>' : '';
        tab.innerHTML = `${escapeHTML(folder.name)}${lockIndicator}`;
        
        tab.addEventListener('click', (e) => {
            handleFolderTabClick(folderId);
        });
        bar.insertBefore(tab, document.getElementById('btn-add-folder'));
    });
}

function handleFolderTabClick(folderId) {
    if (folderId === 'all') {
        activateFolder('all');
        return;
    }
    
    const folder = customFolders[folderId];
    if (folder && folder.password) {
        // Запит пароля
        const promptModal = document.getElementById('folder-password-prompt-modal');
        const inputField = document.getElementById('prompt-folder-password-input');
        const errorMsg = document.getElementById('folder-password-error-msg');
        const submitBtn = document.getElementById('btn-submit-folder-password');
        
        inputField.value = '';
        errorMsg.style.display = 'none';
        promptModal.classList.add('active');
        
        submitBtn.onclick = function() {
            if (inputField.value === folder.password) {
                promptModal.classList.remove('active');
                activateFolder(folderId);
            } else {
                errorMsg.style.display = 'block';
            }
        };
    } else {
        activateFolder(folderId);
    }
}

function activateFolder(folderId) {
    document.querySelectorAll('.folder-tab').forEach(t => {
        if(t.getAttribute('data-folder') === folderId) {
            t.classList.add('active');
        } else {
            t.classList.remove('active');
        }
    });
    currentFolder = folderId;
    renderChatsList();
}

window.createNewFolder = function() {
    const nameInput = document.getElementById('new-folder-name');
    const pwdToggle = document.getElementById('folder-password-toggle-check');
    const pwdInput = document.getElementById('new-folder-password-field');
    
    const name = nameInput.value.trim();
    if (name) {
        const folderId = 'folder_' + Date.now();
        let password = (pwdToggle.checked && pwdInput.value) ? pwdInput.value : null;
        
        customFolders[folderId] = { name: name, password: password };
        localStorage.setItem('bg_custom_folders', JSON.stringify(customFolders));
        
        renderCustomFolderTabs();
        
        // Скинути форму
        nameInput.value = '';
        pwdToggle.checked = false;
        pwdInput.value = '';
        document.getElementById('folder-password-input-subblock').style.display = 'none';
        document.getElementById('create-folder-modal').classList.remove('active');
    }
};

// ==========================================
// МУЛЬТИ-ВИБІР ЧАТІВ (MULTI-SELECT CHATS)
// ==========================================
window.toggleMultiChatSelectMode = function() {
    multiSelectMode = !multiSelectMode;
    if (multiSelectMode) {
        document.body.classList.add('multi-select-enabled');
        document.getElementById('multi-chats-bar').classList.add('active');
        selectedChatsSet.clear();
        updateMultiSelectCounter();
    } else {
        window.disableMultiChatSelectMode();
    }
    renderChatsList();
};

window.disableMultiChatSelectMode = function() {
    multiSelectMode = false;
    document.body.classList.remove('multi-select-enabled');
    document.getElementById('multi-chats-bar').classList.remove('active');
    selectedChatsSet.clear();
    renderChatsList();
};

function updateMultiSelectCounter() {
    document.getElementById('multi-chats-count').innerText = `Обрано: ${selectedChatsSet.size}`;
}

function handleChatCheckboxClick(e, chatId) {
    e.stopPropagation();
    if (e.target.checked) {
        selectedChatsSet.add(chatId);
    } else {
        selectedChatsSet.delete(chatId);
    }
    updateMultiSelectCounter();
}

window.bulkMoveChatsToFolderPrompt = function() {
    if (selectedChatsSet.size === 0) return;
    const listContainer = document.getElementById('bulk-folder-options-list');
    listContainer.innerHTML = '';
    
    // Вкладка "Всі" (скинути папку)
    const btnAll = document.createElement('button');
    btnAll.className = 'multi-action-btn secondary';
    btnAll.innerText = 'Усі (Скинути папки)';
    btnAll.onclick = function() {
        selectedChatsSet.forEach(chatId => {
            if (!chatSettings[chatId]) chatSettings[chatId] = {};
            chatSettings[chatId].folder = 'all';
        });
        localStorage.setItem('bg_chat_settings', JSON.stringify(chatSettings));
        document.getElementById('bulk-folder-assign-modal').classList.remove('remove');
        window.disableMultiChatSelectMode();
        document.getElementById('bulk-folder-assign-modal').classList.remove('active');
    };
    listContainer.appendChild(btnAll);

    // Перелік кастомних папок
    Object.keys(customFolders).forEach(fId => {
        const btn = document.createElement('button');
        btn.className = 'multi-action-btn';
        btn.style.marginTop = '4px';
        btn.innerText = customFolders[fId].name;
        btn.onclick = function() {
            selectedChatsSet.forEach(chatId => {
                if (!chatSettings[chatId]) chatSettings[chatId] = {};
                chatSettings[chatId].folder = fId;
            });
            localStorage.setItem('bg_chat_settings', JSON.stringify(chatSettings));
            window.disableMultiChatSelectMode();
            document.getElementById('bulk-folder-assign-modal').classList.remove('active');
        };
        listContainer.appendChild(btn);
    });
    
    document.getElementById('bulk-folder-assign-modal').classList.add('active');
};

window.bulkArchiveChats = function() {
    if (selectedChatsSet.size === 0) return;
    selectedChatsSet.forEach(chatId => {
        if (!archivedChats.includes(chatId)) {
            archivedChats.push(chatId);
        }
    });
    localStorage.setItem('bg_archived_chats', JSON.stringify(archivedChats));
    window.disableMultiChatSelectMode();
};

window.bulkDeleteChats = function() {
    if (selectedChatsSet.size === 0) return;
    if (confirm(`Ви впевнені, що хочете видалити ${selectedChatsSet.size} обраних чатів разом із історією?`)) {
        selectedChatsSet.forEach(chatId => {
            delete activeChats[chatId];
            delete messagesHistory[chatId];
        });
        localStorage.setItem('bg_active_chats', JSON.stringify(activeChats));
        localStorage.setItem('bg_messages_history', JSON.stringify(messagesHistory));
        if (selectedChatsSet.has(currentSelectedChatId)) {
            currentSelectedChatId = null;
            document.getElementById('chat-area').style.display = 'none';
            document.getElementById('no-chat-placeholder').style.display = 'flex';
        }
        window.disableMultiChatSelectMode();
    }
};

// ==========================================
// УПРАВЛІННЯ АРХІВОМ ТА БЛОКУВАННЯМ ЮЗЕРІВ
// ==========================================
function renderSettingsArchiveList() {
    const listNode = document.getElementById('settings-archive-list');
    listNode.innerHTML = '';
    
    if (archivedChats.length === 0) {
        listNode.innerHTML = `<div class="empty-embedded-text">Архів порожній</div>`;
        return;
    }
    
    archivedChats.forEach(chatId => {
        const itemData = activeChats[chatId] || { name: chatId };
        const row = document.createElement('div');
        row.className = 'settings-list-item';
        row.innerHTML = `
            <span>${escapeHTML(itemData.name)} (@${chatId})</span>
            <button class="settings-item-btn" onclick="window.unarchiveChatFromSettings('${chatId}')">Дістати</button>
        `;
        listNode.appendChild(row);
    });
}

window.unarchiveChatFromSettings = function(chatId) {
    archivedChats = archivedChats.filter(id => id !== chatId);
    localStorage.setItem('bg_archived_chats', JSON.stringify(archivedChats));
    renderSettingsArchiveList();
    renderChatsList();
};

function renderSettingsBlockedList() {
    const listNode = document.getElementById('settings-blocked-list');
    listNode.innerHTML = '';
    
    if (blockedUsers.length === 0) {
        listNode.innerHTML = `<div class="empty-embedded-text">Немає заблокованих юзерів</div>`;
        return;
    }
    
    blockedUsers.forEach(userId => {
        const row = document.createElement('div');
        row.className = 'settings-list-item';
        row.innerHTML = `
            <span>@${escapeHTML(userId)}</span>
            <button class="settings-item-btn danger" onclick="window.unblockUserFromSettings('${userId}')">Розблокувати</button>
        `;
        listNode.appendChild(row);
    });
}

window.unblockUserFromSettings = function(userId) {
    blockedUsers = blockedUsers.filter(id => id !== userId);
    localStorage.setItem('bg_blocked_users', JSON.stringify(blockedUsers));
    renderSettingsBlockedList();
    renderChatsList();
};

// ==========================================
// ОПЦІЇ ОКРЕМОГО ЧАТУ
// ==========================================
window.openChatOptionsMenu = function(e) {
    e.stopPropagation();
    currentChatMenuTargetId = currentSelectedChatId;
    if (!currentChatMenuTargetId) return;
    
    const menu = document.getElementById('chat-options-menu');
    menu.style.display = 'block';
    menu.style.top = `${e.clientY + 10}px`;
    menu.style.left = `${e.clientX - 140}px`;
    
    document.addEventListener('click', closeChatOptionsMenuOutside);
};

function closeChatOptionsMenuOutside() {
    document.getElementById('chat-options-menu').style.display = 'none';
    document.removeEventListener('click', closeChatOptionsMenuOutside);
}

window.optAssignFolder = function() {
    if (!currentChatMenuTargetId) return;
    const listNode = document.getElementById('folder-assign-list');
    listNode.innerHTML = '';
    
    // Кнопка скидання
    const btnAll = document.createElement('button');
    btnAll.className = 'multi-action-btn secondary';
    btnAll.innerText = 'Всі чати (Скинути)';
    btnAll.onclick = function() {
        if(!chatSettings[currentChatMenuTargetId]) chatSettings[currentChatMenuTargetId] = {};
        chatSettings[currentChatMenuTargetId].folder = 'all';
        localStorage.setItem('bg_chat_settings', JSON.stringify(chatSettings));
        document.getElementById('folder-assign-modal').classList.remove('active');
        renderChatsList();
    };
    listNode.appendChild(btnAll);

    // Перелік папок
    Object.keys(customFolders).forEach(fId => {
        const btn = document.createElement('button');
        btn.className = 'multi-action-btn';
        btn.innerText = customFolders[fId].name;
        btn.onclick = function() {
            if(!chatSettings[currentChatMenuTargetId]) chatSettings[currentChatMenuTargetId] = {};
            chatSettings[currentChatMenuTargetId].folder = fId;
            localStorage.setItem('bg_chat_settings', JSON.stringify(chatSettings));
            document.getElementById('folder-assign-modal').classList.remove('active');
            renderChatsList();
        };
        listNode.appendChild(btn);
    });
    
    document.getElementById('folder-assign-modal').classList.add('active');
};

window.optArchiveChat = function() {
    if (currentChatMenuTargetId && !archivedChats.includes(currentChatMenuTargetId)) {
        archivedChats.push(currentChatMenuTargetId);
        localStorage.setItem('bg_archived_chats', JSON.stringify(archivedChats));
        
        if (currentChatMenuTargetId === currentSelectedChatId) {
            currentSelectedChatId = null;
            document.getElementById('chat-area').style.display = 'none';
            document.getElementById('no-chat-placeholder').style.display = 'flex';
        }
        renderChatsList();
    }
};

window.optToggleGlowChat = function() {
    if (!currentChatMenuTargetId) return;
    if (!chatSettings[currentChatMenuTargetId]) chatSettings[currentChatMenuTargetId] = {};
    chatSettings[currentChatMenuTargetId].glow = !chatSettings[currentChatMenuTargetId].glow;
    localStorage.setItem('bg_chat_settings', JSON.stringify(chatSettings));
    renderChatsList();
};

window.optBlockUser = function() {
    if (!currentChatMenuTargetId) return;
    if (confirm(`Заблокувати користувача @${currentChatMenuTargetId}? Вашу історію повідомлень буде видалено.`)) {
        if (!blockedUsers.includes(currentChatMenuTargetId)) {
            blockedUsers.push(currentChatMenuTargetId);
            localStorage.setItem('bg_blocked_users', JSON.stringify(blockedUsers));
        }
        // Видалення історії повідомлень з цим юзером
        delete messagesHistory[currentChatMenuTargetId];
        localStorage.setItem('bg_messages_history', JSON.stringify(messagesHistory));
        
        if (currentChatMenuTargetId === currentSelectedChatId) {
            currentSelectedChatId = null;
            document.getElementById('chat-area').style.display = 'none';
            document.getElementById('no-chat-placeholder').style.display = 'flex';
        }
        renderChatsList();
    }
};

// ==========================================
// ВІДМАЛЬОВУВАННЯ СПИСКУ ДІАЛОГІВ
// ==========================================
function renderChatsList() {
    const listNode = document.getElementById('chats-list');
    listNode.innerHTML = '';
    
    const keys = Object.keys(activeChats);
    if(keys.length === 0) {
        listNode.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:13px;">Немає діалогів. Знайдіть користувача через пошук!</div>`;
        return;
    }
    
    keys.forEach(chatId => {
        // Якщо користувач заблокований, приховати його з загального списку діалогів
        if (blockedUsers.includes(chatId)) return;
        
        // Якщо чат в архіві, приховати його з бічної панелі (він доступний тільки в налаштуваннях)
        if (archivedChats.includes(chatId)) return;
        
        const settings = chatSettings[chatId] || {};
        const folderAssigned = settings.folder || 'all';
        
        // Перевірка фільтрації папок
        if (currentFolder !== 'all' && folderAssigned !== currentFolder) return;
        
        const data = activeChats[chatId];
        const item = document.createElement('div');
        item.className = 'chat-item';
        if (chatId === currentSelectedChatId) item.classList.add('active');
        if (settings.glow) item.classList.add('glow-active');
        
        // Компонент Чекбокса для Мульти-вибору
        const isChecked = selectedChatsSet.has(chatId) ? 'checked' : '';
        const checkboxHtml = `
            <div class="chat-item-cb-wrapper">
                <input type="checkbox" class="chat-item-checkbox" ${isChecked} onclick="handleChatCheckboxClick(event, '${chatId}')">
            </div>
        `;
        
        let avatarHtml = data.avatar ? `<img src="${data.avatar}" class="avatar">` : `<div class="avatar-placeholder" style="background:#2da5ff;">${data.name.charAt(0)}</div>`;
        
        const isOnline = activeConnections[chatId] ? 'online' : '';
        const statusText = activeConnections[chatId] ? 'online' : 'offline';
        
        item.innerHTML = `
            ${checkboxHtml}
            <div class="chat-info-block" onclick="if(!multiSelectMode) selectActiveChatConversation('${chatId}')">
                ${avatarHtml}
                <div class="chat-text-details">
                    <span class="chat-item-name">${escapeHTML(data.name)}</span>
                    <span style="font-size:11px; color:var(--text-muted);">@${chatId}</span>
                </div>
            </div>
            <div class="status-dot ${isOnline}">${statusText}</div>
        `;
        
        listNode.appendChild(item);
    });
}

function selectActiveChatConversation(chatId) {
    currentSelectedChatId = chatId;
    document.getElementById('no-chat-placeholder').style.display = 'none';
    document.getElementById('chat-area').style.display = 'flex';
    
    const data = activeChats[chatId];
    document.getElementById('chat-title-text').innerText = data.name;
    
    const container = document.getElementById('chat-header-avatar-container');
    container.innerHTML = data.avatar ? `<img src="${data.avatar}" class="avatar">` : `<div class="avatar-placeholder" style="background:#2da5ff; width:34px; height:34px; font-size:13px;">${data.name.charAt(0)}</div>`;
    
    renderChatsList();
    renderConversationMessages();
    updateChatPinnedBarView();
}

// ==========================================
// РЕНДЕРИНГ ПОВІДОМЛЕНЬ ТА ІСТОРІЇ
// ==========================================
function renderConversationMessages() {
    const box = document.getElementById('messages');
    box.innerHTML = '';
    if(!currentSelectedChatId) return;
    
    const history = messagesHistory[currentSelectedChatId] || [];
    history.forEach(msg => {
        const msgRow = document.createElement('div');
        msgRow.className = `msg-container ${msg.sender === myUsername ? 'my' : 'their'}`;
        
        let contentHtml = '';
        if (msg.type === 'sticker') {
            contentHtml = `<img src="${msg.body}" style="max-width:120px; display:block;">`;
        } else if (msg.type === 'file') {
            if (msg.body.startsWith('data:image')) {
                contentHtml = `<img src="${msg.body}" style="max-width:200px; border-radius:8px; cursor:pointer;" onclick="window.openImageViewerSrc('${msg.body}')">`;
            } else {
                contentHtml = `<a href="${msg.body}" download="file" style="color:white; font-weight:bold;">💾 Скачати файл</a>`;
            }
        } else {
            contentHtml = `<div>${escapeHTML(msg.body)}</div>`;
        }
        
        msgRow.innerHTML = `
            <div class="msg-bubble" oncontextmenu="window.openMessageContextMenu(event, '${msg.id}')">
                ${contentHtml}
                <span class="msg-time">${msg.time || ''}</span>
            </div>
        `;
        box.appendChild(msgRow);
    });
    box.scrollTop = box.scrollHeight;
}

window.openImageViewerSrc = function(src) {
    document.getElementById('image-viewer-img').src = src;
    document.getElementById('image-viewer-modal').classList.add('active');
};

window.closeImageViewer = function() {
    document.getElementById('image-viewer-modal').classList.remove('active');
};

// ==========================================
// ПОШУК ТА СТВОРЕННЯ ДІАЛОГІВ
// ==========================================
const searchInput = document.getElementById('search-input');
if (searchInput) {
    searchInput.addEventListener('input', function() {
        const query = this.value.trim();
        const dropdown = document.getElementById('search-results-dropdown');
        dropdown.innerHTML = '';
        if(!query) { dropdown.style.display = 'none'; return; }
        
        dropdown.style.display = 'block';
        dropdown.innerHTML = `<div class="search-section-title">Результати пошуку</div>`;
        
        const row = document.createElement('div');
        row.className = 'search-result-item';
        row.innerHTML = `🔍 Почати чат з: <b>@${escapeHTML(query)}</b>`;
        row.onclick = function() {
            if(!activeChats[query]) {
                activeChats[query] = { name: query, avatar: '', bio: '' };
                localStorage.setItem('bg_active_chats', JSON.stringify(activeChats));
            }
            dropdown.style.display = 'none';
            searchInput.value = '';
            document.getElementById('search-frame').classList.remove('active');
            selectActiveChatConversation(query);
        };
        dropdown.appendChild(row);
    });
}

// ==========================================
// СТІКЕРИ ТА ЕМОДЗІ
// ==========================================
function renderStickersGrid() {
    const eGrid = document.getElementById('emojis-panel-grid');
    eGrid.innerHTML = '';
    const emojis = ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','😘','😗','😙','😚','🙂','🤗','🤩'];
    emojis.forEach(emo => {
        const b = document.createElement('button');
        b.style = "background:transparent; border:none; font-size:20px; cursor:pointer;";
        b.innerText = emo;
        b.onclick = () => { document.getElementById('input').value += emo; };
        eGrid.appendChild(b);
    });

    const sGrid = document.getElementById('stickers-panel-grid');
    sGrid.innerHTML = '';
    customStickers.forEach(st => {
        const img = document.createElement('img');
        img.className = 'sticker-item-img';
        img.src = st;
        img.onclick = () => { sendCustomPayloadMessage(st, 'sticker'); };
        sGrid.appendChild(img);
    });
}

window.toggleStickerMenu = function() {
    const m = document.getElementById('sticker-menu');
    m.style.display = m.style.display === 'none' ? 'block' : 'none';
};

window.switchStickersTab = function(tab) {
    if(tab === 'emojis') {
        document.getElementById('emojis-panel-grid').style.display = 'flex';
        document.getElementById('stickers-panel-grid').style.display = 'none';
    } else {
        document.getElementById('emojis-panel-grid').style.display = 'none';
        document.getElementById('stickers-panel-grid').style.display = 'grid';
    }
};

window.uploadCustomStickers = function(input) {
    if(input.files) {
        for(let i=0; i<input.files.length; i++) {
            const r = new FileReader();
            r.onload = function(e) {
                customStickers.push(e.target.result);
                localStorage.setItem('bg_custom_stickers', JSON.stringify(customStickers));
                renderStickersGrid();
            };
            r.readAsDataURL(input.files[i]);
        }
    }
};

// ==========================================
// СИСТЕМА ПОВІДОМЛЕНЬ ТА КОНТЕКСТНОГО МЕНЮ
// ==========================================
window.openMessageContextMenu = function(e, msgId) {
    e.preventDefault();
    targetedContextMessageId = msgId;
    const menu = document.getElementById('global-context-menu');
    menu.style.display = 'block';
    menu.style.top = `${e.clientY}px`;
    menu.style.left = `${e.clientX}px`;
    
    // Відображення швидких реакцій
    const rxRow = document.getElementById('ctx-reaction-row');
    rxRow.innerHTML = '';
    ['👍','❤️','🔥','😂','😮','👏'].forEach(rx => {
        const rb = document.createElement('span');
        rb.style = "font-size:18px; cursor:pointer; padding:2px;";
        rb.innerText = rx;
        rb.onclick = () => { alert(`Реакція ${rx} на повідомлення ${msgId}`); menu.style.display='none'; };
        rxRow.appendChild(rb);
    });

    document.addEventListener('click', closeMessageContextMenuOutside);
};

function closeMessageContextMenuOutside() {
    document.getElementById('global-context-menu').style.display = 'none';
    document.removeEventListener('click', closeMessageContextMenuOutside);
}

function sendCustomPayloadMessage(body, type='text') {
    if(!currentSelectedChatId) return;
    const msg = {
        id: 'msg_' + Date.now(),
        sender: myUsername,
        body: body,
        type: type,
        time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    };
    
    if(!messagesHistory[currentSelectedChatId]) messagesHistory[currentSelectedChatId] = [];
    messagesHistory[currentSelectedChatId].push(msg);
    localStorage.setItem('bg_messages_history', JSON.stringify(messagesHistory));
    
    // Імітація надсилання через мережевий peer коннект якщо активний
    if(activeConnections[currentSelectedChatId]) {
        activeConnections[currentSelectedChatId].send({ type: 'msg', data: msg });
    }
    
    audioSend.play();
    renderConversationMessages();
}

// Обробка файлів
window.handleMediaFilesSelection = function(input) {
    if(input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            sendCustomPayloadMessage(e.target.result, 'file');
        };
        reader.readAsDataURL(input.files[0]);
    }
};

// Надсилання з поля вводу
const btnSend = document.getElementById('button');
if(btnSend) {
    btnSend.onclick = function() {
        const inp = document.getElementById('input');
        const txt = inp.value.trim();
        if(txt) {
            sendCustomPayloadMessage(txt, 'text');
            inp.value = '';
        }
    };
}

// Пакет закриття модалок
const closeSettings = document.getElementById('settings-close-btn');
if(closeSettings) closeSettings.onclick = () => document.getElementById('settings-modal').classList.remove('active');
const toggleSettings = document.getElementById('settings-toggle-btn');
if(toggleSettings) toggleSettings.onclick = () => window.openMyProfile();

// Закріплення повідомлень (Заглушки API)
function updateChatPinnedBarView() {
    document.getElementById('pinned-message-bar').style.display = 'none';
}
window.scrollToPinnedMessage = function() {};
window.unpinCurrentMessageBlock = function(e) { e.stopPropagation(); updateChatPinnedBarView(); };

// ==========================================
// ЗАКЛЮЧНИЙ СТАРТ
// ==========================================
initUserInterface();

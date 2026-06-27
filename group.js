// group.js - Логіка Каналів та Груп для BurmaldaGram Premium

let myGroupsAndChannels = {};
let currentCGView = null; 

// ==========================================
// 1. СТВОРЕННЯ (КАНАЛИ ТА ГРУПИ)
// ==========================================

function openCGTypeSelection() {
    const modal = document.getElementById('cg-type-modal');
    if(modal) modal.classList.add('active');
}

function openCGSetup(type) {
    document.getElementById('cg-type-modal').classList.remove('active');
    const setupModal = document.getElementById('cg-setup-modal');
    if(setupModal) {
        setupModal.classList.add('active');
        document.getElementById('cg-setup-type').value = type;
        document.getElementById('cg-setup-title').innerText = type === 'channel' ? '📢 Створити Канал' : '👥 Створити Групу';
        
        // Очищення форми
        document.getElementById('cg-name').value = '';
        document.getElementById('cg-desc').value = '';
        document.getElementById('cg-avatar-data').value = '';
        document.getElementById('cg-banner-data').value = '';
        document.getElementById('cg-wallpaper-data').value = '';
        document.getElementById('cg-msg-style').value = 'default';
    }
}

function submitCG() {
    const type = document.getElementById('cg-setup-type').value;
    const name = document.getElementById('cg-name').value.trim();
    const desc = document.getElementById('cg-desc').value.trim();
    const avatar = document.getElementById('cg-avatar-data').value;
    const banner = document.getElementById('cg-banner-data').value;
    const wallpaper = document.getElementById('cg-wallpaper-data').value;
    const msgStyle = document.getElementById('cg-msg-style').value;

    if (!name) return alert('Назва є обов\'язковою!');

    const payload = {
        id: type + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        type: type,
        name: name,
        description: desc,
        avatar: avatar,
        banner: banner,
        wallpaper: wallpaper,
        msgStyle: msgStyle,
        owner: myNick,
        admins: [],
        seniorMods: [],
        juniorMods: [],
        members: [myNick],
        banned: {}, // { username: unbanTimestamp (або null для назавжди) }
        muted: {},  // { username: unmuteTimestamp }
        permissions: {
            editMessages: ['owner', 'admin'],
            publishMessages: ['owner', 'admin'], // Актуально для каналів
            changeInfo: ['owner', 'admin'],
            manageAdmins: ['owner']
        },
        createdAt: Date.now()
    };

    socket.emit('cg_create', payload);
    document.getElementById('cg-setup-modal').classList.remove('active');
}

// Утиліти для завантаження картинок (base64) в приховані поля
function handleCGImageUpload(inputEl, targetId) {
    const file = inputEl.files[0];
    if (!file) return;
    compressImage(file, (base64) => {
        document.getElementById(targetId).value = base64;
        const previewEl = document.getElementById(targetId + '-preview');
        if(previewEl) {
            previewEl.style.backgroundImage = `url(${base64})`;
            previewEl.style.backgroundSize = 'cover';
        }
    });
}

// ==========================================
// 2. ІНТЕРФЕЙС ТА ВІДОБРАЖЕННЯ
// ==========================================

socket.on('cg_sync', (data) => {
    myGroupsAndChannels = data;
    renderChatsList(); // Виклик існуючої функції з script.js (її потрібно буде модифікувати в HTML/JS для інтеграції груп)
});

function openCG(cgId) {
    const cg = myGroupsAndChannels[cgId];
    if (!cg) return;
    
    currentActiveChatPartner = null; 
    currentCGView = cgId;
    currentRoom = cgId;

    document.body.classList.add('chat-opened');
    document.getElementById('no-chat-placeholder').style.display = 'none';
    document.getElementById('chat-area').style.display = 'flex';

    updateCGHeader(cgId);
    applyCGStyling(cgId);
    checkCGPermissions(cgId);

    socket.emit('join_room', { room: cgId, user: myNick });
    socket.emit('request_history', { room: cgId });
}

function updateCGHeader(cgId) {
    const cg = myGroupsAndChannels[cgId];
    if (!cg) return;

    let onlineCount = 0;
    cg.members.forEach(m => { if (isUserOnline(m)) onlineCount++; });

    const avatarHtml = cg.avatar 
        ? `<img src="${cg.avatar}" class="avatar" style="border-radius:50%;">` 
        : `<div class="avatar-placeholder" style="background:var(--accent);">${cg.name.charAt(0)}</div>`;

    const titleEl = document.getElementById('chat-title-text');
    titleEl.innerHTML = `
        ${avatarHtml} 
        <div style="display:flex; flex-direction:column; align-items:flex-start;">
            <span style="font-weight:bold;">${escapeHTML(cg.name)}</span>
            <small style="font-size:11px; color:var(--text-muted);">
                Учасників: ${cg.members.length} | В мережі: ${onlineCount}
            </small>
        </div>
    `;
    titleEl.onclick = () => openCGInfo(cgId);
}

function applyCGStyling(cgId) {
    const cg = myGroupsAndChannels[cgId];
    const mainChat = document.getElementById('chat-main');
    
    if (cg.wallpaper) {
        mainChat.style.backgroundImage = `url(${cg.wallpaper})`;
        mainChat.style.backgroundSize = 'cover';
        mainChat.style.backgroundPosition = 'center';
    } else {
        applyCustomBackground(); // Повернення до стандартного
    }

    // Тут можна додати логіку для cg.msgStyle (наприклад, додавання CSS класу до body)
}

function checkCGPermissions(cgId) {
    const cg = myGroupsAndChannels[cgId];
    const inputPanel = document.getElementById('input-panel-container');
    const myRole = getCGRole(cgId, myNick);

    // Перевірка бану
    if (cg.banned[myNick]) {
        const banExp = cg.banned[myNick];
        if (banExp === null || banExp > Date.now()) {
            inputPanel.style.display = 'none';
            alert('Вам заблоковано доступ до цього чату.');
            document.getElementById('btn-back').click(); // Вийти
            return;
        }
    }

    // Перевірка муту
    if (cg.muted[myNick] && cg.muted[myNick] > Date.now()) {
        inputPanel.style.display = 'none';
        return;
    }

    if (cg.type === 'channel') {
        if (cg.permissions.publishMessages.includes(myRole) || myRole === 'owner') {
            inputPanel.style.display = 'flex';
        } else {
            inputPanel.style.display = 'none';
        }
    } else {
        inputPanel.style.display = 'flex'; // У групі пишуть всі (якщо не в муті)
    }
}

// ==========================================
// 3. РОЛІ ТА МОДЕРАЦІЯ
// ==========================================

const ROLE_LEVELS = { 'owner': 4, 'admin': 3, 'seniorMod': 2, 'juniorMod': 1, 'member': 0 };

function getCGRole(cgId, username) {
    const cg = myGroupsAndChannels[cgId];
    if (!cg) return 'member';
    if (cg.owner === username) return 'owner';
    if (cg.admins.includes(username)) return 'admin';
    if (cg.seniorMods.includes(username)) return 'seniorMod';
    if (cg.juniorMods.includes(username)) return 'juniorMod';
    return 'member';
}

function executeCGModeration(cgId, targetUser, action, durationMs = null) {
    const cg = myGroupsAndChannels[cgId];
    const myRole = getCGRole(cgId, myNick);
    const targetRole = getCGRole(cgId, targetUser);

    if (ROLE_LEVELS[myRole] <= ROLE_LEVELS[targetRole] && myRole !== 'owner') {
        return alert('У вас недостатньо прав для дії над цим користувачем.');
    }

    // Перевірка прав для конкретних ролей
    if (myRole === 'juniorMod' && action !== 'mute' && action !== 'unmute') {
        return alert('Молодший модер може лише мутити/розмучувати.');
    }
    if (myRole === 'seniorMod' && action === 'ban' && durationMs === null) {
        return alert('Старший модер не може банити назавжди.');
    }

    socket.emit('cg_moderate', {
        cgId: cgId,
        actor: myNick,
        target: targetUser,
        action: action, // 'mute', 'unmute', 'kick', 'ban', 'unban', 'promote', 'demote'
        durationMs: durationMs,
        newRole: action === 'promote' || action === 'demote' ? durationMs : null // Використовуємо поле для передачі ролі
    });
}

// Виклики з UI
window.cgMute = function(cgId, user, minutes) { 
    executeCGModeration(cgId, user, 'mute', minutes * 60 * 1000); 
};
window.cgUnmute = function(cgId, user) { 
    executeCGModeration(cgId, user, 'unmute'); 
};
window.cgKick = function(cgId, user) { 
    executeCGModeration(cgId, user, 'kick'); 
};
window.cgBan = function(cgId, user, minutes = null) { 
    // minutes = null означає перманентний бан
    const duration = minutes ? minutes * 60 * 1000 : null;
    executeCGModeration(cgId, user, 'ban', duration); 
};
window.cgAssignRole = function(cgId, user, role) {
    if(getCGRole(cgId, myNick) !== 'owner') return alert('Тільки власник може призначати ролі!');
    executeCGModeration(cgId, user, 'promote', role);
};

// ==========================================
// 4. ІНФО ТА НАЛАШТУВАННЯ КАНАЛУ/ГРУПИ
// ==========================================

function openCGInfo(cgId) {
    const cg = myGroupsAndChannels[cgId];
    if (!cg) return;
    
    const myRole = getCGRole(cgId, myNick);
    const canEdit = cg.permissions.changeInfo.includes(myRole) || myRole === 'owner';

    // Тут очікується відкриття модального вікна (HTML буде надано пізніше)
    const modal = document.getElementById('cg-info-modal');
    if(!modal) return;

    document.getElementById('cg-info-name').value = cg.name;
    document.getElementById('cg-info-desc').value = cg.description;
    document.getElementById('cg-info-name').disabled = !canEdit;
    document.getElementById('cg-info-desc').disabled = !canEdit;

    // Рендер ієрархії (Адміни, Модери)
    const hierarchyEl = document.getElementById('cg-hierarchy-list');
    hierarchyEl.innerHTML = '';
    
    const renderUser = (u, rLabel) => {
        hierarchyEl.innerHTML += `<div class="hierarchy-item">
            ${getAvatarHTML(u)} 
            <div><b>${escapeHTML(u)}</b> <span style="font-size:10px; color:var(--accent);">${rLabel}</span></div>
            ${canEdit && u !== myNick ? `<button onclick="showModerationMenu('${cgId}', '${u}')">⚙️</button>` : ''}
        </div>`;
    };

    renderUser(cg.owner, '👑 Власник');
    cg.admins.forEach(u => renderUser(u, '🛡️ Адмін'));
    cg.seniorMods.forEach(u => renderUser(u, '⚔️ Старший Модер'));
    cg.juniorMods.forEach(u => renderUser(u, '🗡️ Молодший Модер'));

    modal.classList.add('active');
}
// ==========================================================================
// КОРЕКТНА ІНТЕГРАЦІЯ ТА ВІДКРИТТЯ КАНАЛІВ І ГРУП (ПІДЛАШТОВАНО ПІД СТРУКТУРУ)
// ==========================================================================

if (typeof socket !== 'undefined') {
    // Слухаємо сервер та оновлюємо локальну базу груп
    socket.on('cg_sync', (data) => {
        myGroupsAndChannels = data || {};
        // Викликаємо перерендер списку чатів
        if (typeof renderChatsList === 'function') {
            renderChatsList();
        }
    });
}

// Перехоплюємо рендер чатів, щоб додати туди групи
setTimeout(() => {
    if (typeof renderChatsList === 'function') {
        const originalRenderChatsList = renderChatsList;

        renderChatsList = function(...args) {
            // Спочатку виконуємо твій рідний рендер приватних чатів
            originalRenderChatsList(...args);

            // Знаходимо твій список чатів (у тебе в HTML це id="chats-list")
            const sidebar = document.getElementById('chats-list');
            if (!sidebar) return;

            // Рендеримо кожну групу та канал
            Object.entries(myGroupsAndChannels).forEach(([cgId, cgData]) => {
                // Якщо вже є на екрані — пропускаємо, щоб не дублювати
                if (document.getElementById(`cg-item-${cgId}`)) return;

                const cgItem = document.createElement('div');
                cgItem.id = `cg-item-${cgId}`;
                
                // Використовуємо твої рідні класи для збереження стилів BurmaldaGram
                cgItem.className = 'chat-item'; 
                
                // Перевіряємо, чи ця група зараз виділена як активна
                if (currentCGView === cgId) {
                    cgItem.classList.add('active');
                }

                // Генерація аватара
                const icon = cgData.avatar 
                    ? `<img src="${cgData.avatar}" class="chat-avatar">` 
                    : `<div class="chat-avatar" style="background: rgba(0, 136, 204, 0.15); display:flex; align-items:center; justify-content:center; font-size:18px; color: var(--accent);">
                        ${cgData.type === 'channel' ? '📢' : '👥'}
                       </div>`;

                cgItem.innerHTML = `
                    ${icon}
                    <div class="chat-info">
                        <div class="chat-name">${escapeHTML(cgData.name)}</div>
                        <div class="chat-last-msg" style="color: var(--accent);">
                            ${cgData.type === 'channel' ? '📢 Публічний канал' : '👥 Груповий чат'}
                        </div>
                    </div>
                `;

                // ОБРОБКА НАТИСКАННЯ: ВІДКРИТТЯ ЧАТУ ГРУПИ
                cgItem.onclick = () => {
                    // 1. Встановлюємо активну групу та скидаємо приватного партнера
                    currentCGView = cgId;
                    if (typeof currentChatPartner !== 'undefined') currentChatPartner = null;

                    // 2. Змінюємо візуальне виділення (клас active)
                    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
                    cgItem.classList.add('active');

                    // 3. Оновлюємо шапку чату (назву та статус)
                    const titleEl = document.querySelector('.chat-header .chat-name') || document.getElementById('chat-title');
                    const statusEl = document.querySelector('.chat-header .chat-status');
                    
                    if (titleEl) titleEl.innerText = cgData.name;
                    if (statusEl) statusEl.innerText = cgData.type === 'channel' ? 'канал' : 'групова розмова';

                    // 4. Очищаємо поле повідомлень перед завантаженням історії
                    const msgsContainer = document.getElementById('chat-messages');
                    if (msgsContainer) msgsContainer.innerHTML = '';

                    // 5. Показуємо головну панель чату (забираємо заглушку "Виберіть чат")
                    const mainChat = document.getElementById('main-chat') || document.querySelector('.main-chat');
                    const placeholder = document.getElementById('chat-placeholder') || document.querySelector('.chat-placeholder');
                    if (mainChat) mainChat.style.display = 'flex';
                    if (placeholder) placeholder.style.display = 'none';

                    // 6. Смикаємо сервер, щоб увійти в кімнату та отримати історію повідомлень груп
                    if (typeof socket !== 'undefined') {
                        socket.emit('join_room', { room: cgId });
                        socket.emit('request_history', { room: cgId });
                    }
                };

                // Додаємо в самий початок твого списку чатів
                sidebar.prepend(cgItem);
            });
        };

        // Запускаємо первинний рендер
        originalRenderChatsList();
    }
}, 600);

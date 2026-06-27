// ==========================================
// СИСТЕМА ГРУП ТА КАНАЛІВ (group.js)
// Доповнення до основної логіки месенджера
// ==========================================

let myCommunities = []; // Список ID груп/каналів користувача
let communitiesData = {}; // Кеш метаданих { id, name, type, banner, avatar, desc, roles, members, theme }
let currentActiveCommunity = null;

const COMMUNITY_RANKS = {
    MEMBER: 0,
    JUNIOR_MOD: 1, // Може мутити
    MOD: 2,        // Може мутити, блокувати (кікати)
    ADMIN: 3,      // Може змінювати налаштування, керувати повідомленнями
    SENIOR_ADMIN: 4, // Може все, окрім видалення групи
    OWNER: 5       // Творець
};

// --- ІНІЦІАЛІЗАЦІЯ ТА ВКЛАДКИ ---
function initCommunityTabs() {
    const contactsTab = document.getElementById('tab-contacts');
    const communitiesTab = document.getElementById('tab-communities');
    
    if (contactsTab) contactsTab.onclick = () => switchSidebarTab('contacts');
    if (communitiesTab) communitiesTab.onclick = () => switchSidebarTab('communities');
}

function switchSidebarTab(tab) {
    if (tab === 'contacts') {
        safeSetDisplay('chats-list', 'block');
        safeSetDisplay('communities-list', 'none');
        safeSetDisplay('btn-create-community', 'none');
    } else if (tab === 'communities') {
        safeSetDisplay('chats-list', 'none');
        safeSetDisplay('communities-list', 'block');
        safeSetDisplay('btn-create-community', 'block');
        renderCommunitiesList();
    }
}

// --- РЕНДЕР СПИСКУ СПІЛЬНОТ ---
function renderCommunitiesList() {
    const list = document.getElementById('communities-list');
    if (!list) return;
    list.innerHTML = '';

    if (myCommunities.length === 0) {
        list.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:14px;">Немає груп або каналів. Створіть першу!</div>`;
        return;
    }

    myCommunities.forEach(commId => {
        const comm = communitiesData[commId];
        if (!comm) return;

        const item = document.createElement('div');
        item.className = `chat-item ${currentActiveCommunity === commId ? 'active' : ''}`;
        
        // Використовуємо існуючу функцію генерації аватарок або кастомну логіку для груп
        const avatarHtml = comm.avatar ? `<img src="${comm.avatar}" class="avatar">` : `<div class="avatar-placeholder" style="background:#5856d6;">${comm.name.charAt(0)}</div>`;
        const typeIcon = comm.type === 'channel' ? '📢' : '👥';

        item.innerHTML = `
            <div class="chat-info-block">
                ${avatarHtml}
                <div>
                    <div style="font-weight:600; font-size:14px;">${typeIcon} ${escapeHTML(comm.name)}</div>
                    <div style="font-size:12px; color:var(--text-muted);">${comm.type === 'channel' ? 'Канал' : 'Група'}</div>
                </div>
            </div>
        `;

        item.onclick = () => openCommunityChat(commId);
        list.appendChild(item);
    });
}

// --- ВІДКРИТТЯ ЧАТУ СПІЛЬНОТИ ---
function openCommunityChat(commId) {
    const comm = communitiesData[commId];
    if (!comm) return;

    currentActiveCommunity = commId;
    currentActiveChatPartner = null; // Скидаємо приватний чат
    currentRoom = commId;

    document.body.classList.add('chat-opened');
    safeSetDisplay('no-chat-placeholder', 'none');
    safeSetDisplay('chat-area', 'flex');

    // Застосування кастомної теми групи
    if (comm.theme && comm.theme.color) {
        document.documentElement.style.setProperty('--accent', comm.theme.color);
    } else {
        document.documentElement.style.removeProperty('--accent');
    }

    if (comm.banner) {
        const chatMain = document.getElementById('chat-main');
        if (chatMain) {
            chatMain.style.backgroundImage = `url(${comm.banner})`;
            chatMain.style.backgroundSize = 'cover';
            chatMain.style.backgroundPosition = 'center';
            chatMain.style.boxShadow = 'inset 0 0 80px rgba(0,0,0,0.8)';
        }
    } else {
        applyCustomBackground(); // Повернення до дефолтного фону
    }

    // Оновлення хедера
    const avatarHtml = comm.avatar ? `<img src="${comm.avatar}" style="width:30px; height:30px; border-radius:50%;">` : '📢';
    safeSetInnerHTML('chat-title-text', `${avatarHtml} <span>${escapeHTML(comm.name)}</span>`);

    // Перевірка прав для поля вводу
    checkPostingPermissions(comm);

    // Запит історії та учасників
    socket.emit('request_community_history', { room: commId });
    socket.emit('join_community_room', { room: commId, user: myNick });

    renderCommunitiesList();
    cancelAction();
}

// --- ПЕРЕВІРКА ПРАВ (ПОЛЕ ВВОДУ ТА ДІЇ) ---
function checkPostingPermissions(comm) {
    const inputField = document.getElementById('input');
    const sendBtn = document.getElementById('button');
    const attachBtn = document.getElementById('btn-attach');
    
    if (!inputField || !sendBtn) return;

    const myRole = comm.roles[myNick] || COMMUNITY_RANKS.MEMBER;
    
    // Якщо це канал, писати можуть тільки адміни+
    if (comm.type === 'channel' && myRole < COMMUNITY_RANKS.ADMIN) {
        inputField.disabled = true;
        inputField.placeholder = "Тільки адміністратори можуть писати тут...";
        sendBtn.disabled = true;
        if(attachBtn) attachBtn.style.display = 'none';
    } else {
        // Перевірка на мут
        const isMuted = comm.mutedUsers && comm.mutedUsers.includes(myNick);
        if (isMuted) {
            inputField.disabled = true;
            inputField.placeholder = "Вам тимчасово заборонено писати.";
            sendBtn.disabled = true;
            if(attachBtn) attachBtn.style.display = 'none';
        } else {
            inputField.disabled = false;
            inputField.placeholder = "Напишіть повідомлення...";
            sendBtn.disabled = false;
            if(attachBtn) attachBtn.style.display = 'flex';
        }
    }
}

// --- УПРАВЛІННЯ УЧАСНИКАМИ ТА КОНТЕКСТНЕ МЕНЮ ---
function showCommunityMemberMenu(event, targetUser) {
    event.preventDefault();
    const comm = communitiesData[currentActiveCommunity];
    if (!comm) return;

    const myRole = comm.roles[myNick] || COMMUNITY_RANKS.MEMBER;
    const targetRole = comm.roles[targetUser] || COMMUNITY_RANKS.MEMBER;

    // Не можна керувати тими, хто має вищий або рівний ранг (крім власника)
    if (myRole <= targetRole && myRole !== COMMUNITY_RANKS.OWNER) return;
    if (targetUser === myNick) return; // Не можна редагувати себе тут

    const options = [];

    // Права для Junior Mod і вище
    if (myRole >= COMMUNITY_RANKS.JUNIOR_MOD) {
        const isMuted = comm.mutedUsers && comm.mutedUsers.includes(targetUser);
        options.push({
            text: isMuted ? "🔊 Розмутити" : "🔇 Видати мут",
            action: () => socket.emit('community_action', { action: 'toggle_mute', room: comm.id, target: targetUser })
        });
    }

    // Права для Senior Mod і вище
    if (myRole >= COMMUNITY_RANKS.MOD) {
        options.push({
            text: "🚫 Заблокувати (Кік)",
            class: 'danger',
            action: () => socket.emit('community_action', { action: 'kick_user', room: comm.id, target: targetUser })
        });
    }

    // Права для Senior Admin і Власника (Призначення ролей)
    if (myRole >= COMMUNITY_RANKS.SENIOR_ADMIN) {
        options.push({
            text: "👑 Керувати рангом",
            action: () => openRoleManagementModal(comm.id, targetUser)
        });
    }

    if (options.length > 0) {
        showContextMenu(event, options);
    }
}

// --- СТВОРЕННЯ ГРУПИ/КАНАЛУ ---
function openCreateCommunityModal() {
    const modal = document.getElementById('create-community-modal');
    if (modal) modal.classList.add('active');
}

function submitCreateCommunity() {
    const name = document.getElementById('comm-name-input').value.trim();
    const desc = document.getElementById('comm-desc-input').value.trim();
    const type = document.querySelector('input[name="comm_type"]:checked').value;
    const customColor = document.getElementById('comm-color-input').value;
    
    // Тут логіка отримання base64 банеру та аватарки, якщо вони були завантажені
    const avatar = window.tempCommAvatar || ''; 
    const banner = window.tempCommBanner || '';

    if (!name) {
        alert("Введіть назву!");
        return;
    }

    const payload = {
        name, desc, type, avatar, banner,
        theme: { color: customColor },
        owner: myNick
    };

    socket.emit('create_community', payload);
    document.getElementById('create-community-modal').classList.remove('active');
    
    // Очищення тимчасових змінних
    window.tempCommAvatar = '';
    window.tempCommBanner = '';
    document.getElementById('comm-name-input').value = '';
}

// --- SOCKET ПОДІЇ ДЛЯ СПІЛЬНОТ ---
if (typeof socket !== 'undefined') {
    
    socket.on('community_sync', (data) => {
        myCommunities = data.list || [];
        data.details.forEach(comm => {
            communitiesData[comm.id] = comm;
        });
        renderCommunitiesList();
        if (currentActiveCommunity) {
            checkPostingPermissions(communitiesData[currentActiveCommunity]);
        }
    });

    socket.on('community_created', (comm) => {
        communitiesData[comm.id] = comm;
        if (!myCommunities.includes(comm.id)) myCommunities.push(comm.id);
        renderCommunitiesList();
        openCommunityChat(comm.id);
    });

    socket.on('community_updated', (comm) => {
        communitiesData[comm.id] = comm;
        if (currentActiveCommunity === comm.id) {
            checkPostingPermissions(comm);
            // Тут можна додати оновлення хедера та списку учасників на льоту
        }
        renderCommunitiesList();
    });
}

// Ініціалізація після завантаження DOM
document.addEventListener('DOMContentLoaded', () => {
    initCommunityTabs();
});

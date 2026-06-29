// ==========================================
// BURMALDA MESSENGER - GROUPS EXTENSION
// ==========================================

// Локальне сховище для груп
let localGroups = JSON.parse(localStorage.getItem(getStorageKey('burmalda_groups'))) || {};

// ==========================================
// 1. ПЕРЕХОПЛЕННЯ БАЗОВИХ ФУНКЦІЙ (Monkey Patching)
// ==========================================

// Перехоплюємо отримання імені, щоб воно працювало і для груп
const originalGetVisibleName = window.getVisibleName;
window.getVisibleName = function(id) {
    if (id && id.startsWith('group_')) {
        return localGroups[id] ? localGroups[id].name : "Невідома група";
    }
    return originalGetVisibleName(id);
};

// Перехоплюємо отримання аватарки (робимо їх квадратно-заокругленими для груп, щоб відрізнялись)
const originalGetAvatarHTML = window.getAvatarHTML;
window.getAvatarHTML = function(id, cssClass = 'avatar') {
    if (id && id.startsWith('group_')) {
        const gData = localGroups[id] || {};
        const radiusStyle = 'border-radius: 12px !important;'; 
        if (gData.avatar && gData.avatar.startsWith('data:image')) {
            return `<img src="${gData.avatar}" class="${cssClass}" style="${radiusStyle} box-shadow: 0 2px 5px rgba(0,0,0,0.3);">`;
        }
        const firstLetter = gData.name ? gData.name.charAt(0).toUpperCase() : 'G';
        const placeholderClass = cssClass === 'avatar' ? 'avatar-placeholder' : 'modal-avatar-placeholder';
        return `<div class="${placeholderClass}" style="background: linear-gradient(135deg, var(--accent), #8a2be2); ${radiusStyle} box-shadow: 0 2px 5px rgba(0,0,0,0.3);">${firstLetter}</div>`;
    }
    return originalGetAvatarHTML(id, cssClass);
};

// Перехоплюємо відкриття чату, щоб обробляти кімнати груп
const originalOpenChatWith = window.openChatWith;
window.openChatWith = function(targetId) {
    if (targetId && targetId.startsWith('group_')) {
        currentActiveChatPartner = targetId;
        currentRoom = targetId; // Для груп ID групи = ID кімнати
        
        document.body.classList.add('chat-opened');
        document.getElementById('no-chat-placeholder').style.display = 'none';
        document.getElementById('chat-area').style.display = 'flex';
        
        // Оновлюємо шапку (замість профілю юзера відкриваємо налаштування групи)
        const chatTitleText = document.getElementById('chat-title-text');
        const membersCount = localGroups[targetId]?.members?.length || 0;
        chatTitleText.innerHTML = `${getAvatarHTML(targetId)} <span>${escapeHTML(getVisibleName(targetId))} <br><small style="color:var(--text-muted); font-size:11px;">Учасників: ${membersCount}</small></span>`;
        chatTitleText.onclick = () => openGroupSettings(targetId);

        const cleanUrl = window.location.pathname + '?auth=' + (urlParams.get('auth') || '') + '&chat=' + targetId;
        window.history.pushState({}, "", cleanUrl);
        
        socket.emit('request_history', { room: currentRoom });
        socket.emit('join_room', { room: currentRoom, user: myNick });
        
        // Ховаємо дзвінки для груп (поки що)
        document.getElementById('btn-call-video').style.display = 'none';
        document.getElementById('btn-call-audio').style.display = 'none';
        
        document.getElementById('input').disabled = false;
        document.getElementById('input').placeholder = "Напишіть у групу...";
        document.getElementById('button').disabled = false;

        updateChatHeaderUI(); 
        cancelAction(); 
        currentPinIndex = 0; 
        if(window.renderPinnedBar) renderPinnedBar(); 
        loadMessagesHistory(); 
        renderChatsList();
    } else {
        originalOpenChatWith(targetId);
        // Повертаємо кнопки дзвінків, якщо це приватний чат
        document.getElementById('btn-call-video').style.display = 'flex';
        document.getElementById('btn-call-audio').style.display = 'flex';
        document.getElementById('chat-title-text').onclick = openPartnerProfile;
    }
};

// Перехоплюємо рендер повідомлення, щоб додавати імена авторів у групах
const originalAppendSingleMessage = window.appendSingleMessage;
window.appendSingleMessage = function(msg, isHistoryBuild = false) {
    originalAppendSingleMessage(msg, isHistoryBuild);
    
    if (currentRoom && currentRoom.startsWith('group_') && msg.from !== myNick && msg.type !== 'system') {
        const liWrapper = document.getElementById(`msg-item-${msg.id}`);
        if (liWrapper && !liWrapper.querySelector('.group-sender-name')) {
            const senderName = document.createElement('div');
            senderName.className = 'group-sender-name';
            senderName.style.fontSize = '11px';
            senderName.style.color = 'var(--accent)';
            senderName.style.marginBottom = '4px';
            senderName.style.fontWeight = 'bold';
            senderName.style.cursor = 'pointer';
            senderName.innerText = getVisibleName(msg.from);
            senderName.onclick = (e) => {
                e.stopPropagation();
                if (msg.from !== myNick) openChatWith(msg.from); // Швидкий перехід в ЛС
            };
            
            const li = liWrapper.querySelector('li');
            if (li) li.insertBefore(senderName, li.firstChild);
        }
    }
};

// ==========================================
// 2. ЛОГІКА СТВОРЕННЯ ГРУПИ
// ==========================================

let tempGroupAvatar = '';

function openCreateGroupModal() {
    tempGroupAvatar = '';
    document.getElementById('create-group-modal').classList.add('active');
    document.getElementById('new-group-name').value = '';
    document.getElementById('new-group-avatar-preview').innerHTML = '<div class="modal-avatar-placeholder" style="border-radius:12px; background:var(--bg-input);">📷</div>';
}

function closeCreateGroupModal() {
    document.getElementById('create-group-modal').classList.remove('active');
}

function handleGroupAvatarUpload(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    compressImage(file, (compressedBase64) => {
        tempGroupAvatar = compressedBase64;
        document.getElementById('new-group-avatar-preview').innerHTML = `<img src="${tempGroupAvatar}" style="width:85px; height:85px; border-radius:12px; object-fit:cover; border:2px solid var(--accent);">`;
    });
}

function submitCreateGroup() {
    const name = document.getElementById('new-group-name').value.trim();
    if (!name) {
        alert("Введіть назву групи!");
        return;
    }
    
    const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const newGroup = {
        id: groupId,
        name: name,
        avatar: tempGroupAvatar,
        owner: myNick,
        members: [myNick]
    };

    // Зберігаємо локально
    localGroups[groupId] = newGroup;
    localStorage.setItem(getStorageKey('burmalda_groups'), JSON.stringify(localGroups));
    
    if (!activeChats.includes(groupId)) {
        activeChats.push(groupId);
        saveActiveChats();
    }

    // Відправляємо на сервер
    socket.emit('create_group', newGroup);
    
    closeCreateGroupModal();
    openChatWith(groupId);
}

// ==========================================
// 3. НАЛАШТУВАННЯ ГРУПИ ТА УПРАВЛІННЯ УЧАСНИКАМИ
// ==========================================

let activeGroupSettingsId = null;

function openGroupSettings(groupId) {
    activeGroupSettingsId = groupId;
    const group = localGroups[groupId];
    if (!group) return;

    document.getElementById('group-settings-modal').classList.add('active');
    document.getElementById('group-settings-avatar').innerHTML = getAvatarHTML(groupId, 'modal-avatar');
    document.getElementById('group-settings-name').innerText = group.name;
    
    const isOwner = group.owner === myNick;
    document.getElementById('btn-add-group-member').style.display = isOwner ? 'block' : 'none';
    document.getElementById('btn-delete-group').style.display = isOwner ? 'block' : 'none';
    document.getElementById('btn-leave-group').style.display = !isOwner ? 'block' : 'none';

    renderGroupMembersList(group);
}

function closeGroupSettings() {
    document.getElementById('group-settings-modal').classList.remove('active');
    activeGroupSettingsId = null;
}

function renderGroupMembersList(group) {
    const list = document.getElementById('group-members-list');
    list.innerHTML = '';
    const isOwner = group.owner === myNick;

    group.members.forEach(member => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.padding = '8px';
        item.style.borderBottom = '1px solid var(--border-color)';
        
        let roleBadge = member === group.owner ? '<span style="color:var(--accent); font-size:10px; border:1px solid var(--accent); padding:2px 4px; border-radius:4px; margin-left:6px;">Власник</span>' : '';
        
        item.innerHTML = `<div style="display:flex; align-items:center; gap:10px; cursor:pointer;" onclick="if('${member}' !== myNick) openChatWith('${member}')">
            ${getAvatarHTML(member, 'avatar')} 
            <span style="font-weight:600; font-size:14px; color:var(--text-main);">${escapeHTML(getVisibleName(member))} ${roleBadge}</span>
        </div>`;

        // Кнопка видалення (тільки якщо ти Owner і це не ти сам)
        if (isOwner && member !== myNick) {
            const delBtn = document.createElement('button');
            delBtn.innerHTML = '❌';
            delBtn.style.background = 'none';
            delBtn.style.border = 'none';
            delBtn.style.cursor = 'pointer';
            delBtn.onclick = () => removeGroupMember(group.id, member);
            item.appendChild(delBtn);
        }
        
        list.appendChild(item);
    });
}

function openAddMemberModal() {
    document.getElementById('add-member-modal').classList.add('active');
    const list = document.getElementById('add-member-list');
    list.innerHTML = '';
    
    const group = localGroups[activeGroupSettingsId];
    
    // Показуємо всі контакти (activeChats), які не є групами і ще не в цій групі
    const availableContacts = activeChats.filter(c => !c.startsWith('group_') && !group.members.includes(c));
    
    if (availableContacts.length === 0) {
        list.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:13px; padding:10px;">Немає контактів для додавання</div>';
        return;
    }

    availableContacts.forEach(user => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '10px';
        item.style.padding = '8px';
        item.style.borderBottom = '1px solid var(--border-color)';
        item.style.cursor = 'pointer';
        item.innerHTML = `${getAvatarHTML(user, 'avatar')} <span style="font-weight:600; font-size:14px;">${escapeHTML(getVisibleName(user))}</span>`;
        
        item.onclick = () => {
            addGroupMember(activeGroupSettingsId, user);
            document.getElementById('add-member-modal').classList.remove('active');
        };
        list.appendChild(item);
    });
}

function closeAddMemberModal() {
    document.getElementById('add-member-modal').classList.remove('active');
}

function addGroupMember(groupId, username) {
    socket.emit('group_action', { action: 'add_member', groupId: groupId, user: username });
}

function removeGroupMember(groupId, username) {
    if(confirm(`Видалити ${getVisibleName(username)} з групи?`)) {
        socket.emit('group_action', { action: 'remove_member', groupId: groupId, user: username });
    }
}

function leaveGroup() {
    if(confirm("Ви дійсно хочете покинути групу?")) {
        socket.emit('group_action', { action: 'leave_group', groupId: activeGroupSettingsId, user: myNick });
        closeGroupSettings();
        deleteChatLocally(activeGroupSettingsId); // Видаляємо з локального списку
    }
}

function deleteGroup() {
    if(confirm("Увага! Це видалить групу для всіх учасників. Продовжити?")) {
        socket.emit('group_action', { action: 'delete_group', groupId: activeGroupSettingsId });
        closeGroupSettings();
        deleteChatLocally(activeGroupSettingsId);
    }
}

// ==========================================
// 4. ОБРОБКА СЕРВЕРНИХ ПОДІЙ ГРУП
// ==========================================

if (socket) {
    socket.on('group_sync', (groupData) => {
        localGroups[groupData.id] = groupData;
        localStorage.setItem(getStorageKey('burmalda_groups'), JSON.stringify(localGroups));
        
        // Якщо нас додали в групу, і її немає в списку чатів
        if (groupData.members.includes(myNick) && !activeChats.includes(groupData.id)) {
            activeChats.push(groupData.id);
            saveActiveChats();
        }
        
        // Оновлюємо UI якщо група зараз відкрита
        if (currentRoom === groupData.id) {
            const membersCount = groupData.members.length;
            document.getElementById('chat-title-text').innerHTML = `${getAvatarHTML(groupData.id)} <span>${escapeHTML(getVisibleName(groupData.id))} <br><small style="color:var(--text-muted); font-size:11px;">Учасників: ${membersCount}</small></span>`;
        }
        if (activeGroupSettingsId === groupData.id) {
            renderGroupMembersList(groupData);
        }
        
        renderChatsList();
    });

    socket.on('group_deleted', (data) => {
        const groupId = data.groupId;
        delete localGroups[groupId];
        localStorage.setItem(getStorageKey('burmalda_groups'), JSON.stringify(localGroups));
        
        activeChats = activeChats.filter(c => c !== groupId);
        saveActiveChats();
        
        if (currentRoom === groupId) {
            currentActiveChatPartner = null; 
            currentRoom = null; 
            document.getElementById('chat-area').style.display = 'none'; 
            document.getElementById('no-chat-placeholder').style.display = 'block';
            alert("Групу було видалено власником.");
        }
        renderChatsList();
    });

    socket.on('kicked_from_group', (data) => {
        const groupId = data.groupId;
        activeChats = activeChats.filter(c => c !== groupId);
        saveActiveChats();
        
        if (currentRoom === groupId) {
            currentActiveChatPartner = null; 
            currentRoom = null; 
            document.getElementById('chat-area').style.display = 'none'; 
            document.getElementById('no-chat-placeholder').style.display = 'block';
            alert("Вас було видалено з групи.");
        }
        renderChatsList();
    });
}

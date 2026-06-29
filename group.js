// === group.js - Додаток для груп у BurmaldaGram Premium ===

// 1. Ініціалізація та збереження груп
window.groupsData = JSON.parse(localStorage.getItem(getStorageKey('burmalda_groups_data'))) || {};

function saveGroupsLocally() {
    localStorage.setItem(getStorageKey('burmalda_groups_data'), JSON.stringify(window.groupsData));
}

// Переносимо всі локальні групи в глобальний об'єкт профілів, щоб аватарки працювали з коробки
Object.keys(window.groupsData).forEach(id => {
    localProfiles[id] = window.groupsData[id];
});

// 2. Логіка модального вікна створення
window.openCreateGroupModal = function() {
    document.getElementById('group-create-modal').classList.add('active');
};

window.closeCreateGroupModal = function() {
    document.getElementById('group-create-modal').classList.remove('active');
};

window.createGroup = function() {
    const name = document.getElementById('group-name-input').value.trim();
    if (!name) { alert('Введіть назву групи!'); return; }

    const avatarInput = document.getElementById('group-avatar-input');

    const processCreation = (avatarBase64) => {
        const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const groupObj = {
            id: groupId,
            displayName: name,
            avatar: avatarBase64,
            isGroup: true,
            admin: myNick,
            members: [myNick]
        };

        // Зберігаємо локально
        window.groupsData[groupId] = groupObj;
        localProfiles[groupId] = groupObj; 
        saveGroupsLocally();

        if (!activeChats.includes(groupId)) {
            activeChats.push(groupId);
            saveActiveChats();
        }

        // Відправляємо на сервер
        socket.emit('create_group', groupObj);

        closeCreateGroupModal();
        renderChatsList();
        openChatWith(groupId);
    };

    if (avatarInput.files && avatarInput.files[0]) {
        compressImage(avatarInput.files[0], processCreation);
    } else {
        processCreation('');
    }
};

// 3. Перехоплення стандартних функцій script.js
const originalOpenChatWith = window.openChatWith;
window.openChatWith = function(partnerId) {
    if (partnerId.startsWith('group_')) {
        currentActiveChatPartner = partnerId;
        currentRoom = partnerId; // Для груп ID є назвою кімнати (без сортування room_a_b)

        document.body.classList.add('chat-opened');
        document.getElementById('no-chat-placeholder').style.display = 'none';
        document.getElementById('chat-area').style.display = 'flex';

        const gData = window.groupsData[partnerId] || localProfiles[partnerId] || { displayName: 'Група', members: [] };
        
        // Оновлюємо заголовок
        const chatTitleText = document.getElementById('chat-title-text');
        chatTitleText.innerHTML = `${getAvatarHTML(partnerId)} <span>${escapeHTML(gData.displayName)} <small style="color:var(--text-muted); font-size:11px;">Учасників: ${gData.members.length}</small></span>`;

        // Підключаємось до кімнати
        socket.emit('request_history', { room: currentRoom });
        socket.emit('join_room', { room: currentRoom, user: myNick });
        socket.emit('mark_read', { room: currentRoom, reader: myNick });

        // Розблоковуємо інпут (якщо раніше був заблокований юзер)
        const input = document.getElementById('input');
        const button = document.getElementById('button');
        input.disabled = false;
        input.placeholder = "Напишіть у групу...";
        button.disabled = false;

        document.getElementById('btn-block-user').style.display = 'none'; // У групі блокування не показуємо
        
        cancelAction();
        currentPinIndex = 0;
        renderPinnedBar();
        loadMessagesHistory();
        renderChatsList();
    } else {
        // Якщо це звичайний юзер, викликаємо оригінальну функцію
        originalOpenChatWith(partnerId);
        document.getElementById('btn-block-user').style.display = 'block';
    }
};

// Перехоплюємо клік на 3 точки
const originalToggleChatMenu = window.toggleChatMenu;
window.toggleChatMenu = function(e) {
    if (currentActiveChatPartner && currentActiveChatPartner.startsWith('group_')) {
        e.stopPropagation();
        document.getElementById('chat-options-menu').style.display = 'none';
        openGroupInfoModal(currentActiveChatPartner);
    } else {
        originalToggleChatMenu(e);
    }
};

// 4. Логіка вікна інформації про групу
window.openGroupInfoModal = function(groupId) {
    const group = window.groupsData[groupId] || localProfiles[groupId];
    if (!group) return;

    document.getElementById('group-info-modal').classList.add('active');
    document.getElementById('group-info-avatar').innerHTML = getAvatarHTML(groupId, 'modal-avatar');
    document.getElementById('group-info-name').textContent = group.displayName;

    const membersList = document.getElementById('group-members-list');
    membersList.innerHTML = '';

    group.members.forEach(member => {
        const div = document.createElement('div');
        div.className = 'forward-user-item'; // Використовуємо твій існуючий CSS клас для стилю
        div.style.justifyContent = 'space-between';
        div.style.cursor = 'default';

        let adminBadge = member === group.admin ? '<span style="color:var(--accent); font-size:11px; padding: 2px 6px; background: rgba(0, 136, 204, 0.2); border-radius: 8px;">Адмін</span>' : '';
        let removeBtn = (group.admin === myNick && member !== myNick) ? `<button class="unpin-btn-x" onclick="removeMember('${groupId}', '${member}')">❌</button>` : '';

        div.innerHTML = `<div style="display:flex; align-items:center; gap:10px;">${getAvatarHTML(member, 'avatar')} <span>${getVisibleName(member)} ${adminBadge}</span></div> ${removeBtn}`;
        membersList.appendChild(div);
    });

    const deleteBtn = document.getElementById('btn-delete-group');
    if (group.admin === myNick) {
        deleteBtn.textContent = '🗑 Видалити групу';
        deleteBtn.style.background = 'var(--danger)';
        deleteBtn.onclick = () => deleteGroup(groupId);
    } else {
        deleteBtn.textContent = '🚪 Вийти з групи';
        deleteBtn.style.background = 'var(--bg-header)';
        deleteBtn.onclick = () => removeMember(groupId, myNick);
    }
};

window.closeGroupInfoModal = function() {
    document.getElementById('group-info-modal').classList.remove('active');
};

// 5. Управління учасниками
window.openAddMemberMenu = function() {
    const groupId = currentActiveChatPartner;
    const group = window.groupsData[groupId] || localProfiles[groupId];
    if (!group) return;

    // Шукаємо, кого з твоїх активних чатів ще немає в групі
    const availableUsers = activeChats.filter(u => !u.startsWith('group_') && !group.members.includes(u));
    
    let newUser = prompt("Введіть нікнейм користувача для додавання:\nПідказка (твої контакти): " + (availableUsers.length > 0 ? availableUsers.join(", ") : "немає вільних контактів"));

    if (newUser && newUser.trim() !== '') {
        newUser = newUser.trim();
        if (group.members.includes(newUser)) {
            alert("Користувач вже в групі!"); return;
        }
        
        group.members.push(newUser);
        localProfiles[groupId] = group;
        saveGroupsLocally();
        socket.emit('group_action', { action: 'add', groupId: groupId, user: newUser, by: myNick });
        
        openGroupInfoModal(groupId); // Оновлюємо список
    }
};

window.removeMember = function(groupId, member) {
    if (!confirm(member === myNick ? "Справді вийти з групи?" : `Видалити ${member} з групи?`)) return;
    
    const group = window.groupsData[groupId] || localProfiles[groupId];
    if (!group) return;

    group.members = group.members.filter(m => m !== member);
    localProfiles[groupId] = group;
    saveGroupsLocally();

    socket.emit('group_action', { action: 'remove', groupId: groupId, user: member, by: myNick });

    if (member === myNick) {
        closeGroupInfoModal();
        activeChats = activeChats.filter(c => c !== groupId);
        saveActiveChats();
        currentActiveChatPartner = null;
        currentRoom = null;
        document.getElementById('chat-area').style.display = 'none';
        document.getElementById('no-chat-placeholder').style.display = 'block';
        renderChatsList();
    } else {
        openGroupInfoModal(groupId); // Оновлюємо список
    }
};

window.deleteGroup = function(groupId) {
    if (!confirm("Ви впевнені, що хочете видалити групу для всіх?")) return;
    
    socket.emit('group_action', { action: 'delete', groupId: groupId, by: myNick });

    delete window.groupsData[groupId];
    delete localProfiles[groupId];
    saveGroupsLocally();

    closeGroupInfoModal();
    activeChats = activeChats.filter(c => c !== groupId);
    saveActiveChats();
    currentActiveChatPartner = null;
    currentRoom = null;
    document.getElementById('chat-area').style.display = 'none';
    document.getElementById('no-chat-placeholder').style.display = 'block';
    renderChatsList();
};

// 6. Обробка сокетів від сервера
socket.on('group_update', (data) => {
    const { groupObj, action, targetUser, by } = data;

    if (action === 'delete') {
        delete window.groupsData[groupObj.id];
        delete localProfiles[groupObj.id];
        activeChats = activeChats.filter(c => c !== groupObj.id);
        
        if (currentActiveChatPartner === groupObj.id) {
            currentActiveChatPartner = null; currentRoom = null;
            document.getElementById('chat-area').style.display = 'none'; 
            document.getElementById('no-chat-placeholder').style.display = 'block';
        }
        alert(`Група "${groupObj.displayName}" була видалена.`);
    } else {
        window.groupsData[groupObj.id] = groupObj;
        localProfiles[groupObj.id] = groupObj;

        if (action === 'add' && targetUser === myNick) {
            if (!activeChats.includes(groupObj.id)) activeChats.push(groupObj.id);
        }
        if (action === 'remove' && targetUser === myNick) {
            activeChats = activeChats.filter(c => c !== groupObj.id);
            if (currentActiveChatPartner === groupObj.id) {
                currentActiveChatPartner = null; currentRoom = null;
                document.getElementById('chat-area').style.display = 'none'; 
                document.getElementById('no-chat-placeholder').style.display = 'block';
            }
            alert(`Вас видалили з групи "${groupObj.displayName}".`);
        }
    }

    saveGroupsLocally();
    saveActiveChats();
    renderChatsList();
    
    // Якщо ми зараз у цій групі, оновлюємо UI
    if (currentActiveChatPartner === groupObj.id) {
        if (document.getElementById('group-info-modal').classList.contains('active')) {
            openGroupInfoModal(groupObj.id); 
        }
        openChatWith(groupObj.id); 
    }
});

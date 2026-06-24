// Глобальный объект для кэширования групп
let localGroups = {};
let newGroupAvatarBase64 = '';

// Открытие модалки создания
const btnCreateGroup = document.getElementById('btn-create-group-modal');
if (btnCreateGroup) {
    btnCreateGroup.onclick = () => {
        document.getElementById('create-group-modal').classList.add('active');
    };
}

// Загрузка аватарки для новой группы
window.handleGroupAvatar = function(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    compressImage(file, (base64) => {
        newGroupAvatarBase64 = base64;
        const preview = document.getElementById('new-group-avatar-preview');
        preview.style.backgroundImage = `url(${base64})`;
        preview.style.backgroundSize = 'cover';
        preview.style.color = 'transparent';
    });
};

// Отправка запроса на создание
window.submitNewGroup = function() {
    const type = document.getElementById('new-group-type').value;
    const name = document.getElementById('new-group-name').value.trim();
    const desc = document.getElementById('new-group-desc').value.trim();

    if (!name) {
        alert("Введіть назву!");
        return;
    }

    socket.emit('create_group', {
        type: type,
        name: name,
        desc: desc,
        avatar: newGroupAvatarBase64
    });

    document.getElementById('create-group-modal').classList.remove('active');
    document.getElementById('new-group-name').value = '';
    document.getElementById('new-group-desc').value = '';
    newGroupAvatarBase64 = '';
};

// Слушаем успешное создание группы
socket.on('group_created', (groupData) => {
    localGroups[groupData.id] = groupData;
    if (!activeChats.includes(groupData.id)) {
        activeChats.push(groupData.id);
        saveActiveChats();
    }
    renderChatsList(); // Вызовет функцию из script.js
    openChatWith(groupData.id); // Сразу открываем чат
});

// Синхронизация данных групп с сервера
socket.on('group_updated', (groupData) => {
    localGroups[groupData.id] = groupData;
    // Если чат сейчас открыт, обновляем интерфейс
    if (currentActiveChatPartner === groupData.id) {
        updateGroupUI(groupData);
    }
});

// Функция обновления UI если открыта группа
function updateGroupUI(group) {
    const myRole = group.members[myNick]?.role;
    
    // Блокировка инпута для каналов
    const inputField = document.getElementById('input');
    const sendBtn = document.getElementById('button');
    
    if (group.type === 'channel') {
        if (!['owner', 'co_owner', 'senior_admin', 'admin'].includes(myRole)) {
            if(inputField) {
                inputField.disabled = true;
                inputField.placeholder = "Тільки адміністратори можуть писати...";
            }
            if(sendBtn) sendBtn.disabled = true;
        } else {
            if(inputField) {
                inputField.disabled = false;
                inputField.placeholder = "Публікація в канал...";
            }
            if(sendBtn) sendBtn.disabled = false;
        }
    }
    
    // Кастомный фон группы
    if (group.wallpaper) {
        document.getElementById('chat-main').style.backgroundImage = `url(${group.wallpaper})`;
    }
}

// Контекстное меню для управления участником группы (Правый клик по сообщению или в списке)
window.showGroupMemberContextMenu = function(e, targetUser, groupId) {
    e.preventDefault();
    const group = localGroups[groupId];
    if (!group) return;

    const myRole = group.members[myNick]?.role;
    // Если я обычный участник, я не могу управлять
    if (myRole === 'member') return;

    const options = [];

    if (['owner', 'co_owner', 'senior_admin', 'admin', 'moderator'].includes(myRole)) {
        options.push({ text: "🔇 Заглушити (Мут на 1 год)", action: () => socket.emit('group_action', { groupId, action: 'mute', targetUser, muteTimeMinutes: 60 }) });
    }
    
    if (['owner', 'co_owner', 'senior_admin'].includes(myRole)) {
        options.push({ text: "🚫 Видалити з групи", class: 'danger', action: () => socket.emit('group_action', { groupId, action: 'kick', targetUser }) });
    }

    if (myRole === 'owner') {
        options.push({ text: "⭐ Зробити Адміном", action: () => socket.emit('group_action', { groupId, action: 'set_role', targetUser, role: 'admin' }) });
        options.push({ text: "🔧 Зробити Модератором", action: () => socket.emit('group_action', { groupId, action: 'set_role', targetUser, role: 'moderator' }) });
    }

    if (options.length > 0) {
        showContextMenu(e, options); // Вызов существующей функции из script.js
    }
}

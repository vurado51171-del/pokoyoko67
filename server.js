// Ініціалізація Socket.io (підключається автоматично  до поточного хоста)
const socket = io();

// Отримуємо поточного користувача (наприклад, зі sessionStorage або localStorage)
const currentUsername = localStorage.getItem('username') || "Користувач_" + Math.floor(Math.random() * 1000);

let currentRoom = '';
let currentPartner = '';

// Сховища для даних, які прилітають із сервера
let allExistingUsers = new Set(); // Тут зберігатимемо ВСІХ реальних користувачів для пошуку
let activeDialogs = [];           // Список активних діалогів користувача

// Елементи інтерфейсу (переконайся, що у твоїй HTML є такі ID або заміни на свої)
const searchInput = document.getElementById('search-input');
const suggestionsBox = document.getElementById('search-suggestions');
const chatMessagesContainer = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const dialogsListContainer = document.getElementById('dialogs-list');

/* ==========================================================================
   1. АВТОРИЗАЦІЯ ТА ЗАПИТ ДАНИХ ПРИ ВХОДІ
   ========================================================================== */
socket.emit('store user', currentUsername);
socket.emit('request profiles'); // Запитуємо всі профілі, щоб знати, хто взагалі є в системі

/* ==========================================================================
   2. ОБРОБКА ПОДІЙ СЕРВЕРА (ОБОВ'ЯЗКОВО ЗБІГАЄТЬСЯ З ТВОЇМ JS СЕРВЕРА)
   ========================================================================== */

// Отримуємо список усіх профілів для розумного пошуку
socket.on('all profiles data', (profiles) => {
    Object.keys(profiles).forEach(username => {
        if (username !== currentUsername) {
            allExistingUsers.add(username);
        }
    });
});

// Отримуємо онлайн-користувачів (додаємо їх також до списку існуючих)
socket.on('online users', (onlineUsers) => {
    onlineUsers.forEach(username => {
        if (username !== currentUsername) {
            allExistingUsers.add(username);
        }
    });
    // Тут можна викликати функцію оновлення статусів "онлайн" в інтерфейсі
});

// Отримуємо список діалогів, де користувач уже брав участь
socket.on('server dialogs list', (dialogs) => {
    activeDialogs = dialogs;
    renderDialogsList();
});

// Отримуємо історію повідомлень при вході в кімнату
socket.on('server history', (messages) => {
    chatMessagesContainer.innerHTML = ''; // Очищаємо екран перед завантаженням історії
    messages.forEach(msg => {
        renderMessage(msg);
    });
    scrollToBottom();
});

// СЛУХАЄМО НОВІ ПОВІДОМЛЕННЯ (Виправлено баг зникнення повідомлень!)
socket.on('chat message', (msgData) => {
    // Відображаємо повідомлення лише якщо воно належить до поточної відкритої кімнати
    if (msgData.room === currentRoom) {
        renderMessage(msgData);
        scrollToBottom();
    }
    
    // Якщо цього діалогу ще немає у списку зліва — додаємо його туди
    const partner = msgData.room.replace(currentUsername, '').replace('_', '');
    if (partner && !activeDialogs.includes(partner)) {
        activeDialogs.push(partner);
        renderDialogsList();
    }
});

// Якщо сервер просить примусово підключитися до кімнати (бо хтось написав нам вперше)
socket.on('force join room', (roomName) => {
    const partner = roomName.replace(currentUsername, '').replace('_', '');
    socket.emit('join room', partner);
});

// Оновлення реакцій на повідомленнях
socket.on('update_message_data', (data) => {
    const msgElement = document.querySelector(`[data-msg-id="${data.msgId}"]`);
    if (msgElement) {
        updateReactionsUI(msgElement, data.reactions);
    }
});


/* ==========================================================================
   3. ЛОГІКА РОЗУМНОГО ПОШУКУ (Варіанти + Валідація)
   ========================================================================== */

if (searchInput) {
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        suggestionsBox.innerHTML = ''; // Очищаємо старі підказки
        
        if (!query) {
            suggestionsBox.style.display = 'none';
            return;
        }

        // Шукаємо користувачів, чий нікнейм містить введені літери
        const matches = Array.from(allExistingUsers).filter(user => 
            user.toLowerCase().includes(query)
        );

        if (matches.length > 0) {
            suggestionsBox.style.display = 'block';
            matches.forEach(user => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.innerText = user;
                // Клік на підказку відразу відкриває чат
                div.onclick = () => {
                    openChatWith(user);
                    searchInput.value = '';
                    suggestionsBox.style.display = 'none';
                };
                suggestionsBox.appendChild(div);
            });
        } else {
            // Якщо збігів немає, показуємо підказку, що нікого не знайдено
            suggestionsBox.style.display = 'block';
            const noResult = document.createElement('div');
            noResult.className = 'suggestion-item no-result';
            noResult.innerText = 'Нікого не знайдено';
            suggestionsBox.appendChild(noResult);
        }
    });
}

// Функція для відкриття чату з перевіркою на існування користувача
function openChatWith(partnerName) {
    if (!partnerName) return;

    // Головна валідація: якщо користувача немає в базі серверові — не створюємо чат!
    if (!allExistingUsers.has(partnerName)) {
        alert(`Користувача "${partnerName}" не існує в BurmaldaGram!`);
        return;
    }

    currentPartner = partnerName;
    // Генеруємо назву кімнати точно так само, як твій сервер: [user1, user2].sort().join('_')
    currentRoom = [currentUsername, partnerName].sort().join('_');

    // Кажемо серверу, що ми заходимо в кімнату
    socket.emit('join room', partnerName);

    // Додаємо в активні діалоги зліва, якщо його там не було
    if (!activeDialogs.includes(partnerName)) {
        activeDialogs.push(partnerName);
        renderDialogsList();
    }

    // Візуально підсвічуємо активний чат в інтерфейсі
    document.getElementById('chat-title').innerText = `Чат з ${partnerName}`;
}


/* ==========================================================================
   4. ВІДПРАВКА ПОВІДОМЛЕНЬ
   ========================================================================== */
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentRoom) return;

    const msgId = 'msg-' + Date.now();

    // Формуємо пакет даних ТОЧНО у форматі, який очікує твій сервер
    const messagePacket = {
        room: currentRoom,
        text: text,
        user: currentUsername,
        msgId: msgId,
        isRead: false,
        time: Date.now(),
        reactions: {}
    };

    // Відправляємо на сервер
    socket.emit('private chat message', messagePacket);
    
    // Очищаємо поле вводу
    messageInput.value = '';
}

if (sendButton) sendButton.addEventListener('click', sendMessage);
if (messageInput) {
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
}


/* ==========================================================================
   5. ДОПОМІЖНІ ФУНКЦІЇ РЕНДЕРУ (UI)
   ========================================================================== */

function renderDialogsList() {
    if (!dialogsListContainer) return;
    dialogsListContainer.innerHTML = '';
    
    activeDialogs.forEach(partner => {
        const item = document.createElement('div');
        item.className = `dialog-item ${partner === currentPartner ? 'active' : ''}`;
        item.innerText = partner;
        item.onclick = () => openChatWith(partner);
        dialogsListContainer.appendChild(item);
    });
}

function renderMessage(msg) {
    if (!chatMessagesContainer) return;

    const div = document.createElement('div');
    // Визначаємо клас: наше повідомлення чи співрозмовника
    div.className = `message ${msg.user === currentUsername ? 'my-message' : 'other-message'}`;
    div.setAttribute('data-msg-id', msg.msgId);

    // Вміст повідомлення
    div.innerHTML = `
        <div class="message-sender">${msg.user}</div>
        <div class="message-text">${msg.text}</div>
        <div class="message-reactions" id="reactions-${msg.msgId}"></div>
    `;

    // Додаємо клік для відправки реакції (наприклад, 👍)
    div.onclick = () => {
        socket.emit('message_reaction', {
            room: currentRoom,
            msgId: msg.msgId,
            reaction: '👍',
            username: currentUsername
        });
    };

    chatMessagesContainer.appendChild(div);
    updateReactionsUI(div, msg.reactions || {});
}

function updateReactionsUI(msgElement, reactions) {
    const reactionsContainer = msgElement.querySelector('.message-reactions');
    if (!reactionsContainer) return;
    reactionsContainer.innerHTML = '';

    Object.keys(reactions).forEach(emoji => {
        const usersWhoReacted = reactions[emoji];
        if (usersWhoReacted.length > 0) {
            const span = document.createElement('span');
            span.className = 'reaction-badge';
            span.innerText = `${emoji} ${usersWhoReacted.length}`;
            reactionsContainer.appendChild(span);
        }
    });
}

function scrollToBottom() {
    if (chatMessagesContainer) {
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
}

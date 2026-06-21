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
    function stopRingtone() { clearInterval(ringInterval);
    }

    const translations = {
        uk: { searchPlaceholder: "Введіть ім'я...", dialogsTitle: "Ваші діалоги", placeholderText: "BurmaldaGram Premium<br><span style='font-size: 13px; color: var(--text-muted);'>Оберіть чат 🔍</span>", backBtn: "⬅ Назад", inputPlaceholder: "Напишіть повідомлення...", btnSend: "Надіслати", settingsTitle: "⚙️ Налаштування", profileTitle: "👤 Профіль", profile: "Юзернейм:", profileName: "Нік:", status: "Статус:", online: "в мережі", offline: "офлайн", loginTime: "Вхід:", logoutBtn: "Вийти 🚪", emptyList: "Список порожній", selfChatError: "Не можна створювати чат із собою!", ctxReply: "Відповісти ↩", ctxEdit: "Редагувати ✏️", userNotFound: "Не знайдено!", ctxPin: "Закріпити повідомлення 📌", ctxUnpin: "Відкріпити повідомлення 🔓", ctxDeleteMy: "Видалити (своє) 🗑", chatStatusOnline: "● онлайн", chatStatusOffline: "офлайн", typingText: "пише...", 
            uploadBtn: "📁 Завантажити", bioPlaceholder: "Про себе:", bioEmpty: "Пусто", replyPrefix: "Відповідь на: ", pinnedLabel: "Закріплено", blockedMeText: "Цей користувач вас заблокував.", themeTitle: "Тема оформлення:" },
        ru: { searchPlaceholder: "Введите имя...", dialogsTitle: "Диалоги", placeholderText: "BurmaldaGram Premium", backBtn: "⬅ Назад", inputPlaceholder: "Напишите...", btnSend: "Отправить", settingsTitle: "⚙️ Настройки", profileTitle: "👤 Профиль", profile: "Юзернейм:", profileName: "Ник:", status: "Статус:", online: "в сети", offline: "офлайн", loginTime: "Вход:", logoutBtn: "Выйти 🚪", emptyList: "Пусто", selfChatError: "Нельзя с собой!", ctxReply: "Ответить ↩", ctxEdit: "Изменить ✏️", userNotFound: "Не найден!", ctxPin: "Закрепить 📌", ctxUnpin: 
"Открепить 🔓", ctxDeleteMy: "Удалить 🗑", chatStatusOnline: "● онлайн", chatStatusOffline: "офлайн", typingText: "печатает...", 
            uploadBtn: "📁 Загрузить", bioPlaceholder: "О себе:", bioEmpty: "Пусто", replyPrefix: "Ответ: ", pinnedLabel: "Закреплено", blockedMeText: "Этот пользователь вас заблокировал.", themeTitle: "Тема оформления:" },
        en: { searchPlaceholder: "Search...", dialogsTitle: "Chats", placeholderText: "BurmaldaGram Premium", backBtn: "⬅ Back", inputPlaceholder: "Message...", btnSend: "Send", settingsTitle: "⚙️ Settings", profileTitle: "👤 Profile", profile: "ID:", profileName: "Name:", status: "Status:", online: "online", offline: "offline", loginTime: "Login:", logoutBtn: "Log out 🚪", emptyList: "Empty", selfChatError: "Can't chat with yourself!", ctxReply: "Reply ↩", ctxEdit: "Edit ✏️", userNotFound: "Not found!", ctxPin: "Pin 📌", ctxUnpin: "Unpin 🔓", ctxDeleteMy: "Delete 🗑", chatStatusOnline: "● online", chatStatusOffline: "offline", typingText: "typing...", uploadBtn: 
            "📁 Upload", bioPlaceholder: "Bio:", bioEmpty: "Empty", replyPrefix: "Reply: ", pinnedLabel: "Pinned", blockedMeText: "You are blocked by this user.", themeTitle: "Theme:" }
    };
    let currentLang = localStorage.getItem('burmalda_lang') || 'uk';
    let currentTheme = localStorage.getItem('burmalda_theme') || 'theme-dark';
    const urlParams = new URLSearchParams(window.location.search);
    const authToken = urlParams.get('auth');
    let myNick = 'Анонім';
    let authorized = false;
    let sessionTimeString = 'Невідомо';
    
    let replyTargetMsgId = null;
    let editTargetMsgId = null;
    let activeChats = JSON.parse(localStorage.getItem('burmalda_chat_list')) || [];
    let glowingChats = JSON.parse(localStorage.getItem('burmalda_glow_chats')) || {};
    let pinnedMessages = JSON.parse(localStorage.getItem('burmalda_pinned_data')) || {};
    let currentPinIndex = 0;
    let chatSettings = JSON.parse(localStorage.getItem('burmalda_chat_settings')) || {};
    let myCustomStickers = JSON.parse(localStorage.getItem('burmalda_custom_stickers')) || [];
    const ALL_EMOJIS = ['👍','❤️','😂','😮','😢','🙏','😎','🔥','💯','🎉','💩','👽','👻','🤡','🤝','💪','👀','🧠',' Ukraine','🍉'];

    document.body.className = currentTheme;
    document.getElementById('theme-select').value = currentTheme;
    if (authToken) {
        try {
            const decoded = decodeURIComponent(atob(authToken));
            const parts = decoded.split('_');
            myNick = parts[0]; 
            const loginTime = parseInt(parts[1]);
            if (!isNaN(loginTime)) sessionTimeString = new Date(loginTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) + " " + new Date(loginTime).toLocaleDateString();
            if (Date.now() - loginTime < 86400000 && myNick) authorized = true;
        } catch (e) { console.error("Помилка авторизації:", e);
        }
    }

    if (!authorized) { alert('Доступ заблоковано!'); window.location.href = '/';
    } 
    else { document.getElementById('main-body').style.display = 'flex'; }

    const socket = io();
    let currentRoom = null;
    let currentActiveChatPartner = null;
    let onlineUsers = [];
    let savedMessages = {};
    function safeSaveHistory() {
        try {
            localStorage.setItem('burmalda_msg_history', JSON.stringify(savedMessages));
        } catch(e) {
            console.warn("localStorage переповнено! Дані не збережено локально.");
        }
    }

    try {
        const rawHistory = localStorage.getItem('burmalda_msg_history');
        if (rawHistory) savedMessages = typeof rawHistory === 'string' ? JSON.parse(rawHistory) : rawHistory;
    } catch (e) { savedMessages = {};
    }

    let localProfiles = JSON.parse(localStorage.getItem('burmalda_profiles_data')) || {};

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
            const cleanUrl = window.location.pathname + '?auth=' + urlParams.get('auth');
            window.history.replaceState({}, "", cleanUrl); 
            renderChatsList(); 
        } 
    };
    function formatDateDivider(ts) {
        return new Date(ts).toLocaleDateString(currentLang, {day: 'numeric', month: 'long'});
    }

    function saveActiveChats() {
        localStorage.setItem('burmalda_chat_list', JSON.stringify(activeChats));
        socket.emit('sync_contacts', { user: myNick, chats: activeChats });
    }

    function getVisibleName(username) { 
        const uData = localProfiles[username];
        if (uData && uData.displayName && uData.displayName.trim() !== '') return uData.displayName.trim(); 
        return username;
    }

    function getAvatarHTML(username, cssClass = 'avatar') { 
        const uData = localProfiles[username];
        if (uData && uData.avatar && uData.avatar.startsWith('data:image')) { 
            return `<img src="${uData.avatar}" class="${cssClass}" id="av-node-${username}" alt="">`;
        } 
        const visibleName = getVisibleName(username);
        const firstLetter = visibleName ?
visibleName.charAt(0) : '?'; 
        const placeholderClass = cssClass === 'avatar' ? 'avatar-placeholder' : 'modal-avatar-placeholder';
        const colors = ['#0088cc', '#4cd964', '#ff3b30', '#ffcc00', '#5856d6', '#ff2d55', '#af52de']; 
        let charCodeSum = 0;
        for (let i = 0; i < username.length; i++) charCodeSum += username.charCodeAt(i); 
        const pickedColor = colors[charCodeSum % colors.length];
        return `<div class="${placeholderClass}" id="av-node-${username}" style="background-color: ${pickedColor}">${firstLetter}</div>`; 
    }

    function applyLanguage() { 
        const t = translations[currentLang];
        document.getElementById('lang-select').value = currentLang;
        document.getElementById('my-profile-name').innerHTML = `${getAvatarHTML(myNick)} <span>${getVisibleName(myNick)}</span>`; 
        searchInput.placeholder = t.searchPlaceholder; 
        document.getElementById('lbl-dialogs').textContent = t.dialogsTitle; 
        document.getElementById('placeholder-text').innerHTML = t.placeholderText; 
        document.getElementById('btn-back').textContent = t.backBtn;
        input.placeholder = t.inputPlaceholder;
        button.textContent = t.btnSend; 
        document.getElementById('lbl-profile-name').textContent = t.profileName; 
        document.getElementById('lbl-profile').textContent = t.profile; 
        document.getElementById('lbl-status').textContent = t.status; 
        document.getElementById('lbl-bio-title').textContent = t.bioPlaceholder;
        document.getElementById('lbl-time').textContent = t.loginTime;
        document.getElementById('btn-logout').textContent = t.logoutBtn; 
        document.getElementById('lbl-upload-btn').textContent = t.uploadBtn; 
        document.getElementById('lbl-theme-title').textContent = t.themeTitle;
        if (settingsModal.classList.contains('active')) { 
            const openedNick = document.getElementById('info-nick').textContent;
            const isMe = (openedNick === myNick);
            document.getElementById('modal-title-text').textContent = isMe ? t.settingsTitle : t.profileTitle; 
            const isOnline = onlineUsers.includes(openedNick);
            const statusLabel = document.getElementById('lbl-online-status'); 
            statusLabel.textContent = isOnline ? t.online : t.offline; 
            statusLabel.style.color = isOnline ? '#4cd964' : '#ff3b30';
        } 
        renderChatsList(); loadMessagesHistory(); renderStickersList();
    }

    function changeLanguage(lang) { currentLang = lang; localStorage.setItem('burmalda_lang', lang); applyLanguage();
    }

    function changeTheme(themeVal) {
        currentTheme = themeVal;
        document.body.className = themeVal;
        localStorage.setItem('burmalda_theme', themeVal);
    }

    function openMyProfile() { 
        const t = translations[currentLang];
        document.getElementById('info-nick').textContent = myNick; 
        const myData = localProfiles[myNick] || { avatar: '', bio: '', displayName: '' }; 
        document.getElementById('profile-display-name').disabled = false;
        document.getElementById('profile-display-name').value = myData.displayName || myNick; 
        document.getElementById('profile-desc').disabled = false; document.getElementById('profile-desc').value = myData.bio || ''; document.getElementById('profile-desc').placeholder = t.bioEmpty; 
        document.getElementById('modal-avatar-view').innerHTML = getAvatarHTML(myNick, 'modal-avatar');
        document.getElementById('info-login-time').textContent = sessionTimeString; 
        document.getElementById('lbl-upload-btn').style.display = 'block'; document.getElementById('btn-logout').style.display = 'block'; 
        document.getElementById('lang-select-block').style.display = 'block'; document.getElementById('theme-select-block').style.display = 'block'; document.getElementById('login-time-block').style.display = 'block';
        document.getElementById('sticker-creator-block').style.display = 'block';
        applyLanguage(); settingsModal.classList.add('active');
    }

    function openPartnerProfile() { 
        if (!currentActiveChatPartner) return;
        const t = translations[currentLang]; document.getElementById('info-nick').textContent = currentActiveChatPartner; 
        const pData = localProfiles[currentActiveChatPartner] || { avatar: '', bio: '', displayName: '' };
        document.getElementById('profile-display-name').disabled = true; document.getElementById('profile-display-name').value = pData.displayName || currentActiveChatPartner; 
        document.getElementById('profile-desc').disabled = true; document.getElementById('profile-desc').value = pData.bio || ''; document.getElementById('profile-desc').placeholder = t.bioEmpty;
        document.getElementById('modal-avatar-view').innerHTML = getAvatarHTML(currentActiveChatPartner, 'modal-avatar'); 
        document.getElementById('lbl-upload-btn').style.display = 'none'; document.getElementById('btn-logout').style.display = 'none'; 
        document.getElementById('lang-select-block').style.display = 'none'; document.getElementById('theme-select-block').style.display = 'none'; document.getElementById('login-time-block').style.display = 'none';
        document.getElementById('sticker-creator-block').style.display = 'none';
        applyLanguage();
        settingsModal.classList.add('active');
    }

    function saveMyDisplayName(val) { 
        if (!localProfiles[myNick]) localProfiles[myNick] = {};
        localProfiles[myNick].displayName = val; 
        localStorage.setItem('burmalda_profiles_data', JSON.stringify(localProfiles)); socket.emit('update_profile', { username: myNick, data: localProfiles[myNick] }); 
        document.getElementById('my-profile-name').innerHTML = `${getAvatarHTML(myNick)} <span>${getVisibleName(myNick)}</span>`;
    }

    function saveMyBio(val) { 
        if (!localProfiles[myNick]) localProfiles[myNick] = {};
        localProfiles[myNick].bio = val; 
        localStorage.setItem('burmalda_profiles_data', JSON.stringify(localProfiles)); socket.emit('update_profile', { username: myNick, data: localProfiles[myNick] });
    }

    function handleAvatarUpload(inputEl) { 
        const file = inputEl.files[0];
        if (!file) return; const reader = new FileReader(); 
        reader.onloadend = function() { 
            if (!localProfiles[myNick]) localProfiles[myNick] = {};
            localProfiles[myNick].avatar = reader.result; 
            localStorage.setItem('burmalda_profiles_data', JSON.stringify(localProfiles)); socket.emit('update_profile', { username: myNick, data: localProfiles[myNick] }); 
            document.getElementById('modal-avatar-view').innerHTML = getAvatarHTML(myNick, 'modal-avatar'); document.getElementById('my-profile-name').innerHTML = `${getAvatarHTML(myNick)} <span>${getVisibleName(myNick)}</span>`;
        }; reader.readAsDataURL(file); 
    }

    function uploadCustomStickers(inputEl) {
        if (!inputEl.files || inputEl.files.length === 0) return;
        Array.from(inputEl.files).forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => {
                myCustomStickers.push(reader.result);
                localStorage.setItem('burmalda_custom_stickers', JSON.stringify(myCustomStickers));
                renderStickersList();
            };
            reader.readAsDataURL(file);
        });
        inputEl.value = '';
    }

    function renderStickersList() {
        const preview = document.getElementById('my-stickers-preview');
        preview.innerHTML = '';
        myCustomStickers.forEach((st, idx) => {
            const img = document.createElement('img');
            img.src = st;
            img.className = 'pack-item-preview';
            img.onclick = () => {
                if (confirm("Видалити цей стікер?")) {
                    myCustomStickers.splice(idx, 1);
                    localStorage.setItem('burmalda_custom_stickers', JSON.stringify(myCustomStickers));
                    renderStickersList();
                }
            };
            preview.appendChild(img);
        });
        stickerMenu.innerHTML = '';
        if (myCustomStickers.length === 0) {
            stickerMenu.innerHTML = '<span style="color:var(--text-muted); font-size:12px;">У вас немає стікерів. Додайте їх в налаштуваннях.</span>';
        } else {
            myCustomStickers.forEach(st => {
                const img = document.createElement('img');
                img.src = st;
                img.className = 'sticker-item';
                img.onclick = () => sendSpecialMessage(st, 'sticker');
                stickerMenu.appendChild(img);
            });
        }
    }

    function toggleStickerMenu() { stickerMenu.classList.toggle('active');
    }

    searchToggleBtn.onclick = () => { searchFrame.classList.toggle('active'); if (searchFrame.classList.contains('active')) searchInput.focus(); };
    // --- ГЛОБАЛЬНИЙ ПОШУК (ЛЮДИ ТА ПОВІДОМЛЕННЯ) ---
    let searchTimeout;
    let latestSearchUsers = [];
    let latestSearchMessages = [];

    searchInput.oninput = (e) => {
        clearTimeout(searchTimeout);
        const val = e.target.value.trim();
        if (val.length > 0) {
            searchTimeout = setTimeout(() => {
                // Відправляємо відразу ДВА запити: один для повідомлень, другий для юзерів у Google
                socket.emit('global_search', { query: val });
                socket.emit('search_users', { query: val });
            }, 300);
        } else {
            searchDropdown.style.display = 'none';
            latestSearchUsers = [];
            latestSearchMessages = [];
        }
    };
    function renderCombinedSearchResults() {
        searchDropdown.innerHTML = '';
        if (latestSearchUsers.length === 0 && latestSearchMessages.length === 0) {
            searchDropdown.innerHTML = `<div style="padding:10px;text-align:center;color:var(--text-muted);font-size:12px;">Нікого не знайдено</div>`;
            searchDropdown.style.display = 'block';
            return;
        }

        if (latestSearchUsers.length > 0) {
            const sec = document.createElement('div');
            sec.className = 'search-section-title';
            sec.textContent = 'Користувачі';
            searchDropdown.appendChild(sec);

            latestSearchUsers.forEach(user => {
                if (!localProfiles[user.username]) localProfiles[user.username] = {};
                localProfiles[user.username].displayName = user.displayName;
                if(user.avatar) localProfiles[user.username].avatar = user.avatar;
                if(user.bio) localProfiles[user.username].bio = user.bio;

                const item = document.createElement('div');
                item.className = 'search-result-item';
                item.innerHTML = `
                    ${getAvatarHTML(user.username)}
                    <div>
                        <div style="font-weight:bold;font-size:13px;color:var(--text-main);">${escapeHTML(user.displayName)}</div>
                        <div style="font-size:11px;color:var(--text-muted);">@${escapeHTML(user.username)}</div>
                   </div>
                `;
                item.onclick = () => {
                    searchInput.value = '';
                    searchDropdown.style.display = 'none';
                    searchFrame.classList.remove('active');
                    if (user.username === myNick) { alert(translations[currentLang].selfChatError); return;
                    }
                    if (!activeChats.includes(user.username)) { activeChats.push(user.username);
                    saveActiveChats(); }
                    openChatWith(user.username);
                };
                searchDropdown.appendChild(item);
            });
        }

        if (latestSearchMessages.length > 0) {
            const sec = document.createElement('div');
            sec.className = 'search-section-title';
            sec.textContent = 'Повідомлення';
            searchDropdown.appendChild(sec);

            latestSearchMessages.forEach(msg => {
                const item = document.createElement('div');
                item.className = 'search-result-item';
                const partnerName = msg.partner === myNick ? "Ви" : getVisibleName(msg.partner);
                const senderName = msg.from === myNick ? "Ви" : getVisibleName(msg.from);
                
                item.innerHTML = `
                    ${getAvatarHTML(msg.partner)}
                    <div style="overflow: hidden; width: 100%;">
                        <div style="font-weight:bold;font-size:13px;color:var(--accent);">${escapeHTML(partnerName)}</div>
                        <div style="font-size:11px;color:var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <strong>${escapeHTML(senderName)}:</strong> ${escapeHTML(msg.text)}
                        </div>
                    </div>
                `;
                item.onclick = () => {
                    searchInput.value = '';
                    searchDropdown.style.display = 'none';
                    searchFrame.classList.remove('active');
                    if (!activeChats.includes(msg.partner)) { activeChats.push(msg.partner); saveActiveChats(); }
                    openChatWith(msg.partner);
                };
                searchDropdown.appendChild(item);
            });
        }
        searchDropdown.style.display = 'block';
    }

    // Слухаємо результати для повідомлень
    socket.on('global_search_results', (data) => {
        latestSearchMessages = data.messages || [];
        renderCombinedSearchResults();
    });
    // Слухаємо результати для нових юзерів (включаючи тих, що з Google)
    socket.on('search_results', (data) => {
        latestSearchUsers = data.results || [];
        renderCombinedSearchResults();
    });
    function renderChatsList() { 
        chatsList.innerHTML = '';
        if (activeChats.length === 0) { 
            chatsList.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:14px;">${translations[currentLang].emptyList}</div>`;
            return; 
        } 
        
        const sortedChats = [...activeChats].sort((a, b) => {
            const pinA = chatSettings[a]?.pinned ? 1 : 0;
            const pinB = chatSettings[b]?.pinned ? 1 : 0;
            return pinB - pinA;
        });
        sortedChats.forEach(user => { 
            const isOnline = onlineUsers.includes(user); 
            const statusText = isOnline ? translations[currentLang].chatStatusOnline : translations[currentLang].chatStatusOffline; 
            const prefs = chatSettings[user] || {};
            const activeClass = (currentActiveChatPartner === user) ? 'active' : ''; 
            const glowClass = glowingChats[user] ? 'glow-active' : '';
            const blockedClass = prefs.blocked ? 'blocked' : '';

            const item = document.createElement('div'); 
            item.className = `chat-item ${activeClass} ${glowClass} ${blockedClass}`; 
            
            let flagsHtml = '';
            if (prefs.pinned) flagsHtml += '📌';
            if (prefs.muted) flagsHtml += '🔇';
            if (prefs.blocked) flagsHtml += '🚫';

            item.innerHTML = `
                <div class="chat-info-block">
                    ${getAvatarHTML(user)}
                    <div>
                        <div style="font-weight:600; font-size:14px;">${escapeHTML(getVisibleName(user))}</div>
                        <div id="bio-${user}" style="font-size:12px; color:var(--text-muted);">${escapeHTML(localProfiles[user]?.bio || '')}</div>
                    </div>
                </div>
                <div class="chat-flags">${flagsHtml}</div>
                <div class="status-dot ${isOnline ? 'online' : ''}">${statusText}</div>
            `;
            
            item.oncontextmenu = (e) => { 
                e.preventDefault();
                showContextMenu(e, [
                    { text: prefs.pinned ? "Відкріпити чат" : "📌 Закріпити чат", action: () => toggleChatPref(user, 'pinned') },
                    { text: prefs.muted ? "Увімкнути звук" : "🔇 Вимкнути звук", action: () => toggleChatPref(user, 'muted') },
                    { text: prefs.blocked ? "Розблокувати" : "🚫 Заблокувати", action: () => toggleChatPref(user, 'blocked') },
                    { text: translations[currentLang].ctxDeleteMy, class: 'delete-btn', action: () => { deleteChatLocally(user); } }
                ]); 
            };
            item.onclick = () => { 
                if (glowingChats[user]) { delete glowingChats[user]; localStorage.setItem('burmalda_glow_chats', JSON.stringify(glowingChats)); }
                openChatWith(user); 
            };
            chatsList.appendChild(item);
        }); 
    }

    function toggleChatMenu(e) {
        e.stopPropagation();
        const menu = document.getElementById('chat-options-menu');
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    }

    function toggleChatPref(user, prefKey) {
        if (!chatSettings[user]) chatSettings[user] = { pinned: false, muted: false, blocked: false };
        chatSettings[user][prefKey] = !chatSettings[user][prefKey];
        localStorage.setItem('burmalda_chat_settings', JSON.stringify(chatSettings));
        
        if (prefKey === 'blocked' && chatSettings[user].blocked && currentActiveChatPartner === user) {
            input.disabled = true;
            input.placeholder = "Користувач заблокований"; button.disabled = true;
        } else if (prefKey === 'blocked' && !chatSettings[user].blocked && currentActiveChatPartner === user) {
            input.disabled = false;
            input.placeholder = translations[currentLang].inputPlaceholder; button.disabled = false;
        }
        updateChatHeaderUI();
        renderChatsList();
        document.getElementById('chat-options-menu').style.display = 'none';
    }

    function clearChatHistory() {
        if(!confirm("Очистити історію цього чату?")) return;
        if(savedMessages[currentRoom]) {
            delete savedMessages[currentRoom];
            safeSaveHistory();
            loadMessagesHistory();
        }
        document.getElementById('chat-options-menu').style.display = 'none';
    }

    function deleteChatLocally(username) { 
        activeChats = activeChats.filter(c => c !== username);
        saveActiveChats(); 
        if (currentActiveChatPartner === username) { 
            currentActiveChatPartner = null;
            currentRoom = null; chatArea.style.display = 'none'; chatPlaceholder.style.display = 'block'; 
        } renderChatsList();
    }

    function updateChatHeaderUI() {
        if (!currentActiveChatPartner) return;
        const prefs = chatSettings[currentActiveChatPartner] || {};
        document.getElementById('btn-mute-user').textContent = prefs.muted ? "🔔 Увімкнути звук" : "🔕 Вимкнути звук";
        document.getElementById('btn-block-user').textContent = prefs.blocked ? "✅ Розблокувати" : "🚫 Заблокувати";
    }

    function openChatWith(username) { 
        currentActiveChatPartner = username;
        const roomSorted = [myNick, username].sort(); 
        currentRoom = `room_${roomSorted[0]}_${roomSorted[1]}`; 
        
        document.body.classList.add('chat-opened'); chatPlaceholder.style.display = 'none'; chatArea.style.display = 'flex'; 
        
        const isOnline = onlineUsers.includes(username);
        chatTitleText.innerHTML = `${getAvatarHTML(username)} <span>${escapeHTML(getVisibleName(username))} ${isOnline ? '<small style="color:#4cd964; font-size:11px;">●</small>' : ''}</span>`;
        const cleanUrl = window.location.pathname + '?auth=' + urlParams.get('auth') + '&chat=' + username; window.history.pushState({}, "", cleanUrl);
        
        socket.emit('request_profile', { username: username });
        socket.emit('join_room', { room: currentRoom, user: myNick });
        socket.emit('mark_read', { room: currentRoom, reader: myNick });
        
        const prefs = chatSettings[username] || {};
        if (prefs.blocked) { input.disabled = true; input.placeholder = "Користувач заблокований"; button.disabled = true;
        } else { input.disabled = false;
            input.placeholder = translations[currentLang].inputPlaceholder; button.disabled = false;
        }

        updateChatHeaderUI();
        cancelAction(); currentPinIndex = 0; renderPinnedBar();
        loadMessagesHistory(); renderChatsList();
    }

    function renderPinnedBar() {
        if (!currentRoom) return;
        if (!Array.isArray(pinnedMessages[currentRoom])) {
            pinnedMessages[currentRoom] = pinnedMessages[currentRoom] ?
            [pinnedMessages[currentRoom]] : [];
        }
        const pins = pinnedMessages[currentRoom];
        if (pins && pins.length > 0) {
            if (currentPinIndex >= pins.length) currentPinIndex = 0;
            const currentPin = pins[currentPinIndex];
            pinCounterBadge.textContent = `${currentPinIndex + 1}/${pins.length}`;
            pinnedBarTextContent.innerHTML = escapeHTML(currentPin.text);
            pinnedMessageBar.style.display = 'flex';
        } else {
            pinnedMessageBar.style.display = 'none';
        }
    }

    function cyclePinnedMessages() {
        const pins = pinnedMessages[currentRoom] || [];
        if (pins.length > 1) { currentPinIndex = (currentPinIndex + 1) % pins.length; renderPinnedBar();
        }
        scrollToPinnedMessage();
    }

    function pinMessage(msgId, text) {
        if (!Array.isArray(pinnedMessages[currentRoom])) pinnedMessages[currentRoom] = [];
        if (!pinnedMessages[currentRoom].some(p => p.id === msgId)) {
            pinnedMessages[currentRoom].push({ id: msgId, text: text });
            localStorage.setItem('burmalda_pinned_data', JSON.stringify(pinnedMessages));
            socket.emit('pin_message', { room: currentRoom, action: 'add', pinData: { id: msgId, text: text } });
            currentPinIndex = pinnedMessages[currentRoom].length - 1;
            renderPinnedBar();
        }
    }

    function requestUnpin(e) {
        e.stopPropagation();
        const pins = pinnedMessages[currentRoom] || [];
        if (pins.length > 0) {
            const removed = pins[currentPinIndex];
            pinnedMessages[currentRoom].splice(currentPinIndex, 1);
            if (currentPinIndex >= pinnedMessages[currentRoom].length) currentPinIndex = 0;
            localStorage.setItem('burmalda_pinned_data', JSON.stringify(pinnedMessages));
            socket.emit('pin_message', { room: currentRoom, action: 'remove', pinData: removed });
            renderPinnedBar();
        }
    }

    function scrollToPinnedMessage() {
        if (!currentRoom) return;
        const pins = pinnedMessages[currentRoom] || [];
        if (pins.length === 0) return;
        const element = document.getElementById(`msg-item-${pins[currentPinIndex].id}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.style.background = 'rgba(255, 204, 0, 0.2)';
            setTimeout(() => { element.style.background = ''; }, 1200);
        }
    }

    function setReplyTarget(msgId, summaryText) {
        replyTargetMsgId = msgId;
        editTargetMsgId = null;
        document.getElementById('reply-preview-text').innerHTML = `${translations[currentLang].replyPrefix} "${escapeHTML(summaryText)}"`;
        document.getElementById('reply-preview-bar').style.display = 'flex'; input.focus();
    }

    function setEditTarget(msgId, text) {
        editTargetMsgId = msgId;
        replyTargetMsgId = null;
        document.getElementById('reply-preview-text').innerHTML = `Редагування: "${escapeHTML(text)}"`;
        document.getElementById('reply-preview-bar').style.display = 'flex'; input.value = text; input.focus();
    }

    function cancelAction() { replyTargetMsgId = null; editTargetMsgId = null; document.getElementById('reply-preview-bar').style.display = 'none'; input.value = '';
    }

    function uploadMediaFile(inputEl) {
        const file = inputEl.files[0];
        if (!file || !currentRoom) return; const reader = new FileReader();
        reader.onloadend = function() { sendSpecialMessage(reader.result, 'image'); cancelAction(); inputEl.value = '';
        }; 
        reader.readAsDataURL(file);
    }

    function sendSpecialMessage(dataStr, type) {
        if (!currentRoom) return;
        const msgId = type + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const msgPayload = { id: msgId, room: currentRoom, from: myNick, to: currentActiveChatPartner, text: dataStr, type: type, replyTo: replyTargetMsgId, timestamp: Date.now(), reactions: {}, status: 'sent' };
        if (!activeChats.includes(currentActiveChatPartner)) { activeChats.push(currentActiveChatPartner); saveActiveChats(); }
        if (!savedMessages[currentRoom]) savedMessages[currentRoom] = [];
        savedMessages[currentRoom].push(msgPayload);
        safeSaveHistory();
        socket.emit('chat_message', msgPayload); appendSingleMessage(msgPayload); audioSend.play().catch(e=>console.log(e));
        cancelAction(); stickerMenu.classList.remove('active'); messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    let mediaRecorder = null;
    let recordedChunks = [];
    let currentRecordType = null;
    let recordTimerInterval;
    let recordSeconds = 0;
    async function startMediaRecording(type) {
        try {
            const constraints = type === 'video_circle' ?
            { video: { facingMode: "user" }, audio: true } : { audio: true };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            document.getElementById('form').style.display = 'none';
            const overlay = document.getElementById('record-overlay');
            overlay.style.display = 'flex';
            const preview = document.getElementById('record-preview');
            if (type === 'video_circle') {
                preview.style.display = 'block';
                preview.srcObject = stream;
            } else {
                preview.style.display = 'none';
            }
            preview.classList.add('recording');

            mediaRecorder = new MediaRecorder(stream);
            recordedChunks = [];
            currentRecordType = type;
            recordSeconds = 0;
            document.getElementById('record-timer').textContent = '00:00';
            
            recordTimerInterval = setInterval(() => {
                recordSeconds++;
                const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
                const s = String(recordSeconds % 60).padStart(2, '0');
                document.getElementById('record-timer').textContent = `${m}:${s}`;
            }, 1000);
            mediaRecorder.ondataavailable = e => { if(e.data.size > 0) recordedChunks.push(e.data); };
            mediaRecorder.onstop = () => {
                clearInterval(recordTimerInterval);
                stream.getTracks().forEach(t => t.stop());
                preview.srcObject = null;
                preview.classList.remove('recording');
                
                if (!window.cancelCurrentRecord) {
                    const mimeType = type === 'video_circle' ?
                    'video/webm' : 'audio/webm';
                    const blob = new Blob(recordedChunks, { type: mimeType });
                    const reader = new FileReader();
                    reader.onloadend = () => { sendSpecialMessage(reader.result, type); };
                    reader.readAsDataURL(blob);
                }
                window.cancelCurrentRecord = false;
                closeRecordUI();
            };
            mediaRecorder.start();
        } catch(e) {
            alert('Помилка доступу до камери/мікрофона');
            console.error(e);
            closeRecordUI();
        }
    }

    function pauseResumeRecord() {
        if (!mediaRecorder) return;
        const btn = document.getElementById('btn-pause-record');
        const preview = document.getElementById('record-preview');
        
        if (mediaRecorder.state === 'recording') {
            mediaRecorder.pause();
            clearInterval(recordTimerInterval);
            btn.textContent = '▶';
            preview.classList.remove('recording');
        } else if (mediaRecorder.state === 'paused') {
            mediaRecorder.resume();
            recordTimerInterval = setInterval(() => {
                recordSeconds++;
                const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
                const s = String(recordSeconds % 60).padStart(2, '0');
                document.getElementById('record-timer').textContent = `${m}:${s}`;
            }, 1000);
            btn.textContent = '⏸';
            preview.classList.add('recording');
        }
    }

    function deleteRecord() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            window.cancelCurrentRecord = true;
            mediaRecorder.stop();
        } else {
            closeRecordUI();
        }
    }

    function finishAndSendRecord() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
    }

    function closeRecordUI() {
        clearInterval(recordTimerInterval);
        document.getElementById('record-overlay').style.display = 'none';
        document.getElementById('form').style.display = 'flex';
        currentRecordType = null;
    }

    function appendSingleMessage(msg, isHistoryBuild = false) { 
        if (!isHistoryBuild) {
            const msgDate = formatDateDivider(msg.timestamp);
            const dividers = document.querySelectorAll('.date-divider');
            const lastDateText = dividers.length > 0 ? dividers[dividers.length - 1].textContent : null;
            if (msgDate !== lastDateText) {
                const div = document.createElement('div');
                div.className = 'date-divider'; div.textContent = msgDate;
                messagesContainer.appendChild(div);
            }
        }

        const liWrapper = document.createElement('div');
        liWrapper.className = `msg-container ${msg.from === myNick ? 'my-wrapper' : ''}`; liWrapper.id = `msg-item-${msg.id}`;

        const li = document.createElement('li');
        if (msg.from === myNick) li.className = 'my-msg'; 

        if (['image', 'sticker', 'audio', 'video_circle'].includes(msg.type)) {
            li.classList.add('msg-transparent');
        }

        if (msg.replyTo) {
            const originalMsg = savedMessages[currentRoom]?.find(m => m.id === msg.replyTo);
            const quoteDiv = document.createElement('div'); quoteDiv.className = 'reply-quote';
            let quoteText = originalMsg ? escapeHTML(originalMsg.text) : 'Повідомлення видалено';
            if (originalMsg) {
                if (originalMsg.type === 'image') quoteText = '📷 Фотографія';
                if (originalMsg.type === 'sticker') quoteText = '🦄 Стікер';
                if (originalMsg.type === 'audio') quoteText = '🎤 Аудіо';
                if (originalMsg.type === 'video_circle') quoteText = '🔵 Відео';
            }
            quoteDiv.innerHTML = quoteText;
            quoteDiv.onclick = (e) => { e.stopPropagation(); const targetNode = document.getElementById(`msg-item-${msg.replyTo}`); if (targetNode) targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
            li.appendChild(quoteDiv);
        }

        if (msg.type === 'image') {
            const mediaWrapper = document.createElement('div');
            mediaWrapper.className = 'chat-media-wrapper'; mediaWrapper.style.padding = '4px';
            const placeholder = document.createElement('div'); placeholder.style.padding = '14px 20px'; placeholder.style.background = 'rgba(0,0,0,0.3)'; placeholder.style.borderRadius = '10px';
            placeholder.style.textAlign = 'center'; placeholder.style.cursor = 'pointer'; placeholder.style.border = '1px dashed rgba(255,255,255,0.2)';
            placeholder.innerHTML = '🖼️ <b>Відкрити медіафайл</b>';
            placeholder.onclick = (e) => { e.stopPropagation(); placeholder.style.display = 'none'; const img = document.createElement('img'); img.src = msg.text; img.className = 'chat-media-img'; mediaWrapper.appendChild(img);
            };
            mediaWrapper.appendChild(placeholder); li.appendChild(mediaWrapper);
        } else if (msg.type === 'sticker') {
            const img = document.createElement('img');
            img.src = msg.text; img.className = 'sticker-img'; li.appendChild(img);
        } else if (msg.type === 'audio') {
            const audio = document.createElement('audio');
            audio.controls = true; audio.src = msg.text; audio.className = 'audio-msg'; li.appendChild(audio);
        } else if (msg.type === 'video_circle') {
            const video = document.createElement('video');
            video.src = msg.text; video.autoplay = true; video.loop = true; video.muted = true; video.className = 'circle-video';
            video.onclick = (e) => { 
                e.stopPropagation();
                if (video.paused) { video.play(); video.muted = false; } 
                else { video.pause();
                video.muted = true; } 
            }; 
            li.appendChild(video);
        } else {
            const textNode = document.createElement('span');
            textNode.innerHTML = escapeHTML(msg.text) + (msg.edited ? ' <small style="opacity:0.6; font-size:10px; margin-left:4px;">(змінено)</small>' : '');
            li.appendChild(textNode);
        }

        const metaLine = document.createElement('div'); metaLine.className = 'msg-meta-line';
        const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}); 
        
        let checkmarksHtml = '';
        if (msg.from === myNick) {
            const isRead = msg.status === 'read';
            const checkmarks = isRead ? '✓✓' : '✓';
            checkmarksHtml = `<span class="msg-status ${isRead ? 'read' : ''}" id="status-${msg.id}">${checkmarks}</span>`;
        }

        metaLine.innerHTML = `<span class="msg-time">${timeStr}</span> ${checkmarksHtml}`; li.appendChild(metaLine); 

        const reactionsHolder = document.createElement('div');
        reactionsHolder.className = 'reactions-holder'; li.appendChild(reactionsHolder);
        const picker = document.createElement('div'); picker.className = 'reaction-picker';
        ALL_EMOJIS.slice(0, 10).forEach(em => {
            const emSpan = document.createElement('span'); emSpan.textContent = em;
            emSpan.onclick = (e) => { e.stopPropagation(); toggleMessageReaction(msg.id, em); picker.style.display = 'none'; }; picker.appendChild(emSpan);
        });
        liWrapper.appendChild(picker);

        li.onclick = (e) => { e.stopPropagation(); document.querySelectorAll('.reaction-picker').forEach(p => { if(p !== picker) p.style.display = 'none'; });
            picker.style.display = picker.style.display === 'flex' ? 'none' : 'flex'; };
        li.oncontextmenu = (e) => { 
            e.preventDefault();
            picker.style.display = 'none';
            let summary = msg.text;
            if (msg.type === 'image') summary = '📷 Фотографія';
            if (msg.type === 'sticker') summary = '🦄 Стікер';
            if (msg.type === 'audio') summary = '🎤 Аудіо';
            if (msg.type === 'video_circle') summary = '🔵 Відео';

            const menuOptions = [ { text: translations[currentLang].ctxReply, action: () => { setReplyTarget(msg.id, summary);
            } }, { text: translations[currentLang].ctxPin, action: () => { pinMessage(msg.id, summary); } } ];
            if (msg.from === myNick) {
                if (msg.type === 'text') menuOptions.push({ text: translations[currentLang].ctxEdit, action: () => { setEditTarget(msg.id, msg.text); } });
                menuOptions.push({ text: translations[currentLang].ctxDeleteMy, class: 'delete-btn', action: () => { requestSmartDeleteMessage(msg.id); } });
            }
            showContextMenu(e, menuOptions);
        }; 

        liWrapper.appendChild(li); messagesContainer.appendChild(liWrapper); renderReactionsUI(msg.id, msg.reactions, reactionsHolder);
    }

    function toggleMessageReaction(msgId, reaction) {
        const chatMsgs = savedMessages[currentRoom] || []; const msg = chatMsgs.find(m => m.id === msgId); if (!msg) return;
        if (!msg.reactions) msg.reactions = {};
        if (!msg.reactions[reaction]) msg.reactions[reaction] = [];
        if (msg.reactions[reaction].includes(myNick)) { msg.reactions[reaction] = msg.reactions[reaction].filter(u => u !== myNick); } else { msg.reactions[reaction].push(myNick);
        }
        if (msg.reactions[reaction].length === 0) delete msg.reactions[reaction];
        safeSaveHistory();
        socket.emit('message_reaction', { room: currentRoom, msgId: msgId, username: myNick, reaction: reaction, reactions: msg.reactions }); loadMessagesHistory();
    }

    function renderReactionsUI(msgId, reactionsObj, container) {
        container.innerHTML = '';
        if (!reactionsObj) return;
        for (const [reaction, users] of Object.entries(reactionsObj)) {
            if (!users || users.length === 0) continue;
            const chip = document.createElement('div'); chip.className = `reaction-chip ${users.includes(myNick) ? 'active-my' : ''}`; chip.innerHTML = `<span>${reaction}</span> <small>${users.length}</small>`;
            chip.onclick = (e) => { e.stopPropagation(); toggleMessageReaction(msgId, reaction); }; container.appendChild(chip);
        }
    }

    function requestSmartDeleteMessage(msgId) { executeLocalDeletion(msgId); socket.emit('delete_message', { room: currentRoom, msgId: msgId });
    }

    function executeLocalDeletion(msgId) {
        if (!currentRoom || !savedMessages[currentRoom]) return;
        savedMessages[currentRoom] = savedMessages[currentRoom].filter(m => m.id !== msgId); safeSaveHistory();
        if (pinnedMessages[currentRoom]) {
            pinnedMessages[currentRoom] = pinnedMessages[currentRoom].filter(p => p.id !== msgId);
            localStorage.setItem('burmalda_pinned_data', JSON.stringify(pinnedMessages)); renderPinnedBar();
        } loadMessagesHistory();
    }

    function executeLocalEdit(msgId, newText) {
        if (!currentRoom || !savedMessages[currentRoom]) return;
        const msg = savedMessages[currentRoom].find(m => m.id === msgId); if (msg) { msg.text = newText; msg.edited = true; safeSaveHistory();
        }
        loadMessagesHistory();
    }

    function loadMessagesHistory() { 
        if (!currentRoom) return;
        messagesContainer.innerHTML = ''; 
        const history = savedMessages[currentRoom] || []; 
        let lastDate = null;
        history.forEach(msg => { 
            const msgDate = formatDateDivider(msg.timestamp);
            if (msgDate !== lastDate) {
                const div = document.createElement('div'); div.className = 'date-divider'; div.textContent = msgDate;
                messagesContainer.appendChild(div);
                lastDate = msgDate;
            }
            appendSingleMessage(msg, true); 
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    messagesContainer.onscroll = () => {
        const btn = document.getElementById('scroll-to-bottom-btn');
        if (messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight > 300) {
            btn.style.display = 'flex';
        } else {
            btn.style.display = 'none';
        }
    };

    document.getElementById('form').onsubmit = (e) => { 
        e.preventDefault();
        const val = input.value.trim(); if (!val || !currentRoom) return; 

        if (editTargetMsgId) { socket.emit('edit_message', { room: currentRoom, msgId: editTargetMsgId, newText: val });
            executeLocalEdit(editTargetMsgId, val); cancelAction(); return; }
        
        const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const msgPayload = { id: msgId, room: currentRoom, from: myNick, to: currentActiveChatPartner, text: val, type: 'text', replyTo: replyTargetMsgId, timestamp: Date.now(), reactions: {}, status: 'sent', edited: false };
        if (!activeChats.includes(currentActiveChatPartner)) { activeChats.push(currentActiveChatPartner); saveActiveChats(); } 
        if (!savedMessages[currentRoom]) savedMessages[currentRoom] = [];
        savedMessages[currentRoom].push(msgPayload);
        safeSaveHistory(); 

        socket.emit('chat_message', msgPayload); appendSingleMessage(msgPayload);
        audioSend.play().catch(e=>console.log(e)); 
        cancelAction(); messagesContainer.scrollTop = messagesContainer.scrollHeight; renderChatsList(); 
    };

    let typingTimeout = null;
    let lastTypingEmit = 0;
    input.oninput = () => { 
        if (!currentRoom) return;
        const now = Date.now();
        if (now - lastTypingEmit > 2000) {
            socket.emit('typing', { room: currentRoom, user: myNick, isTyping: true });
            lastTypingEmit = now;
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => { 
            socket.emit('typing', { room: currentRoom, user: myNick, isTyping: false }); 
            lastTypingEmit = 0;
        }, 1500);
    };

    function showContextMenu(e, options) { 
        contextMenu.innerHTML = '';
        options.forEach(opt => { const b = document.createElement('button'); b.textContent = opt.text; if (opt.class) b.className = opt.class; b.onclick = () => { contextMenu.style.display = 'none'; opt.action(); }; contextMenu.appendChild(b); });
        contextMenu.style.display = 'block';
        const rect = contextMenu.getBoundingClientRect();
        let x = e.clientX, y = e.clientY;
        if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 10;
        if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 10;
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
    }

    document.onclick = (e) => { 
        if(!e.target.closest('#btn-sticker') && !e.target.closest('#sticker-menu')) stickerMenu.classList.remove('active');
        if(!e.target.closest('.search-trigger-btn') && !e.target.closest('#chat-options-menu') && !e.target.closest('.search-container')) {
            document.getElementById('chat-options-menu').style.display = 'none';
            searchDropdown.style.display = 'none';
        }
        contextMenu.style.display = 'none'; 
        document.querySelectorAll('.reaction-picker').forEach(p => p.style.display = 'none'); 
    };
    // --- ПОВНІСТЮ НОВІ ДЗВІНКИ ЧЕРЕЗ PEERJS ---
    let myPeer = null;
    let localStream = null;
    let currentCall = null;
    let isCurrentCallVideo = false;

    function initPeerJS(username) {
        if (myPeer) return;
        myPeer = new Peer(username);

        myPeer.on('open', (id) => {
            console.log('[PeerJS] Готовий до роботи, ID:', id);
        });
        // Вхідний дзвінок
        myPeer.on('call', async (call) => {
            currentCall = call;
            isCurrentCallVideo = true;

            document.getElementById('call-modal').classList.add('active');
            document.getElementById('call-status-text').textContent = `Вхідний дзвінок від ${getVisibleName(call.peer)}...`;
            
            document.getElementById('btn-accept-call').style.display = 'inline-block';
            document.getElementById('toggle-mic-btn').style.display = 'none';
            document.getElementById('toggle-cam-btn').style.display = 'none';
            document.getElementById('call-video-container').style.display = 'none';
            
            startRingtone();

            document.getElementById('btn-accept-call').onclick = async () => {
                stopRingtone();
                document.getElementById('btn-accept-call').style.display = 'none';
                document.getElementById('toggle-mic-btn').style.display = 'inline-block';
                document.getElementById('toggle-cam-btn').style.display = 'inline-block';
                document.getElementById('call-video-container').style.display = 'flex';
                document.getElementById('call-status-text').textContent = 'З\'єднання...';

                try {
                    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: {facingMode: "user"} });
                    document.getElementById('local-video').srcObject = localStream;
                    
                    call.answer(localStream);
                    
                    call.on('stream', (remoteStream) => {
                        document.getElementById('call-status-text').textContent = 'Розмова...';
                        document.getElementById('remote-video').srcObject = remoteStream;
                    });
                    call.on('close', () => { endCall(false); });
                } catch (err) {
                    alert('Помилка камери/мікрофона: ' + err.message);
                    endCall(true);
                }
            };
        });
        myPeer.on('error', (err) => {
            console.error('[PeerJS Error]:', err);
        });
    }

    async function startCall(isVideo) {
        if (!currentActiveChatPartner || !onlineUsers.includes(currentActiveChatPartner)) {
            alert("Користувач не в мережі!");
            return;
        }
        
        isCurrentCallVideo = isVideo;
        document.getElementById('call-modal').classList.add('active');
        document.getElementById('call-status-text').textContent = `Дзвінок до ${getVisibleName(currentActiveChatPartner)}...`;
        
        document.getElementById('btn-accept-call').style.display = 'none';
        document.getElementById('toggle-mic-btn').style.display = 'inline-block';
        document.getElementById('toggle-cam-btn').style.display = isVideo ? 'inline-block' : 'none';
        document.getElementById('call-video-container').style.display = isVideo ? 'flex' : 'none';

        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo ? {facingMode: "user"} : false });
            document.getElementById('local-video').srcObject = localStream;
            
            currentCall = myPeer.call(currentActiveChatPartner, localStream);
            
            currentCall.on('stream', (remoteStream) => {
                document.getElementById('call-status-text').textContent = 'Розмова...';
                if (!isVideo) document.getElementById('call-video-container').style.display = 'flex';
                document.getElementById('remote-video').srcObject = remoteStream;
            });
            currentCall.on('close', () => { endCall(false); });
            
        } catch(e) {
            alert('Помилка доступу до камери або мікрофона');
            endCall(true);
        }
    }

    function toggleCallMic() {
        if (localStream) {
            const track = localStream.getAudioTracks()[0];
            if(track) {
                track.enabled = !track.enabled;
                const micBtn = document.getElementById('toggle-mic-btn');
                if(!track.enabled) { micBtn.innerText = "🔇 Мікр: Вимк"; micBtn.classList.add('active-control');
                } 
                else { micBtn.innerText = "🎤 Мікр: Увімк";
                micBtn.classList.remove('active-control'); }
            }
        }
    }

    function toggleCallCam() {
        if (localStream) {
            const track = localStream.getVideoTracks()[0];
            if(track) {
                track.enabled = !track.enabled;
                const camBtn = document.getElementById('toggle-cam-btn');
                if(!track.enabled) { camBtn.innerText = "📷 Камера: Вимк"; camBtn.classList.add('active-control');
                } 
                else { camBtn.innerText = "📷 Камера: Увімк";
                camBtn.classList.remove('active-control'); }
            }
        }
    }

    function endCall(notifyPartner = true) {
        stopRingtone();
        if (currentCall) {
            currentCall.close();
            currentCall = null;
        }
        
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        
        document.getElementById('local-video').srcObject = null;
        document.getElementById('remote-video').srcObject = null;
        document.getElementById('call-modal').classList.remove('active');
        document.getElementById('call-video-container').style.display = 'none';
        
        document.getElementById('toggle-mic-btn').innerText = "🎤 Мікр: Увімк";
        document.getElementById('toggle-mic-btn').classList.remove('active-control');
        document.getElementById('toggle-cam-btn').innerText = "📷 Камера: Увімк";
        document.getElementById('toggle-cam-btn').classList.remove('active-control');
    }
    // ------------------------------------------

    // --- SOCKET EVENTS ---
    socket.on('connect', () => { 
        socket.emit('online_ping', { username: myNick }); 
        socket.emit('sync_contacts', { user: myNick, chats: activeChats });
    });
    socket.on('online_list', (users) => { 
        onlineUsers = users; 
        applyLanguage(); 
        if (myNick && myNick !== 'Анонім') {
            initPeerJS(myNick);
        }
    });
    socket.on('contacts_synced', (serverChats) => {
        if (Array.isArray(serverChats)) {
            activeChats = serverChats;
            localStorage.setItem('burmalda_chat_list', JSON.stringify(activeChats));
            renderChatsList();
        }
    });
    socket.on('user_blocked_you', (data) => {
        if (data.room === currentRoom && data.blocked) {
            input.disabled = true; input.placeholder = translations[currentLang].blockedMeText || "Цей користувач вас заблокував."; button.disabled = true;
        }
    });
    socket.on('chat_message', (msg) => { 
        if (chatSettings[myNick] && chatSettings[myNick].blocked) return; 
        if (chatSettings[msg.from]?.blocked) return;
        
        if (!localProfiles[msg.from]) {
            socket.emit('request_profile', { username: msg.from });
        }

        if (msg.room !== currentRoom) {
            if (!activeChats.includes(msg.from)) { activeChats.push(msg.from); saveActiveChats(); }
  
            glowingChats[msg.from] = true; localStorage.setItem('burmalda_glow_chats', JSON.stringify(glowingChats));
            
            if (!savedMessages[msg.room]) savedMessages[msg.room] = [];
            if (!savedMessages[msg.room].some(m => m.id === msg.id)) { savedMessages[msg.room].push(msg); safeSaveHistory(); }
            renderChatsList();
            
            if (!chatSettings[msg.from]?.muted) audioReceiveOutChat.play().catch(e=>console.log(e));

        } else {
            if (!activeChats.includes(msg.from)) { activeChats.push(msg.from);
            saveActiveChats(); renderChatsList(); }
            if (!savedMessages[currentRoom]) savedMessages[currentRoom] = [];
            if (!savedMessages[currentRoom].some(m => m.id === msg.id)) { 
                savedMessages[currentRoom].push(msg);
                safeSaveHistory();
                appendSingleMessage(msg); messagesContainer.scrollTop = messagesContainer.scrollHeight; 
                if (msg.from !== myNick) socket.emit('mark_read', { room: currentRoom, reader: myNick });
                if (!chatSettings[msg.from]?.muted) audioReceiveInChat.play().catch(e=>console.log(e));
            } 
        }
    });
    socket.on('messages_read', (data) => {
        if (savedMessages[data.room]) {
            let updated = false;
            savedMessages[data.room].forEach(msg => {
                if (msg.from !== data.reader && msg.status !== 'read') {
                    msg.status = 'read'; updated = true;
                    const statusEl = document.getElementById(`status-${msg.id}`);
                    if (statusEl) { statusEl.textContent = '✓✓'; statusEl.classList.add('read'); }
                }
            });
            if (updated) safeSaveHistory();
        }
    });
    
    socket.on('edit_message', (data) => {
        if (currentRoom === data.room) { executeLocalEdit(data.msgId, data.newText); } 
        else if (savedMessages[data.room]) {
            const msg = savedMessages[data.room].find(m => m.id === data.msgId);
            if (msg) { msg.text = data.newText; msg.edited = true; safeSaveHistory(); }
        }
    });
    socket.on('delete_message', (data) => {
        if (currentRoom === data.room) { executeLocalDeletion(data.msgId); } 
        else if (savedMessages[data.room]) {
            savedMessages[data.room] = savedMessages[data.room].filter(m => m.id !== data.msgId); safeSaveHistory();
        }
    });
    socket.on('message_reaction', (data) => {
        if (savedMessages[data.room]) {
            const msg = savedMessages[data.room].find(m => m.id === data.msgId);
            if (msg) { msg.reactions = data.reactions || {}; safeSaveHistory(); if (currentRoom === data.room) loadMessagesHistory(); }
        }
    });
    socket.on('pin_message', (data) => {
        const room = data.room;
        if (!Array.isArray(pinnedMessages[room])) pinnedMessages[room] = [];
        
        if (data.action === 'add') {
            if (!pinnedMessages[room].some(p => p.id === data.pinData.id)) pinnedMessages[room].push(data.pinData);
        } else if (data.action === 'remove') {
            pinnedMessages[room] = pinnedMessages[room].filter(p => p.id !== data.pinData.id);
        } else if (data.pinned) {
            pinnedMessages[room] = data.pinned;
        }
        localStorage.setItem('burmalda_pinned_data', JSON.stringify(pinnedMessages));
        if (room === currentRoom) {
            currentPinIndex = Math.max(0, pinnedMessages[room].length - 1);
            renderPinnedBar();
        }
    });
    socket.on('typing_status', (data) => { 
        if (currentRoom === data.room && data.user !== myNick) { 
            typingStatusEl.textContent = `${getVisibleName(data.user)} ${translations[currentLang].typingText}`; typingStatusEl.style.display = data.isTyping ? 'block' : 'none'; 
        }
        
        const bioEl = document.getElementById(`bio-${data.user}`);
        if (bioEl) {
            if (data.isTyping) {
                if (!bioEl.dataset.orig) bioEl.dataset.orig = bioEl.innerText;
                bioEl.innerText = translations[currentLang].typingText;
                bioEl.style.color = '#4cd964';
            } else {
                bioEl.innerText = bioEl.dataset.orig || '';
                bioEl.style.color = 'var(--text-muted)';
                delete bioEl.dataset.orig;
            }
        }
    });
    socket.on('profile_broadcast', (profileUpdate) => { 
        localProfiles[profileUpdate.username] = profileUpdate.data; localStorage.setItem('burmalda_profiles_data', JSON.stringify(localProfiles)); 
        if (profileUpdate.username === currentActiveChatPartner || profileUpdate.username === myNick) { 
            const isOnline = onlineUsers.includes(currentActiveChatPartner);
            if (currentActiveChatPartner) { chatTitleText.innerHTML = `${getAvatarHTML(currentActiveChatPartner)} <span>${escapeHTML(getVisibleName(currentActiveChatPartner))} ${isOnline ? '<small style="color:#4cd964; font-size:11px;">●</small>' : ''}</span>`; }
        } renderChatsList(); 
    });
    function logout() { localStorage.removeItem('burmalda_auth_token'); window.location.href = '/'; }

    if (window.visualViewport) { 
        window.visualViewport.addEventListener('resize', () => { 
            const containerEl = document.getElementById('input-panel-container'); 
            if (window.visualViewport.height < window.innerHeight) { 
                const keyboardHeight = window.innerHeight - window.visualViewport.height; 
                containerEl.style.position = 'fixed'; 

                containerEl.style.bottom = keyboardHeight + 'px'; messagesContainer.style.paddingBottom = '90px'; setTimeout(() => { messagesContainer.scrollTop = messagesContainer.scrollHeight; }, 60); 
            } else { containerEl.style.position = 'relative'; containerEl.style.bottom = '0px'; messagesContainer.style.paddingBottom = '20px'; } 
        });
    }

    applyLanguage();
    const initialChatPartner = urlParams.get('chat'); if (initialChatPartner && activeChats.includes(initialChatPartner)) openChatWith(initialChatPartner);
 

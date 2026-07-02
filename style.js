const translations = {
    uk: { searchPlaceholder: "Введіть ім'я...", dialogsTitle: "Ваші діалоги", placeholderText: "BurmaldaGram Premium<br><span style='font-size: 13px; color: var(--text-muted);'>Оберіть чат 🔍</span>", backBtn: "⬅ Назад", inputPlaceholder: "Напишіть повідомлення...", btnSend: "Надіслати", settingsTitle: "⚙️ Налаштування", profileTitle: "👤 Профіль", profile: "Юзернейм:", profileName: "Нік:", status: "Статус:", online: "в мережі", offline: "офлайн", loginTime: "Вхід:", logoutBtn: "Вийти 🚪", emptyList: "Список порожній", selfChatError: "Не можна створювати чат із собою!", ctxReply: "Відповісти ↩", ctxEdit: "Редагувати ✏️", userNotFound: "Не знайдено!", ctxPin: "Закріпити повідомлення 📌", ctxUnpin: "Відкріпити повідомлення 🔓", ctxDeleteMy: "Видалити (своє) 🗑", chatStatusOnline: "● онлайн", chatStatusOffline: "офлайн", typingText: "пише...", uploadBtn: "📁 Завантажити", bioPlaceholder: "Про себе:", bioEmpty: "Пусто", replyPrefix: "Відповідь на: ", pinnedLabel: "Закріплено", blockedMeText: "Цей користувач вас заблокував.", themeTitle: "Тема оформлення:" },
    ru: { searchPlaceholder: "Введите имя...", dialogsTitle: "Диалоги", placeholderText: "BurmaldaGram Premium", backBtn: "⬅ Назад", inputPlaceholder: "Напишите...", btnSend: "Отправить", settingsTitle: "⚙️ Настройки", profileTitle: "👤 Профиль", profile: "Юзернейм:", profileName: "Ник:", status: "Статус:", online: "в сети", offline: "офлайн", loginTime: "Вход:", logoutBtn: "Выйти 🚪", emptyList: "Пусто", selfChatError: "Нельзя с собой!", ctxReply: "Ответить ↩", ctxEdit: "Изменить ✏️", userNotFound: "Не найден!", ctxPin: "Закрепить 📌", ctxUnpin: "Открепить 🔓", ctxDeleteMy: "Удалить 🗑", chatStatusOnline: "● онлайн", chatStatusOffline: "офлайн", typingText: "печатает...", uploadBtn: "📁 Загрузить", bioPlaceholder: "О себе:", bioEmpty: "Пусто", replyPrefix: "Ответ: ", pinnedLabel: "Закреплено", blockedMeText: "Этот пользователь вас заблокировал.", themeTitle: "Тема оформления:" },
    en: { searchPlaceholder: "Search...", dialogsTitle: "Chats", placeholderText: "BurmaldaGram Premium", backBtn: "⬅ Back", inputPlaceholder: "Message...", btnSend: "Send", settingsTitle: "⚙️ Settings", profileTitle: "👤 Profile", profile: "ID:", profileName: "Name:", status: "Status:", online: "online", offline: "offline", loginTime: "Login:", logoutBtn: "Log out 🚪", emptyList: "Empty", selfChatError: "Can't chat with yourself!", ctxReply: "Reply ↩", ctxEdit: "Edit ✏️", userNotFound: "Not found!", ctxPin: "Pin 📌", ctxUnpin: "Unpin 🔓", ctxDeleteMy: "Delete 🗑", chatStatusOnline: "● online", chatStatusOffline: "offline", typingText: "typing...", uploadBtn: "📁 Upload", bioPlaceholder: "Bio:", bioEmpty: "Empty", replyPrefix: "Reply: ", pinnedLabel: "Pinned", blockedMeText: "You are blocked by this user.", themeTitle: "Theme:" }
};

const GLOW_COLORS = {
    'green': '#4cd964',
    'red': '#ff3b30',
    'blue': '#0088cc',
    'dark': '#333333',
    'white': '#ffffff',
    'yellow': '#ffcc00'
};

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
}

function getStorageKey(key) { return `${key}_${myNick}`; }

let currentLang = localStorage.getItem('burmalda_lang') || 'uk';
let currentTheme = localStorage.getItem('burmalda_theme') || 'theme-dark';
let chatBackgroundImage = localStorage.getItem(getStorageKey('burmalda_bg_image')) || '';
let chatBackgroundBlur = localStorage.getItem(getStorageKey('burmalda_bg_blur')) || '0';

document.body.className = currentTheme;
const themeSelectEl = document.getElementById('theme-select');
if (themeSelectEl) themeSelectEl.value = currentTheme;

function applyCustomBackground() {
    const mainChat = document.getElementById('chat-main');
    if (chatBackgroundImage && mainChat) {
        mainChat.style.backgroundImage = `url(${chatBackgroundImage})`;
        mainChat.style.backgroundSize = 'cover';
        mainChat.style.backgroundPosition = 'center';
        mainChat.style.boxShadow = 'inset 0 0 80px rgba(0,0,0,0.8), inset 0 0 30px rgba(255,255,255,0.1)';
        mainChat.style.backdropFilter = `blur(${chatBackgroundBlur}px)`;
        mainChat.style.webkitBackdropFilter = `blur(${chatBackgroundBlur}px)`; 
    } else if (mainChat) {
        mainChat.style.backgroundImage = '';
        mainChat.style.boxShadow = '';
        mainChat.style.backdropFilter = '';
        mainChat.style.webkitBackdropFilter = '';
    }
}

function applyLanguage() { 
    const t = translations[currentLang];
    const langSelect = document.getElementById('lang-select');
    if (langSelect) langSelect.value = currentLang;
    
    const myProfileName = document.getElementById('my-profile-name');
    if (myProfileName) myProfileName.innerHTML = `${getAvatarHTML(myNick)} <span>${getVisibleName(myNick)}</span>`;
    
    if (searchInput) searchInput.placeholder = t.searchPlaceholder; 
    const lblDialogs = document.getElementById('lbl-dialogs');
    if (lblDialogs) lblDialogs.textContent = t.dialogsTitle; 
    
    const placeholderText = document.getElementById('placeholder-text');
    if (placeholderText) placeholderText.innerHTML = t.placeholderText; 
    
    const btnBack = document.getElementById('btn-back');
    if (btnBack) btnBack.textContent = t.backBtn;
    
    if (input) input.placeholder = t.inputPlaceholder; 
    if (button) button.textContent = t.btnSend;
    
    const lblProfileName = document.getElementById('lbl-profile-name');
    if (lblProfileName) lblProfileName.textContent = t.profileName; 
    const lblProfile = document.getElementById('lbl-profile');
    if (lblProfile) lblProfile.textContent = t.profile; 
    const lblStatus = document.getElementById('lbl-status');
    if (lblStatus) lblStatus.textContent = t.status; 
    const lblBioTitle = document.getElementById('lbl-bio-title');
    if (lblBioTitle) lblBioTitle.textContent = t.bioPlaceholder;
    const lblTime = document.getElementById('lbl-time');
    if (lblTime) lblTime.textContent = t.loginTime; 
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.textContent = t.logoutBtn;
    const lblUploadBtn = document.getElementById('lbl-upload-btn');
    if (lblUploadBtn) lblUploadBtn.textContent = t.uploadBtn; 
    const lblThemeTitle = document.getElementById('lbl-theme-title');
    if (lblThemeTitle) lblThemeTitle.textContent = t.themeTitle;
    
    if (settingsModal && settingsModal.classList.contains('active')) { 
        const infoNickEl = document.getElementById('info-nick');
        if (infoNickEl) {
            const openedNick = infoNickEl.textContent;
            const isMe = (openedNick === myNick);
            const modalTitleText = document.getElementById('modal-title-text');
            if (modalTitleText) modalTitleText.textContent = isMe ? t.settingsTitle : t.profileTitle; 
            const isOnline = onlineUsers.includes(openedNick);
            const statusLabel = document.getElementById('lbl-online-status'); 
            if (statusLabel) {
                statusLabel.textContent = isOnline ? t.online : t.offline; 
                statusLabel.style.color = isOnline ? '#4cd964' : '#ff3b30';
            }
        }
    } 
    if (typeof renderChatsList === 'function') renderChatsList(); 
    if (typeof loadMessagesHistory === 'function') loadMessagesHistory(); 
    if (typeof renderStickersList === 'function') renderStickersList();
    applyCustomBackground();
    if (typeof updateChatTitle === 'function') updateChatTitle();
}

function changeLanguage(lang) { currentLang = lang; localStorage.setItem('burmalda_lang', lang); applyLanguage(); }
function changeTheme(themeVal) { currentTheme = themeVal; document.body.className = themeVal; localStorage.setItem('burmalda_theme', themeVal); }

function applyBanner(username) {
    const uData = localProfiles[username] || {};
    const bannerEl = document.getElementById('profile-banner-view');
    if (bannerEl) {
        if (uData.banner) {
            bannerEl.style.backgroundImage = `url(${uData.banner})`;
            bannerEl.style.backgroundSize = 'cover';
            bannerEl.style.backgroundPosition = 'center';
            bannerEl.style.height = '120px';
            bannerEl.style.borderRadius = '8px';
            bannerEl.style.marginBottom = '10px';
        } else {
            bannerEl.style.backgroundImage = 'none';
            bannerEl.style.height = '0px';
            bannerEl.style.marginBottom = '0px';
        }
    }
}

window.setBackgroundImage = function(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    compressImage(file, (compressedBase64) => {
        chatBackgroundImage = compressedBase64;
        localStorage.setItem(getStorageKey('burmalda_bg_image'), chatBackgroundImage);
        applyCustomBackground();
    });
};

window.clearBackgroundImage = function() {
    chatBackgroundImage = '';
    localStorage.removeItem(getStorageKey('burmalda_bg_image'));
    applyCustomBackground();
};

window.setBackgroundBlur = function(val) {
    chatBackgroundBlur = val;
    localStorage.setItem(getStorageKey('burmalda_bg_blur'), chatBackgroundBlur);
    applyCustomBackground();
};

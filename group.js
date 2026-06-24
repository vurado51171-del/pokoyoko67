// group.js - Управління групами, каналами та ієрархією рангів БурмалдаGram Premium
(function() {
    // Ієрархія рангів та рівнів доступу для груп та каналів
    window.BURMALDA_ROLES = {
        OWNER: { level: 6, id: 'owner', name: '👑 Головний Овнер' },
        CO_OWNER: { level: 5, id: 'co_owner', name: '⚡ Полуовнер / Допоміжник' },
        SENIOR_ADMIN: { level: 4, id: 'senior_admin', name: '⭐ Старший адмін' },
        MIDDLE_ADMIN: { level: 3, id: 'middle_admin', name: '🛡️ Середній адмін' },
        JUNIOR_ADMIN: { level: 2, id: 'junior_admin', name: '🔰 Молодший адмін' },
        MEMBER: { level: 1, id: 'member', name: '👤 Простий учасник' }
    };

    // Глобальний контекст поточної відкритої групи
    window.currentGroupContext = null;

    // Ініціалізація модуля та реєстрація сокет-слухачів
    window.initGroupModule = function() {
        if (!window.socket) return;

        // Слухаємо оновлення метаданих групи від сервера
        window.socket.on('group_updated', function(group) {
            if (window.currentChatPartner === group.id) {
                window.currentGroupContext = group;
                window.applyGroupCustomization(group);
            }
            if (typeof window.renderChatsList === 'function') {
                window.renderChatsList();
            }
        });

        // Привітання при вході нового учасника в чат
        window.socket.on('group_user_joined', function(data) {
            if (window.currentChatPartner === data.groupId && data.greeting) {
                if (typeof window.appendSystemMessage === 'function') {
                    window.appendSystemMessage(data.greeting);
                }
            }
        });
    };

    // Відкриття модального вікна створення Групи або Каналу
    window.openCreateGroupModal = function() {
        let modal = document.getElementById('create-group-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'create-group-modal';
            modal.className = 'modal-overlay';
            modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:2000;';
            
            modal.innerHTML = `
                <div class="modal-content" style="background:var(--bg-panel); border:1px solid var(--border-color); padding:20px; border-radius:12px; width:90%; max-width:400px; color:var(--text-main);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <h3 style="margin:0; font-size:18px;">🛠️ Створити Групу / Канал</h3>
                        <button onclick="window.closeCreateGroupModal()" style="background:none; border:none; color:var(--text-muted); font-size:24px; cursor:pointer; line-height:1;">&times;</button>
                    </div>
                    <div style="margin-bottom:12px;">
                        <label style="display:block; margin-bottom:5px; font-size:13px; color:var(--text-muted);">Назва:</label>
                        <input type="text" id="new-group-name" style="width:100%; padding:10px; background:var(--bg-input); border:1px solid var(--border-color); border-radius:6px; color:white; box-sizing:border-box;" placeholder="Назва вашого проекту...">
                    </div>
                    <div style="margin-bottom:12px;">
                        <label style="display:block; margin-bottom:5px; font-size:13px; color:var(--text-muted);">Тип простору:</label>
                        <select id="new-group-type" style="width:100%; padding:10px; background:var(--bg-input); border:1px solid var(--border-color); border-radius:6px; color:white; box-sizing:border-box;" onchange="window.toggleGroupTypeFields()">
                            <option value="group">💬 Група (Спільний чат для всіх)</option>
                            <option value="channel">📢 Канал (Публікації тільки від Адмінів)</option>
                        </select>
                    </div>
                    <div style="margin-bottom:12px;">
                        <label style="display:block; margin-bottom:5px; font-size:13px; color:var(--text-muted);">Доступність:</label>
                        <select id="new-group-privacy" style="width:100%; padding:10px; background:var(--bg-input); border:1px solid var(--border-color); border-radius:6px; color:white; box-sizing:border-box;">
                            <option value="public">🌍 Публічна (Для всіх користувачів)</option>
                            <option value="private">🔒 Приватна (Тільки по запрошенню)</option>
                        </select>
                    </div>
                    <div id="channel-linked-chat-div" style="margin-bottom:12px; display:none;">
                        <label style="display:block; margin-bottom:5px; font-size:13px; color:var(--text-muted);">Прив'язати чат для обговорень (ID групи):</label>
                        <input type="text" id="new-group-linked-chat" style="width:100%; padding:10px; background:var(--bg-input); border:1px solid var(--border-color); border-radius:6px; color:white; box-sizing:border-box;" placeholder="g_xxxxxx (необов'язково)">
                    </div>
                    <button onclick="window.submitCreateGroup()" style="width:100%; padding:12px; background:var(--accent); border:none; border-radius:6px; color:white; font-weight:bold; cursor:pointer; margin-top:10px; transition: background 0.2s;">Створити простір</button>
                </div>
            `;
            document.body.appendChild(modal);
        }
        modal.style.display = 'flex';
    };

    window.closeCreateGroupModal = function() {
        const modal = document.getElementById('create-group-modal');
        if (modal) modal.style.display = 'none';
    };

    window.toggleGroupTypeFields = function() {
        const type = document.getElementById('new-group-type').value;
        const linkedDiv = document.getElementById('channel-linked-chat-div');
        if (linkedDiv) {
            linkedDiv.style.display = (type === 'channel') ? 'block' : 'none';
        }
    };

    window.submitCreateGroup = function() {
        const name = document.getElementById('new-group-name').value.trim();
        const type = document.getElementById('new-group-type').value;
        const privacy = document.getElementById('new-group-privacy').value;
        const linkedChat = document.getElementById('new-group-linked-chat') ? document.getElementById('new-group-linked-chat').value.trim() : "";

        if (!name) {
            alert("Помилка: Будь ласка, вкажіть назву групи або каналу!");
            return;
        }

        const payload = {
            name: name,
            type: type,
            privacy: privacy,
            linkedChat: linkedChat,
            owner: window.currentUser // Використовує авторизованого юзера з основного скрипта
        };

        window.socket.emit('create_group', payload);
        window.closeCreateGroupModal();
    };

    // Отримання поточної ролі юзера у конкретному просторі
    window.getGroupUserRole = function(group, username) {
        if (!group || !username) return null;
        if (group.owner === username) return window.BURMALDA_ROLES.OWNER;
        
        if (group.settings && group.settings.admins && group.settings.admins[username]) {
            const roleId = group.settings.admins[username];
            for (let key in window.BURMALDA_ROLES) {
                if (window.BURMALDA_ROLES[key].id === roleId) return window.BURMALDA_ROLES[key];
            }
        }
        
        if (group.members && group.members.includes(username)) return window.BURMALDA_ROLES.MEMBER;
        return null;
    };

    // Перевірка прав на виконання дій (публікація, кастомізація, управління адмінами)
    window.canUserPerformAction = function(username, group, action) {
        const userRole = window.getGroupUserRole(group, username);
        if (!userRole) return false;

        // Власник має повний абсолютний доступ до всього
        if (userRole.id === 'owner') return true;

        if (group.type === 'channel') {
            // В каналах публікувати контент та змінювати налаштування можуть тільки Молодші адміни (рівень 2) і вище
            if (action === 'send_message' || action === 'edit_settings') {
                return userRole.level >= window.BURMALDA_ROLES.JUNIOR_ADMIN.level;
            }
            // Керувати правами інших адмінів може тільки Полуовнер/Допоміжник
            if (action === 'manage_admins') {
                return userRole.level >= window.BURMALDA_ROLES.CO_OWNER.level;
            }
        } else {
            // Конфігурація для Груп (чатів)
            if (action === 'send_message') return true; // Писати можуть всі учасники
            if (action === 'edit_settings') {
                return userRole.level >= window.BURMALDA_ROLES.SENIOR_ADMIN.level; // Від Старшого адміна
            }
            if (action === 'manage_admins') {
                return userRole.level >= window.BURMALDA_ROLES.CO_OWNER.level; // Від Полуовнера
            }
        }
        return false;
    };

    // Динамічне застосування стилів, шпалер та банерів групи до шапки та фону чату
    window.applyGroupCustomization = function(group) {
        if (!group) return;
        const settings = group.settings || {};
        
        // 1. Опис та колір опису
        const bioEl = document.getElementById('chat-user-bio');
        if (bioEl) {
            bioEl.innerText = settings.description || "Опис відсутній";
            bioEl.style.color = settings.descriptionColor || "var(--text-muted)";
        }

        // 2. Встановлення фонового баннера в шапку чату
        const headerEl = document.querySelector('.chat-header');
        if (headerEl) {
            if (settings.banner) {
                headerEl.style.backgroundImage = `url(${settings.banner})`;
                headerEl.style.backgroundSize = 'cover';
                headerEl.style.backgroundPosition = 'center';
            } else {
                headerEl.style.backgroundImage = 'none';
                headerEl.style.background = 'var(--bg-header)';
            }
        }

        // 3. Індивідуальні шпалери (обої) всередині чату цієї групи
        const chatArea = document.getElementById('chat-messages');
        if (chatArea) {
            if (settings.wallpaper) {
                chatArea.style.backgroundImage = `url(${settings.wallpaper})`;
                chatArea.style.backgroundSize = 'cover';
                chatArea.style.backgroundPosition = 'center';
            } else {
                const globalBg = localStorage.getItem('burmalda_bg_image') || 'none';
                chatArea.style.backgroundImage = globalBg !== 'none' ? `url(${globalBg})` : 'none';
            }
        }

        // 4. Перевірка та блокування поля введення для звичайних користувачів у каналах
        const inputEl = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        if (inputEl) {
            if (group.type === 'channel' && !window.canUserPerformAction(window.currentUser, group, 'send_message')) {
                inputEl.disabled = true;
                inputEl.placeholder = "🔒 Публікація дозволена тільки адміністраторам...";
                if (sendBtn) sendBtn.style.display = 'none';
            } else {
                inputEl.disabled = false;
                inputEl.placeholder = "Напишіть повідомлення...";
                if (sendBtn) sendBtn.style.display = 'block';
            }
        }
    };

    // Модальне вікно повної кастомізації та налаштування рангів адміністрації
    window.openGroupSettingsModal = function() {
        if (!window.currentGroupContext) {
            alert("Помилка: Поточний чат не є групою або каналом.");
            return;
        }

        const group = window.currentGroupContext;
        const settings = group.settings || {};
        const canEdit = window.canUserPerformAction(window.currentUser, group, 'edit_settings');

        let modal = document.getElementById('group-settings-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'group-settings-modal';
            modal.className = 'modal-overlay';
            modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:2000;';
            document.body.appendChild(modal);
        }

        // Рендеринг списку діючих адміністраторів
        let adminsListHtml = '';
        if (settings.admins) {
            for (let adminName in settings.admins) {
                let roleId = settings.admins[adminName];
                let roleName = 'Адміністратор';
                for (let r in window.BURMALDA_ROLES) {
                    if (window.BURMALDA_ROLES[r].id === roleId) roleName = window.BURMALDA_ROLES[r].name;
                }
                adminsListHtml += `<li style="font-size:13px; margin-bottom:5px; color:var(--text-main);">🛡️ ${adminName} — <b>${roleName}</b></li>`;
            }
        }

        modal.innerHTML = `
            <div class="modal-content" style="background:var(--bg-panel); border:1px solid var(--border-color); padding:20px; border-radius:12px; width:95%; max-width:460px; color:var(--text-main); max-height:85vh; overflow-y:auto; box-sizing:border-box;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                    <h3 style="margin:0; font-size:18px;">⚙️ Керування: ${group.name}</h3>
                    <button onclick="window.closeGroupSettingsModal()" style="background:none; border:none; color:var(--text-muted); font-size:24px; cursor:pointer; line-height:1;">&times;</button>
                </div>

                <div style="border-bottom:1px solid var(--border-color); padding-bottom:12px; margin-bottom:12px;">
                    <h4 style="margin:0 0 10px 0; font-size:14px; color:var(--accent);">🎨 Стилізація та Дизайн</h4>
                    <div style="margin-bottom:8px;">
                        <label style="font-size:12px; color:var(--text-muted);">Опис простору:</label>
                        <textarea id="edit-group-desc" style="width:100%; background:var(--bg-input); color:white; border:1px solid var(--border-color); border-radius:6px; padding:8px; box-sizing:border-box; resize:vertical;" ${!canEdit ? 'disabled' : ''}>${settings.description || ''}</textarea>
                    </div>
                    <div style="margin-bottom:8px;">
                        <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">Колір тексту опису:</label>
                        <input type="color" id="edit-group-desc-color" value="${settings.descriptionColor || '#aaaaaa'}" ${!canEdit ? 'disabled' : ''}>
                    </div>
                    <div style="margin-bottom:8px;">
                        <label style="font-size:12px; color:var(--text-muted);">URL баннера в шапку чату:</label>
                        <input type="text" id="edit-group-banner" value="${settings.banner || ''}" style="width:100%; background:var(--bg-input); color:white; border:1px solid var(--border-color); border-radius:6px; padding:8px; box-sizing:border-box;" ${!canEdit ? 'disabled' : ''}>
                    </div>
                    <div style="margin-bottom:8px;">
                        <label style="font-size:12px; color:var(--text-muted);">URL унікальних шпалер для фону:</label>
                        <input type="text" id="edit-group-wallpaper" value="${settings.wallpaper || ''}" style="width:100%; background:var(--bg-input); color:white; border:1px solid var(--border-color); border-radius:6px; padding:8px; box-sizing:border-box;" ${!canEdit ? 'disabled' : ''}>
                    </div>
                </div>

                <div style="border-bottom:1px solid var(--border-color); padding-bottom:12px; margin-bottom:12px;">
                    <h4 style="margin:0 0 10px 0; font-size:14px; color:var(--accent);">📜 Внутрішні правила та Вітання</h4>
                    <div style="margin-bottom:8px;">
                        <label style="font-size:12px; color:var(--text-muted);">Правила поведінки (Rules):</label>
                        <textarea id="edit-group-rules" style="width:100%; background:var(--bg-input); color:white; border:1px solid var(--border-color); border-radius:6px; padding:8px; box-sizing:border-box; resize:vertical;" placeholder="Напишіть правила для учасників..." ${!canEdit ? 'disabled' : ''}>${settings.rules || ''}</textarea>
                    </div>
                    <div style="margin-bottom:8px;">
                        <label style="font-size:12px; color:var(--text-muted);">Повідомлення-вітання при вході:</label>
                        <input type="text" id="edit-group-greeting" value="${settings.greeting || ''}" style="width:100%; background:var(--bg-input); color:white; border:1px solid var(--border-color); border-radius:6px; padding:8px; box-sizing:border-box;" placeholder="Ласкаво просимо в наш простір!..." ${!canEdit ? 'disabled' : ''}>
                    </div>
                </div>

                <div style="margin-bottom:15px;">
                    <h4 style="margin:0 0 10px 0; font-size:14px; color:var(--accent);">👑 Ієрархія та Склад Адміністрації</h4>
                    <ul style="padding-left:15px; margin:5px 0; list-style-type: none;">
                        <li style="font-size:13px; margin-bottom:5px; color:var(--text-main);">🥇 ${group.owner} — <b>Головний Творець (Овнер)</b></li>
                        ${adminsListHtml}
                    </ul>
                    
                    ${window.canUserPerformAction(window.currentUser, group, 'manage_admins') ? `
                        <div style="background:var(--bg-input); padding:10px; border-radius:8px; margin-top:10px; border:1px solid var(--border-color);">
                            <span style="font-size:12px; display:block; margin-bottom:6px; font-weight:bold;">Управління правами та посадами:</span>
                            <input type="text" id="manage-admin-username" placeholder="Нікнейм користувача" style="width:100%; background:var(--bg-panel); color:white; border:1px solid var(--border-color); padding:8px; border-radius:6px; margin-bottom:6px; box-sizing:border-box;">
                            <select id="manage-admin-role" style="width:100%; background:var(--bg-panel); color:white; border:1px solid var(--border-color); padding:8px; border-radius:6px; margin-bottom:8px; box-sizing:border-box;">
                                <option value="co_owner">Полуовнер / Допоміжник</option>
                                <option value="senior_admin">Старший адмін</option>
                                <option value="middle_admin">Середній адмін</option>
                                <option value="junior_admin">Молодший адмін</option>
                                <option value="member">❌ Зняти всі повноваження (Учасник)</option>
                            </select>
                            <button onclick="window.submitAdminRoleChange()" style="width:100%; padding:8px; background:var(--accent); color:white; border:none; border-radius:6px; cursor:pointer; font-weight:bold;">Застосувати зміни рангів</button>
                        </div>
                    ` : ''}
                </div>

                ${canEdit ? `<button onclick="window.saveGroupSettings()" style="width:100%; padding:12px; background:var(--accent); border:none; border-radius:6px; color:white; font-weight:bold; cursor:pointer; font-size:14px;">💾 Зберегти конфігурацію</button>` : ''}
            </div>
        `;
        modal.style.display = 'flex';
    };

    window.closeGroupSettingsModal = function() {
        const modal = document.getElementById('group-settings-modal');
        if (modal) modal.style.display = 'none';
    };

    // Відправка оновлених налаштувань на Node.js сервер
    window.saveGroupSettings = function() {
        if (!window.currentGroupContext) return;
        const group = window.currentGroupContext;
        group.settings = group.settings || {};

        group.settings.description = document.getElementById('edit-group-desc').value.trim();
        group.settings.descriptionColor = document.getElementById('edit-group-desc-color').value;
        group.settings.banner = document.getElementById('edit-group-banner').value.trim();
        group.settings.wallpaper = document.getElementById('edit-group-wallpaper').value.trim();
        group.settings.rules = document.getElementById('edit-group-rules').value.trim();
        group.settings.greeting = document.getElementById('edit-group-greeting').value.trim();

        window.socket.emit('update_group_settings', {
            groupId: group.id,
            settings: group.settings
        });

        window.closeGroupSettingsModal();
    };

    // Надсилання запиту на зміну рангу користувача
    window.submitAdminRoleChange = function() {
        if (!window.currentGroupContext) return;
        const targetUser = document.getElementById('manage-admin-username').value.trim();
        const chosenRole = document.getElementById('manage-admin-role').value;

        if (!targetUser) {
            alert("Помилка: Будь ласка, вкажіть нікнейм користувача для зміни його рангу!");
            return;
        }

        window.socket.emit('change_user_role', {
            groupId: window.currentGroupContext.id,
            targetUser: targetUser,
            role: chosenRole
        });
        
        window.closeGroupSettingsModal();
    };
})();

// ChatManager.js
// Handles everything related to text channels:
//   - joining / leaving / deleting channels
//   - sending, receiving and deleting messages
//   - @mention autocomplete and ping notifications
//   - server and channel creation modals
//   - server list rendering (text + voice tree)

class ChatManager {
    constructor(state, modal, auth) {
        this.state = state;
        this.modal = modal;
        this.auth  = auth;

        // DOM refs used throughout this class
        this.welcomeArea  = document.getElementById('welcomeArea');
        this.chatArea     = document.getElementById('chatArea');
        this.chatTitle    = document.getElementById('chatTitle');
        this.chatSubtitle = document.getElementById('chatSubtitle');
        this.messagesEl   = document.getElementById('messages');
        this.messageInput = document.getElementById('messageInput');
        this.searchInput  = document.getElementById('searchInput');

        // Mention dropdown element (created lazily)
        this.mentionBox      = null;
        this.mentionHideTimer = null;

        // File upload state
        this.selectedImageBase64 = null;
        this.selectedFileBase64  = null;
        this.selectedFileName    = null;
        this.selectedFileType    = null;
        this.MAX_FILE_SIZE       = 10000 * 1024; // 10 MB

        this._bindUI();
        this._subscribeFirebase();
    }

    // -------------------------------------------------------------------------
    // Firebase subscriptions
    // -------------------------------------------------------------------------

    _subscribeFirebase() {
        // Keep local caches in sync with the database
        this.state.chatsRef.on('value', snap => {
            this.state.chatsCache = snap.val() || {};
            this.renderServerList();
        });

        this.state.serversRef.on('value', snap => {
            this.state.serversCache = snap.val() || {};
            this.renderServerList();
        });

        this.state.voiceChatsRef.on('value', snap => {
            this.state.voiceChatsCache = snap.val() || {};
            this.renderServerList();
        });
    }

    // -------------------------------------------------------------------------
    // UI bindings
    // -------------------------------------------------------------------------

    _bindUI() {
        const leaveBtn  = document.getElementById('leaveBtn');
        const deleteBtn = document.getElementById('deleteBtn');
        const sendBtn   = document.getElementById('sendBtn');
        const uploadBtn = document.getElementById('uploadBtn');
        const imageInput = document.getElementById('imageInput');
        const searchBtn  = document.getElementById('searchBtn');

        if (leaveBtn)  leaveBtn.onclick  = () => { if (!this.state.currentChatId) return; this.detachChat(); };
        if (deleteBtn) deleteBtn.onclick = () => this.openDeleteModal();
        if (sendBtn)   sendBtn.onclick   = () => this.sendMessage();
        if (uploadBtn) uploadBtn.onclick = () => imageInput && imageInput.click();

        if (imageInput) {
            imageInput.onchange = (e) => this._handleFileSelect(e);
        }

        if (this.messageInput) {
            this.messageInput.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
            });
            this.messageInput.addEventListener('input', () => this._handleMentionInput());
            this.messageInput.addEventListener('click', () => this._handleMentionInput());
            this.messageInput.addEventListener('blur', () => {
                if (this.mentionHideTimer) clearTimeout(this.mentionHideTimer);
                this.mentionHideTimer = setTimeout(() => this._hideMentionBox(), 150);
            });
        }

        if (searchBtn) searchBtn.onclick = () => this.renderServerList();
        if (this.searchInput) {
            this.searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.renderServerList(); });
        }
    }

    // -------------------------------------------------------------------------
    // Server list rendering
    // -------------------------------------------------------------------------

    renderServerList() {
        const listEl = document.getElementById('serverList');
        if (!listEl) return;

        listEl.innerHTML = '';
        const filter = (this.searchInput ? this.searchInput.value : '').trim();
        const pingedChats = this._getPingedChats();
        const entries = Object.entries(this.state.serversCache);

        if (entries.length === 0) {
            listEl.innerHTML = '<div style="padding:10px; opacity:0.6">No servers. Create one!</div>';
            return;
        }

        const filtered = entries.filter(([, s]) =>
            !filter || (s.name || '').toLowerCase().includes(filter.toLowerCase())
        );

        filtered.forEach(([serverId, server]) => {
            this._renderServer(listEl, serverId, server, filter, pingedChats);
        });
    }

    _renderServer(listEl, serverId, server, filter, pingedChats) {
        const isExpanded = this.state.expandedServers.has(serverId);
        const serverDiv  = document.createElement('div');
        serverDiv.className = 'tree-item tree-server';
        if (isExpanded) serverDiv.classList.add('active');
        if (this.state.currentServerId === serverId) serverDiv.classList.add('selected');

        const arrow = isExpanded ? '▼' : '▶';
        const serverHasPing = !!(server.channels?.text &&
            Object.keys(server.channels.text).some(cid => pingedChats.has(cid)));

        serverDiv.innerHTML = `<span class="tree-prefix" style="font-size:10px;vertical-align:middle;margin-right:6px;">${arrow}</span>${escapeHtml(server.name)}${serverHasPing ? '<span class="ping-dot" title="Mention"></span>' : ''}`;

        serverDiv.onclick = () => {
            this.state.currentServerId = serverId;
            this.state.expandedServers.has(serverId)
                ? this.state.expandedServers.delete(serverId)
                : this.state.expandedServers.add(serverId);
            this.renderServerList();
        };
        listEl.appendChild(serverDiv);

        if (isExpanded || filter) {
            this._renderTextChannels(listEl, serverId, server, pingedChats);
            this._renderVoiceChannels(listEl, serverId, server);
        }
    }

    _renderTextChannels(listEl, serverId, server, pingedChats) {
        const txtCat = document.createElement('div');
        txtCat.className = 'tree-item tree-category indent-1';
        txtCat.innerHTML = `<span class="tree-prefix"></span>TEXT CHATS: <span class="add-channel-btn" title="Create Text Channel" onclick="app.chat.openChannelCreateModal('${serverId}', 'text')">+</span>`;
        listEl.appendChild(txtCat);

        if (!server.channels?.text) return;
        Object.entries(server.channels.text).forEach(([channelId, channelData]) => {
            const chanDiv = document.createElement('div');
            chanDiv.className = 'tree-item tree-channel indent-2';
            if (this.state.currentChatId === channelId) chanDiv.classList.add('active');

            const hasPing = pingedChats.has(channelId);
            chanDiv.innerHTML = `<span class="tree-prefix">|_</span><span style="opacity:0.7">#</span> ${escapeHtml(channelData.name)}${hasPing ? '<span class="ping-dot" title="Mention"></span>' : ''}`;

            chanDiv.onclick = (e) => {
                if (e.target.classList.contains('settings-icon')) { app.voice.openVoiceSettingsModal(channelId); return; }
                this._checkServerAccess(serverId, () => {
                    this.state.currentServerId   = serverId;
                    this.state.currentChannelId  = channelId;
                    this.state.currentChannelType = 'text';
                    this.state.currentChatId     = channelId;
                    this.state.expandedServers.add(serverId);
                    this.renderServerList();
                    this.joinChat(channelId);
                });
            };
            listEl.appendChild(chanDiv);
        });
    }

    _renderVoiceChannels(listEl, serverId, server) {
        const voiceCat = document.createElement('div');
        voiceCat.className = 'tree-item tree-category indent-1';
        voiceCat.innerHTML = `<span class="tree-prefix"></span>VOICE CHATS: <span class="add-channel-btn" title="Create Voice Channel" onclick="app.chat.openChannelCreateModal('${serverId}', 'voice')">+</span>`;
        listEl.appendChild(voiceCat);

        if (!server.channels?.voice) return;
        Object.entries(server.channels.voice).forEach(([channelId, channelData]) => {
            const chanDiv = document.createElement('div');
            chanDiv.className = 'tree-item tree-channel indent-2';
            if (this.state.currentVoiceChatId === channelId) chanDiv.classList.add('active');

            chanDiv.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding-right:6px;';
            chanDiv.innerHTML = `
                <span style="display:flex;align-items:center;overflow:hidden;">
                    <span class="tree-prefix">|_</span>🔊 ${escapeHtml(channelData.name)}
                    <span id="ping-${channelId}" style="margin-left:8px;font-size:11px;font-family:monospace;font-weight:bold;"></span>
                </span>
                <span class="settings-icon" title="Voice Settings">⚙</span>
            `;

            chanDiv.onclick = (e) => {
                if (e.target.classList.contains('settings-icon')) { app.voice.openVoiceSettingsModal(channelId); return; }
                if (this.state.currentVoiceChatId === channelId) return;
                this._checkServerAccess(serverId, () => {
                    this.state.currentChannelId   = channelId;
                    this.state.currentChannelType = 'voice';
                    this.renderServerList();
                    app.voice.joinVoiceChat(channelId);
                });
            };
            listEl.appendChild(chanDiv);

            // Show who is currently in this voice channel
            const voiceData = this.state.voiceChatsCache[channelId];
            if (voiceData?.users) {
                Object.entries(voiceData.users).forEach(([uid, uData]) => {
                    app.voice.renderVoiceUserInTree(listEl, channelId, uid, uData);
                });
            }
        });
    }

    // -------------------------------------------------------------------------
    // Server / channel creation
    // -------------------------------------------------------------------------

    openCreateModal() {
        this.modal.show(`
            <h4>CREATE NEW SERVER</h4>
            <div class="row">
                <label>Server Name</label>
                <input id="newName" placeholder="e.g. My Gaming Server" />
            </div>
            <div class="row">
                <label>Access Password</label>
                <input id="newPass" placeholder="leave empty for public" type="password" />
            </div>
            <div class="row">
                <label>Admin/Delete Password</label>
                <input id="newDeletePass" placeholder="required to delete server" type="password" />
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                <button id="cancelCreate" class="btn btn-ghost">Cancel</button>
                <button id="confirmCreate" class="btn btn-primary">Create Server</button>
            </div>
        `);

        document.getElementById('cancelCreate').onclick = () => this.modal.close();
        document.getElementById('confirmCreate').onclick = () => {
            const name       = String(document.getElementById('newName').value       || '').trim();
            const pass       = String(document.getElementById('newPass').value       || '');
            const deletePass = String(document.getElementById('newDeletePass').value || '');

            if (!name)       { this.modal.alert('Provide server name');    return; }
            if (!deletePass) { this.modal.alert('Provide delete password'); return; }

            const newServerRef  = this.state.serversRef.push();
            const defaultTextId  = newServerRef.child('channels/text').push().key;
            const defaultVoiceId = newServerRef.child('channels/voice').push().key;

            newServerRef.set({
                name, password: pass, deletePassword: deletePass,
                createdAt: Date.now(),
                ownerId: this.state.currentUser ? this.state.currentUser.uid : null,
                channels: {
                    text:  { [defaultTextId]:  { name: 'general', type: 'text'  } },
                    voice: { [defaultVoiceId]: { name: 'Lobby',   type: 'voice' } },
                }
            }).then(() => {
                this.modal.close();
                this.modal.alert('Server created! Please select it from the list.');
            }).catch(e => this.modal.alert('Error: ' + e.message));
        };
    }

    openChannelCreateModal(serverId, type) {
        const title = type === 'text' ? 'NEW TEXT CHANNEL' : 'NEW VOICE CHANNEL';
        this.modal.show(`
            <h4>${title}</h4>
            <div class="row">
                <label>Channel Name</label>
                <input id="newChannelName" placeholder="e.g. general" />
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                <button id="cancelChan" class="btn btn-ghost">Cancel</button>
                <button id="confirmChan" class="btn btn-primary">Create</button>
            </div>
        `);

        document.getElementById('cancelChan').onclick = () => this.modal.close();
        document.getElementById('confirmChan').onclick = () => {
            const name = String(document.getElementById('newChannelName').value || '').trim();
            if (!name) { this.modal.alert('Please enter a name'); return; }

            this.state.db.ref(`servers/${serverId}/channels/${type}`)
                .push({ name, type })
                .then(() => { this.modal.close(); this.modal.alert('Channel created!'); })
                .catch(err => this.modal.alert('Error: ' + err.message));
        };
    }

    // -------------------------------------------------------------------------
    // Server access check (password gate)
    // -------------------------------------------------------------------------

    _checkServerAccess(serverId, callback) {
        const server = this.state.serversCache[serverId];
        if (!server) return;

        const isOwner       = this.state.currentUser && server.ownerId === this.state.currentUser.uid;
        const isAccountAdmin = this.auth.isAdmin();
        const isUnlocked    = this.state.unlockedServers.has(serverId);
        const hasNoPass     = !server.password || server.password === '';

        if (hasNoPass || isUnlocked || isOwner || isAccountAdmin) { callback(); return; }

        this.modal.show(`
            <h4>Server Locked</h4>
            <div class="row">
                <label>Enter Server Password</label>
                <input id="serverPassInput" type="password" placeholder="Password" />
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                <button id="cancelServerAuth" class="btn btn-ghost">Cancel</button>
                <button id="confirmServerAuth" class="btn btn-primary">Enter</button>
            </div>
        `);

        document.getElementById('cancelServerAuth').onclick = () => this.modal.close();
        document.getElementById('confirmServerAuth').onclick = async () => {
            const val          = String(document.getElementById('serverPassInput').value || '');
            const isAdminPass  = await this.auth.checkAdminPassword(val);
            if (val === server.password || isAdminPass) {
                this.state.unlockedServers.add(serverId);
                this.modal.close();
                callback();
            } else {
                this.modal.alert('Wrong password!');
            }
        };
    }

    // -------------------------------------------------------------------------
    // Join / leave / delete chat
    // -------------------------------------------------------------------------

    joinChat(id) {
        // Remove any active stream overlay when switching to text
        const overlay = document.getElementById('stream-overlay');
        if (overlay) overlay.remove();

        this.messagesEl.style.display = 'block';
        const inputPanel = document.querySelector('.msg-input');
        if (inputPanel) inputPanel.style.display = 'flex';

        this.state.currentWatchedUid = null;
        this.state.currentChatId  = id;
        this.state.currentChatRef = this.state.db.ref('chats/' + id);

        // Look up channel name from the server tree
        let foundName = null;
        Object.values(this.state.serversCache).forEach(s => {
            if (s.channels?.text?.[id]) foundName = s.channels.text[id].name;
        });

        this.chatTitle.textContent    = foundName || '—';
        this.chatSubtitle.textContent = 'ID: ' + id;
        this.welcomeArea.style.display = 'none';
        this.chatArea.style.display    = 'flex';
        this.messagesEl.innerHTML      = '';

        this.auth.ensureUsersCache().catch(() => {});
        this.state.chatParticipants = new Set();
        this._hideMentionBox();

        // Clear unread ping indicator for current user
        if (this.state.currentUser?.uid) {
            this.state.db.ref(`chats/${id}/pings/${this.state.currentUser.uid}`).remove();
        }

        // Detach previous message listener before attaching a new one
        if (this.state.messagesRef) this.state.messagesRef.off();

        this.state.messagesRef = this.state.db.ref(`chats/${id}/messages`);
        let initialLoad = true;
        let lastDate    = null;

        const removeDateSeparatorIfEmpty = (targetDate) => {
            let found = false;
            this.messagesEl.querySelectorAll('div').forEach(d => {
                if (d.dataset?.date === targetDate) found = true;
            });
            if (!found) {
                const sep = Array.from(this.messagesEl.querySelectorAll('.date-separator'))
                    .find(s => s.textContent === targetDate);
                if (sep) sep.remove();
            }
        };

        this.state.messagesRef.on('child_added', snap => {
            const m     = snap.val();
            const msgId = snap.key;

            if (m?.nickname) this.state.chatParticipants.add(String(m.nickname));

            const timeStr = m.createdAt
                ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : (m.time ? String(m.time).split(' ').pop() : '');

            // Display [ADMIN] badge for registered admin users
            let displayNick = m.nickname || 'Anon';
            if (m.userId && this.state.usersCacheById[m.userId]?.admin === 1) displayNick += ' [ADMIN]';

            // Date separator row between days
            const msgDate  = new Date(m.createdAt || Date.now());
            const dateOnly = msgDate.toLocaleDateString();
            if (lastDate !== dateOnly) {
                const sep = document.createElement('div');
                sep.className   = 'date-separator';
                sep.textContent = dateOnly;
                this.messagesEl.appendChild(sep);
                lastDate = dateOnly;
            }

            const msgWrap = document.createElement('div');
            msgWrap.className    = 'msg-wrap';
            msgWrap.dataset.date = dateOnly;

            // Meta line: [time] Nick
            const meta     = document.createElement('div'); meta.className = 'meta-line';
            const timeSpan = document.createElement('span'); timeSpan.textContent = `[${timeStr}] `;
            const nickSpan = document.createElement('span');
            nickSpan.textContent = displayNick;
            nickSpan.className   = 'msg-nick' + (m.userId ? ' msg-nick-registered' : '');
            meta.appendChild(timeSpan);
            meta.appendChild(nickSpan);

            const bubble = document.createElement('div'); bubble.className = 'message';

            if (m.text) {
                this._renderTextWithLinks(bubble, m.text);
            } else if (m.imageBase64) {
                this._renderImage(bubble, m.imageBase64, initialLoad);
            } else if (m.fileBase64) {
                this._renderFile(bubble, m.fileBase64, m.fileName);
            }

            // Click message to reveal delete button (own messages or admin)
            bubble.addEventListener('click', () => {
                if (!this.state.currentUser) return;
                const existing = bubble.querySelector('.trash-icon');
                if (existing) { existing.remove(); return; }
                const trash = document.createElement('span');
                trash.className = 'trash-icon';
                trash.textContent = '🗑️';
                trash.style.cssText = 'cursor:pointer;position:absolute;right:-26px;top:4px;';
                bubble.style.position = 'relative';
                bubble.appendChild(trash);
                trash.onclick = (e) => {
                    e.stopPropagation();
                    if (!confirm('Delete message?')) return;
                    this.state.db.ref(`users/${this.state.currentUser.uid}`).once('value').then(snapUser => {
                        const isAdmin = snapUser.val()?.admin === 1;
                        if (isAdmin || m.userId === this.state.currentUser.uid) {
                            this.state.db.ref(`chats/${this.state.currentChatId}/messages/${msgId}`)
                                .remove()
                                .then(() => { msgWrap.remove(); removeDateSeparatorIfEmpty(dateOnly); });
                        } else {
                            this.modal.alert('You can delete only your messages.');
                        }
                    });
                };
            });

            msgWrap.appendChild(meta);
            msgWrap.appendChild(bubble);
            this.messagesEl.appendChild(msgWrap);

            // Auto-scroll if near the bottom
            if (initialLoad || (this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight < 300)) {
                this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
            }
        });

        this.state.messagesRef.once('value', () => {
            initialLoad = false;
            setTimeout(() => { this.messagesEl.scrollTop = this.messagesEl.scrollHeight; }, 100);
        });
    }

    detachChat() {
        if (this.state.messagesRef) this.state.messagesRef.off();
        this.state.currentChatId  = null;
        this.state.currentChatRef = null;
        this.messagesEl.innerHTML = '';
        this.chatArea.style.display    = 'none';
        this.welcomeArea.style.display = 'block';
        this.chatTitle.textContent    = '—';
        this.chatSubtitle.textContent = '—';
    }

    openDeleteModal() {
        const targetId = this.state.currentChatId || this.state.currentChannelId;
        if (!targetId) return;

        let chatName = 'Chat';
        let isServerChannel = false;
        let parentServer = null;

        if (this.state.currentServerId && this.state.serversCache[this.state.currentServerId]) {
            parentServer    = this.state.serversCache[this.state.currentServerId];
            isServerChannel = true;
            if (this.state.currentChannelType === 'text'  && parentServer.channels?.text?.[targetId])  chatName = parentServer.channels.text[targetId].name;
            if (this.state.currentChannelType === 'voice' && parentServer.channels?.voice?.[targetId]) chatName = parentServer.channels.voice[targetId].name;
        } else if (this.state.chatsCache[targetId]) {
            chatName = this.state.chatsCache[targetId].name;
        }

        this.modal.show(`
            <h4>Delete: ${escapeHtml(chatName)}</h4>
            <div class="row">
                <label>Admin or Server Delete Password</label>
                <input id="deletePassInput" type="password" placeholder="Password"/>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                <button id="cancelDelete" class="btn btn-ghost">Cancel</button>
                <button id="confirmDelete" class="btn btn-primary" style="background:#b91c1c;">Delete</button>
            </div>
        `);

        document.getElementById('cancelDelete').onclick = () => this.modal.close();
        document.getElementById('confirmDelete').onclick = async () => {
            const enteredPass    = String(document.getElementById('deletePassInput').value || '');
            const isGlobalAdmin  = await this.auth.checkAdminPassword(enteredPass);
            const isAccountAdmin = this.auth.isAdmin();
            const isServerAdmin  = parentServer?.deletePassword && enteredPass === parentServer.deletePassword;
            const oldChat        = this.state.chatsCache[targetId];
            const isOldChatAdmin = oldChat?.deletePassword && enteredPass === oldChat.deletePassword;

            if (isAccountAdmin || isGlobalAdmin || isServerAdmin || isOldChatAdmin) {
                const updates = {};
                if (isServerChannel && this.state.currentServerId && this.state.currentChannelType) {
                    updates[`servers/${this.state.currentServerId}/channels/${this.state.currentChannelType}/${targetId}`] = null;
                }
                updates[`chats/${targetId}`] = null;
                if (this.state.currentChannelType === 'voice') {
                    updates[`voice_chats/${targetId}`]    = null;
                    updates[`voice_signaling/${targetId}`] = null;
                }

                this.state.db.ref().update(updates).then(() => {
                    this.modal.close();
                    this.modal.alert('Channel/Chat deleted successfully.');
                    this.detachChat();
                    if (this.state.currentChannelType === 'voice') app.voice.leaveVoiceChat();
                    this.renderServerList();
                }).catch(e => this.modal.alert('Error deleting: ' + e.message));
            } else {
                this.modal.alert('Wrong delete password.');
            }
        };
    }

    // -------------------------------------------------------------------------
    // Sending messages
    // -------------------------------------------------------------------------

    sendMessage() {
        if (!this.state.currentChatId) { this.modal.alert('Join a chat first'); return; }
        this._actuallySendMessage();
    }

    async _actuallySendMessage() {
        const text = String(this.messageInput?.value || '').trim();
        if (!text && !this.selectedImageBase64 && !this.selectedFileBase64) return;

        const nickInputVal = String(document.getElementById('nicknameInput')?.value || '').trim();
        const nick = this.state.currentUser
            ? this.state.currentUser.nick
            : (nickInputVal || 'Anon' + Math.floor(1000 + Math.random() * 9000));

        const now = new Date();
        const t   = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const mentionedUserIds = await this._resolveMentionedUserIds(text);

        const msgData = {
            nickname:      nick,
            text:          text || null,
            imageBase64:   this.selectedImageBase64,
            fileBase64:    this.selectedFileBase64,
            fileName:      this.selectedFileName,
            time:          t,
            createdAt:     Date.now(),
            userId:        this.state.currentUser ? this.state.currentUser.uid : null,
        };

        this.state.db.ref(`chats/${this.state.currentChatId}/messages`).push(msgData).then(() => {
            if (this.messageInput) this.messageInput.value = '';
            this.selectedImageBase64 = null;
            this.selectedFileBase64  = null;
            const ex = document.querySelector('#messageInput + img, #messageInput + .file-preview');
            if (ex) ex.remove();
            if (mentionedUserIds.length > 0) {
                this._addPingsForUsers(this.state.currentChatId, mentionedUserIds, nick, this.state.currentUser?.uid);
            }
        });
    }

    // -------------------------------------------------------------------------
    // File upload handling
    // -------------------------------------------------------------------------

    _handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > this.MAX_FILE_SIZE) { this.modal.alert('File too large (max 10Mb)'); e.target.value = ''; return; }

        this.selectedImageBase64 = null;
        this.selectedFileBase64  = null;
        const existing = document.querySelector('#messageInput + img, #messageInput + .file-preview');
        if (existing) existing.remove();

        const reader = new FileReader();
        reader.onload = (ev) => {
            if (file.type.startsWith('image/')) {
                this.selectedImageBase64 = ev.target.result;
                const p = document.createElement('img');
                p.src = this.selectedImageBase64;
                p.style.cssText = 'max-width:100px;margin-top:4px;';
                this.messageInput?.insertAdjacentElement('afterend', p);
            } else {
                this.selectedFileBase64 = ev.target.result;
                this.selectedFileName   = file.name;
                this.selectedFileType   = file.type;
                const d = document.createElement('div');
                d.className   = 'file-preview';
                d.textContent = file.name;
                this.messageInput?.insertAdjacentElement('afterend', d);
            }
        };
        reader.readAsDataURL(file);
    }

    // -------------------------------------------------------------------------
    // Message rendering helpers
    // -------------------------------------------------------------------------

    _renderTextWithLinks(bubble, text) {
        const urlRegex = /(?:https?:\/\/[^\s]+)|(?:www\.[^\s]+)/g;
        let lastIndex  = 0;
        let match;
        while ((match = urlRegex.exec(text)) !== null) {
            const idx = match.index;
            if (idx > lastIndex) bubble.appendChild(document.createTextNode(text.slice(lastIndex, idx)));
            const url  = match[0];
            const href = url.startsWith('http') ? url : 'http://' + url;
            const a    = document.createElement('a');
            a.href = href; a.textContent = url; a.target = '_blank'; a.className = 'file-link';
            bubble.appendChild(a);
            lastIndex = idx + url.length;
        }
        if (lastIndex < text.length) bubble.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    _renderImage(bubble, src, initialLoad) {
        const img  = document.createElement('img');
        img.src    = src;
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', e => {
            e.stopPropagation();
            // Reuse ModalManager's raw modal elements for image zoom
            document.getElementById('modalContent').innerHTML =
                `<div class="modal-viewer"><a class="modal-download" href="${src}" download="img.png">⬇</a><img src="${src}" class="modal-image"/></div>`;
            document.getElementById('modal').style.display = 'flex';
            const modalImg = document.getElementById('modalContent').querySelector('.modal-image');
            if (modalImg) modalImg.onload = () => this.modal._adjustImage();
        });
        img.onload = () => {
            if (initialLoad || (this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight < 300)) {
                this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
            }
        };
        bubble.appendChild(img);
    }

    _renderFile(bubble, src, fileName) {
        const fileLink    = document.createElement('a');
        fileLink.href     = src;
        fileLink.target   = '_blank';
        fileLink.className = 'file-link';
        fileLink.textContent = fileName || 'file';
        fileLink.download = fileName || '';
        bubble.appendChild(fileLink);
    }

    // -------------------------------------------------------------------------
    // Mention autocomplete
    // -------------------------------------------------------------------------

    _ensureMentionBox() {
        if (this.mentionBox) return this.mentionBox;
        this.mentionBox = document.createElement('div');
        this.mentionBox.id        = 'mentionBox';
        this.mentionBox.className = 'mention-box';
        this.mentionBox.style.display = 'none';
        const wrap = this.messageInput?.closest('.msg-input');
        if (wrap) { wrap.style.position = 'relative'; wrap.appendChild(this.mentionBox); }
        return this.mentionBox;
    }

    _showMentionBox(items) {
        const box = this._ensureMentionBox();
        box.innerHTML = '';
        if (!items || items.length === 0) { box.style.display = 'none'; return; }
        items.forEach(nick => {
            const item = document.createElement('div');
            item.className   = 'mention-item';
            item.textContent = nick;
            item.onclick = (e) => { e.preventDefault(); this._insertMention(nick); this._hideMentionBox(); };
            box.appendChild(item);
        });
        box.style.display = 'block';
    }

    _hideMentionBox() {
        if (this.mentionBox) this.mentionBox.style.display = 'none';
    }

    _insertMention(nick) {
        const input = this.messageInput;
        if (!input) return;
        const value  = input.value;
        const cursor = input.selectionStart || value.length;
        const before = value.slice(0, cursor);
        const after  = value.slice(cursor);
        const match  = before.match(/@([^\s@]*)$/);
        if (!match) return;
        const startIdx = before.lastIndexOf('@');
        const newBefore = before.slice(0, startIdx) + '@' + nick + ' ';
        input.value = newBefore + after;
        input.setSelectionRange(newBefore.length, newBefore.length);
        input.focus();
    }

    _handleMentionInput() {
        if (!this.messageInput) return;
        const value  = this.messageInput.value;
        const cursor = this.messageInput.selectionStart || value.length;
        const before = value.slice(0, cursor);
        const match  = before.match(/@([^\s@]*)$/);
        if (!match) { this._hideMentionBox(); return; }
        const query        = match[1].toLowerCase();
        const participants = Array.from(this.state.chatParticipants || [])
            .filter(n => n && this.state.usersCacheByNickLower[n.toLowerCase()]);
        const filtered = participants.filter(n => n.toLowerCase().includes(query)).slice(0, 8);
        this._showMentionBox(filtered);
    }

    // -------------------------------------------------------------------------
    // Mention resolution and ping notifications
    // -------------------------------------------------------------------------

    _extractMentionedUserIds(text) {
        if (!text) return [];
        const ids       = new Set();
        const lowerText = text.toLowerCase();
        const atIndices = [];
        for (let i = 0; i < lowerText.length; i++) if (lowerText[i] === '@') atIndices.push(i);
        if (atIndices.length === 0) return [];

        const sortedNicks = [...this.state.usersNicknamesLower].sort((a, b) => b.length - a.length);
        for (const idx of atIndices) {
            const slice = lowerText.slice(idx + 1);
            let matchedNick = null;
            for (const nickLower of sortedNicks) {
                if (slice.startsWith(nickLower)) {
                    const endPos  = idx + 1 + nickLower.length;
                    const nextChar = lowerText[endPos] || '';
                    if (!nextChar || /[\s.,!?;:()\[\]{}"'<>]/.test(nextChar)) { matchedNick = nickLower; break; }
                }
            }
            if (matchedNick) {
                const uid = this.state.usersCacheByNickLower[matchedNick];
                if (uid) ids.add(uid);
            }
        }
        return Array.from(ids);
    }

    async _resolveMentionedUserIds(text) {
        await this.auth.ensureUsersCache();
        return this._extractMentionedUserIds(text);
    }

    _addPingsForUsers(chatId, userIds, senderNick, senderUid) {
        if (!chatId || !userIds?.length) return;
        userIds.forEach(uid => {
            if (senderUid && uid === senderUid) return;
            const pingRef = this.state.db.ref(`chats/${chatId}/pings/${uid}`);
            pingRef.transaction(prev => {
                const next  = prev && typeof prev === 'object' ? prev : {};
                const count = Number(next.count || 0) + 1;
                return { count, lastAt: Date.now(), lastBy: senderNick || 'Anon' };
            });
        });
    }

    // Returns the set of chat IDs that have an unread ping for the current user
    _getPingedChats() {
        const set = new Set();
        if (!this.state.currentUser?.uid) return set;
        Object.entries(this.state.chatsCache || {}).forEach(([chatId, chatData]) => {
            if (chatData?.pings?.[this.state.currentUser.uid]) set.add(chatId);
        });
        return set;
    }
}

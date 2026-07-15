// Text chat manager
class ChatManager {
    constructor(state, modal, auth) {
        this.state = state;
        this.modal = modal;
        this.auth  = auth;

        this.welcomeArea  = document.getElementById('welcomeArea');
        this.chatArea     = document.getElementById('chatArea');
        this.chatTitle    = document.getElementById('chatTitle');
        this.chatSubtitle = document.getElementById('chatSubtitle');
        this.messagesEl   = document.getElementById('messages');
        this.messageInput = document.getElementById('messageInput');
        this.searchInput  = document.getElementById('searchInput');

        this.mentionBox       = null;
        this.mentionHideTimer = null;

        this.selectedImageBase64 = null;
        this.selectedFileBase64  = null;
        this.selectedFileName    = null;
        this.selectedFileType    = null;
        this.selectedFileSize    = null;
        this.MAX_FILE_SIZE       = 10000 * 1024;
        this.NAME_MAX            = 25;
        this._nameCache          = {};

        this._bindUI();
        this._subscribeFirebase();
    }

    // Firebase subscriptions
    _subscribeFirebase() {
        this.state.serversRef.on('value', snap => {
            this.state.serversCache = snap.val() || {};
            this.syncPingSubs();
            this.renderServerList();
        });

        this.state.voiceChatsRef.on('value', snap => {
            this.state.voiceChatsCache = snap.val() || {};
            this.renderServerList();
        });
    }

    // Ping listeners
    syncPingSubs() {
        const uid    = this.state.currentUser?.uid || null;
        const wanted = new Set();

        if (uid) {
            Object.values(this.state.serversCache).forEach(s => {
                Object.keys(s.channels?.text || {}).forEach(cid => wanted.add(cid));
            });
        }

        Object.keys(this.state.pingSubs).forEach(cid => {
            const sub = this.state.pingSubs[cid];
            if (!wanted.has(cid) || sub.uid !== uid) {
                sub.ref.off();
                delete this.state.pingSubs[cid];
                this.state.pingedChats.delete(cid);
            }
        });

        wanted.forEach(cid => {
            if (this.state.pingSubs[cid]) return;
            const ref = this.state.db.ref(`chats/${cid}/pings/${uid}`);
            this.state.pingSubs[cid] = { ref, uid };
            ref.on('value', snap => {
                snap.exists() ? this.state.pingedChats.add(cid) : this.state.pingedChats.delete(cid);
                this.renderServerList();
            });
        });
    }

    // UI bindings
    _bindUI() {
        const sendBtn    = document.getElementById('sendBtn');
        const uploadBtn  = document.getElementById('uploadBtn');
        const imageInput = document.getElementById('imageInput');
        const searchBtn  = document.getElementById('searchBtn');

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
            // Block password-manager autofill
            this.searchInput.setAttribute('readonly', 'readonly');
            this.searchInput.addEventListener('focus', () => this.searchInput.removeAttribute('readonly'));
            this.searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.renderServerList(); });
            this.searchInput.addEventListener('input', () => this.renderServerList());
        }
    }

    // Channel name (decrypts)
    _channelName(serverId, channelData) {
        if (!channelData) return '?';
        if (channelData.name) return channelData.name;
        const enc = channelData.nameEnc;
        if (!enc) return '?';

        const cached = this._nameCache[enc];
        if (typeof cached === 'string') return cached;

        if (cached === undefined) {
            this._nameCache[enc] = false;
            const key = CryptoManager.getServerKey(serverId);
            if (key) {
                CryptoManager.decryptText(key, enc)
                    .then(name => { this._nameCache[enc] = name; this.renderServerList(); })
                    .catch(() => {});
            }
        }
        return '🔒︎ ???';
    }

    // Retry after key change
    _clearNameCache() {
        this._nameCache = {};
    }

    // Server list
    renderServerList() {
        const listEl = document.getElementById('serverList');
        if (!listEl) return;

        listEl.innerHTML = '';
        const filter  = (this.searchInput ? this.searchInput.value : '').trim();
        const entries = Object.entries(this.state.serversCache);

        if (entries.length === 0) {
            listEl.innerHTML = '<div style="padding:10px; opacity:0.6">No servers. Create one!</div>';
            return;
        }

        const filtered = entries.filter(([, s]) =>
            !filter || (s.name || '').toLowerCase().includes(filter.toLowerCase())
        );

        filtered.forEach(([serverId, server]) => {
            try {
                this._renderServer(listEl, serverId, server, filter);
            } catch (e) {
                console.error('[LIST] Failed to render server:', serverId, e);
            }
        });
    }

    _renderServer(listEl, serverId, server, filter) {
        const isExpanded = this.state.expandedServers.has(serverId);
        const serverDiv  = document.createElement('div');
        serverDiv.className = 'tree-item tree-server';
        if (isExpanded) serverDiv.classList.add('active');
        if (this.state.currentServerId === serverId) serverDiv.classList.add('selected');

        const arrow = isExpanded ? '▼' : '▶';
        const serverHasPing = !!(server.channels?.text &&
            Object.keys(server.channels.text).some(cid => this.state.pingedChats.has(cid)));
        const isLocked = !!(server.password && server.password !== '');
        const isEnc    = !!server.encrypted;

        // 🔒︎ / 🔒︎+Enc badge
        let badge = '';
        if (isLocked && isEnc)  badge = '<span class="lock-icon" title="Password + encrypted">🔒︎+Enc</span>';
        else if (isLocked)      badge = '<span class="lock-icon" title="Password protected">🔒︎</span>';
        else if (isEnc)         badge = '<span class="lock-icon" title="Encrypted">+Enc</span>';

        serverDiv.innerHTML = `<span class="tree-prefix" style="font-size:10px;vertical-align:middle;margin-right:6px;">${arrow}</span>${escapeHtml(server.name)}${serverHasPing ? '<span class="ping-dot" title="Mention"></span>' : ''}${badge}`;

        serverDiv.onclick = () => {
            if (this.state.expandedServers.has(serverId)) {
                this.state.expandedServers.delete(serverId);
                this.renderServerList();
                return;
            }
            this._checkServerAccess(serverId, () => {
                this.state.currentServerId = serverId;
                this.state.expandedServers.add(serverId);
                this.renderServerList();
                this._promptServerKey(serverId);
            });
        };
        serverDiv.oncontextmenu = (e) => {
            e.preventDefault();
            this.openEditModal('server', serverId);
        };
        listEl.appendChild(serverDiv);

        if (isExpanded || filter) {
            this._renderTextChannels(listEl, serverId, server);
            this._renderVoiceChannels(listEl, serverId, server);
        }
    }

    _renderTextChannels(listEl, serverId, server) {
        const txtCat = document.createElement('div');
        txtCat.className = 'tree-item tree-category indent-1';
        txtCat.innerHTML = `<span class="tree-prefix"></span>TEXT CHATS: <span class="add-channel-btn" title="Create Text Channel" onclick="app.chat.openChannelCreateModal('${serverId}', 'text')">+</span>`;
        listEl.appendChild(txtCat);

        if (!server.channels?.text) return;
        Object.entries(server.channels.text).forEach(([channelId, channelData]) => {
            const chanDiv = document.createElement('div');
            chanDiv.className = 'tree-item tree-channel indent-2';
            if (this.state.currentChatId === channelId) chanDiv.classList.add('active');

            const hasPing = this.state.pingedChats.has(channelId);
            const chanName = this._channelName(serverId, channelData);
            chanDiv.innerHTML = `<span class="tree-prefix">|_</span><span style="opacity:0.7">#</span> ${escapeHtml(chanName)}${hasPing ? '<span class="ping-dot" title="Mention"></span>' : ''}`;

            chanDiv.onclick = () => {
                this._checkServerAccess(serverId, () => {
                    this.state.currentServerId    = serverId;
                    this.state.currentChannelId   = channelId;
                    this.state.currentChannelType = 'text';
                    this.state.currentChatId      = channelId;
                    this.state.expandedServers.add(serverId);
                    this.renderServerList();
                    this.joinChat(channelId);
                });
            };
            chanDiv.oncontextmenu = (e) => {
                e.preventDefault();
                this.openEditModal('text', serverId, channelId);
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
            const chanName = this._channelName(serverId, channelData);
            chanDiv.innerHTML = `
                <span style="display:flex;align-items:center;overflow:hidden;">
                    <span class="tree-prefix">|_</span>🔊 ${escapeHtml(chanName)}
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
            chanDiv.oncontextmenu = (e) => {
                e.preventDefault();
                this.openEditModal('voice', serverId, channelId);
            };
            listEl.appendChild(chanDiv);

            const voiceData = this.state.voiceChatsCache[channelId];
            if (voiceData?.users) {
                Object.entries(voiceData.users).forEach(([uid, uData]) => {
                    app.voice.renderVoiceUserInTree(listEl, channelId, uid, uData);
                });
            }
        });
    }

    // Create server
    openCreateModal() {
        this.modal.show(`
            <h4>CREATE NEW SERVER</h4>
            <div class="row">
                <label>Server Name (max ${this.NAME_MAX} chars)</label>
                <input id="newName" placeholder="e.g. My Gaming Server" maxlength="${this.NAME_MAX}" />
            </div>
            <div class="row">
                <label>Access Password</label>
                <input id="newPass" placeholder="leave empty for public" type="password" />
            </div>
            <div class="row">
                <label>Admin/Delete Password</label>
                <input id="newDeletePass" placeholder="required to edit/delete server" type="password" />
            </div>
            <div class="row" style="flex-direction:row !important;align-items:center !important;gap:8px;">
                <input id="newEncrypted" type="checkbox" style="width:auto !important;" />
                <label style="width:auto !important;margin:0;">Enable message encryption (E2E)</label>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                <button id="cancelCreate" class="btn btn-ghost">Cancel</button>
                <button id="confirmCreate" class="btn btn-primary">Create Server</button>
            </div>
        `);

        document.getElementById('cancelCreate').onclick = () => this.modal.close();
        document.getElementById('confirmCreate').onclick = async () => {
            const name       = String(document.getElementById('newName').value       || '').trim();
            const pass       = String(document.getElementById('newPass').value       || '');
            const deletePass = String(document.getElementById('newDeletePass').value || '');
            const encrypted  = document.getElementById('newEncrypted').checked;

            if (!name)                        { this.modal.alert('Provide server name');    return; }
            if (name.length > this.NAME_MAX)  { this.modal.alert(`Name too long (max ${this.NAME_MAX} chars)`); return; }
            if (!deletePass)                  { this.modal.alert('Provide admin password'); return; }

            const hashedPass       = pass ? await this.auth.hashPassword(pass) : '';
            const hashedDeletePass = await this.auth.hashPassword(deletePass);

            const newServerRef   = this.state.serversRef.push();
            const defaultTextId  = newServerRef.child('channels/text').push().key;
            const defaultVoiceId = newServerRef.child('channels/voice').push().key;

            // Key + encrypted names
            let keyHex = null, encCheck = null;
            let textChan  = { name: 'general', type: 'text'  };
            let voiceChan = { name: 'Lobby',   type: 'voice' };
            if (encrypted) {
                keyHex    = CryptoManager.generateKeyHex();
                encCheck  = await CryptoManager.makeKeyCheck(keyHex);
                textChan  = { nameEnc: await CryptoManager.encryptText(keyHex, 'general'), type: 'text'  };
                voiceChan = { nameEnc: await CryptoManager.encryptText(keyHex, 'Lobby'),   type: 'voice' };
            }

            newServerRef.set({
                name, password: hashedPass, deletePassword: hashedDeletePass,
                encrypted,
                encCheck,
                createdAt: Date.now(),
                ownerId: this.state.currentUser ? this.state.currentUser.uid : null,
                channels: {
                    text:  { [defaultTextId]:  textChan },
                    voice: { [defaultVoiceId]: voiceChan },
                }
            }).then(() => {
                this.modal.close();
                if (encrypted) {
                    CryptoManager.setServerKey(newServerRef.key, keyHex);
                    this._showKeyModal(keyHex);
                } else {
                    this.modal.alert('Server created! Please select it from the list.');
                }
            }).catch(e => this.modal.alert('Error: ' + e.message));
        };
    }

    // Show generated key
    _showKeyModal(keyHex) {
        this.modal.show(`
            <h4>SERVER ENCRYPTION KEY</h4>
            <p style="font-size:13px;opacity:0.8;margin:0 0 8px;">
                Save this key now — it is <strong>not stored anywhere</strong> except your browser.
                Share it privately with server members. Without it, messages cannot be decrypted.
            </p>
            <div class="key-box" id="keyBox">${keyHex}</div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
                <button id="copyKey" class="btn btn-ghost">Copy Key</button>
                <button id="keyDone" class="btn btn-primary">Done</button>
            </div>
        `);
        document.getElementById('copyKey').onclick = () => {
            navigator.clipboard.writeText(keyHex).then(() => {
                document.getElementById('copyKey').textContent = 'Copied!';
            }).catch(() => {});
        };
        document.getElementById('keyDone').onclick = () => this.modal.close();
    }

    openChannelCreateModal(serverId, type) {
        const title = type === 'text' ? 'NEW TEXT CHANNEL' : 'NEW VOICE CHANNEL';
        this.modal.show(`
            <h4>${title}</h4>
            <div class="row">
                <label>Channel Name (max ${this.NAME_MAX} chars)</label>
                <input id="newChannelName" placeholder="e.g. general" maxlength="${this.NAME_MAX}" />
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                <button id="cancelChan" class="btn btn-ghost">Cancel</button>
                <button id="confirmChan" class="btn btn-primary">Create</button>
            </div>
        `);

        document.getElementById('cancelChan').onclick = () => this.modal.close();
        document.getElementById('confirmChan').onclick = async () => {
            const name = String(document.getElementById('newChannelName').value || '').trim();
            if (!name)                       { this.modal.alert('Please enter a name'); return; }
            if (name.length > this.NAME_MAX) { this.modal.alert(`Name too long (max ${this.NAME_MAX} chars)`); return; }

            const server = this.state.serversCache[serverId];
            let payload = { name, type };
            if (server?.encrypted) {
                const key = CryptoManager.getServerKey(serverId);
                if (!key) {
                    this.modal.alert('Enter the encryption key first (click the server name).');
                    return;
                }
                payload = { nameEnc: await CryptoManager.encryptText(key, name), type };
            }

            this.state.db.ref(`servers/${serverId}/channels/${type}`)
                .push(payload)
                .then(() => { this.modal.close(); this.modal.alert('Channel created!'); })
                .catch(err => this.modal.alert('Error: ' + err.message));
        };
    }

    // Edit modal
    openEditModal(kind, serverId, channelId = null) {
        const server = this.state.serversCache[serverId];
        if (!server) return;

        const isServer = kind === 'server';
        const target   = isServer ? server : server.channels?.[kind]?.[channelId];
        if (!target) return;

        const displayName = isServer
            ? (target.name || '')
            : this._channelName(serverId, target);

        // Local key only — encryption is create-time only
        const encRows = (!isServer || !server.encrypted) ? '' : `
            <div class="row">
                <label>Encryption Key (local only)</label>
                <div style="display:flex;gap:6px;width:100%;">
                    <input id="editLocalKey" maxlength="64" placeholder="Paste 64 hex chars" style="font-family:monospace;flex:1;" value="${escapeHtml(CryptoManager.getServerKey(serverId) || '')}" autocomplete="off" />
                    <button id="saveLocalKey" class="btn btn-ghost">Save</button>
                </div>
            </div>`;

        const serverRows = isServer ? `
            <div class="row">
                <label>New Join Password (empty = keep)</label>
                <input id="editJoinPass" type="password" placeholder="unchanged" autocomplete="new-password" />
            </div>
            <div class="row" style="flex-direction:row !important;align-items:center !important;gap:8px;">
                <input id="editMakePublic" type="checkbox" style="width:auto !important;" />
                <label style="width:auto !important;margin:0;">Remove join password (make public)</label>
            </div>
            <div class="row">
                <label>New Admin Password (empty = keep)</label>
                <input id="editAdminPass" type="password" placeholder="unchanged" autocomplete="new-password" />
            </div>
            ${encRows}` : '';

        this.modal.show(`
            <h4>EDIT ${isServer ? 'SERVER' : kind.toUpperCase() + ' CHANNEL'}: ${escapeHtml(displayName)}</h4>
            <div class="row">
                <label>Name (max ${this.NAME_MAX} chars)</label>
                <input id="editName" maxlength="${this.NAME_MAX}" value="${escapeHtml(displayName === '🔒︎ ???' ? '' : displayName)}" />
            </div>
            ${serverRows}
            <div class="row">
                <label>Current server Admin Password (required)</label>
                <input id="editAuthPass" type="password" placeholder="Password" autocomplete="new-password" />
            </div>
            <div style="display:flex;gap:8px;justify-content:space-between;margin-top:8px">
                <button id="editDelete" class="btn" style="background:#b91c1c;color:white">${isServer ? 'Delete Server' : 'Delete Channel'}</button>
                <div style="display:flex;gap:8px;">
                    <button id="editCancel" class="btn btn-ghost">Cancel</button>
                    <button id="editSave" class="btn btn-primary">Save</button>
                </div>
            </div>
        `);

        document.getElementById('editCancel').onclick = () => this.modal.close();

        // Local key update (verified)
        const saveLocalKeyBtn = document.getElementById('saveLocalKey');
        if (saveLocalKeyBtn) {
            saveLocalKeyBtn.onclick = async () => {
                const key = String(document.getElementById('editLocalKey').value || '').trim();
                if (!CryptoManager.isValidKey(key)) { this.modal.alert('Key must be exactly 64 hex characters.'); return; }
                if (!(await CryptoManager.verifyKey(key, server.encCheck))) {
                    this.modal.alert('Wrong encryption key.');
                    return;
                }
                CryptoManager.setServerKey(serverId, key);
                this._clearNameCache();
                this.modal.close();
                this.modal.alert('Encryption key saved locally.');
                this.renderServerList();
                if (this.state.currentChatId) this.joinChat(this.state.currentChatId);
            };
        }

        document.getElementById('editSave').onclick = async () => {
            const name = String(document.getElementById('editName').value || '').trim();
            if (!name)                       { this.modal.alert('Provide a name'); return; }
            if (name.length > this.NAME_MAX) { this.modal.alert(`Name too long (max ${this.NAME_MAX} chars)`); return; }

            const authPass = String(document.getElementById('editAuthPass').value || '');
            if (!(await this._authorizeServerAdmin(serverId, server, authPass))) {
                this.modal.alert('Wrong admin password.');
                return;
            }

            const updates = {};
            if (isServer) {
                updates[`servers/${serverId}/name`] = name;

                const makePublic = document.getElementById('editMakePublic').checked;
                const joinPass   = String(document.getElementById('editJoinPass').value  || '');
                const adminPass  = String(document.getElementById('editAdminPass').value || '');

                if (makePublic)    updates[`servers/${serverId}/password`] = '';
                else if (joinPass) updates[`servers/${serverId}/password`] = await this.auth.hashPassword(joinPass);
                if (adminPass)     updates[`servers/${serverId}/deletePassword`] = await this.auth.hashPassword(adminPass);
            } else if (server.encrypted) {
                const key = CryptoManager.getServerKey(serverId);
                if (!key) {
                    this.modal.alert('Enter the encryption key first (click the server name).');
                    return;
                }
                updates[`servers/${serverId}/channels/${kind}/${channelId}/nameEnc`] = await CryptoManager.encryptText(key, name);
                updates[`servers/${serverId}/channels/${kind}/${channelId}/name`] = null;
                this._clearNameCache();
            } else {
                updates[`servers/${serverId}/channels/${kind}/${channelId}/name`] = name;
            }

            this.state.db.ref().update(updates).then(() => {
                this.modal.close();
                this.modal.alert('Changes saved.');
            }).catch(e => this.modal.alert('Error: ' + e.message));
        };

        document.getElementById('editDelete').onclick = async () => {
            const authPass = String(document.getElementById('editAuthPass').value || '');
            if (!(await this._authorizeServerAdmin(serverId, server, authPass))) {
                this.modal.alert('Wrong admin password.');
                return;
            }
            if (!confirm(`Delete "${displayName}"? This cannot be undone.`)) return;

            const updates = {};
            if (isServer) {
                updates[`servers/${serverId}`] = null;
                Object.keys(server.channels?.text || {}).forEach(cid => {
                    updates[`chats/${cid}`] = null;
                });
                Object.keys(server.channels?.voice || {}).forEach(cid => {
                    updates[`voice_chats/${cid}`]     = null;
                    updates[`voice_signaling/${cid}`] = null;
                });
            } else if (kind === 'text') {
                updates[`servers/${serverId}/channels/text/${channelId}`] = null;
                updates[`chats/${channelId}`] = null;
            } else {
                updates[`servers/${serverId}/channels/voice/${channelId}`] = null;
                updates[`voice_chats/${channelId}`]     = null;
                updates[`voice_signaling/${channelId}`] = null;
            }

            this.state.db.ref().update(updates).then(() => {
                this.modal.close();

                const deletedTextIds  = isServer ? Object.keys(server.channels?.text  || {}) : (kind === 'text'  ? [channelId] : []);
                const deletedVoiceIds = isServer ? Object.keys(server.channels?.voice || {}) : (kind === 'voice' ? [channelId] : []);

                if (this.state.currentChatId && deletedTextIds.includes(this.state.currentChatId)) this.detachChat();
                if (this.state.currentVoiceChatId && deletedVoiceIds.includes(this.state.currentVoiceChatId)) app.voice.leaveVoiceChat();

                this.modal.alert('Deleted successfully.');
                this.renderServerList();
            }).catch(e => this.modal.alert('Error deleting: ' + e.message));
        };
    }

    // Admin authorization
    async _authorizeServerAdmin(serverId, server, entered) {
        if (this.auth.isAdmin()) return true;
        if (entered && await this.auth.checkAdminPassword(entered)) return true;

        const res = await this.auth.verifySecret(entered, server.deletePassword);
        if (res.ok && res.upgrade) {
            this.state.db.ref(`servers/${serverId}/deletePassword`).set(await this.auth.hashPassword(entered));
        }
        return res.ok;
    }

    // Join password gate
    _checkServerAccess(serverId, callback) {
        const server = this.state.serversCache[serverId];
        if (!server) return;

        const isOwner        = this.state.currentUser && server.ownerId === this.state.currentUser.uid;
        const isAccountAdmin = this.auth.isAdmin();
        const isUnlocked     = this.state.unlockedServers.has(serverId);
        const hasNoPass      = !server.password || server.password === '';

        if (hasNoPass || isUnlocked || isOwner || isAccountAdmin) { callback(); return; }

        this.modal.show(`
            <h4>Server Locked</h4>
            <div class="row">
                <label>Enter Server Password</label>
                <input id="serverPassInput" type="password" placeholder="Password" autocomplete="new-password" />
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                <button id="cancelServerAuth" class="btn btn-ghost">Cancel</button>
                <button id="confirmServerAuth" class="btn btn-primary">Enter</button>
            </div>
        `);

        document.getElementById('cancelServerAuth').onclick = () => this.modal.close();
        document.getElementById('confirmServerAuth').onclick = async () => {
            const val         = String(document.getElementById('serverPassInput').value || '');
            const res         = await this.auth.verifySecret(val, server.password);
            const isAdminPass = await this.auth.checkAdminPassword(val);

            if (res.ok || isAdminPass) {
                // Plaintext to hash
                if (res.ok && res.upgrade) {
                    this.state.db.ref(`servers/${serverId}/password`).set(await this.auth.hashPassword(val));
                }
                this.state.unlockedServers.add(serverId);
                this.modal.close();
                callback();
            } else {
                this.modal.alert('Wrong password!');
            }
        };
    }

    // Encryption key prompt
    _promptServerKey(serverId) {
        const server = this.state.serversCache[serverId];
        if (!server?.encrypted) return;
        if (CryptoManager.getServerKey(serverId)) return;

        this.modal.show(`
            <h4>ENCRYPTED SERVER</h4>
            <p style="font-size:13px;opacity:0.8;margin:0 0 8px;">
                Messages on this server are end-to-end encrypted.
                Enter the 64-character key to read and write messages.
            </p>
            <div class="row">
                <label>Encryption Key (64 hex chars)</label>
                <input id="serverKeyInput" maxlength="64" placeholder="Paste key here" style="font-family:monospace;" autocomplete="off" />
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                <button id="skipServerKey" class="btn btn-ghost">Skip</button>
                <button id="confirmServerKey" class="btn btn-primary">Save Key</button>
            </div>
        `);

        document.getElementById('skipServerKey').onclick = () => this.modal.close();
        document.getElementById('confirmServerKey').onclick = async () => {
            const key = String(document.getElementById('serverKeyInput').value || '').trim();
            if (!CryptoManager.isValidKey(key)) { this.modal.alert('Key must be exactly 64 hex characters.'); return; }
            if (!(await CryptoManager.verifyKey(key, server.encCheck))) {
                this.modal.alert('Wrong encryption key.');
                return;
            }
            CryptoManager.setServerKey(serverId, key);
            this._clearNameCache();
            this.modal.close();
            this.renderServerList();
            if (this.state.currentChatId && this.state.currentServerId === serverId) {
                this.joinChat(this.state.currentChatId);
            }
        };
    }

    // Server of chat
    _findServerIdByChatId(chatId) {
        for (const [sid, s] of Object.entries(this.state.serversCache)) {
            if (s.channels?.text?.[chatId]) return sid;
        }
        return null;
    }

    // Join chat
    joinChat(id) {
        const overlay = document.getElementById('stream-overlay');
        if (overlay) overlay.remove();

        this.messagesEl.style.display = 'block';
        const inputPanel = document.querySelector('.msg-input');
        if (inputPanel) inputPanel.style.display = 'flex';

        this.state.currentWatchedUid = null;
        this.state.currentChatId  = id;
        this.state.currentChatRef = this.state.db.ref('chats/' + id);

        let foundName = null;
        for (const [sid, s] of Object.entries(this.state.serversCache)) {
            if (s.channels?.text?.[id]) {
                foundName = this._channelName(sid, s.channels.text[id]);
                break;
            }
        }

        this.chatTitle.textContent     = foundName || '—';
        this.chatSubtitle.textContent  = 'ID: ' + id;
        this.welcomeArea.style.display = 'none';
        this.chatArea.style.display    = 'flex';
        this.messagesEl.innerHTML      = '';

        // Loading indicator
        console.log(`%c[CHAT] Loading chat: ${id}`, 'color:#0ea5ff;font-weight:bold;');
        const loadingEl = document.createElement('div');
        loadingEl.className   = 'chat-status';
        loadingEl.textContent = 'Loading...';
        this.messagesEl.appendChild(loadingEl);
        const clearLoading = () => {
            const el = this.messagesEl.querySelector('.chat-status');
            if (el) el.remove();
        };

        this.auth.ensureUsersCache().catch(() => {});
        this.state.chatParticipants = new Set();
        this._hideMentionBox();

        // Clear own ping
        if (this.state.currentUser?.uid) {
            this.state.db.ref(`chats/${id}/pings/${this.state.currentUser.uid}`).remove();
        }

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

        const chatServerId = this._findServerIdByChatId(id);

        this.state.messagesRef.on('child_added', snap => {
            clearLoading();
            const m     = snap.val();
            const msgId = snap.key;

            if (m?.nickname) this.state.chatParticipants.add(String(m.nickname));

            const timeStr = m.createdAt
                ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : (m.time ? String(m.time).split(' ').pop() : '');

            let displayNick = m.nickname || 'Anon';
            if (m.userId && this.state.usersCacheById[m.userId]?.admin === 1) displayNick += ' [ADMIN]';

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

            // Meta: Nick [time]
            const meta     = document.createElement('div'); meta.className = 'meta-line';
            const nickSpan = document.createElement('span');
            nickSpan.textContent = displayNick;
            nickSpan.className   = 'msg-nick' + (m.userId ? ' msg-nick-registered' : '');
            const timeSpan = document.createElement('span');
            timeSpan.textContent = ` [${timeStr}]`;
            timeSpan.className   = 'msg-time';
            meta.appendChild(nickSpan);
            meta.appendChild(timeSpan);

            const bubble = document.createElement('div'); bubble.className = 'message';

            if (m.enc) {
                this._renderEncrypted(bubble, m.enc, chatServerId);
            } else if (m.text) {
                this._renderTextWithLinks(bubble, m.text);
            } else if (m.imageBase64) {
                this._renderImage(bubble, m.imageBase64, initialLoad);
            } else if (m.fileBase64) {
                this._renderFile(bubble, m.fileBase64, m.fileName, m.fileSize);
            }

            // Delete own message
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

            if (initialLoad || (this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight < 300)) {
                this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
            }
        });

        this.state.messagesRef.once('value', () => {
            clearLoading();
            console.log(`%c[CHAT] Chat content loaded: ${id}`, 'color:#22c55e;');
            initialLoad = false;
            setTimeout(() => { this.messagesEl.scrollTop = this.messagesEl.scrollHeight; }, 100);
        }, (err) => {
            console.error('[CHAT] Failed to load chat content:', err);
            const el = this.messagesEl.querySelector('.chat-status');
            if (el) el.textContent = 'Failed to load chat content';
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

    // Send message
    sendMessage() {
        if (!this.state.currentChatId) { this.modal.alert('Join a chat first'); return; }
        this._actuallySendMessage();
    }

    async _actuallySendMessage() {
        const text = String(this.messageInput?.value || '').trim();
        if (!text && !this.selectedImageBase64 && !this.selectedFileBase64) return;

        const nick = this.auth.getDisplayNick();

        const now = new Date();
        const t   = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const mentionedUserIds = await this._resolveMentionedUserIds(text);

        // Encrypt if enabled
        let outText = text || null;
        let outEnc  = null;
        const sid = this._findServerIdByChatId(this.state.currentChatId);
        const srv = sid ? this.state.serversCache[sid] : null;
        if (srv?.encrypted && text) {
            const key = CryptoManager.getServerKey(sid);
            if (!key) {
                this.modal.alert('This server is encrypted. Click the server name to enter the encryption key first.');
                return;
            }
            if (!(await CryptoManager.verifyKey(key, srv.encCheck))) {
                localStorage.removeItem('konsmon_enc_key_' + sid);
                this.modal.alert('Wrong encryption key saved locally. Enter the correct key first.');
                this._promptServerKey(sid);
                return;
            }
            outEnc  = await CryptoManager.encryptText(key, text);
            outText = null;
        }

        const msgData = {
            nickname:    nick,
            text:        outText,
            enc:         outEnc,
            imageBase64: this.selectedImageBase64,
            fileBase64:  this.selectedFileBase64,
            fileName:    this.selectedFileName,
            fileSize:    this.selectedFileSize,
            time:        t,
            createdAt:   Date.now(),
            userId:      this.state.currentUser ? this.state.currentUser.uid : null,
        };

        this.state.db.ref(`chats/${this.state.currentChatId}/messages`).push(msgData).then(() => {
            if (this.messageInput) this.messageInput.value = '';
            this.selectedImageBase64 = null;
            this.selectedFileBase64  = null;
            this.selectedFileName    = null;
            this.selectedFileSize    = null;
            const ex = document.querySelector('#messageInput + img, #messageInput + .file-preview');
            if (ex) ex.remove();
            if (mentionedUserIds.length > 0) {
                this._addPingsForUsers(this.state.currentChatId, mentionedUserIds, nick, this.state.currentUser?.uid);
            }
        });
    }

    // File select
    _handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > this.MAX_FILE_SIZE) { this.modal.alert('File too large (max 10Mb)'); e.target.value = ''; return; }

        this.selectedImageBase64 = null;
        this.selectedFileBase64  = null;
        this.selectedFileName    = null;
        this.selectedFileType    = null;
        this.selectedFileSize    = null;
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
                this.selectedFileSize   = file.size;
                const d = document.createElement('div');
                d.className   = 'file-preview';
                d.textContent = `${file.name} (${this._formatFileSize(file.size)})`;
                this.messageInput?.insertAdjacentElement('afterend', d);
            }
        };
        reader.readAsDataURL(file);
    }

    _formatFileSize(bytes) {
        const b = Number(bytes) || 0;
        if (b <= 0) return '';
        if (b < 1024) return b + ' B';
        if (b < 1024 * 1024) return (b / 1024).toFixed(2) + ' KB';
        return (b / (1024 * 1024)).toFixed(2) + ' MB';
    }

    // Render helpers
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

    // Decrypt or gibberish
    _renderEncrypted(bubble, enc, serverId) {
        const showCipher = () => {
            bubble.classList.add('msg-encrypted');
            bubble.textContent = '🔒 ' + enc;
            bubble.title = 'Encrypted message (no valid key)';
        };
        const key = serverId ? CryptoManager.getServerKey(serverId) : null;
        if (!key) { showCipher(); return; }
        CryptoManager.decryptText(key, enc)
            .then(text => this._renderTextWithLinks(bubble, text))
            .catch(() => showCipher());
    }

    _renderImage(bubble, src, initialLoad) {
        const img  = document.createElement('img');
        img.src    = src;
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', e => {
            e.stopPropagation();
            document.getElementById('modalContent').innerHTML =
                `<div class="modal-viewer"><a class="modal-download" href="${src}" download="img.png">Download</a><img src="${src}" class="modal-image"/></div>`;
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

    _isAudioFile(fileName) {
        if (!fileName) return false;
        const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'weba', 'opus'];
        const ext = fileName.split('.').pop().toLowerCase();
        return audioExts.includes(ext);
    }

    _renderFile(bubble, src, fileName, fileSize) {
        // Estimate legacy size
        let size = Number(fileSize) || 0;
        if (!size && src) {
            const dataIdx = src.indexOf(',');
            size = Math.round((src.length - (dataIdx + 1)) * 3 / 4);
        }

        // Check if it's an audio file
        if (this._isAudioFile(fileName)) {
            this._renderAudio(bubble, src, fileName, size);
            return;
        }

        const link      = document.createElement('a');
        link.href       = src;
        link.download   = fileName || 'file';
        link.className  = 'file-msg';
        link.title      = 'Download file';

        const icon = document.createElement('img');
        icon.src       = 'gfx/file.png';
        icon.alt       = 'file';
        icon.className = 'file-icon';
        icon.style.width = '40px';
        icon.style.height = '50px';

        const info = document.createElement('span');
        info.className = 'file-info';

        const nameEl = document.createElement('span');
        nameEl.className   = 'file-name';
        nameEl.textContent = fileName || 'file';

        const sizeEl = document.createElement('span');
        sizeEl.className   = 'file-size';
        sizeEl.textContent = this._formatFileSize(size);

        info.appendChild(nameEl);
        info.appendChild(sizeEl);
        link.appendChild(icon);
        link.appendChild(info);
        bubble.appendChild(link);
    }

    _renderAudio(bubble, src, fileName, fileSize) {
        const container = document.createElement('div');
        container.className = 'audio-player-container';

        // Hidden audio element for playback
        const audio = document.createElement('audio');
        audio.src = src;
        audio.className = 'audio-player-element';

        // Custom player controls
        const playerDiv = document.createElement('div');
        playerDiv.className = 'audio-player-custom';

        // Play button
        const playBtn = document.createElement('button');
        playBtn.className = 'audio-play-btn';
        playBtn.innerHTML = '▶';
        playBtn.title = 'Play/Pause';
        let isPlaying = false;
        playBtn.onclick = (e) => {
            e.stopPropagation();
            if (isPlaying) {
                audio.pause();
                playBtn.innerHTML = '▶';
                isPlaying = false;
            } else {
                audio.play();
                playBtn.innerHTML = '⏸';
                isPlaying = true;
            }
        };
        audio.onplay = () => { playBtn.innerHTML = '⏸'; isPlaying = true; };
        audio.onpause = () => { playBtn.innerHTML = '▶'; isPlaying = false; };
        audio.onended = () => { playBtn.innerHTML = '▶'; isPlaying = false; };

        // Progress bar
        const progressContainer = document.createElement('div');
        progressContainer.className = 'audio-progress-container';

        const progressBar = document.createElement('input');
        progressBar.type = 'range';
        progressBar.className = 'audio-progress-bar';
        progressBar.min = '0';
        progressBar.value = '0';
        progressBar.onclick = (e) => e.stopPropagation();

        audio.onloadedmetadata = () => {
            progressBar.max = audio.duration;
        };

        audio.ontimeupdate = () => {
            progressBar.value = audio.currentTime;
        };

        progressBar.oninput = () => {
            audio.currentTime = progressBar.value;
        };

        progressContainer.appendChild(progressBar);

        // Time display
        const timeDiv = document.createElement('div');
        timeDiv.className = 'audio-time';
        timeDiv.textContent = '0:00 / 0:00';

        const formatTime = (seconds) => {
            if (isNaN(seconds)) return '0:00';
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        audio.ontimeupdate = () => {
            progressBar.value = audio.currentTime;
            timeDiv.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
        };

        // Volume control
        const volumeContainer = document.createElement('div');
        volumeContainer.className = 'audio-volume-container';

        const volumeBtn = document.createElement('button');
        volumeBtn.className = 'audio-volume-btn';
        volumeBtn.textContent = '🔊';
        volumeBtn.title = 'Show volume slider';
        volumeBtn.onclick = (e) => {
            e.stopPropagation();
            const visible = volumeSlider.classList.toggle('audio-volume-visible');
            volumeBtn.title = visible ? 'Hide volume slider' : 'Show volume slider';
        };

        const volumeSlider = document.createElement('input');
        volumeSlider.type = 'range';
        volumeSlider.className = 'audio-volume-slider';
        volumeSlider.min = '0';
        volumeSlider.max = '1';
        volumeSlider.step = '0.01';
        volumeSlider.value = '1';
        volumeSlider.title = 'Volume';
        volumeSlider.onclick = (e) => e.stopPropagation();
        volumeSlider.oninput = () => {
            audio.volume = volumeSlider.value;
            if (audio.muted) audio.muted = false;
        };

        volumeContainer.appendChild(volumeBtn);
        volumeContainer.appendChild(volumeSlider);

        // Download button
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'audio-download-icon-btn';
        downloadBtn.textContent = '↓';
        downloadBtn.title = 'Download audio file';
        downloadBtn.onclick = (e) => {
            e.stopPropagation();
            const link = document.createElement('a');
            link.href = src;
            link.download = fileName || 'audio';
            link.click();
        };

        // File info section
        const infoDiv = document.createElement('div');
        infoDiv.className = 'audio-info';

        const nameEl = document.createElement('span');
        nameEl.className = 'audio-name';
        nameEl.textContent = fileName || 'audio';

        const sizeEl = document.createElement('span');
        sizeEl.className = 'audio-size';
        sizeEl.textContent = this._formatFileSize(fileSize);

        infoDiv.appendChild(nameEl);
        infoDiv.appendChild(sizeEl);

        // Assemble player
        playerDiv.appendChild(playBtn);
        playerDiv.appendChild(progressContainer);
        playerDiv.appendChild(timeDiv);
        playerDiv.appendChild(volumeContainer);
        playerDiv.appendChild(downloadBtn);

        container.appendChild(audio);
        container.appendChild(playerDiv);
        container.appendChild(infoDiv);
        bubble.appendChild(container);
    }

    // Mention autocomplete
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
        const startIdx  = before.lastIndexOf('@');
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

    // Ping notifications
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
                    const endPos   = idx + 1 + nickLower.length;
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
}

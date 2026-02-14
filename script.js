// FIREBASE CONFIG
        const firebaseConfig = {
            apiKey: "AIzaSyBeDzJgPfga58CNlEFriKkxVBG-d04JXO4",
            authDomain: "konsmon-website.firebaseapp.com",
            databaseURL: "https://konsmon-website-default-rtdb.europe-west1.firebasedatabase.app",
            projectId: "konsmon-website",
            storageBucket: "konsmon-website.firebasestorage.app",
            messagingSenderId: "1004639372000",
            appId: "1:1004639372000:web:49980358b5ac43526e8685",
            measurementId: "G-WJE8C8CY3E"
        };


        firebase.initializeApp(firebaseConfig);
        const db = firebase.database();
        const usersRef = db.ref('users');
        // ADMIN PASSWORD
        let adminPassword = null;

        // Pobranie hasła admina z bazy
        db.ref('admin/password').once('value').then(snap => {
            adminPassword = snap.val() || '';
        }).catch(err => {
            console.error('error, admin passowrld was not found', err);
        });


        // UI refs
        const chatListEl = document.getElementById('chatList');
        const btnCreate = document.getElementById('btnCreate');
        const btnRefresh = document.getElementById('btnRefresh');
        const createQuick = document.getElementById('createQuick');
        const searchInput = document.getElementById('searchInput');
        const searchBtn = document.getElementById('searchBtn');

        const welcomeArea = document.getElementById('welcomeArea');
        const chatArea = document.getElementById('chatArea');
        const chatTitle = document.getElementById('chatTitle');
        const chatSubtitle = document.getElementById('chatSubtitle');
        const messagesEl = document.getElementById('messages');
        const nicknameInput = document.getElementById('nicknameInput');
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const leaveBtn = document.getElementById('leaveBtn');
        const deleteBtn = document.getElementById('deleteBtn');

        const modal = document.getElementById('modal');
        const modalContent = document.getElementById('modalContent');



        // State
        let chatsCache = {};
        let currentChatId = null;
        let currentChatRef = null;
        let messagesRef = null;

        let chatParticipants = new Set();
        let mentionBox = null;
        let mentionHideTimer = null;

        let usersCacheByNickLower = {};
        let usersNicknamesLower = [];
        let usersNicknamesDisplay = [];
        let usersCacheById = {};
        let usersCacheLoaded = false;

        function buildUsersCache(raw) {
            usersCacheByNickLower = {};
            usersCacheById = {};
            usersNicknamesLower = [];
            usersNicknamesDisplay = [];
            Object.entries(raw || {}).forEach(([uid, data]) => {
                const nick = String(data?.nick || '').trim();
                if (!nick) return;
                const lower = nick.toLowerCase();
                if (!usersCacheByNickLower[lower]) usersCacheByNickLower[lower] = uid;
                usersCacheById[uid] = { ...data, uid };
                usersNicknamesLower.push(lower);
                usersNicknamesDisplay.push(nick);
            });
            usersCacheLoaded = true;
        }

        async function ensureUsersCache() {
            if (usersCacheLoaded) return;
            const snap = await usersRef.once('value');
            buildUsersCache(snap.val() || {});
        }

        usersRef.on('value', snap => {
            buildUsersCache(snap.val() || {});
        });

        let _modalResizeHandler = null;

        function adjustModalImage() {
            const imgEl = modalContent.querySelector('.modal-image');
            if (!imgEl) return;
            const pad = 48; // total horizontal/vertical padding to leave
            const availW = Math.max(100, window.innerWidth - pad);
            const availH = Math.max(100, window.innerHeight - pad);
            const natW = imgEl.naturalWidth || imgEl.width || availW;
            const natH = imgEl.naturalHeight || imgEl.height || availH;
            if (!natW || !natH) return;
            const scale = Math.min(1, availW / natW, availH / natH);
            if (scale < 1) {
                imgEl.style.width = Math.floor(natW * scale) + 'px';
                imgEl.style.height = Math.floor(natH * scale) + 'px';
            } else {
                imgEl.style.width = 'auto';
                imgEl.style.height = 'auto';
            }
        }

        function showModal(html) {
            modalContent.innerHTML = html;
            modal.style.display = 'flex';
            // attach a resize handler so modal images are always fitted
            if (!_modalResizeHandler) {
                _modalResizeHandler = () => adjustModalImage();
                window.addEventListener('resize', _modalResizeHandler);
            }
        }

        function closeModal() {
            modal.style.display = 'none';
            modalContent.innerHTML = '';
            if (_modalResizeHandler) {
                window.removeEventListener('resize', _modalResizeHandler);
                _modalResizeHandler = null;
            }
        }

        function ensureMentionBox() {
            if (mentionBox) return mentionBox;
            mentionBox = document.createElement('div');
            mentionBox.id = 'mentionBox';
            mentionBox.className = 'mention-box';
            mentionBox.style.display = 'none';
            const msgInputWrap = messageInput?.closest('.msg-input');
            if (msgInputWrap) {
                msgInputWrap.style.position = 'relative';
                msgInputWrap.appendChild(mentionBox);
            }
            return mentionBox;
        }

        function showMentionBox(items, query) {
            const box = ensureMentionBox();
            box.innerHTML = '';
            if (!items || items.length === 0) {
                box.style.display = 'none';
                return;
            }

            items.forEach(nick => {
                const item = document.createElement('div');
                item.className = 'mention-item';
                item.textContent = nick;
                item.onclick = (e) => {
                    e.preventDefault();
                    insertMention(nick);
                    hideMentionBox();
                };
                box.appendChild(item);
            });

            box.style.display = 'block';
        }

        function hideMentionBox() {
            if (!mentionBox) return;
            mentionBox.style.display = 'none';
        }

        function insertMention(nick) {
            const input = messageInput;
            if (!input) return;
            const value = input.value;
            const cursor = input.selectionStart || value.length;
            const before = value.slice(0, cursor);
            const after = value.slice(cursor);
            const match = before.match(/@([^\s@]*)$/);
            if (!match) return;
            const startIdx = before.lastIndexOf('@');
            const newBefore = before.slice(0, startIdx) + '@' + nick + ' ';
            input.value = newBefore + after;
            const newPos = newBefore.length;
            input.setSelectionRange(newPos, newPos);
            input.focus();
        }

        function handleMentionInput() {
            if (!messageInput) return;
            const value = messageInput.value;
            const cursor = messageInput.selectionStart || value.length;
            const before = value.slice(0, cursor);
            const match = before.match(/@([^\s@]*)$/);

            if (!match) {
                hideMentionBox();
                return;
            }

            const query = match[1].toLowerCase();
            const participants = Array.from(chatParticipants || [])
                .filter(n => n && usersCacheByNickLower[n.toLowerCase()]);
            const filtered = participants
                .filter(n => n.toLowerCase().includes(query))
                .slice(0, 8);

            showMentionBox(filtered, query);
        }

        function extractMentionedUserIds(text) {
            if (!text) return [];
            const ids = new Set();
            const lowerText = text.toLowerCase();
            const atIndices = [];
            for (let i = 0; i < lowerText.length; i++) {
                if (lowerText[i] === '@') atIndices.push(i);
            }
            if (atIndices.length === 0) return [];

            // Sort nicknames by length (desc) so we match longest name first
            const sortedNicks = [...usersNicknamesLower].sort((a, b) => b.length - a.length);

            for (const idx of atIndices) {
                const slice = lowerText.slice(idx + 1);
                let matchedNick = null;

                for (const nickLower of sortedNicks) {
                    if (slice.startsWith(nickLower)) {
                        // Ensure mention ends on boundary (space, punctuation, end)
                        const endPos = idx + 1 + nickLower.length;
                        const nextChar = lowerText[endPos] || '';
                        if (!nextChar || /[\s.,!?;:()\[\]{}"'<>]/.test(nextChar)) {
                            matchedNick = nickLower;
                            break;
                        }
                    }
                }

                if (matchedNick) {
                    const uid = usersCacheByNickLower[matchedNick];
                    if (uid) ids.add(uid);
                }
            }

            return Array.from(ids);
        }

        async function resolveMentionedUserIds(text) {
            await ensureUsersCache();
            return extractMentionedUserIds(text);
        }

        function addPingsForUsers(chatId, userIds, senderNick, senderUid) {
            if (!chatId || !userIds || userIds.length === 0) return;
            userIds.forEach(uid => {
                if (senderUid && uid === senderUid) return;
                const pingRef = db.ref(`chats/${chatId}/pings/${uid}`);
                pingRef.transaction(prev => {
                    const next = prev && typeof prev === 'object' ? prev : {};
                    const count = Number(next.count || 0) + 1;
                    return {
                        count,
                        lastAt: Date.now(),
                        lastBy: senderNick || 'Anon'
                    };
                });
            });
        }
        function showAlert(msg, cb) {
            showModal(`<div style="min-width:260px"><p style="margin:0 0 8px">${escapeHtml(msg)}</p><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button id="alertOk" class="btn btn-primary">OK</button></div></div>`);
            const btn = document.getElementById('alertOk');
            if (btn) btn.onclick = () => { closeModal(); if (typeof cb === 'function') cb(); };
        }
        function escapeHtml(text) { return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }



        // Render list
        const chatsRef = db.ref('chats');
        chatsRef.on('value', snap => { chatsCache = snap.val() || {}; renderChatList(searchInput.value.trim()); });

        function renderChatList(filter) {
            chatListEl.innerHTML = '';
            const entries = Object.entries(chatsCache);
            if (entries.length === 0) { chatListEl.textContent = 'No chats yet. Create one.'; return; }
            const filtered = entries.filter(([id, c]) => !filter || (c.name || '').toLowerCase().includes(filter.toLowerCase()));
            if (filtered.length === 0) { chatListEl.textContent = 'No chats found.'; return; }
            filtered.forEach(([id, chat]) => {
                const el = document.createElement('div'); el.className = 'chat-item';
                const pingCount = currentUser && chat?.pings && chat.pings[currentUser.uid]
                    ? Number(chat.pings[currentUser.uid].count || 0)
                    : 0;
                const pingDot = pingCount > 0 ? '<span class="ping-dot" title="Mention"></span>' : '';
                el.innerHTML = `
                    <div style="min-width:0">
                        <div class="chat-title">${escapeHtml(chat.name)}</div>
                        <div class="chat-meta">${chat.desc || ''}</div>
                    </div>
                    <div class="chat-right">
                        <div style="text-align:right;font-size:12px;color:rgba(255,255,255,.75)">ID:${id.slice(0, 6)}</div>
                        ${pingDot}
                    </div>
                `;
                el.onclick = () => attemptJoin(id);
                chatListEl.appendChild(el);
            });
        }

        // Create modal
        function openCreateModal() {
            showModal(`
                                            <h4>Create new chat</h4>
                                            <div class="row">
                                                <label>Name</label>
                                                <input id="newName" placeholder="e.g. my_new_chat" />
                                            </div>
                                            <div class="row">
                                                <label>Password</label>
                                                <input id="newPass" placeholder="optional password" type="password" />
                                            </div>
                                            <div class="row">
                                                <label>Delete password</label>
                                                <input id="newDeletePass" placeholder="password to delete chat" type="password" />
                                            </div>
                                            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                                            <button id="cancelCreate" class="btn btn-ghost">Cancel</button>
                                            <button id="confirmCreate" class="btn btn-primary">Create</button>
                                            </div>
                                `       );

            document.getElementById('cancelCreate').onclick = closeModal;
            document.getElementById('confirmCreate').onclick = () => {
                const name = String(document.getElementById('newName').value || '').trim();
                const pass = String(document.getElementById('newPass').value || '');
                const deletePass = String(document.getElementById('newDeletePass').value || '');
                if (!name) { showAlert('Provide chat name'); return; }
                if (!deletePass) { showAlert('Provide delete password'); return; }
                const newRef = chatsRef.push();
                newRef.set({
                    name: name,
                    password: pass,
                    deletePassword: deletePass,
                    createdAt: Date.now(),
                    allow_chat: 1
                }).then(() => {
                    closeModal();
                    attemptJoin(newRef.key, true, pass);
                }).catch(e => showAlert('Error: ' + e.message));
            }
        }

        // Sign up button
        const btnSignup = document.getElementById('btnSignup');
        if (btnSignup) {
            btnSignup.onclick = () => {
                showModal(`
                            <h4>Create account</h4>
                            <div class="row">
                            <label>Username</label>
                            <input id="signupNick" placeholder="Enter username" />
                            </div>
                            <div class="row">
                            <label>Password</label>
                            <input id="signupPass" type="password" placeholder="Enter password" />
                            </div>
                            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                            <button id="cancelSignup" class="btn btn-ghost">Cancel</button>
                            <button id="confirmSignup" class="btn btn-primary">Create</button>
                            </div>
                    `);

                document.getElementById('cancelSignup').onclick = closeModal;
                document.getElementById('confirmSignup').onclick = () => {
                    const nick = String(document.getElementById('signupNick').value || '').trim();
                    const pass = String(document.getElementById('signupPass').value || '').trim();
                    if (!nick || !pass) return showAlert('Please fill in all fields');

                    usersRef.orderByChild('nick').equalTo(nick).once('value', snap => {
                        if (snap.exists()) {
                            showAlert('This username is already taken');
                        } else {
                            usersRef.push({ nick, password: pass, createdAt: Date.now() })
                                .then(() => { showAlert('Account created!'); closeModal(); })
                                .catch(e => showAlert('Error: ' + e.message));
                        }
                    });
                };
            };
        }




        // Sign in
        const btnSignin = document.getElementById('btnSignin');
        const userPanel = document.getElementById('userPanel');
        const currentUserNickEl = document.getElementById('currentUserNick');

        let currentUser = null;

        // Open login modal
        btnSignin.onclick = () => {
            showModal(`
                            <h4>Sign in</h4>
                            <div class="row">
                            <label>Username</label>
                            <input id="signinNick" placeholder="Enter username" />
                            </div>
                            <div class="row">
                            <label>Password</label>
                            <input id="signinPass" type="password" placeholder="Enter password" />
                            </div>
                            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                            <button id="cancelSignin" class="btn btn-ghost">Cancel</button>
                            <button id="confirmSignin" class="btn btn-primary">Login</button>
                            </div>
                            `);

            document.getElementById('cancelSignin').onclick = closeModal;
            document.getElementById('confirmSignin').onclick = () => {
                const nick = String(document.getElementById('signinNick').value || '').trim();
                const pass = String(document.getElementById('signinPass').value || '').trim();
                if (!nick || !pass) {
                    showAlert('Please fill in both fields');
                    return;
                }

                    usersRef.orderByChild('nick').equalTo(nick).once('value', snap => {
                    if (!snap.exists()) {
                        showAlert('User not found');
                        return;
                    }

                    const userData = Object.values(snap.val())[0];
                    if (userData.password === pass) {
                        currentUser = { nick, uid: Object.keys(snap.val())[0] };
                        localStorage.setItem('konsmon_user', JSON.stringify(currentUser));
                        updateUserUI();
                        closeModal();
                    } else {
                        showAlert('Incorrect password');
                    }
                });
            };
        };

        function updateUserUI() {
            if (currentUser) {
                btnSignin.style.display = 'none';
                btnSignup.style.display = 'none';
                userPanel.style.display = 'block';
                currentUserNickEl.textContent = currentUser.nick;
            } else {
                btnSignin.style.display = '';
                btnSignup.style.display = '';
                userPanel.style.display = 'none';
            }
        }

        const userBox = document.getElementById('userBox');
        const userMenu = document.getElementById('userMenu');
        const logoutBtn = document.getElementById('logoutBtn');

        // menu
        userBox.onclick = () => {
            userMenu.style.display = userMenu.style.display === 'none' ? 'block' : 'none';
        };

        // log out
        logoutBtn.onclick = () => {
            localStorage.removeItem('konsmon_user');
            currentUser = null;
            updateUserUI();
            userMenu.style.display = 'none';
            showAlert('Logged out successfully');
        };



        const storedUser = localStorage.getItem('konsmon_user');
        if (storedUser) {
            currentUser = JSON.parse(storedUser);
            updateUserUI();
        }



        btnCreate.onclick = openCreateModal; createQuick.onclick = openCreateModal; btnRefresh.onclick = () => renderChatList(searchInput.value.trim());




        // Join modal
        function attemptJoin(id, skipPrompt = false, knownPass = '') {
            const chat = chatsCache[id];
            if (!chat) {
                showAlert('Chat not found');
                return;
            }

            if (!chat.password || chat.password.trim() === '') {
                joinChat(id);
                return;
            }

            if (skipPrompt) {
                joinChat(id);
                return;
            }

            showModal(`
                                    <h4>Join ${escapeHtml(chat.name)}</h4>
                                    <div class="row">
                                    <label>Password</label>
                                    <input id="joinPass" type="password" placeholder="Password"/>
                                    </div>
                                    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                                    <button id="cancelJoin" class="btn btn-ghost">Cancel</button>
                                    <button id="confirmJoin" class="btn btn-primary">Join</button>
                                    </div>
                            `       );

            document.getElementById('cancelJoin').onclick = closeModal;
            document.getElementById('confirmJoin').onclick = () => {
                const p = String(document.getElementById('joinPass').value || '');


                if (adminPassword && p === adminPassword) {
                    closeModal();
                    joinChat(id, p);
                    return;
                }
                if (currentUser && currentUser.uid) {
                    db.ref(`users/${currentUser.uid}`).once('value')
                        .then(snapUser => {
                            const isAdmin = snapUser.val()?.admin === 1;
                            if (isAdmin || p === (chat.password || '')) {
                                closeModal();
                                joinChat(id, p);
                            } else {
                                showAlert('Wrong password');
                            }
                        })
                            .catch(e => {
                            console.error(e);
                            showAlert('Error: ' + e.message);
                        });
                } else {

                    if (p === (chat.password || '')) {
                        closeModal();
                        joinChat(id, p);
                    } else {
                        showAlert('Wrong password');
                    }
                }
            };
        }





        // Join chat
        function joinChat(id) {
            currentChatId = id;
            currentChatRef = db.ref('chats/' + id);
            const chat = chatsCache[id] || {};
            chatTitle.textContent = chat.name || '—';
            chatSubtitle.textContent = 'ID: ' + id;
            welcomeArea.style.display = 'none';
            chatArea.style.display = 'flex';
            messagesEl.innerHTML = '';

            ensureUsersCache().catch(() => {});

            chatParticipants = new Set();
            hideMentionBox();

            if (currentUser && currentUser.uid) {
                db.ref(`chats/${id}/pings/${currentUser.uid}`).remove();
            }

            // Detach previous
            if (messagesRef) messagesRef.off();
            messagesRef = db.ref(`chats/${id}/messages`);
            let initialLoad = true;
            let lastDate = null; // track last message date to insert separators

            // helper to remove date separator if no messages remain for that date
            function removeDateSeparatorIfEmpty(targetDate) {
                let found = false;
                messagesEl.querySelectorAll('div').forEach(d => {
                    if (d.dataset && d.dataset.date === targetDate) found = true;
                });
                if (!found) {
                    const sep = Array.from(messagesEl.querySelectorAll('.date-separator')).find(s => s.textContent === targetDate);
                    if (sep) sep.remove();
                }
            }

            // Listen for additions
            messagesRef.on('child_added', snap => {
                const m = snap.val();
                const msgId = snap.key;
                const msgWrap = document.createElement('div');

                if (m?.nickname) {
                    chatParticipants.add(String(m.nickname));
                }

                // time only for each message (keep showing time)
                const timeStr = m.createdAt
                    ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : (m.time ? String(m.time).split(' ').pop() : '');

                const meta = document.createElement('div'); meta.className = 'meta-line';
                meta.textContent = `[${timeStr}] ${m.nickname || 'Anon'}`;

                // date separator (centered) inserted above a message when day changes
                const msgDate = new Date(m.createdAt || Date.now());
                const dateOnly = msgDate.toLocaleDateString();
                if (lastDate !== dateOnly) {
                    const sep = document.createElement('div');
                    sep.className = 'date-separator';
                    sep.textContent = dateOnly;
                    messagesEl.appendChild(sep);
                    lastDate = dateOnly;
                }

                // mark wrapper with date so we can track remaining messages
                msgWrap.className = 'msg-wrap';
                msgWrap.dataset.date = dateOnly;

                const bubble = document.createElement('div'); bubble.className = 'message';

                // text (make URLs clickable)
                if (m.text) {
                    // create nodes where URLs become anchors, using text nodes for safety
                    const urlRegex = /(?:https?:\/\/[^\s]+)|(?:www\.[^\s]+)/g;
                    let lastIndex = 0;
                    const text = String(m.text || '');
                    let match;
                    while ((match = urlRegex.exec(text)) !== null) {
                        const idx = match.index;
                        if (idx > lastIndex) {
                            bubble.appendChild(document.createTextNode(text.slice(lastIndex, idx)));
                        }
                        let url = match[0];
                        const href = url.startsWith('http') ? url : 'http://' + url;
                        const a = document.createElement('a');
                        a.href = href;
                        a.textContent = url;
                        a.target = '_blank';
                        a.rel = 'noopener noreferrer';
                        a.className = 'file-link';
                        bubble.appendChild(a);
                        lastIndex = idx + url.length;
                    }
                    if (lastIndex < text.length) bubble.appendChild(document.createTextNode(text.slice(lastIndex)));
                } else if (m.imageBase64) {
                    const img = document.createElement('img');
                    img.src = m.imageBase64;
                    bubble.appendChild(img);
                    img.style.cursor = 'zoom-in';
                    img.addEventListener('click', e => {
                        e.stopPropagation();
                        modalContent.innerHTML = `
                            <div class="modal-viewer">
                                <a class="modal-download" href="${img.src}" download="konsmon-image.png" title="Download image">⬇</a>
                                <img src="${img.src}" class="modal-image" />
                            </div>
                        `;
                        modal.style.display = 'flex';
                        const modalImg = modalContent.querySelector('.modal-image');
                        if (modalImg) {
                            modalImg.onload = () => adjustModalImage();
                            if (modalImg.complete) adjustModalImage();
                        }
                    });
                    img.onload = () => {
                        if (initialLoad || (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 300)) {
                            messagesEl.scrollTop = messagesEl.scrollHeight;
                        }
                    }
                } else if (m.fileBase64) {
                    const fileLink = document.createElement('a');
                    fileLink.href = m.fileBase64;
                    fileLink.target = '_blank';
                    fileLink.rel = 'noopener noreferrer';
                    fileLink.className = 'file-link';
                    fileLink.textContent = (m.fileName || 'file');
                    fileLink.download = m.fileName || '';
                    bubble.appendChild(fileLink);
                }

                bubble.addEventListener('click', () => {
                    if (!currentUser) return;
                    const existingTrash = bubble.querySelector('.trash-icon');
                    if (existingTrash) {
                        existingTrash.remove();
                        return;
                    }

                    const trash = document.createElement('span');
                    trash.className = 'trash-icon';
                    trash.textContent = '🗑️';
                    trash.style.cursor = 'pointer';
                    trash.style.position = 'absolute';
                    trash.style.right = '-26px';
                    trash.style.top = '4px';
                    trash.style.opacity = '0.7';
                    trash.style.transition = 'opacity 0.2s';
                    trash.onmouseenter = () => trash.style.opacity = '1';
                    trash.onmouseleave = () => trash.style.opacity = '0.7';
                    bubble.style.position = 'relative';
                    bubble.appendChild(trash);

                    trash.onclick = (e) => {
                        e.stopPropagation();
                        const confirmDel = confirm('Are you sure you want to delete this message?');
                        if (!confirmDel) return;

                        db.ref(`users/${currentUser.uid}`).once('value').then(snapUser => {
                            const isAdmin = snapUser.val()?.admin === 1;
                            if (isAdmin || m.userId === currentUser.uid) {
                                db.ref(`chats/${currentChatId}/messages/${msgId}`).remove()
                                    .then(() => {
                                        msgWrap.remove();
                                        // remove date separator if no other messages for that day remain
                                        removeDateSeparatorIfEmpty(dateOnly);
                                    })
                                    .catch(e => showAlert('Error deleting message: ' + e.message));
                            } else {
                                showAlert('You can delete only your messages.');
                            }
                        });
                    };
                });

                msgWrap.appendChild(meta);
                msgWrap.appendChild(bubble);
                messagesEl.appendChild(msgWrap);
                const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;

                if (initialLoad || distanceFromBottom < 300) {
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                }
            });

            messagesRef.once('value', () => {
                initialLoad = false;
                setTimeout(() => {
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                }, 100);
            });
        }

        leaveBtn.onclick = () => { if (!currentChatId) return; if (!showAlert('Leave chat?')) return; detachChat(); }
        function detachChat() { if (messagesRef) messagesRef.off(); currentChatId = null; currentChatRef = null; messagesEl.innerHTML = ''; chatArea.style.display = 'none'; welcomeArea.style.display = 'block'; chatTitle.textContent = '—'; chatSubtitle.textContent = '—'; }





        // Delete chat
        deleteBtn.onclick = () => {
            if (!currentChatId) return;
            const chat = chatsCache[currentChatId];
            if (!chat) { showAlert('Chat data not found'); return; }

                showModal(`
                            <h4>Delete chat: ${escapeHtml(chat.name)}</h4>
                            <div class="row">
                                <label>Delete password</label>
                                <input id="deletePassInput" type="password" placeholder="Enter delete or admin password" />
                            </div>
                            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
                            <button id="cancelDelete" class="btn btn-ghost">Cancel</button>
                            <button id="confirmDelete" class="btn btn-primary" style="background:#b91c1c;color:white">Delete</button>
                            </div>
                        `       );

            document.getElementById('cancelDelete').onclick = closeModal;
            document.getElementById('confirmDelete').onclick = () => {
                const enteredPass = String(document.getElementById('deletePassInput').value || '');

                // Global admin password 
                if (adminPassword && enteredPass === adminPassword) {
                    db.ref('chats/' + currentChatId).remove()
                                .then(() => {
                                        closeModal();
                                        showAlert('Chat deleted', detachChat);
                                    })
                                    .catch(e => showAlert('Error: ' + e.message));
                    return;
                }


                if (currentUser && currentUser.uid) {
                    db.ref(`users/${currentUser.uid}`).once('value')
                        .then(snapUser => {
                            const isAdmin = snapUser.val()?.admin === 1;
                            if (isAdmin || enteredPass === (chat.deletePassword || '')) {
                                db.ref('chats/' + currentChatId).remove()
                                    .then(() => {
                                            closeModal();
                                            showAlert('Chat deleted', detachChat);
                                        })
                                    .catch(e => showAlert('Error: ' + e.message));
                            } else {
                                showAlert('Wrong delete password');
                            }
                        })
                        .catch(e => showAlert('Error: ' + e.message));
                } else {

                    if (enteredPass === (chat.deletePassword || '')) {
                        db.ref('chats/' + currentChatId).remove()
                            .then(() => {
                                        closeModal();
                                        showAlert('Chat deleted', detachChat);
                            })
                                    .catch(e => showAlert('Error: ' + e.message));
                    } else {
                        showAlert('Wrong delete password');
                    }
                }
            };
        };



        // Send message
        const uploadBtn = document.getElementById('uploadBtn');
        const imageInput = document.getElementById('imageInput');
        const MAX_FILE_SIZE = 200 * 1024; // 200 KB limit
        let selectedImageBase64 = null;
        let selectedFileBase64 = null;
        let selectedFileName = null;
        let selectedFileType = null;

        uploadBtn.onclick = () => {
            imageInput.click();
        };

        imageInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // file size check
            if (file.size > MAX_FILE_SIZE) {
                showAlert('Selected file is too large (' + (file.size / 1024).toFixed(1) + ' KB). Maximum allowed is 200 KB.');
                e.target.value = '';
                return;
            }

            // clear previous selections
            selectedImageBase64 = null;
            selectedFileBase64 = null;
            selectedFileName = null;
            selectedFileType = null;
            const existingPreview = document.querySelector('#messageInput + img, #messageInput + .file-preview');
            if (existingPreview) existingPreview.remove();

            if (file.type && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = function (ev) {
                    selectedImageBase64 = ev.target.result;
                    const preview = document.createElement('img');
                    preview.src = selectedImageBase64;
                    preview.style.maxWidth = '100px';
                    preview.style.maxHeight = '100px';
                    preview.style.borderRadius = '6px';
                    preview.style.marginTop = '4px';
                    preview.style.cursor = 'zoom-in';
                    preview.onclick = (ev2) => {
                        ev2.stopPropagation();
                        modalContent.innerHTML = `
                            <div class="modal-viewer">
                                <a class="modal-download" href="${preview.src}" download="konsmon-image.png" title="Download image">⬇</a>
                                <img src="${preview.src}" class="modal-image" />
                            </div>
                        `;
                        modal.style.display = 'flex';
                        const modalImg2 = modalContent.querySelector('.modal-image');
                        if (modalImg2) {
                            modalImg2.onload = () => adjustModalImage();
                            if (modalImg2.complete) adjustModalImage();
                        }
                    };
                    messageInput.insertAdjacentElement('afterend', preview);
                    setTimeout(() => preview.remove(), 10000);
                };
                reader.readAsDataURL(file);
            } else {
                // non-image file: read as DataURL (base64) and show a small file chip
                const reader = new FileReader();
                reader.onload = function (ev2) {
                    selectedFileBase64 = ev2.target.result;
                    selectedFileName = file.name;
                    selectedFileType = file.type || 'application/octet-stream';
                    const chip = document.createElement('div');
                    chip.className = 'file-preview';
                    chip.textContent = file.name;
                    const dl = document.createElement('a');
                    dl.textContent = ' ⬇';
                    dl.href = selectedFileBase64;
                    dl.download = file.name;
                    dl.style.marginLeft = '8px';
                    chip.appendChild(dl);
                    messageInput.insertAdjacentElement('afterend', chip);
                    setTimeout(() => chip.remove(), 10000);
                };
                reader.readAsDataURL(file);
            }
        };

        function sendMessage() {
            if (!currentChatId) {
                showAlert('Join a chat first');
                return;
            }
            const chatSettings = chatsCache[currentChatId];
            if (chatSettings && chatSettings.allow_chat !== 1) {
                if (!currentUser) {
                    showAlert("Only admins can write in this chat.");
                    return;
                }
                db.ref(`users/${currentUser.uid}`).once('value').then(snap => {
                    const isAdmin = snap.val()?.admin === 1;
                    if (!isAdmin) {
                        showAlert("Only admins can write in this chat.");
                        return;
                    } else {
                        actuallySendMessage(); 
                    }
                });
                return; 
            }

            actuallySendMessage(); 

            async function actuallySendMessage() {
                let text = String(messageInput.value || '').trim();
                const nickInputVal = String(document.getElementById('nicknameInput').value || '').trim();

                if (!text && !selectedImageBase64 && !selectedFileBase64) return;

                const wrapLimit = 800;
                if (text.length > wrapLimit) {
                    let wrapped = '';
                    for (let i = 0; i < text.length; i += wrapLimit) {
                        wrapped += text.slice(i, i + wrapLimit) + '\n';
                    }
                    text = wrapped.trimEnd();
                }

                let nick;
                if (currentUser) {
                    nick = currentUser.nick;
                } else if (nickInputVal) {
                    nick = nickInputVal;
                } else {
                    nick = 'Anon' + Math.floor(1000 + Math.random() * 9000);
                }

                const now = new Date();
                const t = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                const mentionedUserIds = await resolveMentionedUserIds(text);

                const msgData = {
                    nickname: nick,
                    text: text || null,
                    imageBase64: null,
                    fileBase64: null,
                    fileName: null,
                    fileType: null,
                    time: t,
                    createdAt: Date.now(),
                    userId: currentUser ? currentUser.uid : null
                };
                // If a non-image file was selected, embed base64 into message
                if (selectedFileBase64) {
                    msgData.fileBase64 = selectedFileBase64;
                    msgData.fileName = selectedFileName;
                    msgData.fileType = selectedFileType;
                }

                // If an image was selected, keep the base64 embed
                if (selectedImageBase64) msgData.imageBase64 = selectedImageBase64;

                db.ref(`chats/${currentChatId}/messages`).push(msgData)
                    .then(() => {
                        messageInput.value = '';
                        selectedImageBase64 = null;
                        selectedFileBase64 = null;
                        selectedFileName = null;
                        selectedFileType = null;
                        const existingChip = document.querySelector('#messageInput + .file-preview');
                        if (existingChip) existingChip.remove();
                        const existingPreview = document.querySelector('#messageInput + img');
                        if (existingPreview) existingPreview.remove();
                        if (mentionedUserIds.length > 0) {
                            addPingsForUsers(currentChatId, mentionedUserIds, nick, currentUser ? currentUser.uid : null);
                        }
                    })
                    .catch(e => showAlert('Error: ' + e.message));
            }

        }

        sendBtn.onclick = sendMessage;

        messageInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        messageInput.addEventListener('input', handleMentionInput);
        messageInput.addEventListener('click', handleMentionInput);
        messageInput.addEventListener('blur', () => {
            if (mentionHideTimer) clearTimeout(mentionHideTimer);
            mentionHideTimer = setTimeout(() => hideMentionBox(), 150);
        });



        searchBtn.onclick = () => renderChatList(searchInput.value.trim()); searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') renderChatList(searchInput.value.trim()); });

        modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

        // close modal on Escape
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeModal();
        });


        // Initial
        renderChatList();

        // Initialize wavy logo: split text into spans and add hover handlers
        (function initWavyLogo(){
            try {
                const el = document.getElementById('siteLogo');
                if (!el) return;
                const txt = String(el.textContent || '').trim();
                el.innerHTML = '';
                const spans = [];
                for (let i = 0; i < txt.length; i++) {
                    const ch = txt[i];
                    const sp = document.createElement('span');
                    sp.textContent = ch === ' ' ? '\u00A0' : ch;
                    sp.dataset.i = String(i);
                    el.appendChild(sp);
                    spans.push(sp);
                }
                el.classList.add('wavy-logo');

                // On hover over a letter, lift neighboring letters with decay
                spans.forEach((s, idx) => {
                    s.addEventListener('mouseenter', () => {
                        spans.forEach((ss, j) => {
                            const dist = Math.abs(j - idx);
                            const maxLift = 18; // px
                            const step = 5; // px per distance
                            const lift = Math.max(0, maxLift - dist * step);
                            if (lift > 0) {
                                ss.style.transform = `translateY(-${lift}px)`;
                                ss.style.transitionDelay = `${dist * 30}ms`;
                            } else {
                                ss.style.transform = '';
                                ss.style.transitionDelay = '';
                            }
                        });
                    });
                    s.addEventListener('mouseleave', () => {
                        spans.forEach((ss) => {
                            ss.style.transform = '';
                            ss.style.transitionDelay = '';
                        });
                    });
                });
            } catch (e) { console.warn('wavy logo init failed', e); }
        })();

        // Mobile menu
        (function initMobileMenu() {
            try {
                const btn = document.getElementById('mobileMenuBtn');
                const body = document.body;
                function createOverlay() {
                    let ov = document.getElementById('mobileMenuOverlay');
                    if (!ov) {
                        ov = document.createElement('div');
                        ov.id = 'mobileMenuOverlay';
                        ov.style.position = 'fixed';
                        ov.style.inset = '0';
                        ov.style.background = 'rgba(0,0,0,0.35)';
                        ov.style.zIndex = '1500';
                        document.body.appendChild(ov);
                        ov.addEventListener('click', closeMobileMenu);
                    }
                    return ov;
                }
                function openMobileMenu() {
                    body.classList.add('sidebar-open');
                    const ov = createOverlay();
                    ov.style.display = 'block';
                }
                function closeMobileMenu() {
                    body.classList.remove('sidebar-open');
                    const ov = document.getElementById('mobileMenuOverlay');
                    if (ov) ov.style.display = 'none';
                }

                window.openMobileMenu = openMobileMenu;
                window.closeMobileMenu = closeMobileMenu;

                if (btn) btn.addEventListener('click', () => {
                    if (document.body.classList.contains('sidebar-open')) closeMobileMenu(); else openMobileMenu();
                });

                const originalAttemptJoin = window.attemptJoin;
                if (typeof originalAttemptJoin === 'function') {
                    window.attemptJoin = function (id, skipPrompt, knownPass) {
                        try { closeMobileMenu(); } catch (e) { }
                        return originalAttemptJoin(id, skipPrompt, knownPass);
                    };
                }

                let rt = null;
                window.addEventListener('resize', () => {
                    clearTimeout(rt); rt = setTimeout(() => {
                        if (window.innerWidth > 900) closeMobileMenu();
                    }, 120);
                });

            } catch (e) { console.warn('mobile menu init failed', e); }
        })();

        (function initMobileClass() {
            try {
                const apply = () => {
                    const small = window.innerWidth <= 900;

                    const mobile = small;
                    if (mobile) document.body.classList.add('is-mobile'); else document.body.classList.remove('is-mobile');
                };
                apply();
                let to = null;
                window.addEventListener('resize', () => { clearTimeout(to); to = setTimeout(apply, 120); });
            } catch (e) { console.warn('initMobileClass failed', e); }
        })();

        //WEBRTC VOICE CHAT SYSTEM

        let voiceChatsCache = {};
        let currentVoiceChatId = null;
        let voicePresenceRef = null;
        let voiceSignalingRef = null;
        let isIntentionalLeave = false;

        let localAnonUid = null;
        let localAnonNick = null;
        let localMutes = {};

        // WebRTC
        let localStream = null;
        let peers = {}; 
        let audioContext = null;
        let visualizerIntervals = {};
        let visualizerStreams = {};


        const rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10,
            // To jest ważne: domyślnie jest 'all', ale warto się upewnić
            iceTransportPolicy: 'all'
        };

        const audioConnect = new Audio('./audio/con.mp3');
        const audioDisconnect = new Audio('./audio/discon.mp3');
        const audioMute = new Audio('./audio/mute.mp3');
        const audioUnmute = new Audio('./audio/unmute.mp3');

        if (!document.getElementById('webrtc-audio-container')) {
            const ac = document.createElement('div');
            ac.id = 'webrtc-audio-container';
            document.body.appendChild(ac);
        }

        function getVoiceUid() {
            if (currentUser && currentUser.uid) return currentUser.uid;
            if (!localAnonUid) localAnonUid = 'anon_' + Math.random().toString(36).substr(2, 9);
            return localAnonUid;
        }

        function getVoiceNick() {
            if (currentUser && currentUser.nick) return currentUser.nick;
            const nickInputVal = document.getElementById('nicknameInput')?.value.trim();
            if (nickInputVal) return nickInputVal;
            if (!localAnonNick) localAnonNick = 'Anon' + Math.floor(1000 + Math.random() * 9000);
            return localAnonNick;
        }

        const voiceChatsRef = db.ref('voice_chats');
        const voiceChatListEl = document.getElementById('voiceChatList');

        voiceChatsRef.on('value', snap => {
            let data = snap.val();
            if (!data) {
                data = {
                    'vc_1': { name: 'Voice #1', password: '' },
                    'vc_2': { name: 'Voice #2', password: '' },
                    'vc_3': { name: 'Voice #3', password: '' }
                };
                voiceChatsRef.set(data);
            }
            voiceChatsCache = data;

            // Check kick
            if (currentVoiceChatId && voicePresenceRef) {

                if (isIntentionalLeave) {
                    return;
                }

                const myUid = getVoiceUid();
                if (data && data[currentVoiceChatId] && data[currentVoiceChatId].users) {
                    if (!data[currentVoiceChatId].users[myUid]) {

                        leaveVoiceChat(true);
                    }
                }
            }
            renderVoiceChats();
        });

        function renderVoiceChats() {
            if (!voiceChatListEl) return;
            voiceChatListEl.innerHTML = '';

            Object.entries(voiceChatsCache).forEach(([id, vc]) => {
                const container = document.createElement('div');
                container.className = 'voice-chat-container';

                const item = document.createElement('div');
                item.className = 'voice-chat-item' + (currentVoiceChatId === id ? ' active' : '');

                const titleWrap = document.createElement('div');
                titleWrap.textContent = vc.name;
                item.appendChild(titleWrap);

                if (currentVoiceChatId === id) {
                    const leaveBtn = document.createElement('button');
                    leaveBtn.className = 'v-btn-leave';
                    leaveBtn.innerHTML = '📞 ❌';
                    leaveBtn.title = 'Leave Voice Chat';
                    leaveBtn.onclick = (e) => {
                        e.stopPropagation();
                        leaveVoiceChat();
                    };
                    item.appendChild(leaveBtn);
                }

                item.onclick = () => {
                    if (currentVoiceChatId !== id) attemptJoinVoice(id);
                };

                container.appendChild(item);
                if (vc.users) {
                    const usersList = document.createElement('div');
                    usersList.className = 'voice-users';

                    Object.entries(vc.users).forEach(([uid, uData]) => {
                        const uRow = document.createElement('div');
                        uRow.className = 'voice-user-row';

                        const uLeft = document.createElement('div');
                        uLeft.className = 'voice-user-left';
                        uLeft.innerHTML = `<span style="color:var(--muted); font-weight:bold;">|_</span> <span id="voice-nick-${uid}" style="border: 1px solid transparent; padding: 1px 6px; border-radius: 4px; transition: all 0.1s ease;">${escapeHtml(uData.nick)}</span>`;

                        const uRight = document.createElement('div');
                        uRight.className = 'voice-controls';

                        const myUid = getVoiceUid();
                        const isMe = (uid === myUid);
                        const isAdmin = currentUser && usersCacheById[currentUser.uid] && usersCacheById[currentUser.uid].admin === 1;

                        function createToggleBtn(type, icon) {
                            const btn = document.createElement('span');
                            btn.className = 'v-icon';
                            btn.title = type;
                            btn.innerHTML = icon;

                            const stateKey = uid + '_' + type;
                            if (localMutes[stateKey]) {
                                btn.style.color = '#ef4444';
                                btn.style.background = 'rgba(239, 68, 68, 0.15)';
                            }

                            btn.onclick = (e) => {
                                e.stopPropagation();

                                if (!isMe && !isAdmin && type === 'Mic') {
                                    showAlert("Only admins can mute other users.");
                                    return;
                                }

                                localMutes[stateKey] = !localMutes[stateKey];
                                const isMuted = localMutes[stateKey];

                                if (isMuted) audioMute.play().catch(() => { });
                                else audioUnmute.play().catch(() => { });

                                // MUTE LOGIC
                                if (type === 'Mic') {
                                    if (isMe && localStream) {
                                        localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
                                    }
                                    const remoteAudio = document.getElementById('audio-' + uid);
                                    if (remoteAudio) remoteAudio.muted = isMuted;
                                }

                                if (type === 'Headphones') {
                                    if (isMe) {
                                        document.querySelectorAll('#webrtc-audio-container audio').forEach(a => a.muted = isMuted);
                                    } else {
                                        const remoteAudio = document.getElementById('audio-' + uid);
                                        if (remoteAudio) remoteAudio.muted = isMuted;
                                    }
                                }

                                renderVoiceChats();
                            };
                            return btn;
                        }

                        uRight.appendChild(createToggleBtn('Mic', '🎙️'));
                        uRight.appendChild(createToggleBtn('Headphones', '🎧'));

                        if (isMe) {
                            uRight.appendChild(createToggleBtn('Stream', '🖥️'));
                        }

                        const kickBtn = document.createElement('span');
                        kickBtn.className = 'v-icon';
                        kickBtn.title = 'Kick User';
                        kickBtn.innerHTML = '❌';
                        kickBtn.style.color = '#ef4444';
                        kickBtn.onclick = (e) => {
                            e.stopPropagation();
                            if (!isMe && !isAdmin) {
                                showAlert("Only admins can kick other users.");
                                return;
                            }
                            kickVoiceUser(id, uid);
                        };

                        uRight.appendChild(kickBtn);
                        uRow.appendChild(uLeft);
                        uRow.appendChild(uRight);
                        usersList.appendChild(uRow);
                    });
                    container.appendChild(usersList);
                }

                voiceChatListEl.appendChild(container);
            });
        }

        function attemptJoinVoice(id) {
            const vc = voiceChatsCache[id];
            if (!vc) return;
            if (!vc.password || vc.password.trim() === '') {
                joinVoiceChat(id);
                return;
            }
            showModal(`
                        <h4>Join ${escapeHtml(vc.name)}</h4>
                        <div class="row"><label>Password</label><input id="joinVoicePass" type="password" placeholder="Password"/></div>
                        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                            <button id="cancelJoinVoice" class="btn btn-ghost">Cancel</button>
                            <button id="confirmJoinVoice" class="btn btn-primary">Join</button>
                        </div>`);
            document.getElementById('cancelJoinVoice').onclick = closeModal;
            document.getElementById('confirmJoinVoice').onclick = () => {
                const p = document.getElementById('joinVoicePass').value;
                if (p === (vc.password || '') || p === adminPassword) {
                    closeModal();
                    joinVoiceChat(id);
                } else {
                    showAlert('Wrong password');
                }
            };
        }

        async function joinVoiceChat(id) {
            console.log(">>> DOŁĄCZANIE DO CZATU:", id);
            isIntentionalLeave = false;

            // 1. Reset poprzedniego czatu
            if (currentVoiceChatId) leaveVoiceChat();

            // 2. Inicjalizacja Audio Context
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            // 3. Pobranie mikrofonu
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                console.log(">>> Mikrofon OK");
            } catch (err) {
                console.error("Mic error:", err);
                showAlert("Microphone access denied: " + err.message);
                return;
            }

            // Odtwórz dźwięk wejścia (opcjonalne)
            if (audioConnect) audioConnect.play().catch(() => { });

            currentVoiceChatId = id;
            const myUid = getVoiceUid();

            // 4. Zapisz się w bazie obecności
            voicePresenceRef = db.ref(`voice_chats/${id}/users/${myUid}`);
            const userData = { nick: getVoiceNick(), joinedAt: Date.now() };

            // Ustawiamy onDisconnect zanim wejdziemy
            await voicePresenceRef.onDisconnect().remove();
            await voicePresenceRef.set(userData);
            console.log(">>> Zapisano w bazie obecności jako:", myUid);

            // 5. Nasłuchiwanie na sygnały (NAPRAWIONE)
            voiceSignalingRef = db.ref(`voice_signaling/${id}/${myUid}`);
            voiceSignalingRef.on('child_added', async (snap) => {
                const msg = snap.val();
                if (!msg) return;

                // Konsumujemy wiadomość (usuwamy z bazy)
                snap.ref.remove();

                // --- TU BYŁ BŁĄD (poprawione na msg.type) ---
                console.log(">>> Otrzymano sygnał od:", msg.from, "Typ:", msg.type);

                await handleSignalingMessage(msg);
            });

            // 6. Wizualizacja lokalna (zielona ramka dla siebie)
            try {
                const myClone = localStream.clone();
                visualizerStreams['local'] = myClone;
                attachSpeakingVisualizer(myClone, myUid);
            } catch (e) {
                console.warn("Błąd wizualizacji lokalnej:", e);
            }

            // 7. INICJACJA POŁĄCZEŃ
            console.log(">>> Pobieranie listy użytkowników, żeby zadzwonić...");

            db.ref(`voice_chats/${id}/users`).once('value').then(snapshot => {
                const users = snapshot.val();
                if (!users) {
                    console.log(">>> Nikogo innego tu nie ma (jestem pierwszy).");
                    return;
                }

                const userIds = Object.keys(users);
                console.log(">>> Znaleziono użytkowników w pokoju:", userIds);

                userIds.forEach(targetUid => {
                    // Dzwonimy do wszystkich OPRÓCZ siebie
                    if (targetUid !== myUid) {
                        console.log(">>> DZWONIĘ DO:", targetUid);
                        initiateCall(targetUid);
                    }
                });
            });
        }

        function leaveVoiceChat(wasKicked = false) {
            if (!wasKicked) {
                isIntentionalLeave = true;
            }
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            Object.values(visualizerStreams).forEach(s => s.getTracks().forEach(t => t.stop()));
            visualizerStreams = {};

            Object.values(peers).forEach(pc => pc.close());
            peers = {};

            Object.values(visualizerIntervals).forEach(iv => clearInterval(iv));
            visualizerIntervals = {};

            const container = document.getElementById('webrtc-audio-container');
            if (container) container.innerHTML = '';

            if (voicePresenceRef) {
                if (!wasKicked) audioDisconnect.play().catch(() => { });
                voicePresenceRef.remove();
                voicePresenceRef.onDisconnect().cancel();
                voicePresenceRef = null;
            }
            if (voiceSignalingRef) {
                voiceSignalingRef.off();
                voiceSignalingRef.remove();
                voiceSignalingRef = null;
            }

            currentVoiceChatId = null;
            renderVoiceChats();

            if (wasKicked) showAlert("You were kicked from the voice chat.");
        }

        function createPeerConnection(targetUid) {
            // Jeśli połączenie już istnieje, nie twórz nowego
            if (peerConnections[targetUid]) return;

            console.log(">>> TWORZENIE PEER CONNECTION DLA:", targetUid);

            const rtcConfig = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ],
                iceCandidatePoolSize: 10
            };

            const pc = new RTCPeerConnection(rtcConfig);

            // WAŻNE: Dodajemy do globalnej mapy, żeby initiateCall to widział
            peerConnections[targetUid] = pc;
            pc.iceQueue = []; // Inicjalizacja kolejki

            // 1. Dodajemy nasz mikrofon do połączenia
            if (localStream) {
                localStream.getTracks().forEach(track => {
                    pc.addTrack(track, localStream);
                });
            }

            // 2. Obsługa kandydatów sieciowych (ICE)
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    sendSignal(targetUid, {
                        type: 'candidate',
                        data: event.candidate
                    });
                }
            };

            // 3. Diagnostyka stanu połączenia
            pc.oniceconnectionstatechange = () => {
                console.log(`>>> STAN SIECI (${targetUid}):`, pc.iceConnectionState);
                if (pc.iceConnectionState === 'failed') {
                    console.warn(">>> Połączenie zablokowane przez Firewall/Router!");
                }
            };

            // 4. ODBIERANIE AUDIO (To naprawia brak dźwięku)
            pc.ontrack = (event) => {
                console.log(">>> OTRZYMANO STRUMIEŃ AUDIO OD:", targetUid);
                const remoteStream = new MediaStream([event.track]);

                let audioEl = document.getElementById('audio-' + targetUid);
                if (!audioEl) {
                    audioEl = document.createElement('audio');
                    audioEl.id = 'audio-' + targetUid;
                    audioEl.autoplay = true;
                    audioEl.playsInline = true;

                    // Hack: Element musi być "na stronie", żeby grał, ale może być niewidoczny
                    audioEl.style.position = 'fixed';
                    audioEl.style.top = '0';
                    audioEl.style.opacity = '0';
                    audioEl.style.pointerEvents = 'none';

                    document.body.appendChild(audioEl);
                }

                audioEl.srcObject = remoteStream;
                audioEl.muted = false; // Odciszamy

                const playPromise = audioEl.play();
                if (playPromise !== undefined) {
                    playPromise.catch(e => {
                        console.warn(">>> Autoplay zablokowany. Kliknij w stronę.", e);
                    });
                }

                // Wizualizacja (Visualizer) - w bloku try/catch żeby błąd grafiki nie psuł dźwięku
                try {
                    const clone = remoteStream.clone();
                    visualizerStreams[targetUid] = clone;
                    attachSpeakingVisualizer(clone, targetUid);
                } catch (e) { console.warn("Visualizer error:", e); }
            };

            return pc;
        }

        async function initiateCall(targetUid) {
            console.log(">>> INICJOWANIE POŁĄCZENIA DO:", targetUid);

            // 1. Tworzymy połączenie
            createPeerConnection(targetUid);

            // 2. KLUCZOWA POPRAWKA: Pobieramy obiekt 'pc' z globalnej mapy
            // Wcześniej kod próbował użyć 'pc', którego tu nie było.
            const pc = peerConnections[targetUid];

            if (!pc) {
                console.error(">>> BŁĄD KRYTYCZNY: Nie udało się utworzyć pc dla", targetUid);
                return;
            }

            try {
                // 3. Tworzymy ofertę (SDP)
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                // 4. Wysyłamy do drugiego użytkownika
                sendSignal(targetUid, {
                    type: 'offer',
                    data: offer
                });
                console.log(">>> Oferta wysłana do:", targetUid);
            } catch (err) {
                console.error(">>> Błąd w initiateCall:", err);
            }
        }

        async function handleSignalingMessage(msg) {
            const { type, sdp, candidate, from } = msg;

            if (!peers[from]) {
                if (type === 'offer') {
                    createPeerConnection(from);
                } else {
                    return;
                }
            }

            const pc = peers[from];

            try {
                if (type === 'offer') {
                    console.log("Received Offer from", from);
                    await pc.setRemoteDescription(new RTCSessionDescription(sdp));

                    if (pc.iceQueue.length > 0) {
                        for (const c of pc.iceQueue) {
                            try {
                                await pc.addIceCandidate(c);
                            } catch (err) {
                                console.warn("Error adding queued ice candidate", err);
                            }
                        }
                        pc.iceQueue = [];
                    }

                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    sendSignal(from, { type: 'answer', sdp: answer });
                }
                else if (type === 'answer') {
                    console.log("Received Answer from", from);
                    await pc.setRemoteDescription(new RTCSessionDescription(sdp));

                    if (pc.iceQueue.length > 0) {
                        for (const c of pc.iceQueue) await pc.addIceCandidate(c);
                        pc.iceQueue = [];
                    }
                }
                else if (type === 'candidate') {
                    const cand = new RTCIceCandidate(candidate);
                    if (pc.remoteDescription && pc.remoteDescription.type) {
                        await pc.addIceCandidate(cand);
                    } else {
                        console.log("Queueing ICE candidate for", from);
                        pc.iceQueue.push(cand);
                    }
                }
            } catch (err) {
                console.warn("Signaling error:", err);
            }
        }

        function sendSignal(targetUid, payload) {
            if (!currentVoiceChatId) return;
            const myUid = getVoiceUid();

            db.ref(`voice_signaling/${currentVoiceChatId}/${targetUid}`).push({
                ...payload,
                from: myUid
            });
        }

        function attachSpeakingVisualizer(stream, uid) {

            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            try {
                const source = audioContext.createMediaStreamSource(stream);
                const analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
                source.connect(analyser);

                const dataArray = new Uint8Array(analyser.frequencyBinCount);

                if (visualizerIntervals[uid]) clearInterval(visualizerIntervals[uid]);

                visualizerIntervals[uid] = setInterval(() => {
                    if (!currentVoiceChatId) return;
                    analyser.getByteFrequencyData(dataArray);
                    let sum = 0;
                    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                    const average = sum / dataArray.length;

                    const nickEl = document.getElementById('voice-nick-' + uid);
                    if (nickEl) {
                        if (average > 10) nickEl.classList.add('speaking-border');
                        else nickEl.classList.remove('speaking-border');
                    }
                }, 100);
            } catch (e) {
                console.warn("Visualizer error", e);
            }
        }

        // Kick
        function kickVoiceUser(chatId, uid) {
            if (confirm("Do you want to kick this user from the voice chat?")) {
                db.ref(`voice_chats/${chatId}/users/${uid}`).remove();
                if (uid === getVoiceUid() && currentVoiceChatId === chatId) {
                    leaveVoiceChat();
                }
            }
        }

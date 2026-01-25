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

        function showModal(html) { modalContent.innerHTML = html; modal.style.display = 'flex'; }
        function closeModal() { modal.style.display = 'none'; modalContent.innerHTML = ''; }
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
                el.innerHTML = `<div style="min-width:0"><div class=\"chat-title\">${escapeHtml(chat.name)}</div><div class=\"chat-meta\">${chat.desc || ''}</div></div><div style=\"text-align:right;font-size:12px;color:rgba(255,255,255,.75)\">ID:${id.slice(0, 6)}</div>`;
                el.onclick = () => attemptJoin(id);
                chatListEl.appendChild(el);
            });
        }

        // Create modal
        function openCreateModal() {
            showModal(`
                                            <h4>Create new chat</h4>
                                            <div class="row"><label>Name</label><input id="newName" placeholder="e.g. my_new_chat" /></div>
                                            <div class="row"><label>Password</label><input id="newPass" placeholder="optional password" type="password" /></div>
                                            <div class="row"><label>Delete password</label><input id="newDeletePass" placeholder="password to delete chat" type="password" /></div>
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
                if (!name) { alert('Provide chat name'); return; }
                if (!deletePass) { alert('Provide delete password'); return; }
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
                }).catch(e => alert('Error: ' + e.message));
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
                    if (!nick || !pass) return alert('Please fill in all fields');

                    const usersRef = db.ref('users');
                    usersRef.orderByChild('nick').equalTo(nick).once('value', snap => {
                        if (snap.exists()) {
                            alert('This username is already taken');
                        } else {
                            usersRef.push({ nick, password: pass, createdAt: Date.now() })
                                .then(() => { alert('Account created!'); closeModal(); })
                                .catch(e => alert('Error: ' + e.message));
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
                    alert('Please fill in both fields');
                    return;
                }

                const usersRef = db.ref('users');
                usersRef.orderByChild('nick').equalTo(nick).once('value', snap => {
                    if (!snap.exists()) {
                        alert('User not found');
                        return;
                    }

                    const userData = Object.values(snap.val())[0];
                    if (userData.password === pass) {
                        currentUser = { nick, uid: Object.keys(snap.val())[0] };
                        localStorage.setItem('konsmon_user', JSON.stringify(currentUser));
                        updateUserUI();
                        closeModal();
                    } else {
                        alert('Incorrect password');
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
            alert('Logged out successfully');
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
                alert('Chat not found');
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
                                alert('Wrong password');
                            }
                        })
                        .catch(e => {
                            console.error(e);
                            alert('Error: ' + e.message);
                        });
                } else {

                    if (p === (chat.password || '')) {
                        closeModal();
                        joinChat(id, p);
                    } else {
                        alert('Wrong password');
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

            // Detach previous
            if (messagesRef) messagesRef.off();
            messagesRef = db.ref(`chats/${id}/messages`);
            let initialLoad = true;

            // Listen for additions
            messagesRef.on('child_added', snap => {
                const m = snap.val();
                const msgId = snap.key;
                const msgWrap = document.createElement('div');
                const meta = document.createElement('div'); meta.className = 'meta-line';
                meta.textContent = `[${m.time || ''}] ${m.nickname || 'Anon'}`;
                const bubble = document.createElement('div'); bubble.className = 'message';

                // text
                if (m.text) {
                    bubble.textContent = m.text;
                } else if (m.imageBase64) {
                    const img = document.createElement('img');
                    img.src = m.imageBase64;
                    bubble.appendChild(img);
                    img.onload = () => {
                        if (initialLoad || (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 300)) {
                            messagesEl.scrollTop = messagesEl.scrollHeight;
                        }
                    }
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
                                    })
                                    .catch(e => alert('Error deleting message: ' + e.message));
                            } else {
                                alert('You can delete only your messages.');
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

        leaveBtn.onclick = () => { if (!currentChatId) return; if (!confirm('Leave chat?')) return; detachChat(); }
        function detachChat() { if (messagesRef) messagesRef.off(); currentChatId = null; currentChatRef = null; messagesEl.innerHTML = ''; chatArea.style.display = 'none'; welcomeArea.style.display = 'block'; chatTitle.textContent = '—'; chatSubtitle.textContent = '—'; }





        // Delete chat
        deleteBtn.onclick = () => {
            if (!currentChatId) return;
            const chat = chatsCache[currentChatId];
            if (!chat) { alert('Chat data not found'); return; }

            showModal(`
                                    <h4>Delete chat: ${escapeHtml(chat.name)}</h4>
                                    <div class="row">
                                    <label>Delete password</label>
                                    <input id="deletePassInput" type="password" placeholder="Enter delete or admin password" />
                                    </div>
                                    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
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
                            alert('Chat deleted');
                            closeModal();
                            detachChat();
                        })
                        .catch(e => alert('Error: ' + e.message));
                    return;
                }


                if (currentUser && currentUser.uid) {
                    db.ref(`users/${currentUser.uid}`).once('value')
                        .then(snapUser => {
                            const isAdmin = snapUser.val()?.admin === 1;
                            if (isAdmin || enteredPass === (chat.deletePassword || '')) {
                                db.ref('chats/' + currentChatId).remove()
                                    .then(() => {
                                        alert('Chat deleted');
                                        closeModal();
                                        detachChat();
                                    })
                                    .catch(e => alert('Error: ' + e.message));
                            } else {
                                alert('Wrong delete password');
                            }
                        })
                        .catch(e => alert('Error: ' + e.message));
                } else {

                    if (enteredPass === (chat.deletePassword || '')) {
                        db.ref('chats/' + currentChatId).remove()
                            .then(() => {
                                alert('Chat deleted');
                                closeModal();
                                detachChat();
                            })
                            .catch(e => alert('Error: ' + e.message));
                    } else {
                        alert('Wrong delete password');
                    }
                }
            };
        };





        // Send message
        const uploadBtn = document.getElementById('uploadBtn');
        const imageInput = document.getElementById('imageInput');
        let selectedImageBase64 = null;

        uploadBtn.onclick = () => {
            imageInput.click();
        };

        imageInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function (ev) {
                selectedImageBase64 = ev.target.result;
                const preview = document.createElement('img');
                preview.src = selectedImageBase64;
                preview.style.maxWidth = '100px';
                preview.style.maxHeight = '100px';
                preview.style.borderRadius = '6px';
                preview.style.marginTop = '4px';
                messageInput.insertAdjacentElement('afterend', preview);
                setTimeout(() => preview.remove(), 10000);
            };
            reader.readAsDataURL(file);
        };

        function sendMessage() {
            if (!currentChatId) {
                alert('Join a chat first');
                return;
            }
            const chatSettings = chatsCache[currentChatId];
            if (chatSettings && chatSettings.allow_chat !== 1) {
                if (!currentUser) {
                    alert("Only admins can write in this chat.");
                    return;
                }
                db.ref(`users/${currentUser.uid}`).once('value').then(snap => {
                    const isAdmin = snap.val()?.admin === 1;
                    if (!isAdmin) {
                        alert("Only admins can write in this chat.");
                        return;
                    } else {
                        actuallySendMessage(); 
                    }
                });
                return; 
            }

            actuallySendMessage(); 

            function actuallySendMessage() {
                let text = String(messageInput.value || '').trim();
                const nickInputVal = String(document.getElementById('nicknameInput').value || '').trim();

                if (!text && !selectedImageBase64) return;

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

                const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                const msgData = {
                    nickname: nick,
                    text: text || null,
                    imageBase64: selectedImageBase64 || null,
                    time: t,
                    createdAt: Date.now(),
                    userId: currentUser ? currentUser.uid : null
                };

                db.ref(`chats/${currentChatId}/messages`).push(msgData)
                    .then(() => {
                        messageInput.value = '';
                        selectedImageBase64 = null;
                        const existingPreview = document.querySelector('#messageInput + img');
                        if (existingPreview) existingPreview.remove();
                    })
                    .catch(e => alert('Error: ' + e.message));
            }

        }

        sendBtn.onclick = sendMessage;

        messageInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });



        searchBtn.onclick = () => renderChatList(searchInput.value.trim()); searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') renderChatList(searchInput.value.trim()); });

        modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });





        // Initial
        renderChatList();
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
const serversRef = db.ref('servers');
const voiceChatsRef = db.ref('voice_chats');
const chatsRef = db.ref('chats');

// ADMIN PASSWORD
let adminPassword = null;

db.ref('admin/password').once('value').then(snap => {
    adminPassword = snap.val() || '';
}).catch(err => {
    console.error('Error, admin password was not found', err);
});

// UI refs
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

let voiceChatsCache = {};
let currentVoiceChatId = null;
let voicePresenceRef = null;
let voiceSignalingRef = null;
let isIntentionalLeave = false;

let serversCache = {}; // Stores the entire server tree

// Track where the user is
let currentServerId = null;
let currentChannelId = null;
let currentChannelType = null; // 'text' or 'voice'

let localAnonUid = null;
let localAnonNick = null;
let localMutes = {};

// WebRTC
let currentMicId = localStorage.getItem('konsmon_mic_id') || 'default';
let micSensitivity = parseInt(localStorage.getItem('konsmon_mic_sens') || '15'); // 0-100 threshold
let vadInterval = null;
let testAudioContext = null;
let testStream = null;
let unlockedServers = new Set();
let pingInterval = null;

let localStream = null;
let peers = {};
let audioContext = null;
let visualizerIntervals = {};
let visualizerStreams = {};

// --- USER CACHE LOGIC ---
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

// --- MODAL UTILS ---
let _modalResizeHandler = null;

function adjustModalImage() {
    const imgEl = modalContent.querySelector('.modal-image');
    if (!imgEl) return;
    const pad = 48;
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

function showAlert(msg, cb) {
    showModal(`<div style="min-width:260px"><p style="margin:0 0 8px">${escapeHtml(msg)}</p><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button id="alertOk" class="btn btn-primary">OK</button></div></div>`);
    const btn = document.getElementById('alertOk');
    if (btn) btn.onclick = () => { closeModal(); if (typeof cb === 'function') cb(); };
}

function escapeHtml(text) { return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// --- MENTION LOGIC ---
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
    if (!match) { hideMentionBox(); return; }
    const query = match[1].toLowerCase();
    const participants = Array.from(chatParticipants || []).filter(n => n && usersCacheByNickLower[n.toLowerCase()]);
    const filtered = participants.filter(n => n.toLowerCase().includes(query)).slice(0, 8);
    showMentionBox(filtered, query);
}

function extractMentionedUserIds(text) {
    if (!text) return [];
    const ids = new Set();
    const lowerText = text.toLowerCase();
    const atIndices = [];
    for (let i = 0; i < lowerText.length; i++) { if (lowerText[i] === '@') atIndices.push(i); }
    if (atIndices.length === 0) return [];
    const sortedNicks = [...usersNicknamesLower].sort((a, b) => b.length - a.length);
    for (const idx of atIndices) {
        const slice = lowerText.slice(idx + 1);
        let matchedNick = null;
        for (const nickLower of sortedNicks) {
            if (slice.startsWith(nickLower)) {
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
            return { count, lastAt: Date.now(), lastBy: senderNick || 'Anon' };
        });
    });
}

// --- SERVER AUTHENTICATION HELPER ---

function checkServerAccess(serverId, callback) {
    const server = serversCache[serverId];
    if (!server) return;

    // 1. Warunki, kiedy wpuszczamy BEZ hasła:
    // - brak hasła
    // - serwer jest już odblokowany w tej sesji (unlockedServers)
    // - jestem właścicielem serwera
    // - jestem globalnym adminem (adminPassword)
    const isOwner = currentUser && server.ownerId === currentUser.uid;
    const isUnlocked = unlockedServers.has(serverId);
    const hasNoPass = !server.password || server.password === '';

    // Sprawdzenie czy user wpisał globalne hasło admina przy wejściu (jeśli masz taką logikę)
    // lub czy po prostu zna hasło globalne.
    // Zakładam prostsze sprawdzenie:

    if (hasNoPass || isUnlocked || isOwner) {
        callback();
        return;
    }

    showModal(`
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

    document.getElementById('cancelServerAuth').onclick = closeModal;
    document.getElementById('confirmServerAuth').onclick = () => {
        const val = String(document.getElementById('serverPassInput').value || '');

        // Sprawdzamy hasło serwera LUB hasło globalnego admina
        if (val === server.password || (adminPassword && val === adminPassword)) {
            unlockedServers.add(serverId); // Zapamiętaj, że odblokowano
            closeModal();
            callback(); // Wykonaj wejście na kanał
        } else {
            showAlert("Wrong password!");
        }
    };
}


// --- RENDER TREE SYSTEM (NEW) ---

// Listeners
chatsRef.on('value', snap => {
    chatsCache = snap.val() || {};
    renderServerList();
});

serversRef.on('value', snap => {
    serversCache = snap.val() || {};
    renderServerList();
});

voiceChatsRef.on('value', snap => {
    voiceChatsCache = snap.val() || {};
    renderServerList(); // Re-render tree when users move in voice
});

function renderServerList(filter) {
    const listEl = document.getElementById('serverList');
    if (!listEl) return;

    listEl.innerHTML = '';
    filter = (searchInput.value || '').trim();

    const entries = Object.entries(serversCache);
    if (entries.length === 0) {
        listEl.innerHTML = '<div style="padding:10px; opacity:0.6">No servers. Create one!</div>';
        return;
    }

    const filtered = entries.filter(([id, s]) =>
        !filter || (s.name || '').toLowerCase().includes(filter.toLowerCase())
    );

    filtered.forEach(([serverId, server]) => {
        const isExpanded = (currentServerId === serverId);
        const serverDiv = document.createElement('div');
        serverDiv.className = 'tree-item tree-server';
        if (isExpanded) serverDiv.classList.add('active');

        const arrow = isExpanded ? '▼' : '▶';
        serverDiv.innerHTML = `<span class="tree-prefix" style="font-size:10px; vertical-align:middle; margin-right:6px;">${arrow}</span>${escapeHtml(server.name)}`;

        serverDiv.onclick = () => {
            if (currentServerId === serverId) {
                currentServerId = null;
            } else {
                currentServerId = serverId;
            }
            renderServerList();
        };
        listEl.appendChild(serverDiv);

        if (isExpanded || filter) {
            const txtCat = document.createElement('div');
            txtCat.className = 'tree-item tree-category indent-1';
            txtCat.innerHTML = `<span class="tree-prefix"></span>TEXT CHATS: <span class="add-channel-btn" title="Create Text Channel" onclick="openChannelCreateModal('${serverId}', 'text')">+</span>`;
            listEl.appendChild(txtCat);

            if (server.channels && server.channels.text) {
                Object.entries(server.channels.text).forEach(([channelId, channelData]) => {
                    const chanDiv = document.createElement('div');
                    chanDiv.className = 'tree-item tree-channel indent-2';
                    if (currentChatId === channelId) chanDiv.classList.add('active');
                    chanDiv.innerHTML = `<span class="tree-prefix">|_</span><span style="opacity:0.7">#</span> ${escapeHtml(channelData.name)}`;

                    chanDiv.onclick = () => {
                        checkServerAccess(serverId, () => {
                            currentChannelId = channelId;
                            currentChannelType = 'text';
                            renderServerList();
                            joinChat(channelId);
                        });
                    };
                    listEl.appendChild(chanDiv);
                });
            }

            const voiceCat = document.createElement('div');
            voiceCat.className = 'tree-item tree-category indent-1';
            voiceCat.innerHTML = `<span class="tree-prefix"></span>VOICE CHATS: <span class="add-channel-btn" title="Create Voice Channel" onclick="openChannelCreateModal('${serverId}', 'voice')">+</span>`;
            listEl.appendChild(voiceCat);

            if (server.channels && server.channels.voice) {
                Object.entries(server.channels.voice).forEach(([channelId, channelData]) => {
                    const chanDiv = document.createElement('div');
                    chanDiv.className = 'tree-item tree-channel indent-2';
                    if (currentVoiceChatId === channelId) chanDiv.classList.add('active');

                    chanDiv.style.display = 'flex';
                    chanDiv.style.justifyContent = 'space-between';
                    chanDiv.style.alignItems = 'center';
                    chanDiv.style.paddingRight = '6px';

                    chanDiv.innerHTML = `
                        <span style="display:flex;align-items:center;overflow:hidden;">
                            <span class="tree-prefix">|_</span>🔊 ${escapeHtml(channelData.name)}
                            <span id="ping-${channelId}" style="margin-left:8px;font-size:11px;font-family:monospace;font-weight:bold;"></span>
                        </span>
                        <span class="settings-icon" title="Voice Settings">⚙</span>
                    `;

                    chanDiv.onclick = (e) => {
                        if (e.target.classList.contains('settings-icon')) {
                            openVoiceSettingsModal(channelId);
                            return;
                        }
                        checkServerAccess(serverId, () => {
                            currentChannelId = channelId;
                            currentChannelType = 'voice';
                            renderServerList();
                            attemptJoinVoice(channelId);
                        });
                    };
                    listEl.appendChild(chanDiv);

                    const realTimeVoiceData = voiceChatsCache[channelId];
                    if (realTimeVoiceData && realTimeVoiceData.users) {
                        Object.entries(realTimeVoiceData.users).forEach(([uid, uData]) => {
                            renderVoiceUserInTree(listEl, channelId, uid, uData);
                        });
                    }
                });
            }
        }
    });
}




function openChannelCreateModal(serverId, type) {
    const title = type === 'text' ? 'NEW TEXT CHANEL' : 'NEW VOICE CHANNEL';
    showModal(`
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

    document.getElementById('cancelChan').onclick = closeModal;
    document.getElementById('confirmChan').onclick = () => {
        const name = String(document.getElementById('newChannelName').value || '').trim();
        if (!name) {
            showAlert('Please enter a name');
            return;
        }

        const path = `servers/${serverId}/channels/${type}`;
        db.ref(path).push({
            name: name,
            type: type
        }).then(() => {
            closeModal();
            showAlert('Channel created!');
        }).catch(err => {
            showAlert('Error: ' + err.message);
        });
    };
}

function renderVoiceUserInTree(container, channelId, uid, uData) {
    const userRow = document.createElement('div');
    userRow.className = 'tree-item tree-user indent-3';

    const myUid = getVoiceUid();
    const isMe = (uid === myUid);
    const isAdmin = currentUser && usersCacheById[currentUser.uid] && usersCacheById[currentUser.uid].admin === 1;

    let html = `<span class="tree-prefix">|_</span> <span id="voice-nick-${uid}" class="tree-user-nick">${escapeHtml(uData.nick)}</span>`;

    const controls = document.createElement('span');
    controls.className = 'tree-controls';

    function createIcon(type, icon) {
        const btn = document.createElement('span');
        btn.className = 't-icon';
        btn.title = type;
        btn.innerHTML = icon;

        const stateKey = uid + '_' + type;

        // Wizualne zaznaczenie (czerwony filtr), jeśli wyciszone
        if (localMutes[stateKey]) {
            btn.style.filter = 'grayscale(100%) brightness(50%) sepia(100%) hue-rotate(-50deg) saturate(600%) contrast(0.8)';
        }

        btn.onclick = (e) => {
            e.stopPropagation();

            if (!isMe && !isAdmin && type === 'Mic') {
                showAlert("Only admins can mute other users.");
                return;
            }

            // 1. Przełącz stan klikniętego przycisku
            localMutes[stateKey] = !localMutes[stateKey];
            const isNowMuted = localMutes[stateKey];

            // Dźwięk systemowy
            if (isNowMuted) audioMute.play().catch(() => { });
            else audioUnmute.play().catch(() => { });

            // --- LOGIKA POWIĄZANIA SŁUCHAWEK Z MIKROFONEM ---

            // A. Jeśli kliknięto Słuchawki (Headphones) i właśnie je WYCISZONO -> Wycisz też Mikrofon
            if (type === 'Headphones' && isNowMuted) {
                localMutes[uid + '_Mic'] = true;
            }

            // B. (Opcjonalnie) Jeśli kliknięto Mikrofon i próbujemy go ODCISZYĆ, ale Słuchawki są wyciszone -> Odsłuchaj też słuchawki (żeby było logicznie)
            if (type === 'Mic' && !isNowMuted && localMutes[uid + '_Headphones']) {
                localMutes[uid + '_Headphones'] = false;
            }
            // ----------------------------------------------------

            // Aplikowanie zmian logicznych (WebRTC / HTML Audio)

            // Obsługa Mikrofonu
            const micKey = uid + '_Mic';
            const micMuted = localMutes[micKey];

            if (isMe && localStream) {
                localStream.getAudioTracks().forEach(t => t.enabled = !micMuted);
            }
            // (Dla innych użytkowników ikona mikrofonu jest tylko wizualna, chyba że jesteś adminem, ale WebRTC nie pozwala łatwo wyciszyć zdalnego mikrofonu u źródła, więc tutaj to głównie wizualne dla admina + lokalne wyciszenie audio)
            const remoteAudio = document.getElementById('audio-' + uid);
            if (remoteAudio && type === 'Mic') remoteAudio.muted = micMuted;


            // Obsługa Słuchawek (Deafen)
            const phoneKey = uid + '_Headphones';
            const phoneMuted = localMutes[phoneKey];

            if (type === 'Headphones' || (type === 'Mic' && !isNowMuted)) {
                if (isMe) {
                    // Wyciszamy wszystkich u siebie
                    document.querySelectorAll('#webrtc-audio-container audio').forEach(a => a.muted = phoneMuted);
                } else {
                    // Wyciszamy konkretnego użytkownika u siebie
                    const remAudio = document.getElementById('audio-' + uid);
                    if (remAudio) remAudio.muted = phoneMuted;
                }
            }

            // Przeładuj listę, aby zaktualizować kolory obu ikon (bo mogły się zmienić obie na raz)
            renderServerList();
        };
        return btn;
    }

    controls.appendChild(createIcon('Mic', '🎤'));
    controls.appendChild(createIcon('Headphones', '🎧'));

    if (isMe) {
        controls.appendChild(createIcon('Stream', '🖥️'));
    }

    const actionBtn = document.createElement('span');
    actionBtn.className = 't-icon';

    if (isMe) {
        actionBtn.innerHTML = '📞';
        actionBtn.title = 'Leave Voice';
        actionBtn.style.color = '#ef4444';
        actionBtn.onclick = (e) => { e.stopPropagation(); leaveVoiceChat(); };
    } else if (isAdmin) {
        actionBtn.innerHTML = '❌';
        actionBtn.title = 'Kick User';
        actionBtn.style.color = '#ef4444';
        actionBtn.onclick = (e) => { e.stopPropagation(); kickVoiceUser(channelId, uid); };
    } else {
        actionBtn.innerHTML = '';
    }

    if (actionBtn.innerHTML !== '') controls.appendChild(actionBtn);

    userRow.innerHTML = html;
    userRow.appendChild(controls);

    container.appendChild(userRow);
}

// --- CREATE & JOIN LOGIC ---

function openCreateModal() {
    showModal(`
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

    document.getElementById('cancelCreate').onclick = closeModal;
    document.getElementById('confirmCreate').onclick = () => {
        const name = String(document.getElementById('newName').value || '').trim();
        const pass = String(document.getElementById('newPass').value || '');
        const deletePass = String(document.getElementById('newDeletePass').value || '');

        if (!name) { showAlert('Provide server name'); return; }
        if (!deletePass) { showAlert('Provide delete password'); return; }

        const newServerRef = serversRef.push();
        const defaultTextId = newServerRef.child('channels/text').push().key;
        const defaultVoiceId = newServerRef.child('channels/voice').push().key;

        const serverData = {
            name: name,
            password: pass,
            deletePassword: deletePass,
            createdAt: Date.now(),
            ownerId: currentUser ? currentUser.uid : null,
            channels: {
                text: { [defaultTextId]: { name: 'general', type: 'text' } },
                voice: { [defaultVoiceId]: { name: 'Lobby', type: 'voice' } }
            }
        };

        newServerRef.set(serverData).then(() => {
            closeModal();
            showAlert('Server created! Please select it from the list.');
        }).catch(e => showAlert('Error: ' + e.message));
    }
}

// Sign in UI handling
const userPanel = document.getElementById('userPanel');
const currentUserNickEl = document.getElementById('currentUserNick');
let currentUser = null;



function updateUserUI() {
    const bSignin = document.getElementById('btnSignin');
    if (currentUser) {
        if (bSignin) bSignin.style.display = 'none';
        userPanel.style.display = 'block';
        currentUserNickEl.textContent = currentUser.nick;
    } else {
        if (bSignin) bSignin.style.display = '';
        userPanel.style.display = 'none';
    }
}

const userBox = document.getElementById('userBox');
const userMenu = document.getElementById('userMenu');
const logoutBtn = document.getElementById('logoutBtn');
userBox.onclick = () => { userMenu.style.display = userMenu.style.display === 'none' ? 'block' : 'none'; };
logoutBtn.onclick = () => {
    localStorage.removeItem('konsmon_user');
    currentUser = null;
    updateUserUI();
    userMenu.style.display = 'none';
    showAlert('Logged out successfully');
};
const storedUser = localStorage.getItem('konsmon_user');
if (storedUser) { currentUser = JSON.parse(storedUser); updateUserUI(); }

// Join modal
function attemptJoin(id, skipPrompt = false) {
    const chat = chatsCache[id] || {};
    if (!chat.password || chat.password.trim() === '') { joinChat(id); return; }
    if (skipPrompt) { joinChat(id); return; }
    showModal(`
        <h4>Join ${escapeHtml(chat.name || 'Chat')}</h4>
        <div class="row"><label>Password</label><input id="joinPass" type="password" placeholder="Password"/></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button id="cancelJoin" class="btn btn-ghost">Cancel</button>
        <button id="confirmJoin" class="btn btn-primary">Join</button>
        </div>
    `);
    document.getElementById('cancelJoin').onclick = closeModal;
    document.getElementById('confirmJoin').onclick = () => {
        const p = String(document.getElementById('joinPass').value || '');
        if ((adminPassword && p === adminPassword) || p === (chat.password || '')) {
            closeModal(); joinChat(id, p);
        } else { showAlert('Wrong password'); }
    };
}

function attemptJoinVoice(id) {
    // Tutaj normalnie byłoby sprawdzanie hasła, ale w strukturze serwerów
    // hasło jest na wejściu do serwera, więc wchodzimy od razu.
    joinVoiceChat(id);
}

// Join chat
function joinChat(id) {
    currentChatId = id;
    currentChatRef = db.ref('chats/' + id);
    let foundName = null;
    // Find name in server cache
    Object.values(serversCache).forEach(s => {
        if (s.channels && s.channels.text && s.channels.text[id]) foundName = s.channels.text[id].name;
    });

    chatTitle.textContent = foundName || '—';
    chatSubtitle.textContent = 'ID: ' + id;
    welcomeArea.style.display = 'none';
    chatArea.style.display = 'flex';
    messagesEl.innerHTML = '';

    ensureUsersCache().catch(() => { });
    chatParticipants = new Set();
    hideMentionBox();

    if (currentUser && currentUser.uid) db.ref(`chats/${id}/pings/${currentUser.uid}`).remove();
    if (messagesRef) messagesRef.off();

    messagesRef = db.ref(`chats/${id}/messages`);
    let initialLoad = true;
    let lastDate = null;

    function removeDateSeparatorIfEmpty(targetDate) {
        let found = false;
        messagesEl.querySelectorAll('div').forEach(d => { if (d.dataset && d.dataset.date === targetDate) found = true; });
        if (!found) {
            const sep = Array.from(messagesEl.querySelectorAll('.date-separator')).find(s => s.textContent === targetDate);
            if (sep) sep.remove();
        }
    }

    messagesRef.on('child_added', snap => {
        const m = snap.val();
        const msgId = snap.key;
        const msgWrap = document.createElement('div');
        if (m?.nickname) chatParticipants.add(String(m.nickname));

        const timeStr = m.createdAt
            ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : (m.time ? String(m.time).split(' ').pop() : '');

        const meta = document.createElement('div'); meta.className = 'meta-line';
        meta.textContent = `[${timeStr}] ${m.nickname || 'Anon'}`;

        const msgDate = new Date(m.createdAt || Date.now());
        const dateOnly = msgDate.toLocaleDateString();
        if (lastDate !== dateOnly) {
            const sep = document.createElement('div');
            sep.className = 'date-separator';
            sep.textContent = dateOnly;
            messagesEl.appendChild(sep);
            lastDate = dateOnly;
        }
        msgWrap.className = 'msg-wrap';
        msgWrap.dataset.date = dateOnly;

        const bubble = document.createElement('div'); bubble.className = 'message';

        if (m.text) {
            const urlRegex = /(?:https?:\/\/[^\s]+)|(?:www\.[^\s]+)/g;
            let lastIndex = 0;
            const text = String(m.text || '');
            let match;
            while ((match = urlRegex.exec(text)) !== null) {
                const idx = match.index;
                if (idx > lastIndex) bubble.appendChild(document.createTextNode(text.slice(lastIndex, idx)));
                let url = match[0];
                const href = url.startsWith('http') ? url : 'http://' + url;
                const a = document.createElement('a');
                a.href = href; a.textContent = url; a.target = '_blank'; a.className = 'file-link';
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
                modalContent.innerHTML = `<div class="modal-viewer"><a class="modal-download" href="${img.src}" download="img.png">⬇</a><img src="${img.src}" class="modal-image"/></div>`;
                modal.style.display = 'flex';
                const modalImg = modalContent.querySelector('.modal-image');
                if (modalImg) modalImg.onload = () => adjustModalImage();
            });
            img.onload = () => {
                if (initialLoad || (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 300)) messagesEl.scrollTop = messagesEl.scrollHeight;
            }
        } else if (m.fileBase64) {
            const fileLink = document.createElement('a');
            fileLink.href = m.fileBase64;
            fileLink.target = '_blank';
            fileLink.className = 'file-link';
            fileLink.textContent = (m.fileName || 'file');
            fileLink.download = m.fileName || '';
            bubble.appendChild(fileLink);
        }

        bubble.addEventListener('click', () => {
            if (!currentUser) return;
            const existingTrash = bubble.querySelector('.trash-icon');
            if (existingTrash) { existingTrash.remove(); return; }
            const trash = document.createElement('span');
            trash.className = 'trash-icon'; trash.textContent = '🗑️';
            trash.style.cursor = 'pointer'; trash.style.position = 'absolute'; trash.style.right = '-26px'; trash.style.top = '4px';
            bubble.style.position = 'relative'; bubble.appendChild(trash);
            trash.onclick = (e) => {
                e.stopPropagation();
                if (!confirm('Delete message?')) return;
                db.ref(`users/${currentUser.uid}`).once('value').then(snapUser => {
                    const isAdmin = snapUser.val()?.admin === 1;
                    if (isAdmin || m.userId === currentUser.uid) {
                        db.ref(`chats/${currentChatId}/messages/${msgId}`).remove().then(() => { msgWrap.remove(); removeDateSeparatorIfEmpty(dateOnly); });
                    } else showAlert('You can delete only your messages.');
                });
            };
        });

        msgWrap.appendChild(meta); msgWrap.appendChild(bubble); messagesEl.appendChild(msgWrap);
        if (initialLoad || (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 300)) messagesEl.scrollTop = messagesEl.scrollHeight;
    });

    messagesRef.once('value', () => { initialLoad = false; setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 100); });
}

leaveBtn.onclick = () => { if (!currentChatId) return; if (!showAlert('Leave chat?')) return; detachChat(); }
function detachChat() { if (messagesRef) messagesRef.off(); currentChatId = null; currentChatRef = null; messagesEl.innerHTML = ''; chatArea.style.display = 'none'; welcomeArea.style.display = 'block'; chatTitle.textContent = '—'; chatSubtitle.textContent = '—'; }

// Delete chat
// Delete chat / channel logic
deleteBtn.onclick = () => {
    // Sprawdzamy czy cokolwiek jest wybrane
    const targetId = currentChatId || currentChannelId;
    if (!targetId) return;

    // Ustalamy nazwę do wyświetlenia w modalu
    let chatName = 'Chat';
    let isServerChannel = false;
    let parentServer = null;

    if (currentServerId && serversCache[currentServerId]) {
        parentServer = serversCache[currentServerId];
        isServerChannel = true;
        // Próba znalezienia nazwy
        if (currentChannelType === 'text' && parentServer.channels.text?.[targetId]) {
            chatName = parentServer.channels.text[targetId].name;
        } else if (currentChannelType === 'voice' && parentServer.channels.voice?.[targetId]) {
            chatName = parentServer.channels.voice[targetId].name;
        }
    } else if (chatsCache[targetId]) {
        chatName = chatsCache[targetId].name;
    }

    showModal(`
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

    document.getElementById('cancelDelete').onclick = closeModal;
    document.getElementById('confirmDelete').onclick = () => {
        const enteredPass = String(document.getElementById('deletePassInput').value || '');

        // 1. Sprawdzenie hasła globalnego ADMINA
        const isGlobalAdmin = (adminPassword && enteredPass === adminPassword);

        // 2. Sprawdzenie hasła usuwania SERWERA (jeśli to kanał w serwerze)
        let isServerAdmin = false;
        if (parentServer && parentServer.deletePassword && enteredPass === parentServer.deletePassword) {
            isServerAdmin = true;
        }

        // 3. Sprawdzenie hasła usuwania STAREGO CZATU (flat structure)
        let isOldChatAdmin = false;
        const oldChat = chatsCache[targetId];
        if (oldChat && oldChat.deletePassword && enteredPass === oldChat.deletePassword) {
            isOldChatAdmin = true;
        }

        if (isGlobalAdmin || isServerAdmin || isOldChatAdmin) {
            // Wykonaj usuwanie
            const updates = {};

            // A. Jeśli to kanał w serwerze, usuń go z listy kanałów serwera
            if (isServerChannel && currentServerId && currentChannelType) {
                updates[`servers/${currentServerId}/channels/${currentChannelType}/${targetId}`] = null;
            } else {
                // To stary czat z głównej listy
                updates[`chats/${targetId}`] = null;
            }

            // B. Zawsze usuń historię wiadomości (dla text) i pings
            updates[`chats/${targetId}`] = null; // To usuwa wiadomości
            // C. Jeśli to głosowy, usuń dane sesji voice
            if (currentChannelType === 'voice') {
                updates[`voice_chats/${targetId}`] = null;
                updates[`voice_signaling/${targetId}`] = null;
            }

            db.ref().update(updates)
                .then(() => {
                    closeModal();
                    showAlert('Channel/Chat deleted successfully.');
                    detachChat();
                    if (currentChannelType === 'voice') leaveVoiceChat();
                    renderServerList();
                })
                .catch(e => showAlert('Error deleting: ' + e.message));

        } else {
            showAlert('Wrong delete password.');
        }
    };
};

// Send message logic
const uploadBtn = document.getElementById('uploadBtn');
const imageInput = document.getElementById('imageInput');
const MAX_FILE_SIZE = 200 * 1024;
let selectedImageBase64 = null, selectedFileBase64 = null, selectedFileName = null, selectedFileType = null;

uploadBtn.onclick = () => imageInput.click();
imageInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) { showAlert('File too large (max 200KB)'); e.target.value = ''; return; }
    selectedImageBase64 = null; selectedFileBase64 = null;
    const existing = document.querySelector('#messageInput + img, #messageInput + .file-preview');
    if (existing) existing.remove();
    const reader = new FileReader();
    reader.onload = (ev) => {
        if (file.type.startsWith('image/')) {
            selectedImageBase64 = ev.target.result;
            const p = document.createElement('img'); p.src = selectedImageBase64; p.style.maxWidth = '100px'; p.style.marginTop = '4px';
            messageInput.insertAdjacentElement('afterend', p);
        } else {
            selectedFileBase64 = ev.target.result; selectedFileName = file.name; selectedFileType = file.type;
            const d = document.createElement('div'); d.className = 'file-preview'; d.textContent = file.name;
            messageInput.insertAdjacentElement('afterend', d);
        }
    };
    reader.readAsDataURL(file);
};

function sendMessage() {
    if (!currentChatId) { showAlert('Join a chat first'); return; }
    actuallySendMessage();
    async function actuallySendMessage() {
        let text = String(messageInput.value || '').trim();
        if (!text && !selectedImageBase64 && !selectedFileBase64) return;
        const nickInputVal = String(document.getElementById('nicknameInput').value || '').trim();
        let nick = currentUser ? currentUser.nick : (nickInputVal || 'Anon' + Math.floor(1000 + Math.random() * 9000));
        const now = new Date();
        const t = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const mentionedUserIds = await resolveMentionedUserIds(text);
        const msgData = { nickname: nick, text: text || null, imageBase64: selectedImageBase64, fileBase64: selectedFileBase64, fileName: selectedFileName, time: t, createdAt: Date.now(), userId: currentUser ? currentUser.uid : null };
        db.ref(`chats/${currentChatId}/messages`).push(msgData).then(() => {
            messageInput.value = ''; selectedImageBase64 = null; selectedFileBase64 = null;
            const ex = document.querySelector('#messageInput + img, #messageInput + .file-preview'); if (ex) ex.remove();
            if (mentionedUserIds.length > 0) addPingsForUsers(currentChatId, mentionedUserIds, nick, currentUser ? currentUser.uid : null);
        });
    }
}
sendBtn.onclick = sendMessage;
messageInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
messageInput.addEventListener('input', handleMentionInput);
messageInput.addEventListener('click', handleMentionInput);
messageInput.addEventListener('blur', () => { if (mentionHideTimer) clearTimeout(mentionHideTimer); mentionHideTimer = setTimeout(() => hideMentionBox(), 150); });

searchBtn.onclick = () => renderServerList();
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') renderServerList(); });
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Logo FX
(function initWavyLogo() {
    try {
        const el = document.getElementById('siteLogo'); if (!el) return;
        const txt = String(el.textContent || '').trim(); el.innerHTML = '';
        const spans = [];
        for (let i = 0; i < txt.length; i++) {
            const sp = document.createElement('span'); sp.textContent = txt[i] === ' ' ? '\u00A0' : txt[i];
            el.appendChild(sp); spans.push(sp);
        }
        el.classList.add('wavy-logo');
        spans.forEach((s, idx) => {
            s.addEventListener('mouseenter', () => {
                spans.forEach((ss, j) => {
                    const lift = Math.max(0, 18 - Math.abs(j - idx) * 5);
                    if (lift > 0) { ss.style.transform = `translateY(-${lift}px)`; ss.style.transitionDelay = `${Math.abs(j - idx) * 30}ms`; }
                });
            });
            s.addEventListener('mouseleave', () => spans.forEach(ss => { ss.style.transform = ''; ss.style.transitionDelay = ''; }));
        });
    } catch (e) { console.warn(e); }
})();

// Mobile Menu
(function initMobileMenu() {
    try {
        const btn = document.getElementById('mobileMenuBtn');
        const body = document.body;
        function close() { body.classList.remove('sidebar-open'); const ov = document.getElementById('mobileMenuOverlay'); if (ov) ov.style.display = 'none'; }
        if (btn) btn.addEventListener('click', () => {
            if (body.classList.contains('sidebar-open')) close();
            else {
                body.classList.add('sidebar-open');
                let ov = document.getElementById('mobileMenuOverlay');
                if (!ov) { ov = document.createElement('div'); ov.id = 'mobileMenuOverlay'; ov.style.position = 'fixed'; ov.style.inset = '0'; ov.style.background = 'rgba(0,0,0,0.35)'; ov.style.zIndex = '1500'; body.appendChild(ov); ov.onclick = close; }
                ov.style.display = 'block';
            }
        });
    } catch (e) { }
})();


// --- WEBRTC VOICE ---
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], iceTransportPolicy: 'all' };
const audioConnect = new Audio('./audio/con.mp3');
const audioDisconnect = new Audio('./audio/discon.mp3');
const audioMute = new Audio('./audio/mute.mp3');
const audioUnmute = new Audio('./audio/unmute.mp3');

if (!document.getElementById('webrtc-audio-container')) { const ac = document.createElement('div'); ac.id = 'webrtc-audio-container'; document.body.appendChild(ac); }

function getVoiceUid() {
    if (currentUser && currentUser.uid) return currentUser.uid;
    if (!localAnonUid) localAnonUid = 'anon_' + Math.random().toString(36).substr(2, 9);
    return localAnonUid;
}
function getVoiceNick() {
    if (currentUser && currentUser.nick) return currentUser.nick;
    const val = document.getElementById('nicknameInput')?.value.trim();
    if (val) return val;
    if (!localAnonNick) localAnonNick = 'Anon' + Math.floor(1000 + Math.random() * 9000);
    return localAnonNick;
}

async function joinVoiceChat(id) {
    console.log(`%c[VOICE] Requesting join to: ${id} (Mic: ${currentMicId})`, 'color: #0ea5ff; font-weight: bold;');

    if (currentVoiceChatId) leaveVoiceChat();

    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    if (audioContext.state === 'suspended') await audioContext.resume();

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: currentMicId !== 'default' ? { exact: currentMicId } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false,
                latency: 0
            },
            video: false
        });
        console.log('%c[VOICE] Microphone access GRANTED', 'color: #22c55e;');
    } catch (err) {
        console.error('[VOICE] Microphone access DENIED', err);
        showAlert("Microphone denied: " + err.message);
        return;
    }

    if (audioConnect) audioConnect.play().catch(() => { });
    currentVoiceChatId = id;
    const myUid = getVoiceUid();

    if (vadInterval) clearInterval(vadInterval);

    const vadStream = localStream.clone();
    const vadCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const vadSrc = vadCtx.createMediaStreamSource(vadStream);
    const vadAnalyser = vadCtx.createAnalyser();
    vadAnalyser.fftSize = 256;
    vadSrc.connect(vadAnalyser);
    const vadData = new Uint8Array(vadAnalyser.frequencyBinCount);

    let silenceCounter = 0;

    vadInterval = setInterval(() => {
        if (!localStream || !currentVoiceChatId) {
            vadStream.getTracks().forEach(t => t.stop());
            return;
        }

        vadAnalyser.getByteFrequencyData(vadData);
        let sum = 0;
        for (let i = 0; i < vadData.length; i++) sum += vadData[i];
        const avg = sum / vadData.length;

        const manualMute = localMutes[myUid + '_Mic'];

        if (!manualMute) {
            if (avg > micSensitivity) {
                localStream.getAudioTracks().forEach(t => t.enabled = true);
                silenceCounter = 0;
            } else {
                silenceCounter++;
                if (silenceCounter > 5) {
                    localStream.getAudioTracks().forEach(t => t.enabled = false);
                }
            }
        }
    }, 50);

    voicePresenceRef = db.ref(`voice_chats/${id}/users/${myUid}`);
    await voicePresenceRef.onDisconnect().remove();
    await voicePresenceRef.set({ nick: getVoiceNick(), joinedAt: Date.now() });

    voiceSignalingRef = db.ref(`voice_signaling/${id}/${myUid}`);
    voiceSignalingRef.on('child_added', async (snap) => {
        const msg = snap.val(); if (!msg) return;
        snap.ref.remove();
        await handleSignalingMessage(msg);
    });

    try {
        const myClone = localStream.clone();
        myClone.getAudioTracks()[0].enabled = true;
        visualizerStreams['local'] = myClone;
        attachSpeakingVisualizer(myClone, myUid);
    } catch (e) { }

    db.ref(`voice_chats/${id}/users`).once('value').then(snapshot => {
        const users = snapshot.val();
        if (users) {
            const others = Object.keys(users).filter(uid => uid !== myUid);
            others.forEach(targetUid => initiateCall(targetUid));
        }
    });

    startPingMonitor(id);
}

function leaveVoiceChat(wasKicked = false) {
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    if (vadInterval) { clearInterval(vadInterval); vadInterval = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    Object.values(visualizerStreams).forEach(s => s.getTracks().forEach(t => t.stop())); visualizerStreams = {};
    Object.values(peers).forEach(pc => pc.close()); peers = {};
    Object.values(visualizerIntervals).forEach(iv => clearInterval(iv)); visualizerIntervals = {};
    const c = document.getElementById('webrtc-audio-container'); if (c) c.innerHTML = '';
    if (voicePresenceRef) { if (!wasKicked) audioDisconnect.play().catch(() => { }); voicePresenceRef.remove(); voicePresenceRef.onDisconnect().cancel(); voicePresenceRef = null; }
    if (voiceSignalingRef) { voiceSignalingRef.off(); voiceSignalingRef.remove(); voiceSignalingRef = null; }

    const prevPingEl = document.getElementById(`ping-${currentVoiceChatId}`);
    if (prevPingEl) prevPingEl.textContent = '';

    currentVoiceChatId = null;
    renderServerList();
    if (wasKicked) showAlert("You were kicked.");
}

function createPeerConnection(targetUid) {
    if (peers[targetUid]) return peers[targetUid];

    console.log(`%c[WEBRTC] Creating new PeerConnection for: ${targetUid}`, 'color: #d946ef; font-weight: bold;');

    const pc = new RTCPeerConnection(rtcConfig);
    peers[targetUid] = pc;
    pc.iceQueue = [];

    // ICE State Logging
    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        let color = '#888';
        if (state === 'connected') color = '#22c55e';
        if (state === 'failed' || state === 'disconnected') color = '#ef4444';
        console.log(`%c[WEBRTC] ICE State (${targetUid}): ${state}`, `color: ${color}; font-weight: bold;`);
    };

    if (localStream) {
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            // console.log(`[WEBRTC] Sending ICE Candidate to ${targetUid}`); // Uncomment for verbose logs
            sendSignal(targetUid, { type: 'candidate', candidate: e.candidate.toJSON() });
        }
    };

    pc.ontrack = (e) => {
        console.log(`%c[WEBRTC] Received REMOTE TRACK from ${targetUid}`, 'color: #22c55e; font-weight: bold;');
        const remoteStream = e.streams[0] || new MediaStream([e.track]);

        let audioEl = document.getElementById('audio-' + targetUid);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = 'audio-' + targetUid;
            audioEl.autoplay = true;
            document.getElementById('webrtc-audio-container').appendChild(audioEl);
            console.log(`%c[WEBRTC] Created new <audio> element for ${targetUid}`, 'color: #22c55e;');
        }

        audioEl.srcObject = remoteStream;
        const key = targetUid + '_Headphones';
        audioEl.muted = (localMutes && localMutes[key]) ? true : false;

        audioEl.play().catch(err => console.warn("Autoplay blocked:", err));

        // Remote Visualizer
        try {
            const clone = remoteStream.clone();
            visualizerStreams[targetUid] = clone;
            attachSpeakingVisualizer(clone, targetUid);
        } catch (e) { }
    };

    return pc;
}

async function initiateCall(targetUid) {
    console.log(`%c[WEBRTC] Initiating Call (OFFER) -> ${targetUid}`, 'color: #d946ef;');
    const pc = createPeerConnection(targetUid);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(targetUid, { type: 'offer', data: { sdp: offer.sdp, type: offer.type } });
}

async function handleSignalingMessage(msg) {
    const { type, data, candidate, from } = msg;

    // Log incoming signals
    if (type !== 'candidate') {
        console.log(`%c[SIGNAL] Received ${type.toUpperCase()} from ${from}`, 'color: #f59e0b;');
    }

    if (!peers[from]) {
        if (type === 'offer') {
            createPeerConnection(from);
        } else {
            console.warn(`[SIGNAL] Ignored ${type} from unknown peer ${from} (no offer yet)`);
            return;
        }
    }

    const pc = peers[from];

    try {
        if (type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            console.log(`%c[WEBRTC] Remote Description Set (OFFER) for ${from}`, 'color: #aaa;');

            // Process queued candidates
            if (pc.iceQueue && pc.iceQueue.length > 0) {
                console.log(`[WEBRTC] Adding ${pc.iceQueue.length} queued ICE candidates...`);
                for (const c of pc.iceQueue) await pc.addIceCandidate(c);
                pc.iceQueue = [];
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log(`%c[WEBRTC] Sending ANSWER -> ${from}`, 'color: #d946ef;');
            sendSignal(from, { type: 'answer', data: { sdp: answer.sdp, type: answer.type } });

        } else if (type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            console.log(`%c[WEBRTC] Remote Description Set (ANSWER) for ${from}`, 'color: #aaa;');

            if (pc.iceQueue && pc.iceQueue.length > 0) {
                for (const c of pc.iceQueue) await pc.addIceCandidate(c);
                pc.iceQueue = [];
            }

        } else if (type === 'candidate') {
            const cand = new RTCIceCandidate(candidate);
            if (pc.remoteDescription) {
                await pc.addIceCandidate(cand);
            } else {
                if (!pc.iceQueue) pc.iceQueue = [];
                pc.iceQueue.push(cand);
            }
        }
    } catch (err) {
        console.error(`[WEBRTC] Error handling signal ${type}:`, err);
    }
}

function sendSignal(targetUid, payload) {
    if (!currentVoiceChatId) return;
    db.ref(`voice_signaling/${currentVoiceChatId}/${targetUid}`).push({ ...payload, from: getVoiceUid() });
}

function attachSpeakingVisualizer(stream, uid) {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();

    try {
        // FIX: Ensure AudioContext is running (Chrome policy)
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const src = audioContext.createMediaStreamSource(stream);
        const an = audioContext.createAnalyser();
        an.fftSize = 256;
        src.connect(an);

        const data = new Uint8Array(an.frequencyBinCount);

        if (visualizerIntervals[uid]) clearInterval(visualizerIntervals[uid]);

        visualizerIntervals[uid] = setInterval(() => {
            // Safety check
            if (!currentVoiceChatId) {
                clearInterval(visualizerIntervals[uid]);
                return;
            }

            // Re-check context state just in case
            if (audioContext.state === 'suspended') audioContext.resume();

            an.getByteFrequencyData(data);

            let sum = 0;
            for (let x of data) sum += x;
            const avg = sum / data.length;

            const el = document.getElementById('voice-nick-' + uid);
            if (el) {
                // Zmniejszyłem próg z 10 na 5, żeby łatwiej łapało ciche mówienie
                if (avg > 5) {
                    el.style.color = '#4ade80';
                    el.style.fontWeight = 'bold';
                    el.style.textShadow = '0 0 8px rgba(74, 222, 128, 0.4)'; // Dodatkowy efekt
                } else {
                    el.style.color = '#a1a1aa';
                    el.style.fontWeight = 'normal';
                    el.style.textShadow = 'none';
                }
            }
        }, 100);
    } catch (e) {
        console.warn("Visualizer attach error:", e);
    }
}

function kickVoiceUser(chatId, uid) {
    if (confirm("Kick user?")) {
        db.ref(`voice_chats/${chatId}/users/${uid}`).remove();
        if (uid === getVoiceUid() && currentVoiceChatId === chatId) leaveVoiceChat(true);
    }
}

// 1. Login Modal
function openLoginModal() {
    showModal(`
        <h4>SIGN IN</h4>
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
                showAlert('Logged in!');
            } else {
                showAlert('Incorrect password');
            }
        });
    };
}
// 2. Signup Modal
function openSignupModal() {
    showModal(`
        <h4>CREATE ACCOUNT</h4>
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
}

async function openVoiceSettingsModal(channelId = null) {
    if (testAudioContext) { testAudioContext.close(); testAudioContext = null; }
    if (testStream) { testStream.getTracks().forEach(t => t.stop()); testStream = null; }

    let tempMicId = currentMicId;

    showModal(`
        <h4>VOICE SETTINGS</h4>
        <div class="row">
            <label>Input Device</label>
            <select id="micSelect" style="width:100%; padding:8px; background:#111; color:white; border:1px solid #333; border-radius:4px;"></select>
        </div>
        <div class="row" style="margin-top:15px;">
            <label>Input Sensitivity (Noise Gate)</label>
            <div style="display:flex; justify-content:space-between; font-size:12px; opacity:0.7;">
                <span>Sensitive</span>
                <span>Strict</span>
            </div>
            <input type="range" id="sensSlider" class="range-slider" min="0" max="50" value="${micSensitivity}">
            <div style="font-size:12px; margin-top:4px;">Current Threshold: <span id="sensVal">${micSensitivity}</span></div>
        </div>
        <div class="row" style="margin-top:10px;">
            <label>Mic Test</label>
            <div class="mic-test-bar-container">
                <div id="micTestFill" class="mic-test-bar-fill"></div>
            </div>
            <div id="testText" style="font-size:12px; opacity:0.5; margin-top:4px;">Say something...</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
            <button id="saveSettings" class="btn btn-primary">Done</button>
        </div>
    `);

    const sel = document.getElementById('micSelect');
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        sel.innerHTML = '';
        audioInputs.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.text = d.label || `Microphone ${sel.length + 1}`;
            if (d.deviceId === currentMicId) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.onchange = () => {
            tempMicId = sel.value;
            localStorage.setItem('konsmon_mic_id', tempMicId);
            startMicTest(tempMicId);
        };
    } catch (e) {
        sel.innerHTML = '<option>Error loading devices</option>';
    }

    const slider = document.getElementById('sensSlider');
    const valDisplay = document.getElementById('sensVal');
    slider.oninput = () => {
        micSensitivity = parseInt(slider.value);
        valDisplay.textContent = micSensitivity;
        localStorage.setItem('konsmon_mic_sens', micSensitivity);
    };

    startMicTest(currentMicId);

    document.getElementById('saveSettings').onclick = () => {
        if (testAudioContext) { testAudioContext.close(); testAudioContext = null; }
        if (testStream) { testStream.getTracks().forEach(t => t.stop()); testStream = null; }
        closeModal();

        if (tempMicId !== currentMicId) {
            currentMicId = tempMicId;
            if (currentVoiceChatId) {
                setTimeout(() => joinVoiceChat(currentVoiceChatId), 200);
            }
        }
    };
}

function startPingMonitor(channelId) {
    if (pingInterval) clearInterval(pingInterval);

    pingInterval = setInterval(async () => {
        const el = document.getElementById(`ping-${channelId}`);
        if (!el || !peers || Object.keys(peers).length === 0) {
            if (el) el.textContent = '';
            return;
        }

        let totalRtt = 0;
        let count = 0;

        const promises = Object.values(peers).map(pc => pc.getStats(null));
        const reports = await Promise.all(promises);

        reports.forEach(stats => {
            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
                    totalRtt += report.currentRoundTripTime;
                    count++;
                }
            });
        });

        if (count > 0) {
            const avgMs = Math.round((totalRtt / count) * 1000);
            el.textContent = `ping: ${avgMs}ms`;

            if (avgMs < 50) {
                el.style.color = '#22c55e';
            } else if (avgMs < 100) {
                el.style.color = '#f97316';
            } else {
                el.style.color = '#ef4444';
            }
        } else {
            el.textContent = '';
        }
    }, 2000);
}

// Helper for the modal test bar
async function startMicTest(deviceId) {
    if (testStream) { testStream.getTracks().forEach(t => t.stop()); }
    if (testAudioContext) { testAudioContext.close(); }

    try {
        testStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                echoCancellation: true,
                noiseSuppression: true
            }
        });

        testAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        const src = testAudioContext.createMediaStreamSource(testStream);
        const analyser = testAudioContext.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const fill = document.getElementById('micTestFill');
        const txt = document.getElementById('testText');

        function draw() {
            if (!document.getElementById('micTestFill')) return; // Modal closed
            requestAnimationFrame(draw);
            analyser.getByteFrequencyData(data);

            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const avg = sum / data.length;

            // Visual feedback
            if (fill) {
                fill.style.width = Math.min(100, avg * 2) + '%';

                // Show threshold marker logic
                if (avg > micSensitivity) {
                    fill.style.background = '#22c55e'; // Green (Open)
                    if (txt) txt.textContent = "Voice detected";
                } else {
                    fill.style.background = '#ef4444'; // Red (Gated)
                    if (txt) txt.textContent = "Below threshold (Muted)";
                }
            }
        }
        draw();
    } catch (e) { console.warn("Test mic error", e); }
}

// Buttons Init
document.addEventListener('DOMContentLoaded', () => {
    const bCreate = document.getElementById('btnCreate'), bQuick = document.getElementById('createQuick');
    const bSignin = document.getElementById('btnSignin'), bSignup = document.getElementById('btnSignup');
    const bRefresh = document.getElementById('btnRefresh');
    if (bCreate) bCreate.onclick = openCreateModal;
    if (bQuick) bQuick.onclick = openCreateModal;
    if (bSignin) bSignin.onclick = openLoginModal;
    if (bSignup) bSignup.onclick = openSignupModal;
    if (bRefresh) bRefresh.onclick = () => renderServerList();
    const logo = document.getElementById('siteLogo'); if (logo) logo.onclick = () => location.reload();
});
if (document.readyState === 'complete' || document.readyState === 'interactive') document.dispatchEvent(new Event('DOMContentLoaded'));
// Auth manager
class AuthManager {
    constructor(state, modal) {
        this.state = state;
        this.modal = modal;
        this.siteBlocked = false;
        this._createAccessBlocker();

        const stored = localStorage.getItem('konsmon_user');
        if (stored) {
            this.state.currentUser = JSON.parse(stored);
            this.updateUserUI();
            this.updateCurrentUserIp();
        }

        this.state.usersRef.on('value', snap => {
            this._buildUsersCache(snap.val() || {});
        });

        this._bindUI();
        this.enforceIpBan();
    }

    _createAccessBlocker() {
        const blocker = document.createElement('div');
        blocker.id = 'ipBanBlocker';
        blocker.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:#0f1112;color:#e6eef3;align-items:center;justify-content:center;text-align:center;padding:24px;font:16px Arial,sans-serif;';
        blocker.innerHTML = '<div><h2>Access denied</h2><p>This IP address is banned from this website.</p></div>';
        document.body.appendChild(blocker);
        this.ipBanBlocker = blocker;
    }

    async enforceIpBan() {
        const ip = await this.getCurrentPublicIp();
        if (!ip || !(await this.isIpBanned(ip))) return false;
        this.siteBlocked = true;
        localStorage.removeItem('konsmon_user');
        this.state.currentUser = null;
        this.updateUserUI();
        if (this.ipBanBlocker) this.ipBanBlocker.style.display = 'flex';
        return true;
    }

    _bindUI() {
        const userBox      = document.getElementById('userBox');
        const userMenu     = document.getElementById('userMenu');
        const logoutBtn    = document.getElementById('logoutBtn');
        const adminPanelBtn = document.getElementById('adminPanelBtn');

        if (userBox) {
            userBox.onclick = () => {
                if (userMenu) userMenu.style.display = userMenu.style.display === 'none' ? 'block' : 'none';
            };
        }

        if (adminPanelBtn) {
            adminPanelBtn.onclick = () => {
                if (this.isAdmin()) {
                    this.openAdminPanel();
                    if (userMenu) userMenu.style.display = 'none';
                } else {
                    this.modal.alert('Only admin accounts can use the admin panel.');
                }
            };
        }

        if (logoutBtn) {
            logoutBtn.onclick = () => {
                localStorage.removeItem('konsmon_user');
                this.state.currentUser = null;
                this.updateUserUI();
                if (userMenu) userMenu.style.display = 'none';
                if (typeof app !== 'undefined' && app.chat) { app.chat.syncPingSubs(); app.chat.renderServerList(); }
                this.modal.alert('Logged out successfully');
            };
        }
    }

    _buildUsersCache(raw) {
        this.state.usersCacheByNickLower = {};
        this.state.usersCacheById        = {};
        this.state.usersNicknamesLower   = [];
        this.state.usersNicknamesDisplay = [];

        Object.entries(raw || {}).forEach(([uid, data]) => {
            const nick = String(data?.nick || '').trim();
            if (!nick) return;
            const lower = nick.toLowerCase();
            if (!this.state.usersCacheByNickLower[lower]) this.state.usersCacheByNickLower[lower] = uid;
            this.state.usersCacheById[uid] = { ...data, uid };
            this.state.usersNicknamesLower.push(lower);
            this.state.usersNicknamesDisplay.push(nick);
        });
        this.state.usersCacheLoaded = true;

        if (this.state.currentUser && this.state.currentUser.uid) {
            this.updateUserUI();
        }
    }

    async ensureUsersCache() {
        if (this.state.usersCacheLoaded) return;
        const snap = await this.state.usersRef.once('value');
        this._buildUsersCache(snap.val() || {});
    }

    isAdmin() {
        const u = this.state.currentUser;
        return !!(u && this.state.usersCacheById[u.uid] && this.state.usersCacheById[u.uid].admin === 1);
    }

    // Nick resolution
    getDisplayNick() {
        if (this.state.currentUser?.nick) return this.state.currentUser.nick;
        if (!this.state.localAnonNick) {
            this.state.localAnonNick = 'Anon' + Math.floor(1000 + Math.random() * 9000);
        }
        return this.state.localAnonNick;
    }

    // SHA-256 hash
    async hashPassword(plain) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    _isHash(v) {
        return /^[0-9a-f]{64}$/.test(String(v || ''));
    }

    // Verify, flag migration
    async verifySecret(entered, stored) {
        if (stored === null || stored === undefined || stored === '') return { ok: false, upgrade: false };
        if (this._isHash(stored)) {
            return { ok: (await this.hashPassword(entered)) === stored, upgrade: false };
        }
        const ok = entered === stored;
        return { ok, upgrade: ok };
    }

    async checkAdminPassword(entered) {
        try {
            const snap = await this.state.db.ref('admin/passwordHash').once('value');
            const storedHash = snap.val();
            if (!storedHash) return false;
            return (await this.hashPassword(entered)) === storedHash;
        } catch (e) {
            console.error('Admin password check failed:', e);
            return false;
        }
    }

    updateUserUI() {
        const bSignin       = document.getElementById('btnSignin');
        const bSignup       = document.getElementById('btnSignup');
        const userPanel     = document.getElementById('userPanel');
        const nickEl        = document.getElementById('currentUserNick');
        const adminPanelBtn = document.getElementById('adminPanelBtn');

        if (this.state.currentUser) {
            if (bSignin)   bSignin.style.display   = 'none';
            if (bSignup)   bSignup.style.display   = 'none';
            if (userPanel) userPanel.style.display = 'block';
            if (nickEl)    nickEl.textContent      = this.state.currentUser.nick;
            if (adminPanelBtn) adminPanelBtn.style.display = this.isAdmin() ? 'block' : 'none';
        } else {
            if (bSignin)   bSignin.style.display   = '';
            if (bSignup)   bSignup.style.display   = '';
            if (userPanel) userPanel.style.display = 'none';
            if (adminPanelBtn) adminPanelBtn.style.display = 'none';
        }
    }

    getIpKey() {
        let key = localStorage.getItem('konsmon_ip_key');
        if (!key || !CryptoManager.isValidKey(key)) {
            key = CryptoManager.generateKeyHex();
            localStorage.setItem('konsmon_ip_key', key);
        }
        return key;
    }

    async encryptSensitiveValue(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return '';
        try {
            return await CryptoManager.encryptText(this.getIpKey(), raw);
        } catch (e) {
            console.warn('Failed to encrypt sensitive value:', e);
            return '';
        }
    }

    async decryptSensitiveValue(payload) {
        const raw = String(payload || '').trim();
        if (!raw) return '';
        try {
            return await CryptoManager.decryptText(this.getIpKey(), raw);
        } catch (e) {
            console.warn('Failed to decrypt sensitive value:', e);
            return raw;
        }
    }

    async getCurrentPublicIp() {
        try {
            const res = await fetch('https://api.ipify.org?format=json');
            if (!res.ok) return '';
            const data = await res.json();
            return String(data.ip || '').trim();
        } catch (e) {
            return '';
        }
    }

    async hashIp(ip) {
        return this.hashPassword(String(ip || '').trim());
    }

    async getUserIpDisplay(user = {}) {
        const enc = user.lastIp || user.lastIpEnc || '';
        if (!enc) return 'No IP recorded';
        const decrypted = await this.decryptSensitiveValue(enc);
        return decrypted || 'No IP recorded';
    }

    async getLatestUserIpRecord(uid) {
        if (!uid) return null;
        try {
            const snap = await this.state.db.ref(`userIps/${uid}/ips`).once('value');
            const records = Object.entries(snap.val() || {});
            records.sort((a, b) => Number(b[1]?.lastSeenAt || 0) - Number(a[1]?.lastSeenAt || 0));
            if (records[0]) return { id: records[0][0], ...records[0][1] };

            const legacySnap = await this.state.db.ref(`userIps/${uid}`).once('value');
            const legacyRecords = Object.entries(legacySnap.val() || {})
                .filter((entry) => entry[1]?.ipHash && entry[1]?.recordedAt)
                .sort((a, b) => Number(b[1].recordedAt) - Number(a[1].recordedAt));
            return legacyRecords[0] ? { id: legacyRecords[0][0], ...legacyRecords[0][1] } : null;
        } catch (e) {
            console.warn('Failed to read user IP history:', e);
            return null;
        }
    }

    async updateCurrentUserIp() {
        const uid = this.state.currentUser?.uid;
        if (!uid) return;
        const ip = await this.getCurrentPublicIp();
        if (!ip) return;
        if (await this.isIpBanned(ip)) return;

        const encryptedIp = await this.encryptSensitiveValue(ip);
        if (!encryptedIp) return;
        const ipHash = await this.hashIp(ip);
        const now = Date.now();
        const ipRef = this.state.db.ref(`userIps/${uid}/ips/${ipHash}`);
        const ipSnap = await ipRef.once('value');
        const existing = ipSnap.val() || {};
        await ipRef.update({
            ipEnc: encryptedIp,
            ipHash,
            ipBanned: Number(existing.ipBanned) === 1 ? 1 : 0,
            firstSeenAt: existing.firstSeenAt || now,
            lastSeenAt: now
        });
        await ipRef.child('visits').push({ recordedAt: now });
        await this.state.usersRef.child(uid).update({ lastIpHash: ipHash, lastSeenAt: Date.now() });
    }

    async isIpBanned(ip) {
        if (!ip) return false;
        const ipHash = await this.hashIp(ip);
        try {
            const snap = await this.state.db.ref('userIps').once('value');
            const users = snap.val() || {};
            for (const userData of Object.values(users)) {
                const records = userData?.ips || {};
                for (const entry of Object.values(records)) {
                    if (entry?.ipHash === ipHash && Number(entry.ipBanned) === 1) return true;
                }
                // Keep old timestamp-based records effective during migration.
                for (const entry of Object.values(userData || {})) {
                    if (entry?.ipHash === ipHash && Number(entry.ipBanned) === 1) return true;
                }
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    async openAdminPanel() {
        if (!this.isAdmin()) {
            this.modal.alert('Only admin accounts can use the admin panel.');
            return;
        }

        const users = Object.values(this.state.usersCacheById || {})
            .filter(Boolean)
            .sort((a, b) => String(a.nick || '').localeCompare(String(b.nick || '')));

        const rows = [];
        for (const user of users) {
            const uid = user.uid || '';
            const nick = escapeHtml(String(user.nick || 'Unknown'));
            const adminBadge = user.admin === 1 ? ' <span style="opacity:0.7;">[ADMIN]</span>' : '';
            const latestIp = await this.getLatestUserIpRecord(uid);
            const ipStatus = latestIp ? `Recorded ${new Date(latestIp.lastSeenAt || latestIp.recordedAt).toLocaleString()}` : 'No IP recorded';
            const ipAction = Number(latestIp?.ipBanned) === 1 ? 'unban' : 'ban';
            const ipActionLabel = ipAction === 'unban' ? 'Unban IP' : 'IP ban';
            rows.push(`
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--muted);border-radius:8px;margin-bottom:8px;background:rgba(255,255,255,0.02);">
                    <div>
                        <div><strong>${nick}</strong>${adminBadge}</div>
                        <small style="opacity:0.7;">UID: ${escapeHtml(uid)} · IP: ${escapeHtml(ipStatus)}</small>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                        <button class="btn btn-ghost" data-user-action="rename" data-user-id="${escapeHtml(uid)}">Rename</button>
                        <button class="btn btn-ghost" data-user-action="delete" data-user-id="${escapeHtml(uid)}">Delete</button>
                        <button class="btn btn-ghost" data-user-action="${ipAction}" data-user-id="${escapeHtml(uid)}">${ipActionLabel}</button>
                    </div>
                </div>
            `);
        }

        const content = rows.length ? rows.join('') : '<p>No users found.</p>';

        this.modal.show(`
            <div style="min-width:min(880px,80vw);max-width:90vw;max-height:80vh;overflow:auto;">
                <h4>ADMIN PANEL</h4>
                <p style="margin:0 0 12px; opacity:0.8;">Manage all registered users.</p>
                <div>${content}</div>
                <div style="display:flex;justify-content:flex-end;margin-top:12px;">
                    <button id="closeAdminPanel" class="btn btn-primary">Close</button>
                </div>
            </div>
        `);

        document.getElementById('closeAdminPanel').onclick = () => this.modal.close();

        this.modal.modalContent.querySelectorAll('[data-user-action]').forEach(btn => {
            btn.onclick = async () => {
                const action = btn.getAttribute('data-user-action');
                const uid = btn.getAttribute('data-user-id');
                if (!uid) return;

                if (action === 'rename') {
                    const currentNick = this.state.usersCacheById[uid]?.nick || '';
                    const nextNick = window.prompt('New username for this user:', currentNick);
                    if (nextNick === null) return;
                    const cleanNick = String(nextNick).trim();
                    if (!cleanNick) { this.modal.alert('Username cannot be empty.'); return; }
                    await this.renameUser(uid, cleanNick);
                    this.openAdminPanel();
                    return;
                }

                if (action === 'delete') {
                    const user = this.state.usersCacheById[uid];
                    if (!user) return;
                    const confirmed = window.confirm(`Delete the account for "${user.nick}"? This cannot be undone.`);
                    if (!confirmed) return;
                    await this.deleteUserAccount(uid);
                    this.openAdminPanel();
                    return;
                }

                if (action === 'ban') {
                    const user = this.state.usersCacheById[uid];
                    const ipRecord = await this.getLatestUserIpRecord(uid);
                    if (!user || !ipRecord?.ipHash) {
                        this.modal.alert('This account has no recorded IP to ban.');
                        return;
                    }
                    const confirmed = window.confirm(`Ban the latest recorded IP for user "${user.nick}"?`);
                    if (!confirmed) return;
                    await this.banUserIp(uid, ipRecord);
                    this.modal.alert('The latest recorded IP has been banned.');
                    this.openAdminPanel();
                }

                if (action === 'unban') {
                    const user = this.state.usersCacheById[uid];
                    const ipRecord = await this.getLatestUserIpRecord(uid);
                    if (!user || !ipRecord?.ipHash) {
                        this.modal.alert('This account has no recorded IP to unban.');
                        return;
                    }
                    await this.unbanUserIp(ipRecord.ipHash);
                    this.modal.alert('The IP has been unbanned.');
                    this.openAdminPanel();
                }
            };
        });
    }

    async renameUser(uid, nextNick) {
        if (!this.isAdmin()) {
            this.modal.alert('Only admin accounts can rename users.');
            return;
        }
        if (!uid) return;
        const currentNick = this.state.usersCacheById[uid]?.nick || '';
        if (String(currentNick).trim() === String(nextNick).trim()) {
            this.modal.alert('That is already the current username.');
            return;
        }

        const existing = await this.state.usersRef.orderByChild('nick').equalTo(nextNick).once('value');
        const matches = existing.val() || {};
        const usedByOther = Object.keys(matches).some(key => key !== uid);
        if (usedByOther) {
            this.modal.alert('That username is already in use.');
            return;
        }

        await this.state.usersRef.child(uid).update({ nick: nextNick });
        if (this.state.currentUser?.uid === uid) {
            this.state.currentUser.nick = nextNick;
            localStorage.setItem('konsmon_user', JSON.stringify(this.state.currentUser));
        }
        this.modal.alert('Username updated.');
    }

    async deleteUserAccount(uid) {
        if (!this.isAdmin()) {
            this.modal.alert('Only admin accounts can delete users.');
            return;
        }
        if (!uid) return;
        await this.state.usersRef.child(uid).remove();

        await this.state.db.ref(`userIps/${uid}`).remove();

        if (this.state.currentUser?.uid === uid) {
            localStorage.removeItem('konsmon_user');
            this.state.currentUser = null;
            this.updateUserUI();
            if (typeof app !== 'undefined' && app.chat) {
                app.chat.syncPingSubs();
                app.chat.renderServerList();
            }
        }
        this.modal.alert('User account deleted.');
    }

    async banUserIp(uid, ipOrRecord) {
        if (!this.isAdmin()) {
            this.modal.alert('Only admin accounts can ban IP addresses.');
            return;
        }
        if (!uid || !ipOrRecord) return;
        const userSnap = await this.state.usersRef.child(uid).once('value');
        const user = userSnap.val() || {};
        const record = typeof ipOrRecord === 'object' ? ipOrRecord : { ip: ipOrRecord };
        const ip = String(record.ip || '').trim();
        const ipHash = record.ipHash || (ip ? await this.hashIp(ip) : '');
        const encryptedIp = record.ipEnc || (ip ? await this.encryptSensitiveValue(ip) : '');
        if (!ipHash) return;

        const allIps = await this.state.db.ref('userIps').once('value');
        const updates = {};
        const users = allIps.val() || {};
        Object.entries(users).forEach(([recordUid, userData]) => {
            Object.entries(userData?.ips || {}).forEach(([recordId, entry]) => {
                if (entry?.ipHash === ipHash) {
                    updates[`userIps/${recordUid}/ips/${recordId}/ipBanned`] = 1;
                    updates[`userIps/${recordUid}/ips/${recordId}/bannedAt`] = Date.now();
                    updates[`userIps/${recordUid}/ips/${recordId}/bannedBy`] = this.state.currentUser?.uid || 'admin';
                }
            });
            Object.entries(userData || {}).forEach(([recordId, entry]) => {
                if (entry?.ipHash === ipHash) {
                    updates[`userIps/${recordUid}/ips/${ipHash}/ipBanned`] = 1;
                    updates[`userIps/${recordUid}/ips/${ipHash}/ipHash`] = ipHash;
                    updates[`userIps/${recordUid}/ips/${ipHash}/ipEnc`] = entry.ipEnc || null;
                    updates[`userIps/${recordUid}/ips/${ipHash}/lastSeenAt`] = entry.recordedAt || Date.now();
                    updates[`userIps/${recordUid}/${recordId}/ipBanned`] = 0;
                }
            });
        });
        if (Object.keys(updates).length) await this.state.db.ref().update(updates);
        if (this.state.currentUser?.uid === uid && this.ipBanBlocker) {
            this.siteBlocked = true;
            this.ipBanBlocker.style.display = 'flex';
        }
    }

    async unbanUserIp(ipHash) {
        if (!this.isAdmin()) {
            this.modal.alert('Only admins can unban IP addresses.');
            return;
        }
        if (!ipHash) return;

        const allIps = await this.state.db.ref('userIps').once('value');
        const updates = {};
        const users = allIps.val() || {};
        Object.entries(users).forEach(([uid, userData]) => {
            Object.entries(userData?.ips || {}).forEach(([recordId, entry]) => {
                if (entry?.ipHash === ipHash) {
                    updates[`userIps/${uid}/ips/${recordId}/ipBanned`] = 0;
                    updates[`userIps/${uid}/ips/${recordId}/bannedAt`] = null;
                    updates[`userIps/${uid}/ips/${recordId}/bannedBy`] = null;
                }
            });
            Object.entries(userData || {}).forEach(([recordId, entry]) => {
                if (entry?.ipHash === ipHash) {
                    updates[`userIps/${uid}/${recordId}/ipBanned`] = 0;
                }
            });
        });
        if (Object.keys(updates).length) await this.state.db.ref().update(updates);
    }

    openLoginModal() {
        this.modal.show(`
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

        document.getElementById('cancelSignin').onclick = () => this.modal.close();
        document.getElementById('confirmSignin').onclick = () => {
            const nick = String(document.getElementById('signinNick').value || '').trim();
            const pass = String(document.getElementById('signinPass').value || '').trim();
            if (!nick || !pass) { this.modal.alert('Please fill in both fields'); return; }

            this.state.usersRef.orderByChild('nick').equalTo(nick).once('value', async snap => {
                if (!snap.exists()) { this.modal.alert('User not found'); return; }
                const uid      = Object.keys(snap.val())[0];
                const userData = Object.values(snap.val())[0];
                const ip       = await this.getCurrentPublicIp();

                if (ip && await this.isIpBanned(ip)) {
                    this.modal.alert('This account or IP address is banned from the website.');
                    return;
                }

                const res      = await this.verifySecret(pass, userData.password);

                if (!res.ok) { this.modal.alert('Incorrect password'); return; }

                // Plaintext to hash
                if (res.upgrade) {
                    this.state.usersRef.child(uid).update({ password: await this.hashPassword(pass) });
                }

                this.state.currentUser = { nick, uid };
                localStorage.setItem('konsmon_user', JSON.stringify(this.state.currentUser));
                this.updateUserUI();
                this.updateCurrentUserIp();
                if (typeof app !== 'undefined' && app.chat) { app.chat.syncPingSubs(); app.chat.renderServerList(); }
                this.modal.close();
                this.modal.alert('Logged in!');
            });
        };
    }

    openSignupModal() {
        this.modal.show(`
            <h4>CREATE ACCOUNT</h4>
            <div class="row">
                <label>Username</label>
                <input id="signupNick" placeholder="Enter username" maxlength="25" />
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

        document.getElementById('cancelSignup').onclick = () => this.modal.close();
        document.getElementById('confirmSignup').onclick = async () => {
            const nick = String(document.getElementById('signupNick').value || '').trim();
            const pass = String(document.getElementById('signupPass').value || '').trim();
            if (!nick || !pass) { this.modal.alert('Please fill in all fields'); return; }

            const ip = await this.getCurrentPublicIp();
            if (ip && await this.isIpBanned(ip)) {
                this.modal.alert('This IP address is banned from the website.');
                return;
            }

            this.state.usersRef.orderByChild('nick').equalTo(nick).once('value', async snap => {
                if (snap.exists()) {
                    this.modal.alert('This username is already taken');
                } else {
                    const hashed = await this.hashPassword(pass);
                    this.state.usersRef.push({ nick, password: hashed, createdAt: Date.now() })
                        .then(() => { this.modal.alert('Account created!'); this.modal.close(); })
                        .catch(e => this.modal.alert('Error: ' + e.message));
                }
            });
        };
    }
}

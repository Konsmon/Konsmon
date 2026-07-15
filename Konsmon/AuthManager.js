// Auth manager
class AuthManager {
    constructor(state, modal) {
        this.state = state;
        this.modal = modal;

        const stored = localStorage.getItem('konsmon_user');
        if (stored) {
            this.state.currentUser = JSON.parse(stored);
            this.updateUserUI();
        }

        this.state.usersRef.on('value', snap => {
            this._buildUsersCache(snap.val() || {});
        });

        this._bindUI();
    }

    _bindUI() {
        const userBox   = document.getElementById('userBox');
        const userMenu  = document.getElementById('userMenu');
        const logoutBtn = document.getElementById('logoutBtn');

        if (userBox) {
            userBox.onclick = () => {
                userMenu.style.display = userMenu.style.display === 'none' ? 'block' : 'none';
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
        const bSignin   = document.getElementById('btnSignin');
        const userPanel = document.getElementById('userPanel');
        const nickEl    = document.getElementById('currentUserNick');

        if (this.state.currentUser) {
            if (bSignin)   bSignin.style.display   = 'none';
            if (userPanel) userPanel.style.display = 'block';
            if (nickEl)    nickEl.textContent      = this.state.currentUser.nick;
        } else {
            if (bSignin)   bSignin.style.display   = '';
            if (userPanel) userPanel.style.display = 'none';
        }
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
                const res      = await this.verifySecret(pass, userData.password);

                if (!res.ok) { this.modal.alert('Incorrect password'); return; }

                // Plaintext to hash
                if (res.upgrade) {
                    this.state.usersRef.child(uid).update({ password: await this.hashPassword(pass) });
                }

                this.state.currentUser = { nick, uid };
                localStorage.setItem('konsmon_user', JSON.stringify(this.state.currentUser));
                this.updateUserUI();
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
        document.getElementById('confirmSignup').onclick = () => {
            const nick = String(document.getElementById('signupNick').value || '').trim();
            const pass = String(document.getElementById('signupPass').value || '').trim();
            if (!nick || !pass) { this.modal.alert('Please fill in all fields'); return; }

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

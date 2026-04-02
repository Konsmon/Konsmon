// AuthManager.js
// Handles user registration, login, logout and the local users cache.
// All authentication state is stored in AppState.currentUser.

class AuthManager {
    constructor(state, modal) {
        this.state = state;
        this.modal = modal;

        // Restore session saved in localStorage on previous visit
        const stored = localStorage.getItem('konsmon_user');
        if (stored) {
            this.state.currentUser = JSON.parse(stored);
            this.updateUserUI();
        }

        // Keep local users cache in sync with Firebase in real-time
        this.state.usersRef.on('value', snap => {
            this._buildUsersCache(snap.val() || {});
        });

        // Admin password is never fetched to the client.
        // Instead, when admin actions are needed, we hash the entered password
        // client-side with SHA-256 and compare it against the stored hash in Firebase.
        // To set it up: store SHA-256("yourpassword") under admin/passwordHash in Firebase.
        // You can generate a hash at: https://emn178.github.io/online-tools/sha256.html

        this._bindUI();
    }

    // Wire up logout button and user panel toggle
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
                this.modal.alert('Logged out successfully');
            };
        }
    }

    // Rebuilds the in-memory users cache from a raw Firebase snapshot
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

    // Ensures cache is populated before first use (e.g. for mentions)
    async ensureUsersCache() {
        if (this.state.usersCacheLoaded) return;
        const snap = await this.state.usersRef.once('value');
        this._buildUsersCache(snap.val() || {});
    }

    isAdmin() {
        const u = this.state.currentUser;
        return !!(u && this.state.usersCacheById[u.uid] && this.state.usersCacheById[u.uid].admin === 1);
    }

    // Hashes a plaintext password with SHA-256 using the Web Crypto API.
    // Used instead of sending the raw password to Firebase for comparison.
    async hashPassword(plain) {
        const buf    = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Checks entered password against the SHA-256 hash stored in Firebase under admin/passwordHash.
    // Returns true if it matches.
    async checkAdminPassword(entered) {
        try {
            const snap = await this.state.db.ref('admin/passwordHash').once('value');
            const storedHash = snap.val();
            if (!storedHash) return false;
            const enteredHash = await this.hashPassword(entered);
            return enteredHash === storedHash;
        } catch (e) {
            console.error('Admin password check failed:', e);
            return false;
        }
    }

    // Shows/hides the user panel in the top bar depending on login state
    updateUserUI() {
        const bSignin  = document.getElementById('btnSignin');
        const userPanel = document.getElementById('userPanel');
        const nickEl    = document.getElementById('currentUserNick');

        if (this.state.currentUser) {
            if (bSignin)    bSignin.style.display   = 'none';
            if (userPanel)  userPanel.style.display  = 'block';
            if (nickEl)     nickEl.textContent        = this.state.currentUser.nick;
        } else {
            if (bSignin)    bSignin.style.display   = '';
            if (userPanel)  userPanel.style.display  = 'none';
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

            this.state.usersRef.orderByChild('nick').equalTo(nick).once('value', snap => {
                if (!snap.exists()) { this.modal.alert('User not found'); return; }
                const userData = Object.values(snap.val())[0];
                if (userData.password === pass) {
                    this.state.currentUser = { nick, uid: Object.keys(snap.val())[0] };
                    localStorage.setItem('konsmon_user', JSON.stringify(this.state.currentUser));
                    this.updateUserUI();
                    this.modal.close();
                    this.modal.alert('Logged in!');
                } else {
                    this.modal.alert('Incorrect password');
                }
            });
        };
    }

    openSignupModal() {
        this.modal.show(`
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

        document.getElementById('cancelSignup').onclick = () => this.modal.close();
        document.getElementById('confirmSignup').onclick = () => {
            const nick = String(document.getElementById('signupNick').value || '').trim();
            const pass = String(document.getElementById('signupPass').value || '').trim();
            if (!nick || !pass) { this.modal.alert('Please fill in all fields'); return; }

            this.state.usersRef.orderByChild('nick').equalTo(nick).once('value', snap => {
                if (snap.exists()) {
                    this.modal.alert('This username is already taken');
                } else {
                    this.state.usersRef.push({ nick, password: pass, createdAt: Date.now() })
                        .then(() => { this.modal.alert('Account created!'); this.modal.close(); })
                        .catch(e => this.modal.alert('Error: ' + e.message));
                }
            });
        };
    }
}

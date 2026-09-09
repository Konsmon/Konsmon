// App entry point

// Firebase setup
firebase.initializeApp(firebaseConfig);

AppState.db            = firebase.database();
AppState.usersRef      = AppState.db.ref('users');
AppState.serversRef    = AppState.db.ref('servers');
AppState.voiceChatsRef = AppState.db.ref('voice_chats');
try { AppState.storage = firebase.storage(); } catch (e) { AppState.storage = null; }

// Manager instances
const app = {};

app.modal  = new ModalManager();
app.auth   = new AuthManager(AppState, app.modal);
app.chat   = new ChatManager(AppState, app.modal, app.auth);
app.voice  = new VoiceManager(AppState, app.modal, app.auth);
app.stream = new StreamManager(AppState, app.modal);

_initAnonNick();

// UI bindings
document.addEventListener('DOMContentLoaded', () => {
    const bCreate  = document.getElementById('btnCreate');
    const bQuick   = document.getElementById('createQuick');
    const bSignin  = document.getElementById('btnSignin');
    const bSignup  = document.getElementById('btnSignup');
    const bRefresh = document.getElementById('btnRefresh');
    const logo     = document.getElementById('siteLogo');

    if (logo) logo.textContent = 'KONSMON CLIENT b' + window.VERSION;

    if (bCreate)  bCreate.onclick  = () => app.chat.openCreateModal();
    if (bQuick)   bQuick.onclick   = () => app.chat.openCreateModal();
    if (bSignin)  bSignin.onclick  = () => app.auth.openLoginModal();
    if (bSignup)  bSignup.onclick  = () => app.auth.openSignupModal();
    if (bRefresh) bRefresh.onclick = () => app.chat.renderServerList();
    if (logo)     logo.onclick     = () => app.chat.detachChat();

    _initWavyLogo();
    _initMobileMenu();
    _initUpdateToast();
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    document.dispatchEvent(new Event('DOMContentLoaded'));
}

// Anon nick
async function _initAnonNick() {
    if (AppState.localAnonNick) return;
    let digits = '';
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        const ip  = (await res.json()).ip || '';
        digits = ip.replace(/\D/g, '').slice(-4);
    } catch (e) {}
    if (digits.length < 4) digits = String(Math.floor(1000 + Math.random() * 9000));
    AppState.localAnonNick = 'Anon' + digits;
}

// Logo wave
function _initWavyLogo() {
    try {
        const el = document.getElementById('siteLogo');
        if (!el) return;
        const txt = String(el.textContent || '').trim();
        el.innerHTML = '';
        const spans = [];
        for (let i = 0; i < txt.length; i++) {
            const sp = document.createElement('span');
            sp.textContent = txt[i] === ' ' ? '\u00A0' : txt[i];
            el.appendChild(sp);
            spans.push(sp);
        }
        el.classList.add('wavy-logo');
        spans.forEach((s, idx) => {
            s.addEventListener('mouseenter', () => {
                spans.forEach((ss, j) => {
                    const lift = Math.max(0, 18 - Math.abs(j - idx) * 5);
                    if (lift > 0) {
                        ss.style.transform       = `translateY(-${lift}px)`;
                        ss.style.transitionDelay = `${Math.abs(j - idx) * 30}ms`;
                    }
                });
            });
            s.addEventListener('mouseleave', () => {
                spans.forEach(ss => { ss.style.transform = ''; ss.style.transitionDelay = ''; });
            });
        });
    } catch (e) { console.warn(e); }
}

// Auto-update toast
function _initUpdateToast() {
    const api = window.electronAPI;
    const toast = document.getElementById('updateToast');
    if (!api?.onUpdateStatus || !toast) return;

    const title   = document.getElementById('updateToastTitle');
    const text    = document.getElementById('updateToastText');
    const track   = document.getElementById('updateToastTrack');
    const fill    = document.getElementById('updateToastFill');
    const actions = document.getElementById('updateToastActions');

    let shownVersion = null;
    let dismissedVersion = null;

    const render = status => {
        if (!status || status.version === dismissedVersion) {
            toast.hidden = true;
            return;
        }
        shownVersion = status.version ?? null;
        const name = status.version ? 'Konsmon ' + status.version : 'A new version';
        if (status.state === 'downloading') {
            title.textContent = 'Downloading update';
            text.textContent  = name + ' is downloading in the background.';
            fill.style.width  = (status.percent || 0) + '%';
            track.hidden      = false;
            actions.hidden    = true;
            toast.hidden      = false;
        } else if (status.state === 'ready') {
            title.textContent = 'Update ready';
            text.textContent  = name + ' installs the next time you restart Konsmon.';
            track.hidden      = true;
            actions.hidden    = false;
            toast.hidden      = false;
        } else {
            toast.hidden = true;
        }
    };

    document.getElementById('updateLater').onclick = () => {
        // The update is already staged, so dismissing only silences the prompt for this
        // version; it still installs on the next quit.
        dismissedVersion = shownVersion;
        toast.hidden = true;
    };

    document.getElementById('updateRestart').onclick = () => {
        text.textContent = 'Restarting to install\u2026';
        actions.hidden = true;
        api.installUpdate();
    };

    api.onUpdateStatus(render);
    api.getUpdateStatus().then(render);
}

// Mobile sidebarwa
function _initMobileMenu() {
    try {
        const btn  = document.getElementById('mobileMenuBtn');
        const body = document.body;
        const close = () => {
            body.classList.remove('sidebar-open');
            const ov = document.getElementById('mobileMenuOverlay');
            if (ov) ov.style.display = 'none';
        };
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (body.classList.contains('sidebar-open')) {
                close();
            } else {
                body.classList.add('sidebar-open');
                let ov = document.getElementById('mobileMenuOverlay');
                if (!ov) {
                    ov = document.createElement('div');
                    ov.id = 'mobileMenuOverlay';
                    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:1500;';
                    body.appendChild(ov);
                    ov.onclick = close;
                }
                ov.style.display = 'block';
            }
        });
    } catch (e) {}
}

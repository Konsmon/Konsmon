// VoiceManager.js
// Handles everything related to voice channels:
//   - joining and leaving voice channels
//   - WebRTC peer connections and signaling via Firebase
//   - voice activity detection (VAD) and speaking visualizer
//   - mute/unmute controls and kick
//   - real-time ping display
//   - voice settings modal (mic selection, sensitivity test)

class VoiceManager {
    constructor(state, modal, auth) {
        this.state = state;
        this.modal = modal;
        this.auth  = auth;

        // Create a hidden container for remote audio elements
        if (!document.getElementById('webrtc-audio-container')) {
            const ac = document.createElement('div');
            ac.id = 'webrtc-audio-container';
            document.body.appendChild(ac);
        }
    }

    // -------------------------------------------------------------------------
    // Identity helpers
    // -------------------------------------------------------------------------

    getVoiceUid() {
        if (this.state.currentUser?.uid) return this.state.currentUser.uid;
        if (!this.state.localAnonUid) this.state.localAnonUid = 'anon_' + Math.random().toString(36).substr(2, 9);
        return this.state.localAnonUid;
    }

    getVoiceNick() {
        if (this.state.currentUser?.nick) return this.state.currentUser.nick;
        const val = document.getElementById('nicknameInput')?.value.trim();
        if (val) return val;
        if (!this.state.localAnonNick) this.state.localAnonNick = 'Anon' + Math.floor(1000 + Math.random() * 9000);
        return this.state.localAnonNick;
    }

    // -------------------------------------------------------------------------
    // Join voice channel
    // -------------------------------------------------------------------------

    async joinVoiceChat(id) {
        console.log(`%c[VOICE] Requesting join to: ${id} (Mic: ${this.state.currentMicId})`, 'color:#0ea5ff;font-weight:bold;');

        // Leave any existing voice channel first
        if (this.state.currentVoiceChatId) this.leaveVoiceChat();

        // Ensure AudioContext is running (browsers may suspend it)
        if (!this.state.audioContext) {
            this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        }
        if (this.state.audioContext.state === 'suspended') await this.state.audioContext.resume();

        // Request microphone access; fall back to silent stream if denied
        try {
            this.state.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: this.state.currentMicId !== 'default' ? { exact: this.state.currentMicId } : undefined,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false,
                    latency: 0,
                },
                video: false,
            });
            console.log('%c[VOICE] Microphone access GRANTED', 'color:#22c55e;');
        } catch (err) {
            console.warn('[VOICE] Microphone access DENIED or not found. Joining as listener.', err);
            this.modal.alert('No microphone detected. You are joining as a listener only.');
            const fakeCtx  = new (window.AudioContext || window.webkitAudioContext)();
            const fakeDest = fakeCtx.createMediaStreamDestination();
            this.state.localStream = fakeDest.stream;
            this.state.localMutes[this.getVoiceUid() + '_Mic'] = true;
        }

        this.state.audioConnect.play().catch(() => {});
        this.state.currentVoiceChatId = id;
        const myUid = this.getVoiceUid();

        this._startVAD(myUid);

        // Register presence in Firebase and set up onDisconnect cleanup
        this.state.voicePresenceRef = this.state.db.ref(`voice_chats/${id}/users/${myUid}`);
        await this.state.voicePresenceRef.onDisconnect().remove();
        await this.state.voicePresenceRef.set({ nick: this.getVoiceNick(), joinedAt: Date.now() });

        // Detect when we are kicked externally (our presence node disappears)
        this.state.voicePresenceRef.on('value', snap => {
            if (!snap.exists() && this.state.currentVoiceChatId === id) {
                this.leaveVoiceChat(true);
            }
        });

        // When any user leaves: play disconnect sound and clean up their resources
        this.state.db.ref(`voice_chats/${id}/users`).on('child_removed', snap => {
            const leftUid = snap.key;
            if (leftUid !== myUid) this.state.audioDisconnect.play().catch(() => {});
            this._cleanupPeer(leftUid);
        });

        // Listen for incoming WebRTC signaling messages
        this.state.voiceSignalingRef = this.state.db.ref(`voice_signaling/${id}/${myUid}`);
        this.state.voiceSignalingRef.on('child_added', async snap => {
            const msg = snap.val(); if (!msg) return;
            snap.ref.remove();
            await this._handleSignalingMessage(msg);
        });

        // Start local speaking visualizer
        try {
            const myClone = this.state.localStream.clone();
            myClone.getAudioTracks()[0].enabled = true;
            this.state.visualizerStreams['local'] = myClone;
            this._attachSpeakingVisualizer(myClone, myUid);
        } catch (e) {}

        // Initiate calls to everyone already in the channel
        this.state.db.ref(`voice_chats/${id}/users`).once('value').then(snapshot => {
            const users = snapshot.val();
            if (users) {
                Object.keys(users).filter(uid => uid !== myUid).forEach(uid => this._initiateCall(uid));
            }
        });

        this._startPingMonitor(id);
    }

    // -------------------------------------------------------------------------
    // Leave voice channel
    // -------------------------------------------------------------------------

    leaveVoiceChat(wasKicked = false) {
        if (this.state.localScreenStream) app.stream.stopScreenShare();

        // Restore text chat UI that may have been hidden by a stream overlay
        const overlay = document.getElementById('stream-overlay');
        if (overlay) overlay.remove();
        const messagesEl = document.getElementById('messages');
        if (messagesEl) messagesEl.style.display = 'block';
        const inputPanel = document.querySelector('.msg-input');
        if (inputPanel) inputPanel.style.display = 'flex';

        this.state.remoteStreams    = {};
        this.state.currentWatchedUid = null;

        if (this.state.pingInterval) { clearInterval(this.state.pingInterval); this.state.pingInterval = null; }
        if (this.state.vadInterval)  { clearInterval(this.state.vadInterval);  this.state.vadInterval  = null; }

        if (this.state.localStream) { this.state.localStream.getTracks().forEach(t => t.stop()); this.state.localStream = null; }

        Object.values(this.state.visualizerStreams).forEach(s => s.getTracks().forEach(t => t.stop()));
        this.state.visualizerStreams = {};

        Object.values(this.state.peers).forEach(pc => pc.close());
        this.state.peers = {};

        Object.values(this.state.visualizerIntervals).forEach(iv => clearInterval(iv));
        this.state.visualizerIntervals = {};

        const audioContainer = document.getElementById('webrtc-audio-container');
        if (audioContainer) audioContainer.innerHTML = '';

        if (this.state.voicePresenceRef) {
            this.state.voicePresenceRef.off(); // Remove listener BEFORE removing the node to avoid triggering the kick loop
            if (!wasKicked) this.state.audioDisconnect.play().catch(() => {}); // Play sound BEFORE removing presence
            this.state.voicePresenceRef.remove();
            this.state.voicePresenceRef.onDisconnect().cancel();
            this.state.voicePresenceRef = null;
        }

        // Remove the child_removed listener to avoid it firing after leaving
        if (this.state.currentVoiceChatId) {
            this.state.db.ref(`voice_chats/${this.state.currentVoiceChatId}/users`).off('child_removed');
        }

        if (this.state.voiceSignalingRef) {
            this.state.voiceSignalingRef.off();
            this.state.voiceSignalingRef.remove();
            this.state.voiceSignalingRef = null;
        }

        const prevPingEl = document.getElementById(`ping-${this.state.currentVoiceChatId}`);
        if (prevPingEl) prevPingEl.textContent = '';

        this.state.currentVoiceChatId = null;
        app.chat.renderServerList();
        if (wasKicked) this.modal.alert('You were kicked.');
    }

    // -------------------------------------------------------------------------
    // Kick
    // -------------------------------------------------------------------------

    kickVoiceUser(chatId, uid) {
        if (confirm('Kick user?')) {
            this.state.db.ref(`voice_chats/${chatId}/users/${uid}`).remove();
            // If somehow we kicked ourselves, clean up locally too
            if (uid === this.getVoiceUid() && this.state.currentVoiceChatId === chatId) {
                this.leaveVoiceChat(true);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Voice user row in sidebar tree
    // -------------------------------------------------------------------------

    renderVoiceUserInTree(container, channelId, uid, uData) {
        const userRow  = document.createElement('div');
        userRow.className = 'tree-item tree-user indent-3';

        const myUid      = this.getVoiceUid();
        const isMe       = uid === myUid;
        const amIAdmin   = this.auth.isAdmin();
        const isStreaming = uData.isStreaming === true;

        let displayNick = uData.nick;
        if (this.state.usersCacheById[uid]?.admin === 1) displayNick += ' [ADMIN]';

        const liveIcon = isStreaming
            ? '<span style="color:#ef4444;font-weight:bold;font-size:10px;margin-left:4px;">[LIVE]</span>'
            : '';

        userRow.innerHTML = `<span class="tree-prefix">|_</span> <span id="voice-nick-${uid}" class="tree-user-nick">${escapeHtml(displayNick)} ${liveIcon}</span>`;

        // Clicking a streaming user opens the stream viewer
        if ((!isMe && isStreaming) || (isMe && this.state.localScreenStream)) {
            userRow.style.cursor = 'pointer';
            userRow.title = 'Click to watch stream';
            userRow.onclick = (e) => { e.stopPropagation(); app.stream.viewUserStream(uid, isMe); };
        }

        const controls = document.createElement('span');
        controls.className = 'tree-controls';

        controls.appendChild(this._createMuteIcon('Mic',        '🎤', uid, isMe, amIAdmin));
        controls.appendChild(this._createMuteIcon('Headphones', '🎧', uid, isMe, amIAdmin));
        if (isMe) controls.appendChild(this._createStreamIcon());

        // Leave / kick button
        const actionBtn = document.createElement('span');
        actionBtn.className = 't-icon';
        if (isMe) {
            actionBtn.innerHTML = '📞'; actionBtn.title = 'Leave Voice';
            actionBtn.style.color = '#ef4444';
            actionBtn.onclick = (e) => { e.stopPropagation(); this.leaveVoiceChat(); };
        } else if (amIAdmin) {
            actionBtn.innerHTML = '❌'; actionBtn.title = 'Kick User';
            actionBtn.style.color = '#ef4444';
            actionBtn.onclick = (e) => { e.stopPropagation(); this.kickVoiceUser(channelId, uid); };
        }
        if (actionBtn.innerHTML) controls.appendChild(actionBtn);

        userRow.appendChild(controls);
        container.appendChild(userRow);
    }

    // Creates the stream toggle icon (only shown for the local user)
    _createStreamIcon() {
        const btn = document.createElement('span');
        btn.className = 't-icon'; btn.title = 'Stream'; btn.innerHTML = '🖥️';
        if (this.state.localScreenStream) { btn.style.color = '#4ade80'; btn.style.opacity = '1'; }
        btn.onclick = (e) => {
            e.stopPropagation();
            this.state.localScreenStream ? app.stream.stopScreenShare() : app.stream.openStreamSettingsModal();
        };
        return btn;
    }

    // Creates a mic or headphones mute/unmute toggle icon
    _createMuteIcon(type, icon, uid, isMe, amIAdmin) {
        const btn = document.createElement('span');
        btn.className = 't-icon'; btn.title = type; btn.innerHTML = icon;

        const stateKey = uid + '_' + type;
        if (this.state.localMutes[stateKey]) {
            btn.style.background = 'rgba(255,0,0,1)'; btn.style.color = 'white'; btn.style.borderRadius = '4px';
        } else {
            btn.style.background = 'transparent'; btn.style.color = '';
        }

        btn.onclick = (e) => {
            e.stopPropagation();
            if (!isMe && !amIAdmin && type === 'Mic') { this.modal.alert('Only admins can mute other users.'); return; }

            this.state.localMutes[stateKey] = !this.state.localMutes[stateKey];
            const isNowMuted = this.state.localMutes[stateKey];

            isNowMuted ? this.state.audioMute.play().catch(() => {}) : this.state.audioUnmute.play().catch(() => {});

            // Headphones mutes also mutes mic; un-muting mic unmutes headphones
            if (type === 'Headphones' && isNowMuted) this.state.localMutes[uid + '_Mic'] = true;
            if (type === 'Mic' && !isNowMuted && this.state.localMutes[uid + '_Headphones']) this.state.localMutes[uid + '_Headphones'] = false;

            const micMuted = this.state.localMutes[uid + '_Mic'];
            if (isMe && this.state.localStream) this.state.localStream.getAudioTracks().forEach(t => t.enabled = !micMuted);

            const remoteAudio = document.getElementById('audio-' + uid);
            if (remoteAudio && type === 'Mic') remoteAudio.muted = micMuted;

            const phoneMuted = this.state.localMutes[uid + '_Headphones'];
            if (type === 'Headphones' || (type === 'Mic' && !isNowMuted)) {
                if (isMe) document.querySelectorAll('#webrtc-audio-container audio').forEach(a => a.muted = phoneMuted);
                else if (remoteAudio) remoteAudio.muted = phoneMuted;
            }
            app.chat.renderServerList();
        };
        return btn;
    }

    // -------------------------------------------------------------------------
    // WebRTC peer management
    // -------------------------------------------------------------------------

    _createPeerConnection(targetUid) {
        if (this.state.peers[targetUid]) return this.state.peers[targetUid];
        console.log(`%c[WEBRTC] Creating new PeerConnection for: ${targetUid}`, 'color:#d946ef;font-weight:bold;');

        const pc = new RTCPeerConnection(this.state.rtcConfig);
        this.state.peers[targetUid] = pc;
        pc.iceQueue = [];

        // Add local audio tracks to the connection
        if (this.state.localStream) {
            this.state.localStream.getAudioTracks().forEach(t => pc.addTrack(t, this.state.localStream));
        }

        // Add video track if already streaming, otherwise prepare to receive only
        let hasVideo = false;
        if (this.state.localScreenStream) {
            this.state.localScreenStream.getVideoTracks().forEach(t => { pc.addTrack(t, this.state.localScreenStream); hasVideo = true; });
        }
        if (!hasVideo) pc.addTransceiver('video', { direction: 'recvonly' });

        pc.onicecandidate = (e) => {
            if (e.candidate) this._sendSignal(targetUid, { type: 'candidate', candidate: e.candidate.toJSON() });
        };

        pc.ontrack = (e) => {
            const track  = e.track;
            const stream = e.streams[0] || new MediaStream([track]);

            if (track.kind === 'audio') {
                console.log(`%c[WEBRTC] Audio track from ${targetUid}`, 'color:#22c55e;');
                let audioEl = document.getElementById('audio-' + targetUid);
                if (!audioEl) {
                    audioEl = document.createElement('audio');
                    audioEl.id = 'audio-' + targetUid;
                    audioEl.autoplay = true;
                    document.getElementById('webrtc-audio-container').appendChild(audioEl);
                }
                audioEl.srcObject = stream;
                audioEl.muted = (this.state.globalSoundMuted || this.state.localMutes[targetUid + '_Headphones']) || false;
                audioEl.play().catch(() => {});

                try {
                    const clone = stream.clone();
                    this.state.visualizerStreams[targetUid] = clone;
                    this._attachSpeakingVisualizer(clone, targetUid);
                } catch (err) {}

            } else if (track.kind === 'video') {
                console.log(`%c[WEBRTC] Video track from ${targetUid}`, 'color:#3b82f6;');
                this.state.remoteStreams[targetUid] = stream;
                // If the user is already being watched, refresh the stream view
                if (this.state.currentWatchedUid === targetUid) app.stream.viewUserStream(targetUid);
                const nickEl = document.getElementById(`voice-nick-${targetUid}`);
                if (nickEl) nickEl.classList.add('is-streaming-active');
            }
        };

        return pc;
    }

    async _initiateCall(targetUid) {
        console.log(`%c[WEBRTC] Initiating Call (OFFER) -> ${targetUid}`, 'color:#d946ef;');
        const pc    = this._createPeerConnection(targetUid);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this._sendSignal(targetUid, { type: 'offer', data: { sdp: offer.sdp, type: offer.type } });
    }

    async _handleSignalingMessage(msg) {
        const { type, data, candidate, from } = msg;
        if (type !== 'candidate') console.log(`%c[SIGNAL] Received ${type.toUpperCase()} from ${from}`, 'color:#f59e0b;');

        if (!this.state.peers[from]) {
            if (type === 'offer') this._createPeerConnection(from);
            else { console.warn(`[SIGNAL] Ignored ${type} from unknown peer ${from}`); return; }
        }

        const pc = this.state.peers[from];
        try {
            if (type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data));
                if (pc.iceQueue?.length) { for (const c of pc.iceQueue) await pc.addIceCandidate(c); pc.iceQueue = []; }
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this._sendSignal(from, { type: 'answer', data: { sdp: answer.sdp, type: answer.type } });

            } else if (type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data));
                if (pc.iceQueue?.length) { for (const c of pc.iceQueue) await pc.addIceCandidate(c); pc.iceQueue = []; }

            } else if (type === 'candidate') {
                const cand = new RTCIceCandidate(candidate);
                if (pc.remoteDescription) await pc.addIceCandidate(cand);
                else { if (!pc.iceQueue) pc.iceQueue = []; pc.iceQueue.push(cand); }
            }
        } catch (err) {
            console.error(`[WEBRTC] Error handling signal ${type}:`, err);
        }
    }

    _sendSignal(targetUid, payload) {
        if (!this.state.currentVoiceChatId) return;
        this.state.db.ref(`voice_signaling/${this.state.currentVoiceChatId}/${targetUid}`)
            .push({ ...payload, from: this.getVoiceUid() });
    }

    // Cleans up all resources associated with a peer who left
    _cleanupPeer(leftUid) {
        if (this.state.visualizerIntervals[leftUid]) { clearInterval(this.state.visualizerIntervals[leftUid]); delete this.state.visualizerIntervals[leftUid]; }
        if (this.state.visualizerStreams[leftUid])   { this.state.visualizerStreams[leftUid].getTracks().forEach(t => t.stop()); delete this.state.visualizerStreams[leftUid]; }
        const audioEl = document.getElementById('audio-' + leftUid);
        if (audioEl) audioEl.remove();
        if (this.state.peers[leftUid]) { this.state.peers[leftUid].close(); delete this.state.peers[leftUid]; }
    }

    // -------------------------------------------------------------------------
    // Voice Activity Detection (VAD)
    // -------------------------------------------------------------------------

    _startVAD(myUid) {
        if (this.state.vadInterval) clearInterval(this.state.vadInterval);

        const vadStream   = this.state.localStream.clone();
        const vadCtx      = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        const vadSrc      = vadCtx.createMediaStreamSource(vadStream);
        const vadAnalyser = vadCtx.createAnalyser();
        vadAnalyser.fftSize = 256;
        vadSrc.connect(vadAnalyser);
        const vadData = new Uint8Array(vadAnalyser.frequencyBinCount);
        let silenceCounter = 0;

        // Poll audio level every 50ms and gate the mic track accordingly
        this.state.vadInterval = setInterval(() => {
            if (!this.state.localStream || !this.state.currentVoiceChatId) {
                vadStream.getTracks().forEach(t => t.stop());
                return;
            }
            vadAnalyser.getByteFrequencyData(vadData);
            let sum = 0;
            for (let i = 0; i < vadData.length; i++) sum += vadData[i];
            const avg = sum / vadData.length;

            if (!this.state.localMutes[myUid + '_Mic']) {
                if (avg > this.state.micSensitivity) {
                    this.state.localStream.getAudioTracks().forEach(t => t.enabled = true);
                    silenceCounter = 0;
                } else {
                    silenceCounter++;
                    if (silenceCounter > 5) this.state.localStream.getAudioTracks().forEach(t => t.enabled = false);
                }
            }
        }, 50);
    }

    // -------------------------------------------------------------------------
    // Speaking visualizer (green glow on active nick)
    // -------------------------------------------------------------------------

    _attachSpeakingVisualizer(stream, uid) {
        if (!this.state.audioContext) this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        try {
            if (this.state.audioContext.state === 'suspended') this.state.audioContext.resume();
            const src = this.state.audioContext.createMediaStreamSource(stream);
            const an  = this.state.audioContext.createAnalyser();
            an.fftSize = 256;
            src.connect(an);
            const data = new Uint8Array(an.frequencyBinCount);
            if (this.state.visualizerIntervals[uid]) clearInterval(this.state.visualizerIntervals[uid]);

            this.state.visualizerIntervals[uid] = setInterval(() => {
                if (!this.state.currentVoiceChatId) { clearInterval(this.state.visualizerIntervals[uid]); return; }
                if (this.state.audioContext.state === 'suspended') this.state.audioContext.resume();
                an.getByteFrequencyData(data);
                let sum = 0; for (let x of data) sum += x;
                const avg = sum / data.length;
                const el = document.getElementById('voice-nick-' + uid);
                if (el) {
                    if (avg > 5) {
                        el.style.color      = '#4ade80';
                        el.style.fontWeight = 'bold';
                        el.style.textShadow = '0 0 8px rgba(74,222,128,0.4)';
                    } else {
                        el.style.color      = '#a1a1aa';
                        el.style.fontWeight = 'normal';
                        el.style.textShadow = 'none';
                    }
                }
            }, 100);
        } catch (e) { console.warn('Visualizer attach error:', e); }
    }

    // -------------------------------------------------------------------------
    // Ping monitor
    // -------------------------------------------------------------------------

    _startPingMonitor(channelId) {
        if (this.state.pingInterval) clearInterval(this.state.pingInterval);

        this.state.pingInterval = setInterval(async () => {
            const el = document.getElementById(`ping-${channelId}`);
            if (!el) return;
            if (!this.state.peers || Object.keys(this.state.peers).length === 0) { el.textContent = ''; return; }

            let totalRtt = 0; let count = 0;
            try {
                const reports = await Promise.all(Object.values(this.state.peers).map(pc => pc.getStats(null)));
                reports.forEach(stats => stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded' && typeof report.currentRoundTripTime === 'number') {
                        totalRtt += report.currentRoundTripTime; count++;
                    }
                }));
                if (count > 0) {
                    const avgMs = Math.round((totalRtt / count) * 1000);
                    el.textContent = `current ping: ${avgMs}ms`;
                    el.style.color = avgMs < 50 ? '#22c55e' : avgMs < 100 ? '#f97316' : '#ef4444';
                }
            } catch (err) { console.warn('Ping monitor error:', err); }
        }, 1000);
    }

    // -------------------------------------------------------------------------
    // Voice settings modal
    // -------------------------------------------------------------------------

    async openVoiceSettingsModal() {
        // Clean up any previous test resources
        if (this.state.testAudioContext) { this.state.testAudioContext.close(); this.state.testAudioContext = null; }
        if (this.state.testStream) { this.state.testStream.getTracks().forEach(t => t.stop()); this.state.testStream = null; }

        let tempMicId = this.state.currentMicId;

        this.modal.show(`
            <h4>VOICE SETTINGS</h4>
            <div class="row">
                <label>Input Device</label>
                <select id="micSelect" style="width:100%;padding:8px;background:#111;color:white;border:1px solid #333;border-radius:4px;"></select>
            </div>
            <div class="row" style="margin-top:15px;">
                <label>Input Sensitivity (Noise Gate)</label>
                <div style="display:flex;justify-content:space-between;font-size:12px;opacity:0.7;">
                    <span>Sensitive</span><span>Strict</span>
                </div>
                <input type="range" id="sensSlider" class="range-slider" min="0" max="50" value="${this.state.micSensitivity}">
                <div style="font-size:12px;margin-top:4px;">Current Threshold: <span id="sensVal">${this.state.micSensitivity}</span></div>
            </div>
            <div class="row" style="margin-top:10px;">
                <label>Mic Test</label>
                <div class="mic-test-bar-container">
                    <div id="micTestFill" class="mic-test-bar-fill"></div>
                </div>
                <div id="testText" style="font-size:12px;opacity:0.5;margin-top:4px;">Say something...</div>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
                <button id="saveSettings" class="btn btn-primary">Done</button>
            </div>
        `);

        // Populate microphone device list
        const sel = document.getElementById('micSelect');
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            devices.filter(d => d.kind === 'audioinput').forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.text  = d.label || `Microphone ${sel.length + 1}`;
                if (d.deviceId === this.state.currentMicId) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.onchange = () => { tempMicId = sel.value; localStorage.setItem('konsmon_mic_id', tempMicId); this._startMicTest(tempMicId); };
        } catch (e) {
            sel.innerHTML = '<option>Error loading devices</option>';
        }

        const slider     = document.getElementById('sensSlider');
        const valDisplay = document.getElementById('sensVal');
        slider.oninput = () => {
            this.state.micSensitivity = parseInt(slider.value);
            valDisplay.textContent = this.state.micSensitivity;
            localStorage.setItem('konsmon_mic_sens', this.state.micSensitivity);
        };

        this._startMicTest(this.state.currentMicId);

        document.getElementById('saveSettings').onclick = () => {
            if (this.state.testAudioContext) { this.state.testAudioContext.close(); this.state.testAudioContext = null; }
            if (this.state.testStream) { this.state.testStream.getTracks().forEach(t => t.stop()); this.state.testStream = null; }
            this.modal.close();

            // Rejoin with new mic if device changed
            if (tempMicId !== this.state.currentMicId) {
                this.state.currentMicId = tempMicId;
                if (this.state.currentVoiceChatId) setTimeout(() => this.joinVoiceChat(this.state.currentVoiceChatId), 200);
            }
        };
    }

    async _startMicTest(deviceId) {
        if (this.state.testStream) this.state.testStream.getTracks().forEach(t => t.stop());
        if (this.state.testAudioContext) this.state.testAudioContext.close();

        try {
            this.state.testStream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true }
            });
            this.state.testAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            const src      = this.state.testAudioContext.createMediaStreamSource(this.state.testStream);
            const analyser = this.state.testAudioContext.createAnalyser();
            analyser.fftSize = 256;
            src.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const fill = document.getElementById('micTestFill');
            const txt  = document.getElementById('testText');

            const draw = () => {
                if (!document.getElementById('micTestFill')) return; // Modal was closed
                requestAnimationFrame(draw);
                analyser.getByteFrequencyData(data);
                let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i];
                const avg = sum / data.length;
                if (fill) {
                    fill.style.width = Math.min(100, avg * 2) + '%';
                    if (avg > this.state.micSensitivity) {
                        fill.style.background = '#22c55e';
                        if (txt) txt.textContent = 'Voice detected';
                    } else {
                        fill.style.background = '#ef4444';
                        if (txt) txt.textContent = 'Below threshold (Muted)';
                    }
                }
            };
            draw();
        } catch (e) { console.warn('Test mic error', e); }
    }
}

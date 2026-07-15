// Screen share manager
class StreamManager {
    constructor(state, modal) {
        this.state = state;
        this.modal = modal;
    }

    openStreamSettingsModal() {
        this.modal.show(`
            <h4>START STREAMING</h4>
            <div style="padding:10px 0;color:#ccc;font-size:14px;">
                <p>Select which screen or application you want to share.</p>
                <p>The stream will be visible to everyone in this voice channel.</p>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:15px">
                <button id="cancelStream" class="btn btn-ghost">Cancel</button>
                <button id="confirmStream" class="btn btn-primary">Select Screen & Start</button>
            </div>
        `);

        document.getElementById('cancelStream').onclick  = () => this.modal.close();
        document.getElementById('confirmStream').onclick = () => { this.modal.close(); this.startScreenShare(); };
    }

    // Start stream
    async startScreenShare() {
        if (!this.state.currentVoiceChatId) {
            this.modal.alert('You must be in a voice channel first.');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
            this.state.localScreenStream = stream;

            stream.getVideoTracks()[0].onended = () => this.stopScreenShare();

            this.state.audioStartStr.play().catch(() => {});

            const videoTrack = stream.getVideoTracks()[0];

            if (this.state.voicePresenceRef) this.state.voicePresenceRef.update({ isStreaming: true });

            Object.keys(this.state.peers).forEach(targetUid => {
                const pc = this.state.peers[targetUid];
                if (!pc) return;

                const transceivers     = pc.getTransceivers();
                const videoTransceiver = transceivers.find(t => t.receiver?.track?.kind === 'video');

                if (videoTransceiver) {
                    videoTransceiver.direction = 'sendrecv';
                    videoTransceiver.sender.replaceTrack(videoTrack);
                } else {
                    pc.addTrack(videoTrack, this.state.localScreenStream);
                }
                app.voice._initiateCall(targetUid); // Renegotiate
            });

            this.viewUserStream(app.voice.getVoiceUid(), true);
            app.chat.renderServerList();

        } catch (err) {
            console.error('Error starting screen share:', err);
            if (err.name !== 'NotAllowedError') this.modal.alert('Could not start stream: ' + err.message);
        }
    }

    // Stop stream
    stopScreenShare() {
        if (!this.state.localScreenStream) return;

        this.state.audioEndStr.play().catch(() => {});
        this.state.localScreenStream.getTracks().forEach(t => t.stop());
        this.state.localScreenStream = null;

        if (this.state.voicePresenceRef) this.state.voicePresenceRef.update({ isStreaming: false });

        Object.keys(this.state.peers).forEach(targetUid => {
            const pc = this.state.peers[targetUid];
            if (!pc) return;
            const transceivers     = pc.getTransceivers();
            const videoTransceiver = transceivers.find(t => t.receiver?.track?.kind === 'video');
            if (videoTransceiver) {
                videoTransceiver.direction = 'recvonly';
                if (videoTransceiver.sender.track) pc.removeTrack(videoTransceiver.sender);
            }
            app.voice._initiateCall(targetUid); // Renegotiate
        });

        if (this.state.currentWatchedUid === app.voice.getVoiceUid()) app.chat.detachChat();

        app.chat.renderServerList();
    }

    // Stream viewer
    viewUserStream(uid, isLocal = false) {
        const welcomeArea  = document.getElementById('welcomeArea');
        const chatArea     = document.getElementById('chatArea');
        const messagesEl   = document.getElementById('messages');
        const chatTitle    = document.getElementById('chatTitle');
        const chatSubtitle = document.getElementById('chatSubtitle');

        welcomeArea.style.display = 'none';
        chatArea.style.display    = 'flex';
        messagesEl.innerHTML      = '';

        let userNick = 'Unknown';
        if (isLocal) userNick = 'My Screen';
        else if (this.state.usersCacheById[uid]) userNick = this.state.usersCacheById[uid].nick;
        else if (this.state.voiceChatsCache[this.state.currentVoiceChatId]?.users?.[uid]) {
            userNick = this.state.voiceChatsCache[this.state.currentVoiceChatId].users[uid].nick;
        }

        chatTitle.textContent    = `Streaming: ${userNick}`;
        chatSubtitle.textContent = isLocal ? 'You are sharing your screen' : 'Click a text channel to minimize stream';

        const videoContainer = document.createElement('div');
        videoContainer.style.cssText = 'width:100%;height:100%;display:flex;justify-content:center;align-items:center;background:#000;position:relative;';

        const videoEl = document.createElement('video');
        videoEl.autoplay = true;
        videoEl.controls = true;
        videoEl.style.cssText = 'max-width:100%;max-height:100%;box-shadow:0 0 20px rgba(0,0,0,0.5);';

        if (isLocal) {
            videoEl.muted     = true;
            videoEl.srcObject = this.state.localScreenStream;
        } else if (this.state.remoteStreams[uid]) {
            videoEl.srcObject = this.state.remoteStreams[uid];
        } else {
            videoEl.style.display = 'none';
            const loader = document.createElement('div');
            loader.textContent = 'Connecting to stream...';
            loader.style.color = 'white';
            videoContainer.appendChild(loader);
        }

        videoContainer.appendChild(videoEl);

        messagesEl.style.display = 'none';
        const inputPanel = document.querySelector('.msg-input');
        if (inputPanel) inputPanel.style.display = 'none';

        let overlay = document.getElementById('stream-overlay');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'stream-overlay';
        overlay.style.cssText = 'position:absolute;top:60px;left:0;right:0;bottom:0;z-index:50;background:#1a1a1a;';
        overlay.appendChild(videoContainer);

        chatArea.appendChild(overlay);
        chatArea.style.position = 'relative';

        this.state.currentWatchedUid = uid;
        this.state.currentChatId     = null;
    }
}

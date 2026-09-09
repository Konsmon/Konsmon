// Screen share manager
class StreamManager {
    constructor(state, modal) {
        this.state = state;
        this.modal = modal;
        this._wasapiAudioNode = null;
        this._wasapiPendingChunks = [];
        this._wasapiByteRemainder = new Uint8Array(0);
        this._wasapiAudioCleanup = null;

        if (typeof window.electronAPI?.onWasapiData === 'function') {
            window.electronAPI.onWasapiData(data => this._handleWasapiData(data));
        }
        if (typeof window.electronAPI?.onWasapiEnded === 'function') {
            window.electronAPI.onWasapiEnded(() => this._handleWasapiEnded());
        }
    }

    // The capture helper stopped on its own, so the stream keeps its video but loses audio.
    _handleWasapiEnded() {
        if (!this._wasapiAudioCleanup) return;
        console.warn('[LOOPBACK] Audio capture ended before the stream did.');
        this._wasapiAudioCleanup();
    }

    async openStreamSettingsModal() {
        if (!this.state.currentVoiceChatId) {
            this.modal.alert('You must be in a voice channel first.');
            return;
        }

        let sources = [];
        const canPickDesktopSource = typeof window.electronAPI?.getDesktopSources === 'function';
        if (canPickDesktopSource) {
            try {
                sources = await window.electronAPI.getDesktopSources();
            } catch (err) {
                console.error('Could not list desktop sources:', err);
                this.modal.alert('Could not list screens and applications: ' + err.message);
                return;
            }
        }

        const screens = sources.filter(source => source.type === 'screen');
        const windows = sources.filter(source => source.type === 'window');
        const defaultPanel = screens.length ? 'screen' : 'window';
        const defaultSourceId = (defaultPanel === 'screen' ? screens[0] : windows[0])?.id || '';

        this.modal.show(`
            <div class="stream-picker">
                <h4>START STREAMING</h4>
                ${canPickDesktopSource ? `
                    <div class="stream-picker-tabs" role="tablist">
                        <button type="button" class="stream-picker-tab${defaultPanel === 'screen' ? ' is-active' : ''}" data-panel="screen" role="tab">Entire screen</button>
                        <button type="button" class="stream-picker-tab${defaultPanel === 'window' ? ' is-active' : ''}" data-panel="window" role="tab">A window</button>
                    </div>
                    <div class="stream-picker-panel${defaultPanel === 'screen' ? ' is-active' : ''}" id="streamPanelScreen" data-panel="screen" role="tabpanel"${defaultPanel === 'screen' ? '' : ' hidden'}>
                        ${this._renderSourceGrid(screens, 'screen', defaultSourceId)}
                    </div>
                    <div class="stream-picker-panel${defaultPanel === 'window' ? ' is-active' : ''}" id="streamPanelWindow" data-panel="window" role="tabpanel"${defaultPanel === 'window' ? '' : ' hidden'}>
                        ${this._renderSourceGrid(windows, 'window', defaultSourceId)}
                    </div>
                    <input type="hidden" id="streamSource" value="${escapeHtml(defaultSourceId)}">
                ` : '<p>Your browser will ask which screen or application to share.</p>'}
                <label class="stream-picker-audio">
                    <input id="streamAudio" type="checkbox">
                    <span>
                        <strong id="streamAudioLabel">Share audio</strong>
                        <em id="streamAudioHint"></em>
                    </span>
                </label>
                <p class="stream-picker-note">The stream will be visible to everyone in this voice channel.</p>
                <div class="stream-picker-actions">
                    <button id="cancelStream" class="btn btn-ghost">Cancel</button>
                    <button id="confirmStream" class="btn btn-primary">Start stream</button>
                </div>
            </div>
        `);

        this._bindStreamPicker(sources, canPickDesktopSource);
    }

    _renderSourceGrid(sources, type, selectedId) {
        if (!sources.length) {
            const empty = type === 'window' ? 'No open windows were found.' : 'No screens were found.';
            return `<p class="stream-picker-empty">${empty}</p>`;
        }

        const cards = sources.map(source => {
            const selected = source.id === selectedId ? ' is-selected' : '';
            const thumb = source.thumbnail
                ? `<img class="stream-source-thumb" src="${escapeHtml(source.thumbnail)}" alt="">`
                : `<span class="stream-source-fallback">${escapeHtml((source.name || '?').slice(0, 1))}</span>`;
            const icon = source.icon
                ? `<img class="stream-source-icon" src="${escapeHtml(source.icon)}" alt="">`
                : '';
            return `
                <button type="button" class="stream-source-card${selected}" data-source-id="${escapeHtml(source.id)}" data-source-type="${escapeHtml(source.type)}">
                    <span class="stream-source-preview">${thumb}</span>
                    <span class="stream-source-meta">
                        ${icon}
                        <span class="stream-source-name" title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</span>
                    </span>
                </button>
            `;
        }).join('');

        return `<div class="stream-source-grid stream-source-grid-${type}">${cards}</div>`;
    }

    _bindStreamPicker(sources, canPickDesktopSource) {
        const sourceInput = document.getElementById('streamSource');
        const describeAudio = () => {
            const label = document.getElementById('streamAudioLabel');
            const hint  = document.getElementById('streamAudioHint');
            if (!label || !hint) return;
            const picked = sources.find(source => source.id === sourceInput?.value);
            if (picked?.type === 'window') {
                label.textContent = 'Share this application\u2019s audio';
                hint.textContent  = `Only sound coming from \u201C${picked.name}\u201D is shared, not the rest of your PC.`;
            } else {
                label.textContent = 'Share system audio';
                hint.textContent  = 'Sharing a whole screen shares everything your PC is playing.';
            }
        };

        const selectSource = sourceId => {
            if (!sourceInput) return;
            sourceInput.value = sourceId;
            document.querySelectorAll('.stream-source-card').forEach(card => {
                card.classList.toggle('is-selected', card.dataset.sourceId === sourceId);
            });
            describeAudio();
        };

        document.querySelectorAll('.stream-picker-tab').forEach(tab => {
            tab.onclick = () => {
                const panelName = tab.dataset.panel;
                document.querySelectorAll('.stream-picker-tab').forEach(item => {
                    item.classList.toggle('is-active', item === tab);
                });
                document.querySelectorAll('.stream-picker-panel').forEach(panel => {
                    const active = panel.dataset.panel === panelName;
                    panel.classList.toggle('is-active', active);
                    panel.hidden = !active;
                });
                const firstInPanel = document.querySelector(`.stream-picker-panel[data-panel="${panelName}"] .stream-source-card`);
                if (firstInPanel) selectSource(firstInPanel.dataset.sourceId);
            };
        });

        document.querySelectorAll('.stream-source-card').forEach(card => {
            card.onclick = () => selectSource(card.dataset.sourceId);
            card.ondblclick = () => document.getElementById('confirmStream')?.click();
        });

        describeAudio();

        document.getElementById('cancelStream').onclick  = () => this.modal.close();
        document.getElementById('confirmStream').onclick = async () => {
            const sourceId = sourceInput?.value || null;
            const audio = Boolean(document.getElementById('streamAudio')?.checked);
            if (canPickDesktopSource && !sourceId) {
                this.modal.alert('Select a screen or application first.');
                return;
            }
            if (canPickDesktopSource) {
                const selected = await window.electronAPI.setDesktopSource(sourceId, audio);
                if (!selected) {
                    this.modal.alert('Could not select that screen or application.');
                    return;
                }
            }
            this.modal.close();
            this.startScreenShare({ sourceId, audio });
        };
    }

    // Start stream
    async startScreenShare(options = {}) {
        if (!this.state.currentVoiceChatId) {
            this.modal.alert('You must be in a voice channel first.');
            return;
        }

        try {
            let audioFallback = false;
            let audioError = null;
            let stream;
            try {
                stream = await this._requestDisplayStream(options);
            } catch (err) {
                if (!options.audio || !options.sourceId || options.audioFallbackTried) throw err;

                audioError = err;
                console.warn('Audio loopback failed; falling back to video-only sharing:', err);
                await window.electronAPI.setDesktopSource(options.sourceId, false);
                stream = await this._requestDisplayStream({ ...options, audio: false });
                audioFallback = true;
            }
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
                stream.getAudioTracks().forEach(track => pc.addTrack(track, this.state.localScreenStream));
                app.voice._initiateCall(targetUid); // Renegotiate
            });

            this.viewUserStream(app.voice.getVoiceUid(), true);
            app.chat.renderServerList();

            if (audioFallback) {
                this.modal.alert('Screen sharing started, but without audio.\n\nAudio error: ' + this._describeCaptureError(audioError));
            }

        } catch (err) {
            console.error('Error starting screen share:', err);
            if (err.name !== 'NotAllowedError') {
                this.modal.alert('Could not start stream.\n\nCapture error: ' + this._describeCaptureError(err));
            }
        }
    }

    async _requestDisplayStream(options) {
        if (options.audio && options.sourceId && typeof window.electronAPI?.startWasapiLoopback === 'function') {
            const format = await window.electronAPI.startWasapiLoopback(options.sourceId);
            try {
                const videoStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                const audioStream = await this._createWasapiAudioStream(format);
                audioStream.getAudioTracks().forEach(track => videoStream.addTrack(track));
                return videoStream;
            } catch (error) {
                await window.electronAPI.stopWasapiLoopback().catch(() => {});
                throw error;
            }
        }

        if (options.sourceId && typeof window.electronAPI?.setDesktopVideoSource === 'function') {
            await window.electronAPI.setDesktopVideoSource(options.sourceId);
        }

        const loopback = Boolean(options.audio && typeof window.electronAPI?.enableLoopbackAudio === 'function');
        if (loopback) await window.electronAPI.enableLoopbackAudio();

        try {
            return await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: Boolean(options.audio),
            });
        } finally {
            if (loopback) await window.electronAPI.disableLoopbackAudio();
        }
    }

    async _createWasapiAudioStream(format) {
        this._wasapiFormat = format;
        this._wasapiByteRemainder = new Uint8Array(0);
        const audioContext = new AudioContext({ sampleRate: format.sampleRate });
        await audioContext.resume();
        await audioContext.audioWorklet.addModule('./wasapi-worklet.js');

        const audioNode = new AudioWorkletNode(audioContext, 'wasapi-loopback-processor', {
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });
        const destination = audioContext.createMediaStreamDestination();
        audioNode.connect(destination);
        this._wasapiAudioNode = audioNode;
        console.log(`[LOOPBACK] Audio graph ready: ${format.sampleRate}Hz, ${format.channels} channels, state=${audioContext.state}`);

        this._wasapiPendingChunks.splice(0).forEach(chunk => this._postWasapiChunk(chunk, format));
        this._wasapiAudioCleanup = async () => {
            this._wasapiAudioNode = null;
            this._wasapiPendingChunks = [];
            this._wasapiByteRemainder = new Uint8Array(0);
            audioNode.disconnect();
            await audioContext.close().catch(() => {});
            await window.electronAPI.stopWasapiLoopback().catch(() => {});
            this._wasapiAudioCleanup = null;
        };

        return destination.stream;
    }

    _handleWasapiData(data) {
        const chunk = data instanceof Uint8Array ? data : new Uint8Array(data?.data || data);
        if (!this._wasapiAudioNode) {
            this._wasapiPendingChunks.push(chunk);
            if (this._wasapiPendingChunks.length > 32) this._wasapiPendingChunks.shift();
            return;
        }
        this._postWasapiChunk(chunk);
    }

    // Converts raw capture bytes into the interleaved stereo Float32 frames the worklet plays.
    _postWasapiChunk(bytes, format = this._wasapiFormat) {
        if (!this._wasapiAudioNode) return;

        const channels = Math.max(1, format?.channels || 2);
        const bits = format?.bitsPerSample || 32;
        const isFloat = bits === 32 && format?.encoding === 'IeeeFloat';
        const bytesPerSample = bits / 8;
        const frameSize = channels * bytesPerSample;

        // A chunk can end mid-frame, so hold the tail back until the rest of it arrives.
        const combined = new Uint8Array(this._wasapiByteRemainder.length + bytes.length);
        combined.set(this._wasapiByteRemainder);
        combined.set(bytes, this._wasapiByteRemainder.length);
        const usableLength = combined.length - (combined.length % frameSize);
        this._wasapiByteRemainder = combined.slice(usableLength);
        if (!usableLength) return;

        const view = new DataView(combined.buffer, combined.byteOffset, usableLength);
        const readSample = isFloat
            ? offset => view.getFloat32(offset, true)
            : bits === 16
                ? offset => view.getInt16(offset, true) / 32768
                : offset => view.getInt32(offset, true) / 2147483648;

        const frames = usableLength / frameSize;
        const output = new Float32Array(frames * 2);
        for (let frame = 0; frame < frames; frame++) {
            const base = frame * frameSize;
            const left = readSample(base);
            output[frame * 2]     = left;
            output[frame * 2 + 1] = channels > 1 ? readSample(base + bytesPerSample) : left;
        }

        this._wasapiAudioNode.port.postMessage(output.buffer, [output.buffer]);
    }

    _describeCaptureError(error) {
        if (!error) return 'Unknown capture error';
        const details = [error.name, error.message].filter(Boolean);
        if (error.constraint) details.push('constraint=' + error.constraint);
        if (error.code) details.push('code=' + error.code);
        return details.join(' | ') || String(error);
    }

    // Stop stream
    stopScreenShare() {
        if (!this.state.localScreenStream) return;

        const sharedTracks = new Set(this.state.localScreenStream.getTracks());
        this.state.audioEndStr.play().catch(() => {});
        this.state.localScreenStream.getTracks().forEach(t => t.stop());
        this.state.localScreenStream = null;
        if (this._wasapiAudioCleanup) this._wasapiAudioCleanup();

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
            pc.getSenders().forEach(sender => {
                if (sender.track && sharedTracks.has(sender.track)) pc.removeTrack(sender);
            });
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

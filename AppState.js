// AppState.js
// Central state store shared across all modules.
// Instead of scattered globals, every class reads/writes here.

const AppState = {
    // --- Firebase refs ---
    db: null,
    usersRef: null,
    serversRef: null,
    voiceChatsRef: null,
    chatsRef: null,

    // --- Auth ---
    currentUser: null,       // { uid, nick } or null for anon
    adminPassword: null,
    localAnonUid: null,
    localAnonNick: null,

    // --- Users cache ---
    usersCacheById: {},
    usersCacheByNickLower: {},
    usersNicknamesLower: [],
    usersNicknamesDisplay: [],
    usersCacheLoaded: false,

    // --- Servers / channels ---
    serversCache: {},
    chatsCache: {},
    voiceChatsCache: {},
    expandedServers: new Set(),
    currentServerId: null,
    currentChannelId: null,
    currentChannelType: null,   // 'text' | 'voice'
    unlockedServers: new Set(),

    // --- Text chat ---
    currentChatId: null,
    currentChatRef: null,
    messagesRef: null,
    chatParticipants: new Set(),

    // --- Voice / WebRTC ---
    currentVoiceChatId: null,
    voicePresenceRef: null,
    voiceSignalingRef: null,
    localStream: null,
    peers: {},
    audioContext: null,
    visualizerIntervals: {},
    visualizerStreams: {},
    localMutes: {},
    vadInterval: null,
    pingInterval: null,
    currentMicId: localStorage.getItem('konsmon_mic_id') || 'default',
    micSensitivity: parseInt(localStorage.getItem('konsmon_mic_sens') || '0'),
    testAudioContext: null,
    testStream: null,
    globalMicMuted: false,
    globalSoundMuted: false,

    // --- Screen share / streaming ---
    localScreenStream: null,
    remoteStreams: {},
    currentWatchedUid: null,

    // --- Audio clips ---
    audioConnect:    new Audio('./audio/con_sound.mp3'),
    audioDisconnect: new Audio('./audio/discon.mp3'),
    audioMute:       new Audio('./audio/mute.mp3'),
    audioUnmute:     new Audio('./audio/unmute.mp3'),
    audioStartStr:   new Audio('./audio/startstr.mp3'),
    audioEndStr:     new Audio('./audio/endstr.mp3'),

    // --- WebRTC config ---
    rtcConfig: {
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: 10,
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80',          username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443',         username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        ]
    },
};

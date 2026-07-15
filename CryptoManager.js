// Message encryption (AES-GCM)
const CryptoManager = {
    KEY_LENGTH: 64,

    // Random 64-hex key
    generateKeyHex() {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    isValidKey(hex) {
        return /^[0-9a-fA-F]{64}$/.test(String(hex || ''));
    },

    // Local key storage
    getServerKey(serverId) {
        return localStorage.getItem('konsmon_enc_key_' + serverId) || null;
    },

    setServerKey(serverId, hex) {
        localStorage.setItem('konsmon_enc_key_' + serverId, hex);
    },

    _hexToBytes(hex) {
        const out = new Uint8Array(hex.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
        return out;
    },

    _bytesToB64(bytes) {
        let bin = '';
        bytes.forEach(b => bin += String.fromCharCode(b));
        return btoa(bin);
    },

    _b64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    },

    async _importKey(hex) {
        return crypto.subtle.importKey('raw', this._hexToBytes(hex), 'AES-GCM', false, ['encrypt', 'decrypt']);
    },

    // Returns "iv:ciphertext" base64
    async encryptText(keyHex, text) {
        const key = await this._importKey(keyHex);
        const iv  = crypto.getRandomValues(new Uint8Array(12));
        const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
        return this._bytesToB64(iv) + ':' + this._bytesToB64(new Uint8Array(ct));
    },

    // Throws on wrong key
    async decryptText(keyHex, payload) {
        const sep = payload.indexOf(':');
        if (sep < 0) throw new Error('Bad payload');
        const iv  = this._b64ToBytes(payload.slice(0, sep));
        const ct  = this._b64ToBytes(payload.slice(sep + 1));
        const key = await this._importKey(keyHex);
        const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return new TextDecoder().decode(pt);
    },
};

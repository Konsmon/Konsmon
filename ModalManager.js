// ModalManager.js
// Handles all modal dialogs and alert popups.
// Every other class calls ModalManager.show() / ModalManager.alert() instead of touching the DOM directly.

class ModalManager {
    constructor() {
        this.modal        = document.getElementById('modal');
        this.modalContent = document.getElementById('modalContent');
        this._resizeHandler = null;

        // Close on backdrop click or Escape key
        this.modal.addEventListener('click', e => { if (e.target === this.modal) this.close(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
    }

    // Scales an image inside the modal to fit the viewport
    _adjustImage() {
        const imgEl = this.modalContent.querySelector('.modal-image');
        if (!imgEl) return;
        const pad = 48;
        const availW = Math.max(100, window.innerWidth  - pad);
        const availH = Math.max(100, window.innerHeight - pad);
        const natW = imgEl.naturalWidth  || imgEl.width  || availW;
        const natH = imgEl.naturalHeight || imgEl.height || availH;
        if (!natW || !natH) return;
        const scale = Math.min(1, availW / natW, availH / natH);
        if (scale < 1) {
            imgEl.style.width  = Math.floor(natW * scale) + 'px';
            imgEl.style.height = Math.floor(natH * scale) + 'px';
        } else {
            imgEl.style.width  = 'auto';
            imgEl.style.height = 'auto';
        }
    }

    // Renders arbitrary HTML inside the modal
    show(html) {
        this.modalContent.innerHTML = html;
        this.modal.style.display = 'flex';
        if (!this._resizeHandler) {
            this._resizeHandler = () => this._adjustImage();
            window.addEventListener('resize', this._resizeHandler);
        }
    }

    close() {
        this.modal.style.display = 'none';
        this.modalContent.innerHTML = '';
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
    }

    // Simple OK alert with optional callback fired after dismiss
    alert(msg, cb) {
        this.show(`
            <div style="min-width:260px">
                <p style="margin:0 0 8px">${escapeHtml(msg)}</p>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                    <button id="alertOk" class="btn btn-primary">OK</button>
                </div>
            </div>
        `);
        const btn = document.getElementById('alertOk');
        if (btn) btn.onclick = () => { this.close(); if (typeof cb === 'function') cb(); };
    }
}

// Shared HTML-escape helper used across all modules
function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

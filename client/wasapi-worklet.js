// Plays interleaved stereo Float32 frames pushed in from the loopback capture helper.
const MAX_BUFFERED_FRAMES = 24000; // ~0.5s at 48kHz, caps latency if the capture runs ahead

class WasapiLoopbackProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.queue = [];
        this.offset = 0;
        this.bufferedFrames = 0;
        this.port.onmessage = event => {
            const chunk = new Float32Array(event.data);
            this.queue.push(chunk);
            this.bufferedFrames += chunk.length / 2;
            // The capture clock and the audio clock drift apart over a long stream. Dropping the
            // oldest audio keeps the stream in sync instead of letting delay grow without bound.
            while (this.bufferedFrames > MAX_BUFFERED_FRAMES && this.queue.length > 1) {
                const dropped = this.queue.shift();
                // Frames already played out of this chunk were counted off as they were consumed.
                this.bufferedFrames -= (dropped.length - this.offset) / 2;
                this.offset = 0;
            }
        };
    }

    process(_inputs, outputs) {
        const output = outputs[0];
        const left = output[0];
        const right = output.length > 1 ? output[1] : null;

        for (let frame = 0; frame < left.length; frame++) {
            const chunk = this.queue[0];
            if (!chunk) {
                left[frame] = 0;
                if (right) right[frame] = 0;
                continue;
            }

            left[frame] = chunk[this.offset];
            if (right) right[frame] = chunk[this.offset + 1];

            this.offset += 2;
            this.bufferedFrames--;
            if (this.offset >= chunk.length) {
                this.queue.shift();
                this.offset = 0;
            }
        }

        return true;
    }
}

registerProcessor('wasapi-loopback-processor', WasapiLoopbackProcessor);

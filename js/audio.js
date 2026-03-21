import { makeDistortionCurve } from 'app/effects';
import { transmissionPool } from 'app/constants';

let audioContext;
let masterGainNode, delayNode, feedbackGainNode, distortionNode, filterNode, analyserNode;
let convolverNode, reverbWetGain, granularGainNode;
let pannerNode; // Binaural
let sourceNode = null;
let mediaElement = null;
let mediaElementSource = null;
let mediaElementUrl = null;
let currentAudioBuffer = null;
const audioBufferCache = {};

// Binaural motion state
let binauralEnabled = false;
let motionRAF = null;
let position = { x: 0, y: 0, z: 1.5 }; // start slightly forward
let target = { x: 0, y: 0, z: 1.5 };
let lastTime = 0;
let speed = 0.35; // units per second

function pickNewTarget() {
    // Random sphere within radius 3
    const r = 3;
    target = {
        x: (Math.random() * 2 - 1) * r,
        y: (Math.random() * 2 - 1) * r,
        z: Math.max(0.5, Math.random() * r) // keep mostly in front
    };
}

function updatePannerPosition() {
    if (!pannerNode || !binauralEnabled) return;
    const now = performance.now();
    if (!lastTime) lastTime = now;
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    // Move towards target
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const dz = target.z - position.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (dist < 0.05) {
        pickNewTarget();
    } else {
        const step = Math.min(dist, speed * dt);
        position.x += (dx / dist) * step;
        position.y += (dy / dist) * step;
        position.z += (dz / dist) * step;
    }

    pannerNode.positionX.value = position.x;
    pannerNode.positionY.value = position.y;
    pannerNode.positionZ.value = position.z;

    motionRAF = requestAnimationFrame(updatePannerPosition);
}

function startBinauralMotion() {
    if (motionRAF) cancelAnimationFrame(motionRAF);
    pickNewTarget();
    lastTime = 0;
    motionRAF = requestAnimationFrame(updatePannerPosition);
}

function stopBinauralMotion() {
    if (motionRAF) cancelAnimationFrame(motionRAF);
    motionRAF = null;
}

export function enableBinaural(enable = true) {
    binauralEnabled = enable;
    if (pannerNode) {
        // when disabled, center the sound
        if (!enable) {
            position = { x: 0, y: 0, z: 1.5 };
            pannerNode.positionX.value = position.x;
            pannerNode.positionY.value = position.y;
            pannerNode.positionZ.value = position.z;
            stopBinauralMotion();
        } else {
            startBinauralMotion();
        }
    }
}

// Expose current binaural position for Capture Mission
export function getSourcePosition() {
    return {
        x: position.x,
        y: position.y,
        z: position.z
    };
}

// New function to create a synthetic impulse response for the reverb
function createHarmonicInversionIR(audioContext) {
    const sampleRate = audioContext.sampleRate;
    const duration = 2; // seconds
    const decay = 2.5;
    const numSamples = sampleRate * duration;
    const buffer = audioContext.createBuffer(2, numSamples, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const freqs = [261.63, 329.63, 392.00];

    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        let sample = 0;
        for (const freq of freqs) {
            sample += Math.sin(2 * Math.PI * freq * t);
        }
        sample /= freqs.length;
        const envelope = Math.pow(1 - (i / numSamples), decay);
        const value = sample * envelope;
        left[i] = value;
        right[i] = -value; 
    }
    return buffer;
}

export function initAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    masterGainNode = audioContext.createGain();
    masterGainNode.gain.value = 0.7;

    delayNode = audioContext.createDelay(5.0);
    feedbackGainNode = audioContext.createGain();
    distortionNode = audioContext.createWaveShaper();
    filterNode = audioContext.createBiquadFilter();
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;

    // Binaural panner (HRTF)
    pannerNode = audioContext.createPanner();
    pannerNode.panningModel = 'HRTF';
    pannerNode.distanceModel = 'inverse';
    pannerNode.refDistance = 1;
    pannerNode.maxDistance = 10000;
    pannerNode.rolloffFactor = 1;
    pannerNode.coneInnerAngle = 360;
    pannerNode.coneOuterAngle = 0;
    pannerNode.positionX.value = position.x;
    pannerNode.positionY.value = position.y;
    pannerNode.positionZ.value = position.z;

    // New nodes for Harmonic Inversion (Reverb)
    convolverNode = audioContext.createConvolver();
    convolverNode.buffer = createHarmonicInversionIR(audioContext);
    reverbWetGain = audioContext.createGain();
    reverbWetGain.gain.value = 0;

    // New node for Granular Synthesis
    granularGainNode = audioContext.createGain();
    granularGainNode.gain.value = 0;

    masterGainNode.connect(analyserNode);
    analyserNode.connect(audioContext.destination);

    distortionNode.connect(filterNode);
    filterNode.connect(delayNode);
    delayNode.connect(masterGainNode);
    delayNode.connect(feedbackGainNode);
    feedbackGainNode.connect(delayNode);

    filterNode.connect(convolverNode);
    convolverNode.connect(reverbWetGain);
    reverbWetGain.connect(masterGainNode);

    granularGainNode.connect(masterGainNode);

    delayNode.delayTime.value = 0;
    feedbackGainNode.gain.value = 0;
    distortionNode.oversample = '4x';
    distortionNode.curve = makeDistortionCurve(0);
    filterNode.type = 'lowpass';
    filterNode.frequency.value = 20000;
    filterNode.Q.value = 1;

    // Listener orientation
    audioContext.listener.forwardX.value = 0;
    audioContext.listener.forwardY.value = 0;
    audioContext.listener.forwardZ.value = -1;
    audioContext.listener.upX.value = 0;
    audioContext.listener.upY.value = 1;
    audioContext.listener.upZ.value = 0;

    return {
        audioContext,
        nodes: { masterGainNode, delayNode, feedbackGainNode, distortionNode, filterNode, analyserNode, convolverNode, reverbWetGain, granularGainNode, pannerNode }
    };
}

export function resumeAudioContext() {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(console.error);
    }
}

export function getAnalyser() {
    return analyserNode;
}

export function getCurrentAudioBuffer() {
    return currentAudioBuffer;
}

export async function loadAndPlaySound(sound) {
    stopCurrentSource();

    try {
        const description = sound.description || 'User Signal';
        let uploadedBuffer = null;

        // decode uploaded file if present
        if (sound.file && sound.file instanceof File) {
            // If it's a video container (common on iOS), use media element playback
            if (sound.file.type && sound.file.type.startsWith('video/')) {
                const played = await playMediaElementFromFile(sound.file);
                if (!played) {
                    return { ok: false, code: 'video_play_failed', message: 'Video audio could not be played.' };
                }
                if (binauralEnabled) startBinauralMotion();
                return { ok: true, message: `${description} (video audio)` };
            }

            const arrayBuffer = await sound.file.arrayBuffer();
            uploadedBuffer = await audioContext.decodeAudioData(arrayBuffer);
        } else if (sound.url) {
            uploadedBuffer = audioBufferCache[sound.url];
            if (!uploadedBuffer) {
                const response = await fetch(sound.url);
                const arrayBuffer = await response.arrayBuffer();
                uploadedBuffer = await audioContext.decodeAudioData(arrayBuffer);
                audioBufferCache[sound.url] = uploadedBuffer;
            }
        }

        // If we have an uploadedBuffer, pick a random existing sample and mix them.
        if (uploadedBuffer) {
            // pick random sample from pool
            const candidate = transmissionPool[Math.floor(Math.random() * transmissionPool.length)];
            let sampleBuffer = null;
            try {
                sampleBuffer = audioBufferCache[candidate.url];
                if (!sampleBuffer) {
                    const resp = await fetch(candidate.url);
                    const ab = await resp.arrayBuffer();
                    sampleBuffer = await audioContext.decodeAudioData(ab);
                    audioBufferCache[candidate.url] = sampleBuffer;
                }
            } catch (err) {
                console.warn('Could not load random sample for remix, proceeding with uploaded only.', err);
                sampleBuffer = null;
            }

            // If we have a sampleBuffer, create a mixed buffer (averaging aligned channels)
            let finalBuffer = uploadedBuffer;
            if (sampleBuffer) {
                const sampleRate = audioContext.sampleRate;
                const channels = Math.max(uploadedBuffer.numberOfChannels, sampleBuffer.numberOfChannels);
                const maxLength = Math.max(uploadedBuffer.length, sampleBuffer.length);
                finalBuffer = audioContext.createBuffer(channels, maxLength, sampleRate);

                for (let ch = 0; ch < channels; ch++) {
                    const out = finalBuffer.getChannelData(ch);
                    out.fill(0);
                    const a = uploadedBuffer.getChannelData(Math.min(ch, uploadedBuffer.numberOfChannels - 1));
                    const b = sampleBuffer.getChannelData(Math.min(ch, sampleBuffer.numberOfChannels - 1));
                    for (let i = 0; i < maxLength; i++) {
                        const va = i < a.length ? a[i] : 0;
                        const vb = i < b.length ? b[i] : 0;
                        out[i] = (va + vb) * 0.5; // simple average
                    }
                }

                currentAudioBuffer = finalBuffer;
            } else {
                currentAudioBuffer = uploadedBuffer;
            }

            sourceNode = audioContext.createBufferSource();
            sourceNode.buffer = currentAudioBuffer;
            sourceNode.loop = true;

            // Chain: source -> panner -> distortion
            sourceNode.connect(pannerNode);
            pannerNode.connect(distortionNode);

            sourceNode.start(0);

            if (binauralEnabled) startBinauralMotion();

            return { ok: true, message: `${description} (remixed with local sample)` };
        }

        throw new Error("Could not create audio buffer from sound object.");
    } catch (error) {
        console.error("Error loading or playing sound:", error);
        if (error.name === 'EncodingError' || (error instanceof DOMException)) {
            return { ok: false, code: 'decode_error', message: "Signal Corrupted. Could not decode audio file." };
        }
        return { ok: false, code: 'unknown_error', message: "Signal Lost. Please try tuning again." };
    }
}

// NEW: load and mix multiple uploaded audio files into a single looped buffer
export async function loadAndPlayMixedSignal(files) {
    if (!audioContext || !files || files.length === 0) {
        return { ok: false, code: 'no_signal', message: "No signal detected." };
    }

    stopCurrentSource();

    try {
        const buffers = [];
        for (const file of files) {
            if (!(file instanceof File)) continue;
            if (file.type && file.type.startsWith('video/')) continue;
            const arrayBuffer = await file.arrayBuffer();
            const buffer = await audioContext.decodeAudioData(arrayBuffer);
            if (buffer) buffers.push(buffer);
        }

        if (buffers.length === 0) {
            throw new Error("Could not decode any of the uploaded audio files.");
        }

        // Add one random existing transmission sample to the mix
        try {
            const candidate = transmissionPool[Math.floor(Math.random() * transmissionPool.length)];
            let sampleBuffer = audioBufferCache[candidate.url];
            if (!sampleBuffer) {
                const resp = await fetch(candidate.url);
                const ab = await resp.arrayBuffer();
                sampleBuffer = await audioContext.decodeAudioData(ab);
                audioBufferCache[candidate.url] = sampleBuffer;
            }
            if (sampleBuffer) buffers.push(sampleBuffer);
        } catch (err) {
            console.warn('Could not load random sample to add to mixed signal.', err);
        }

        const sampleRate = audioContext.sampleRate;
        const channels = Math.max(...buffers.map(b => b.numberOfChannels));
        let maxLength = 0;
        for (const b of buffers) {
            if (b.length > maxLength) maxLength = b.length;
        }

        const mixedBuffer = audioContext.createBuffer(channels, maxLength, sampleRate);

        for (let ch = 0; ch < channels; ch++) {
            const output = mixedBuffer.getChannelData(ch);
            output.fill(0);

            for (const b of buffers) {
                const inChannelIndex = Math.min(ch, b.numberOfChannels - 1);
                const input = b.getChannelData(inChannelIndex);
                const scale = 1 / buffers.length;

                const len = input.length;
                for (let i = 0; i < len; i++) {
                    output[i] += input[i] * scale;
                }
            }
        }

        currentAudioBuffer = mixedBuffer;

        sourceNode = audioContext.createBufferSource();
        sourceNode.buffer = mixedBuffer;
        sourceNode.loop = true;

        // Chain: source -> panner -> distortion
        sourceNode.connect(pannerNode);
        pannerNode.connect(distortionNode);

        sourceNode.start(0);

        if (binauralEnabled) startBinauralMotion();

        return { ok: true, message: `User Mixed Signal: ${buffers.length} files blended (incl. local sample if available).` };
    } catch (error) {
        console.error("Error loading or mixing uploaded sounds:", error);
        if (error.name === 'EncodingError' || (error instanceof DOMException)) {
            return { ok: false, code: 'decode_error', message: "Signal Corrupted. One or more files could not be decoded." };
        }
        return { ok: false, code: 'unknown_error', message: "Signal Lost during mixing. Please try again." };
    }
}

function stopCurrentSource() {
    if (sourceNode) {
        try { sourceNode.stop(); } catch (e) {}
        sourceNode.disconnect();
        sourceNode = null;
    }
    if (mediaElementSource) {
        mediaElementSource.disconnect();
        mediaElementSource = null;
    }
    if (mediaElement) {
        try { mediaElement.pause(); } catch (e) {}
        try { mediaElement.remove(); } catch (e) {}
        mediaElement.src = '';
        mediaElement.load();
        mediaElement = null;
    }
    if (mediaElementUrl) {
        URL.revokeObjectURL(mediaElementUrl);
        mediaElementUrl = null;
    }
}

async function playMediaElementFromFile(file) {
    // Create a hidden media element so we can play video audio on mobile
    mediaElementUrl = URL.createObjectURL(file);
    mediaElement = document.createElement('video');
    mediaElement.src = mediaElementUrl;
    mediaElement.loop = true;
    mediaElement.muted = false;
    mediaElement.playsInline = true;
    mediaElement.preload = 'auto';
    mediaElement.style.display = 'none';
    document.body.appendChild(mediaElement);

    mediaElementSource = audioContext.createMediaElementSource(mediaElement);

    // Chain: media element -> panner -> distortion
    mediaElementSource.connect(pannerNode);
    pannerNode.connect(distortionNode);

    try {
        await mediaElement.play();
        return true;
    } catch (err) {
        console.warn('Video playback failed:', err);
        return false;
    }
}

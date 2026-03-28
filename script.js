import { initAudio, resumeAudioContext } from 'app/audio';
import { initGranular, updateGranularParams, makeDistortionCurve } from 'app/effects';
import { initWaveform } from 'app/waveform';

const MAX_RECORD_MS = 15000;
const METABOLISM_MS = 150000;

let audioSystem;
let micStream = null;
let micSource = null;
let micAnalyser = null;
let mediaRecorder = null;
let recordChunks = [];
let recordTimeout = null;
let recordedBuffer = null;
let metabolismSource = null;
let metabolismTimeout = null;
let ambientOsc = null;
let ambientGain = null;

const dom = {};
const backgroundFocus = [
    { x: '50%', y: '50%' }, // Layer 0
    { x: '60%', y: '20%' }, // Layer 1
    { x: '35%', y: '55%' }, // Layer 2
    { x: '50%', y: '75%' }, // Layer 3
    { x: '25%', y: '35%' }, // Layer 4
    { x: '70%', y: '50%' }  // Layer 5
];

function cacheDom() {
    dom.layers = Array.from(document.querySelectorAll('.layer'));
    dom.startBtn = document.getElementById('start-btn');
    dom.readyBtn = document.getElementById('ready-btn');
    dom.recordBtn = document.getElementById('record-btn');
    dom.recordStatus = document.getElementById('record-status');
    dom.toMetabolismBtn = document.getElementById('to-metabolism-btn');
    dom.dropBtn = document.getElementById('drop-btn');
    dom.metabolismStatus = document.getElementById('metabolism-status');
    dom.toNamingBtn = document.getElementById('to-naming-btn');
    dom.doneBtn = document.getElementById('done-btn');
    dom.exitBtn = document.getElementById('exit-btn');
    dom.waveformCanvas = document.getElementById('waveform-canvas');
    dom.particleCanvas = document.getElementById('particle-canvas');
}

function showLayer(index) {
    dom.layers.forEach((layer, i) => {
        if (i === index) {
            layer.classList.add('is-active');
        } else {
            layer.classList.remove('is-active');
        }
    });

    if (index === 3) {
        dom.particleCanvas.classList.add('active');
    } else {
        dom.particleCanvas.classList.remove('active');
    }

    const focus = backgroundFocus[index];
    if (focus) {
        document.documentElement.style.setProperty('--bg-x', focus.x);
        document.documentElement.style.setProperty('--bg-y', focus.y);
    }
}

function setAmbient(level) {
    if (!ambientGain) return;
    ambientGain.gain.setTargetAtTime(level, audioSystem.audioContext.currentTime, 0.5);
}

function startAmbient() {
    if (ambientOsc) return;
    const { audioContext } = audioSystem;
    ambientOsc = audioContext.createOscillator();
    ambientGain = audioContext.createGain();
    ambientOsc.type = 'sine';
    ambientOsc.frequency.value = 42;
    ambientGain.gain.value = 0.0;
    ambientOsc.connect(ambientGain).connect(audioContext.destination);
    ambientOsc.start();
}

async function prepareMicrophone() {
    if (micStream) return;
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const { audioContext } = audioSystem;
        micSource = audioContext.createMediaStreamSource(micStream);
        micAnalyser = audioContext.createAnalyser();
        micAnalyser.fftSize = 2048;
        micSource.connect(micAnalyser);
        initWaveform(dom.waveformCanvas, micAnalyser);
    } catch (err) {
        dom.recordStatus.textContent = 'Microphone access is required.';
        dom.recordBtn.disabled = true;
    }
}

function startRecording() {
    if (!micStream || mediaRecorder) return;
    recordChunks = [];
    mediaRecorder = new MediaRecorder(micStream);

    mediaRecorder.addEventListener('dataavailable', (e) => {
        if (e.data && e.data.size > 0) recordChunks.push(e.data);
    });

    mediaRecorder.addEventListener('stop', async () => {
        clearTimeout(recordTimeout);
        await finalizeRecording();
    });

    mediaRecorder.start();
    dom.recordBtn.textContent = 'Recording';
    dom.recordBtn.classList.add('is-recording');
    dom.recordStatus.textContent = 'Listening...';

    recordTimeout = window.setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
    }, MAX_RECORD_MS);
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
}

async function finalizeRecording() {
    dom.recordBtn.classList.remove('is-recording');
    dom.recordBtn.disabled = true;
    dom.recordBtn.textContent = 'Recorded';
    dom.recordStatus.textContent = 'Captured. Please continue.';

    const blob = new Blob(recordChunks, { type: 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    try {
        recordedBuffer = await audioSystem.audioContext.decodeAudioData(arrayBuffer);
        dom.toMetabolismBtn.disabled = false;
    } catch (err) {
        dom.recordStatus.textContent = 'Unable to decode recording. Please reload.';
    }

    mediaRecorder = null;
}

function configureMetabolismNodes() {
    const { audioContext, nodes } = audioSystem;
    nodes.masterGainNode.gain.setTargetAtTime(0.55, audioContext.currentTime, 0.5);
    nodes.delayNode.delayTime.setTargetAtTime(0.8, audioContext.currentTime, 0.5);
    nodes.feedbackGainNode.gain.setTargetAtTime(0.5, audioContext.currentTime, 0.5);
    nodes.filterNode.frequency.setTargetAtTime(1200, audioContext.currentTime, 0.5);
    nodes.filterNode.Q.setTargetAtTime(1.4, audioContext.currentTime, 0.5);
    nodes.reverbWetGain.gain.setTargetAtTime(0.65, audioContext.currentTime, 0.5);
    nodes.distortionNode.curve = makeDistortionCurve(32);

    initGranular({
        audioContext,
        nodes,
        getBuffer: () => recordedBuffer
    });
    updateGranularParams({
        mix: 0.35,
        size: 0.09,
        density: 18,
        pitch: 0.78,
        spread: 0.6
    });
}

function startMetabolism() {
    if (!recordedBuffer) return;
    const { audioContext, nodes } = audioSystem;

    configureMetabolismNodes();

    metabolismSource = audioContext.createBufferSource();
    metabolismSource.buffer = recordedBuffer;
    metabolismSource.loop = true;
    metabolismSource.playbackRate.value = 0.65;
    metabolismSource.detune.value = -300;
    metabolismSource.connect(nodes.distortionNode);
    metabolismSource.start();

    dom.dropBtn.disabled = true;
    dom.metabolismStatus.textContent = 'Metabolizing. Stay with it.';

    metabolismTimeout = window.setTimeout(() => {
        stopMetabolism();
        dom.toNamingBtn.disabled = false;
        dom.metabolismStatus.textContent = 'You may continue.';
    }, METABOLISM_MS);
}

function stopMetabolism() {
    if (metabolismSource) {
        try { metabolismSource.stop(); } catch (e) {}
        metabolismSource.disconnect();
        metabolismSource = null;
    }
    if (metabolismTimeout) {
        clearTimeout(metabolismTimeout);
        metabolismTimeout = null;
    }
    updateGranularParams({ mix: 0, density: 0 });
}

function setupParticles() {
    const canvas = dom.particleCanvas;
    const ctx = canvas.getContext('2d');
    const particles = [];
    const count = 80;
    const center = { x: 0, y: 0 };

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        center.x = canvas.width / 2;
        center.y = canvas.height / 2;
    }

    function spawnParticle() {
        return {
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            radius: 1 + Math.random() * 3,
            speed: 0.03 + Math.random() * 0.12,
            drift: (Math.random() - 0.5) * 0.08,
            pull: 0.0006 + Math.random() * 0.001,
            opacity: 0.06 + Math.random() * 0.12
        };
    }

    function initParticles() {
        particles.length = 0;
        for (let i = 0; i < count; i++) {
            particles.push(spawnParticle());
        }
    }

    function step() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(210, 200, 180, 0.4)';
        particles.forEach((p) => {
            const dx = center.x - p.x;
            const dy = center.y - p.y;
            p.x += dx * p.pull + p.drift;
            p.y += dy * p.pull + p.speed;
            if (p.x < -40 || p.x > canvas.width + 40 || p.y < -40 || p.y > canvas.height + 40) {
                const fresh = spawnParticle();
                p.x = fresh.x;
                p.y = fresh.y;
                p.radius = fresh.radius;
                p.speed = fresh.speed;
                p.drift = fresh.drift;
                p.pull = fresh.pull;
                p.opacity = fresh.opacity;
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(210, 200, 180, ${p.opacity})`;
            ctx.fill();
        });
        requestAnimationFrame(step);
    }

    resize();
    initParticles();
    window.addEventListener('resize', () => {
        resize();
        initParticles();
    });
    step();
}

function bindEvents() {
    dom.startBtn.addEventListener('click', () => {
        resumeAudioContext();
        startAmbient();
        setAmbient(0.015);
        showLayer(1);
    });

    dom.readyBtn.addEventListener('click', async () => {
        resumeAudioContext();
        await prepareMicrophone();
        setAmbient(0.01);
        showLayer(2);
    });

    dom.recordBtn.addEventListener('click', () => {
        resumeAudioContext();
        if (!mediaRecorder) {
            startRecording();
        } else {
            stopRecording();
        }
    });

    dom.toMetabolismBtn.addEventListener('click', () => {
        showLayer(3);
        setAmbient(0.005);
    });

    dom.dropBtn.addEventListener('click', () => {
        resumeAudioContext();
        startMetabolism();
    });

    dom.toNamingBtn.addEventListener('click', () => {
        showLayer(4);
        setAmbient(0.02);
    });

    dom.doneBtn.addEventListener('click', () => {
        showLayer(5);
        setAmbient(0.03);
    });

    dom.exitBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
    });
}

document.addEventListener('DOMContentLoaded', () => {
    audioSystem = initAudio();
    cacheDom();
    setupParticles();
    bindEvents();
    showLayer(0);
});

let canvasCtx;
let analyserNode;
let waveformAnimationFrameId = null;
let canvas;
const waveformHistory = [];
const HISTORY_LENGTH = 15; // Number of trailing lines, doubled from 7

export function initWaveform(canvasElement, analyser) {
    canvas = canvasElement;
    analyserNode = analyser;
    canvasCtx = canvas.getContext('2d');
    
    // Set initial canvas size and handle resizing
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            canvas.width = entry.contentRect.width;
            canvas.height = entry.contentRect.height;
        }
    });
    resizeObserver.observe(canvasElement);

    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    drawWaveform();
}

function drawWaveform() {
    if (!canvasCtx || !analyserNode) return;

    waveformAnimationFrameId = requestAnimationFrame(drawWaveform);

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteTimeDomainData(dataArray);

    // Add a copy of the current data to the history
    waveformHistory.unshift(new Uint8Array(dataArray));
    if (waveformHistory.length > HISTORY_LENGTH) {
        waveformHistory.pop();
    }

    canvasCtx.fillStyle = '#050505';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    
    canvasCtx.shadowBlur = 8;

    const totalSpread = canvas.height * 0.8; // Lines will be spread across 80% of the canvas height
    const waveAmplitude = (totalSpread / HISTORY_LENGTH) * 2.5; // Amplitude for each wave to reduce overlap. Increased from 1.8 for more "violent" vibration.

    // Draw each historical waveform with decreasing opacity and vertical spread
    waveformHistory.forEach((historyData, index) => {
        // Newest (index 0) is brightest, oldest is faintest
        // Increased the base of the power to make the fade-out less aggressive
        const opacity = Math.pow(0.85, index) * 0.9; 
        
        canvasCtx.lineWidth = index === 0 ? 2.5 : 2;
        canvasCtx.strokeStyle = `rgba(0, 255, 255, ${opacity})`;
        canvasCtx.shadowColor = `rgba(0, 255, 255, ${opacity * 0.7})`;

        canvasCtx.beginPath();

        const sliceWidth = canvas.width * 1.0 / bufferLength;
        
        // Stagger: Add a random horizontal offset to each line, increasing with age.
        const maxStagger = 40; // Increased from 25 for more horizontal variation
        const staggerOffset = (Math.random() - 0.5) * maxStagger * (index / HISTORY_LENGTH);
        let x = staggerOffset;

        // Calculate the vertical offset for this specific line.
        // It's spread from the top to the bottom of the `totalSpread` area.
        // NEW: Add a random vertical offset to make line spacing inconsistent.
        const maxRandomY = 15; // Max pixels for random vertical shift
        const randomYOffset = (Math.random() - 0.5) * maxRandomY * (index / HISTORY_LENGTH);
        const yOffset = (canvas.height - totalSpread) / 2 + (index / (HISTORY_LENGTH - 1)) * totalSpread + randomYOffset;

        for (let i = 0; i < bufferLength; i++) {
            const v = (historyData[i] / 128.0) - 1.0; // Normalize to -1.0 to 1.0

            // Jaggedness: Add random vertical displacement, increasing with age.
            const maxJaggedness = 6; // pixels
            const jaggedness = (Math.random() - 0.5) * maxJaggedness * (index / HISTORY_LENGTH);

            const y = yOffset + (v * waveAmplitude) + jaggedness;

            if (i === 0) {
                canvasCtx.moveTo(x, y);
            } else {
                canvasCtx.lineTo(x, y);
            }

            x += sliceWidth;
        }
        
        // The line now just ends at the right side of the canvas at its current y-level.
        canvasCtx.stroke();
    });
    
    canvasCtx.shadowBlur = 0;
}

export function stopWaveform() {
    if (waveformAnimationFrameId) {
        cancelAnimationFrame(waveformAnimationFrameId);
        waveformAnimationFrameId = null;
    }
}
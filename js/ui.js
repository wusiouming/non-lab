import { resumeAudioContext, loadAndPlaySound, loadAndPlayMixedSignal, enableBinaural } from 'app/audio';
import { engageAutopilot } from 'app/effects';
import { updateBackgroundImage } from 'app/background';

let audioSystem;
let dom;
let buttonMessageTimer = null;
let lastButtonLabel = '';

 // Contemplative prompt choices for the upload button
 const UPLOAD_PROMPTS = [
   "Throw in voice you want to discard",
   "Throw in a relationship you want to discard",
   "Throw in an impulse you want to discard",
   "Throw in an obsession you want to discard"
 ];

function pickRandomUploadPrompt() {
    const i = Math.floor(Math.random() * UPLOAD_PROMPTS.length);
    return UPLOAD_PROMPTS[i];
}

export function initUI(audio) {
    audioSystem = audio;
    dom = {
        uploadButton: document.getElementById('upload-button'),
        fileUploadInput: document.getElementById('file-upload'),
    };
    // Initialize button label with a random prompt
    if (dom.uploadButton) {
        dom.uploadButton.textContent = pickRandomUploadPrompt();
    }

    // Toggle visibility when clicking anywhere on the document
    function toggleUploadButtonVisibility() {
        if (!dom.uploadButton) return;
        const currentlyHidden = dom.uploadButton.style.display === 'none';
        // If showing the button, pick a new random prompt
        if (currentlyHidden) {
            dom.uploadButton.style.display = '';
            dom.uploadButton.textContent = pickRandomUploadPrompt();
        } else {
            dom.uploadButton.style.display = 'none';
        }
    }

    // Prevent document click toggle when interacting with the upload button or file input
    function stopPropagationIfEvent(e) {
        if (e && e.stopPropagation) e.stopPropagation();
    }

    if (dom.uploadButton) {
        // Ensure clicks on the upload button open file dialog and don't toggle visibility
        dom.uploadButton.addEventListener('click', (e) => {
            stopPropagationIfEvent(e);
            if (dom.fileUploadInput) {
                dom.fileUploadInput.click();
            }
        });

        // Also prevent toggling when touch/click starts on the button
        dom.uploadButton.addEventListener('mousedown', stopPropagationIfEvent);
        dom.uploadButton.addEventListener('touchstart', stopPropagationIfEvent);

        // Drag & Drop support on the upload button
        dom.uploadButton.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dom.uploadButton.classList.add('drag-over');
        });
        dom.uploadButton.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Required for drop to work in many browsers
            e.dataTransfer.dropEffect = 'copy';
            dom.uploadButton.classList.add('drag-over');
        });
        dom.uploadButton.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dom.uploadButton.classList.remove('drag-over');
        });
        dom.uploadButton.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            dom.uploadButton.classList.remove('drag-over');
            const dt = e.dataTransfer;
            if (!dt) return;
            const items = dt.files ? Array.from(dt.files) : [];
            if (!items.length) return;

            // Reuse existing upload handler: create a fake event object with target.files
            await handleFileUpload({ target: { files: items } });
        });
    }

    if (dom.fileUploadInput) {
        dom.fileUploadInput.addEventListener('change', handleFileUpload);
        // Prevent the document handler from reacting if the input itself is focused/touched
        dom.fileUploadInput.addEventListener('click', stopPropagationIfEvent);
        dom.fileUploadInput.addEventListener('touchstart', stopPropagationIfEvent);
    }

    // Global click/tap listener toggles upload button visibility
    document.addEventListener('click', (e) => {
        // If click target is the upload button or the file input, don't toggle (already handled)
        const t = e.target;
        if (t === dom.uploadButton || t === dom.fileUploadInput || (t && (t.closest && (t.closest('#upload-button') || t.closest('#file-upload'))))) {
            return;
        }
        toggleUploadButtonVisibility();
    });

    // Also listen for touchend to make it responsive on mobile
    document.addEventListener('touchend', (e) => {
        const t = e.target;
        if (t === dom.uploadButton || t === dom.fileUploadInput || (t && (t.closest && (t.closest('#upload-button') || t.closest('#file-upload'))))) {
            return;
        }
        toggleUploadButtonVisibility();
    }, { passive: true });
}

async function handleFileUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Update background image to a new random URL on each upload
    const newImageUrl = `https://picsum.photos/seed/${Date.now()}-${Math.floor(Math.random() * 1000000)}/1200/900`;
    updateBackgroundImage(newImageUrl);

    resumeAudioContext();
    enableBinaural(true);

    if (files.length === 1) {
        const file = files[0];
        const result = await loadAndPlaySound({
            file,
            description: `User Signal: ${file.name}`,
        });
        handleLoadResult(result);
    } else {
        const result = await loadAndPlayMixedSignal(files);
        handleLoadResult(result);
    }

    // Automatically engage the dive (autopilot modulation)
    startAutopilotDive();

    // Allow re-upload of the same files
    if (dom.fileUploadInput) dom.fileUploadInput.value = '';
}

function handleLoadResult(result) {
    if (!result || result.ok) return;
    showUploadButtonMessage('Unable to read this file. Please use MP3 or MP4.', 3000);
}

function showUploadButtonMessage(message, durationMs = 3000) {
    if (!dom || !dom.uploadButton) return;
    const button = dom.uploadButton;
    if (!lastButtonLabel) lastButtonLabel = button.textContent || '';

    if (button.style.display === 'none') {
        button.style.display = '';
    }

    button.classList.add('error-state');
    button.textContent = message;

    if (buttonMessageTimer) window.clearTimeout(buttonMessageTimer);
    buttonMessageTimer = window.setTimeout(() => {
        if (button.textContent === message) {
            button.textContent = lastButtonLabel || pickRandomUploadPrompt();
        }
        button.classList.remove('error-state');
    }, durationMs);
}

function startAutopilotDive() {
    const makeSlider = () => ({ value: 0 });
    const makeLabel = () => ({ textContent: '' });

    const ui = {
        autopilotButton: {
            classList: { add() {}, remove() {} },
            textContent: '',
        },
        delayTimeSlider: makeSlider(),
        delayTimeValue: makeLabel(),
        delayFeedbackSlider: makeSlider(),
        delayFeedbackValue: makeLabel(),
        distortionAmountSlider: makeSlider(),
        distortionAmountValue: makeLabel(),
        reverbAmountSlider: makeSlider(),
        reverbAmountValue: makeLabel(),
        filterCutoffSlider: makeSlider(),
        filterCutoffValue: makeLabel(),
        filterQSlider: makeSlider(),
        filterQValue: makeLabel(),
        granularMixSlider: makeSlider(),
        granularMixValue: makeLabel(),
        grainSizeSlider: makeSlider(),
        grainSizeValue: makeLabel(),
        grainDensitySlider: makeSlider(),
        grainDensityValue: makeLabel(),
        grainPitchSlider: makeSlider(),
        grainPitchValue: makeLabel(),
        grainSpreadSlider: makeSlider(),
        grainSpreadValue: makeLabel(),
    };

    engageAutopilot({
        nodes: audioSystem.nodes,
        audioContext: audioSystem.audioContext,
        ui,
    });
}

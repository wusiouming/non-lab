let isAutopilotOn = false, autopilotAnimationFrameId = null, autopilotConfig = null;
let isGranularOn = false, granularEngineIntervalId = null;
let granularConfig = {
    audioContext: null, nodes: null, getBuffer: null,
    params: { mix: 0, size: 0.1, density: 10, pitch: 1, spread: 0.1 }
};

// LFO 輔助函式：將重複的數學運算抽出
const lfo = (base, range, t, speed, fn = Math.sin) => base + range * (1 + fn(Math.PI * 2 * t * speed)) / 2;

export const makeDistortionCurve = (amount = 0) => {
    const n_samples = 44100, curve = new Float32Array(n_samples), deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = amount === 0 ? x : (3 + amount) * x * 20 * deg / (Math.PI + amount * Math.abs(x));
    }
    return curve;
};

function granularEngine() {
    const { audioContext: ctx, nodes, getBuffer, params: { size, pitch, spread } } = granularConfig;
    if (!isGranularOn || !ctx || !nodes) return;
    
    const buffer = getBuffer();
    if (!buffer) return;

    const now = ctx.currentTime;
    const offset = Math.random() * (buffer.duration - size);
    const position = Math.max(0, offset + (Math.random() - 0.5) * spread * buffer.duration);

    const grain = ctx.createBufferSource();
    const grainGain = ctx.createGain();

    grain.buffer = buffer;
    grain.playbackRate.value = pitch;
    
    // Envelope 路由設定
    grain.connect(grainGain).connect(nodes.granularGainNode);
    grainGain.connect(grain.playbackRate);

    // Envelope 參數設定
    grainGain.gain.setValueAtTime(0, now);
    grainGain.gain.linearRampToValueAtTime(1, now + size * 0.1);
    grainGain.gain.setValueAtTime(1, now + size * 0.8);
    grainGain.gain.linearRampToValueAtTime(0, now + size);
    
    grain.start(now, Math.min(position, buffer.duration - size));
    grain.stop(now + size);

    grain.onended = () => { grainGain.disconnect(); grain.disconnect(); };
}

export function updateGranularParams(newParams) {
    Object.assign(granularConfig.params, newParams);
    const { mix, density } = granularConfig.params;
    const { nodes, audioContext } = granularConfig;

    if (nodes?.granularGainNode) {
        nodes.granularGainNode.gain.setTargetAtTime(mix, audioContext.currentTime, 0.01);
    }
    
    isGranularOn = mix > 0 && density > 0;

    // 精簡 interval 切換邏輯：清除舊的，若狀態為開啟則建立新的
    if (granularEngineIntervalId) clearInterval(granularEngineIntervalId);
    if (isGranularOn) {
        granularEngineIntervalId = setInterval(granularEngine, 1000 / density);
    }
}

export const initGranular = (config) => Object.assign(granularConfig, config);

function autopilotLoop() {
    if (!isAutopilotOn) return;

    const { nodes, ui, audioContext } = autopilotConfig;
    const t = Date.now() / 3000, gt = Date.now() / 15000, ct = audioContext.currentTime;

    // 更新 UI 與 Audio Node 的輔助函式
    const setParam = (slider, textEl, paramNode, val, formatStr, targetTime = 0.1) => {
        slider.value = val;
        textEl.textContent = formatStr;
        if (paramNode) paramNode.setTargetAtTime(val, ct, targetTime);
    };

    // --- 計算所有 LFO 數值 ---
    const delayT = lfo(0.2, 0.2, t, 0.11);
    const delayF = lfo(0.35, 0.3, t, 0.08);
    const dist = lfo(20, 20, t, 0.05);
    const revMix = lfo(0, 0.4, t, 0.07, Math.cos);
    const filterCut = Math.exp(lfo(Math.log(300), Math.log(8000) - Math.log(300), t, 0.15)); // 對數 LFO
    const filterQ = lfo(1, 9, t, 0.18);
    
    const granMix = lfo(0, 0.35, gt, 0.07);
    const grainSz = lfo(0.002, 0.048, gt, 0.11, Math.cos);
    const grainDen = lfo(10, 30, gt, 0.05);
    const grainPt = lfo(0.8, 0.4, gt, 0.08, Math.cos);
    const grainSp = lfo(0.1, 0.7, gt, 0.06);

    // --- 批次套用更新 ---
    setParam(ui.delayTimeSlider, ui.delayTimeValue, nodes.delayNode.delayTime, delayT, `${delayT.toFixed(2)} s`);
    setParam(ui.delayFeedbackSlider, ui.delayFeedbackValue, nodes.feedbackGainNode.gain, delayF, delayF.toFixed(2));
    setParam(ui.reverbAmountSlider, ui.reverbAmountValue, nodes.reverbWetGain.gain, revMix, revMix.toFixed(2));
    setParam(ui.filterCutoffSlider, ui.filterCutoffValue, nodes.filterNode.frequency, filterCut, `${Math.round(filterCut)} Hz`);
    setParam(ui.filterQSlider, ui.filterQValue, nodes.filterNode.Q, filterQ, filterQ.toFixed(1));

    // Distortion Node 特殊處理 (沒有 setTargetAtTime)
    ui.distortionAmountSlider.value = dist;
    ui.distortionAmountValue.textContent = Math.round(dist);
    nodes.distortionNode.curve = makeDistortionCurve(dist);

    ui.granularMixSlider.value = granMix;
    ui.granularMixValue.textContent = granMix.toFixed(2);
    ui.grainSizeSlider.value = grainSz;
    ui.grainSizeValue.textContent = `${grainSz.toFixed(3)} s`;
    ui.grainDensitySlider.value = grainDen;
    ui.grainDensityValue.textContent = `${Math.round(grainDen)} Hz`;
    ui.grainPitchSlider.value = grainPt;
    ui.grainPitchValue.textContent = `${grainPt.toFixed(2)}x`;
    ui.grainSpreadSlider.value = grainSp;
    ui.grainSpreadValue.textContent = grainSp.toFixed(2);
    
    updateGranularParams({ mix: granMix, size: grainSz, density: grainDen, pitch: grainPt, spread: grainSp });

    autopilotAnimationFrameId = requestAnimationFrame(autopilotLoop);
}

export function engageAutopilot(config) {
    if (isAutopilotOn) return;
    autopilotConfig = config;
    isAutopilotOn = true;
    config.ui.autopilotButton.classList.add('active');
    config.ui.autopilotButton.textContent = 'Disengage Dive';
    autopilotLoop();
}

export function disengageAutopilot() {
    if (!isAutopilotOn) return;
    isAutopilotOn = false;
    cancelAnimationFrame(autopilotAnimationFrameId);
    if (autopilotConfig) {
        autopilotConfig.ui.autopilotButton.classList.remove('active');
        autopilotConfig.ui.autopilotButton.textContent = 'Engage Dive';
        autopilotConfig = null;
    }
}

export const isAutopilotActive = () => isAutopilotOn;
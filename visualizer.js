(() => {
    'use strict';

    const $ = id => document.getElementById(id);

    // ── DOM ──
    const startScreen = $('startScreen');
    const app = $('app');
    const waveCanvas = $('waveCanvas');
    const specCanvas = $('specCanvas');
    const vuCanvas = $('vuCanvas');
    const wCtx = waveCanvas.getContext('2d');
    const sCtx = specCanvas.getContext('2d');
    const vCtx = vuCanvas.getContext('2d');
    const led = $('led');
    const playBtn = $('playBtn');
    const pauseBtn = $('pauseBtn');
    const stopBtn = $('stopBtn');
    const rewBtn = $('rewBtn');
    const ffwBtn = $('ffwBtn');
    const playIcon = $('playIcon');
    const pwrLed = $('pwrLed');
    const recLed = $('recLed');
    const tapeCounter = $('tapeCounter');
    const curTime = $('curTime');
    const durTime = $('durTime');
    const metaTime = $('metaTime');
    const resLabel = $('resLabel');

    const sldRes = $('sldRes'), vR = $('vR');
    const sldGrain = $('sldGrain'), vG = $('vG');
    const sldDecay = $('sldDecay'), vD = $('vD');
    const sldColor = $('sldColor'), vC = $('vC');
    const sldVol = $('sldVol'), vV = $('vV');

    // ── Beats list ──
    const beatsList = $('beatsList');
    const beatCount = $('beatCount');
    let allBeats = [];
    let currentBeat = null;

    // ── Audio ──
    let audioCtx, analyser, source, gainNode;
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.volume = 0.8;
    audio.preservesPitch = false; // Cassette tape effect: pitch shifts with speed
    let isPlaying = false;

    // ── Transport state ──
    const TAPE_FF_RATE = 3.5;
    const TAPE_REW_STEP = 0.4; // seconds per tick for rewind
    const TAPE_REW_INTERVAL = 40; // ms between rewind ticks
    let transportMode = 'stopped'; // stopped | playing | paused | ff | rew
    let rewInterval = null;
    let motorNodes = null; // { noise, filter, whine, whineGain, masterGain }

    let freqData;
    const MAX_BARS = 512;
    const smoothBars = new Float32Array(MAX_BARS);
    const peakBars = new Float32Array(MAX_BARS);

    // ── Waveform peaks ──
    let peaks = [];
    const PEAK_RES = 1024;

    // ── Params ──
    let resolution = 200;
    let grainAmt = 0;
    let decaySpd = 8;
    let colorAmt = 20;
    const PINK = { r: 232, g: 135, b: 154 };

    // ══════════════════════════════════════
    // THEME SYSTEM
    // ══════════════════════════════════════
    let currentTheme = 'minimal';

    const THEMES = {
        minimal: {
            panelBg: '#efece8',
            canvasBg: null, // transparent — CSS panel bg shows through
            vuFace: '#f5f0e6',
            vuText: '#2a2a2a',
            vuBrand: '#b5b1ac',
            vuArc: '#2a2a2a',
            vuAccent: '#E8879A',
            vuNeedle: ['#1a1a1a', '#444', '#1a1a1a'],
            vuPivot: ['#999', '#222'],
            specBase: 55,
            specBg: null,
            wavePlayed: null, // computed from colorAmt
            waveUnplayed: '#d2cec9',
            wavePlayhead: '#E8879A',
            phosphor: false,
            ledSegments: false,
        },
        walnut: {
            panelBg: '#2a2520',
            canvasBg: '#1e1a16',
            vuFace: '#2a2520',
            vuText: '#e4d9d1',
            vuBrand: '#6a5f55',
            vuArc: '#a89a8c',
            vuAccent: '#f0c040',
            vuNeedle: ['#e4d9d1', '#c9b2a3', '#e4d9d1'],
            vuPivot: ['#a89a8c', '#3a2317'],
            specBase: 200,
            specBg: '#1e1a16',
            wavePlayed: '#c9b2a3',
            waveUnplayed: '#4a423a',
            wavePlayhead: '#f0c040',
            phosphor: true,
            ledSegments: true,
        },
        cream: {
            panelBg: '#f4decb',
            canvasBg: '#f0d8c2',
            vuFace: '#f4decb',
            vuText: '#3a2317',
            vuBrand: '#a87e62',
            vuArc: '#3a2317',
            vuAccent: '#d44a2e',
            vuNeedle: ['#3a2317', '#6b4525', '#3a2317'],
            vuPivot: ['#a87e62', '#3a2317'],
            specBase: 80,
            specBg: null,
            wavePlayed: '#926548',
            waveUnplayed: '#c9b2a3',
            wavePlayhead: '#d44a2e',
            phosphor: false,
            ledSegments: false,
        },
        brushed: {
            panelBg: '#b8b8b8',
            canvasBg: '#222225',
            vuFace: '#d5d5d0',
            vuText: '#222',
            vuBrand: '#888',
            vuArc: '#333',
            vuAccent: '#4fc3f7',
            vuNeedle: ['#222', '#555', '#222'],
            vuPivot: ['#bbb', '#444'],
            specBase: 70,
            specBg: '#1a1a1e',
            wavePlayed: '#8ab4c4',
            waveUnplayed: '#444',
            wavePlayhead: '#4fc3f7',
            phosphor: true,
            ledSegments: true,
        },
    };

    function setTheme(name) {
        currentTheme = name;
        document.documentElement.setAttribute('data-theme', name === 'minimal' ? '' : name);
        // update active button
        document.querySelectorAll('.theme-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.t === name);
        });
        // force canvas redraw with new colors
        resize();
    }

    // Theme switch listeners
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => setTheme(btn.dataset.t));
    });

    function T() { return THEMES[currentTheme]; }

    // ── Grain texture ──
    let grainTex = null;
    function makeGrain() {
        if (grainTex) return;
        grainTex = document.createElement('canvas');
        grainTex.width = grainTex.height = 256;
        const g = grainTex.getContext('2d');
        const d = g.createImageData(256, 256);
        for (let i = 0; i < d.data.length; i += 4) {
            const v = Math.random() * 255;
            d.data[i] = v; d.data[i + 1] = v; d.data[i + 2] = v; d.data[i + 3] = 30;
        }
        g.putImageData(d, 0, 0);
    }

    // ══════════════════════════════════════
    // LED DOT MATRIX
    // ══════════════════════════════════════
    const MATRIX_FONT = {
        ' ':[0,0,0,0,0],
        '-':[0,0b00100,0b00100,0b00100,0],
        '.':[0,0,0,0,0b00100],
        '/':[0b00001,0b00010,0b00100,0b01000,0b10000],
        '0':[0b01110,0b10001,0b10001,0b10001,0b01110],
        '1':[0b00100,0b01100,0b00100,0b00100,0b01110],
        '2':[0b01110,0b10001,0b00110,0b01000,0b11111],
        '3':[0b01110,0b10001,0b00110,0b10001,0b01110],
        '4':[0b10010,0b10010,0b11111,0b00010,0b00010],
        '5':[0b11111,0b10000,0b11110,0b00001,0b11110],
        '6':[0b01110,0b10000,0b11110,0b10001,0b01110],
        '7':[0b11111,0b00001,0b00010,0b00100,0b00100],
        '8':[0b01110,0b10001,0b01110,0b10001,0b01110],
        '9':[0b01110,0b10001,0b01111,0b00001,0b01110],
        'A':[0b01110,0b10001,0b11111,0b10001,0b10001],
        'B':[0b11110,0b10001,0b11110,0b10001,0b11110],
        'C':[0b01110,0b10001,0b10000,0b10001,0b01110],
        'D':[0b11110,0b10001,0b10001,0b10001,0b11110],
        'E':[0b11111,0b10000,0b11110,0b10000,0b11111],
        'F':[0b11111,0b10000,0b11110,0b10000,0b10000],
        'G':[0b01110,0b10000,0b10011,0b10001,0b01110],
        'H':[0b10001,0b10001,0b11111,0b10001,0b10001],
        'I':[0b01110,0b00100,0b00100,0b00100,0b01110],
        'J':[0b00111,0b00010,0b00010,0b10010,0b01100],
        'K':[0b10010,0b10100,0b11000,0b10100,0b10010],
        'L':[0b10000,0b10000,0b10000,0b10000,0b11111],
        'M':[0b10001,0b11011,0b10101,0b10001,0b10001],
        'N':[0b10001,0b11001,0b10101,0b10011,0b10001],
        'O':[0b01110,0b10001,0b10001,0b10001,0b01110],
        'P':[0b11110,0b10001,0b11110,0b10000,0b10000],
        'Q':[0b01110,0b10001,0b10101,0b10010,0b01101],
        'R':[0b11110,0b10001,0b11110,0b10010,0b10001],
        'S':[0b01111,0b10000,0b01110,0b00001,0b11110],
        'T':[0b11111,0b00100,0b00100,0b00100,0b00100],
        'U':[0b10001,0b10001,0b10001,0b10001,0b01110],
        'V':[0b10001,0b10001,0b10001,0b01010,0b00100],
        'W':[0b10001,0b10001,0b10101,0b11011,0b10001],
        'X':[0b10001,0b01010,0b00100,0b01010,0b10001],
        'Y':[0b10001,0b01010,0b00100,0b00100,0b00100],
        'Z':[0b11111,0b00010,0b00100,0b01000,0b11111],
        '_':[0,0,0,0,0b11111],
        '#':[0b01010,0b11111,0b01010,0b11111,0b01010]
    };
    const MATRIX_ROWS = 7, MATRIX_COLS = 5;
    const matrixTrack = $('matrixTrack');

    function matrixCharCols(ch) {
        const g = MATRIX_FONT[ch.toUpperCase()] || MATRIX_FONT[' '];
        const cols = [];
        for (let c = 0; c < MATRIX_COLS; c++) {
            const col = [];
            for (let r = 0; r < MATRIX_ROWS; r++) {
                if (r === 0 || r === 6) { col.push(false); continue; }
                col.push(!!(g[r - 1] & (1 << (4 - c))));
            }
            cols.push(col);
        }
        // spacer column between characters
        cols.push(new Array(MATRIX_ROWS).fill(false));
        return cols;
    }

    function updateMarquee(text) {
        if (!matrixTrack) return;
        const allCols = [];
        for (const ch of text) {
            allCols.push(...matrixCharCols(ch));
        }
        // duplicate for seamless loop
        const full = [...allCols, ...allCols];
        let html = '';
        full.forEach(col => {
            html += '<div class="matrix-col">';
            col.forEach(on => {
                html += '<div class="matrix-dot' + (on ? ' on' : '') + '"></div>';
            });
            html += '</div>';
        });
        matrixTrack.innerHTML = html;
        const totalW = full.length * 6; // 4px dot + 2px gap
        matrixTrack.style.width = totalW + 'px';
        matrixTrack.style.animationDuration = (allCols.length * 6 / 40) + 's';
    }

    // Default marquee text
    updateMarquee('   CPG_BEATS   ---   PRODUCER   ---   ');

    // ══════════════════════════════════════
    // AUDIO EFFECTS (rocker switches)
    // ══════════════════════════════════════
    let fxNodes = null; // will be initialized in initAudio
    const fxState = { lofi: false, bass: false, vinyl: false, slow: false, reverb: false, mono: false };

    function createReverbIR(ctx, duration, decay) {
        const rate = ctx.sampleRate;
        const length = rate * duration;
        const impulse = ctx.createBuffer(2, length, rate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }
        return impulse;
    }

    function initFxNodes() {
        if (!audioCtx) return;

        // LO-FI: lowpass filter
        const lofi = audioCtx.createBiquadFilter();
        lofi.type = 'lowpass';
        lofi.frequency.value = 3000;
        lofi.Q.value = 0.7;

        // BASS+: peaking EQ at 80Hz
        const bass = audioCtx.createBiquadFilter();
        bass.type = 'peaking';
        bass.frequency.value = 80;
        bass.gain.value = 12;
        bass.Q.value = 1.0;

        // REVERB: convolver with generated IR
        const reverb = audioCtx.createConvolver();
        reverb.buffer = createReverbIR(audioCtx, 2.0, 2.5);
        const reverbWet = audioCtx.createGain();
        reverbWet.gain.value = 0.35;
        const reverbDry = audioCtx.createGain();
        reverbDry.gain.value = 1.0;

        // MONO: channel splitter/merger to sum L+R
        const monoSplitter = audioCtx.createChannelSplitter(2);
        const monoMerger = audioCtx.createChannelMerger(2);
        const monoGainL = audioCtx.createGain();
        monoGainL.gain.value = 0.5;
        const monoGainR = audioCtx.createGain();
        monoGainR.gain.value = 0.5;

        // VINYL: crackle noise source (created on toggle)
        // We keep a reference holder
        const vinylGain = audioCtx.createGain();
        vinylGain.gain.value = 0.06;
        const vinylFilter = audioCtx.createBiquadFilter();
        vinylFilter.type = 'highpass';
        vinylFilter.frequency.value = 800;

        fxNodes = {
            lofi,
            bass,
            reverb, reverbWet, reverbDry,
            monoSplitter, monoMerger, monoGainL, monoGainR,
            vinylGain, vinylFilter,
            vinylSource: null
        };
    }

    function rebuildFxChain() {
        if (!audioCtx || !fxNodes) return;
        // Disconnect analyser output and rebuild chain
        // Chain: analyser → [effects] → gainNode → destination
        try { analyser.disconnect(); } catch(e) {}
        try { fxNodes.lofi.disconnect(); } catch(e) {}
        try { fxNodes.bass.disconnect(); } catch(e) {}
        try { fxNodes.reverb.disconnect(); } catch(e) {}
        try { fxNodes.reverbWet.disconnect(); } catch(e) {}
        try { fxNodes.reverbDry.disconnect(); } catch(e) {}
        try { fxNodes.monoSplitter.disconnect(); } catch(e) {}
        try { fxNodes.monoMerger.disconnect(); } catch(e) {}
        try { fxNodes.monoGainL.disconnect(); } catch(e) {}
        try { fxNodes.monoGainR.disconnect(); } catch(e) {}

        // Build chain: start from analyser, end at gainNode
        let currentNode = analyser;

        if (fxState.lofi) {
            currentNode.connect(fxNodes.lofi);
            currentNode = fxNodes.lofi;
        }
        if (fxState.bass) {
            currentNode.connect(fxNodes.bass);
            currentNode = fxNodes.bass;
        }
        if (fxState.reverb) {
            // Parallel dry/wet
            currentNode.connect(fxNodes.reverbDry);
            currentNode.connect(fxNodes.reverb);
            fxNodes.reverb.connect(fxNodes.reverbWet);
            if (fxState.mono) {
                fxNodes.reverbDry.connect(fxNodes.monoSplitter);
                fxNodes.reverbWet.connect(fxNodes.monoSplitter);
            } else {
                fxNodes.reverbDry.connect(gainNode);
                fxNodes.reverbWet.connect(gainNode);
            }
            if (!fxState.mono) {
                return; // chain complete
            }
            // mono processes after reverb merge — handled below
            currentNode = fxNodes.monoSplitter;
            fxNodes.monoSplitter.connect(fxNodes.monoGainL, 0);
            fxNodes.monoSplitter.connect(fxNodes.monoGainL, 1);
            fxNodes.monoGainL.connect(fxNodes.monoMerger, 0, 0);
            fxNodes.monoGainL.connect(fxNodes.monoMerger, 0, 1);
            fxNodes.monoMerger.connect(gainNode);
            return;
        }
        if (fxState.mono) {
            currentNode.connect(fxNodes.monoSplitter);
            fxNodes.monoSplitter.connect(fxNodes.monoGainL, 0);
            fxNodes.monoSplitter.connect(fxNodes.monoGainL, 1);
            fxNodes.monoGainL.connect(fxNodes.monoMerger, 0, 0);
            fxNodes.monoGainL.connect(fxNodes.monoMerger, 0, 1);
            fxNodes.monoMerger.connect(gainNode);
            return;
        }

        // Default: direct connection
        currentNode.connect(gainNode);
    }

    function toggleFx(name) {
        fxState[name] = !fxState[name];
        if (!audioCtx || !fxNodes) return;

        if (name === 'slow') {
            audio.playbackRate = fxState.slow ? 0.85 : (transportMode === 'ff' ? TAPE_FF_RATE : 1.0);
            return;
        }
        if (name === 'vinyl') {
            if (fxState.vinyl) {
                // Start crackle noise
                const bufSize = 2 * audioCtx.sampleRate;
                const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
                const data = noiseBuf.getChannelData(0);
                for (let i = 0; i < bufSize; i++) {
                    data[i] = (Math.random() > 0.97 ? (Math.random() * 2 - 1) : 0) * 0.5;
                    // add subtle continuous crackle
                    if (Math.random() > 0.8) data[i] += (Math.random() * 2 - 1) * 0.1;
                }
                const src = audioCtx.createBufferSource();
                src.buffer = noiseBuf;
                src.loop = true;
                src.connect(fxNodes.vinylFilter);
                fxNodes.vinylFilter.connect(fxNodes.vinylGain);
                fxNodes.vinylGain.connect(gainNode);
                src.start();
                fxNodes.vinylSource = src;
            } else {
                // Stop crackle
                if (fxNodes.vinylSource) {
                    try { fxNodes.vinylSource.stop(); } catch(e) {}
                    fxNodes.vinylSource = null;
                }
                try { fxNodes.vinylGain.disconnect(); } catch(e) {}
            }
            return;
        }

        // For lofi, bass, reverb, mono — rebuild the chain
        rebuildFxChain();
    }

    // ── Canvas resize ──
    function sizeCanvas(cvs) {
        const dpr = devicePixelRatio;
        const r = cvs.getBoundingClientRect();
        if (r.width < 1) return;
        cvs.width = r.width * dpr;
        cvs.height = r.height * dpr;
        cvs.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function resize() { sizeCanvas(waveCanvas); sizeCanvas(specCanvas); sizeCanvas(vuCanvas); }
    window.addEventListener('resize', resize);

    // ── Init audio ──
    function initAudio() {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.7;
        gainNode = audioCtx.createGain();
        gainNode.gain.value = audio.volume;
        source = audioCtx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        freqData = new Uint8Array(analyser.frequencyBinCount);
        timeData = new Float32Array(analyser.fftSize);

        // Initialize audio effects nodes
        initFxNodes();

        loadPeaks();
    }

    // ── Decode waveform ──
    async function loadPeaks() {
        try {
            const res = await fetch(audio.src);
            const buf = await res.arrayBuffer();
            const ab = await audioCtx.decodeAudioData(buf);
            const ch = ab.getChannelData(0);
            const n = ch.length;
            const step = Math.floor(n / PEAK_RES);
            peaks = [];
            for (let i = 0; i < PEAK_RES; i++) {
                let mx = 0;
                for (let j = 0; j < step; j++) {
                    const v = Math.abs(ch[i * step + j]);
                    if (v > mx) mx = v;
                }
                peaks.push(mx);
            }
            console.log('[peaks] loaded', peaks.length, 'peaks, max:', Math.max(...peaks).toFixed(3));
        } catch (e) {
            console.warn('[peaks] decode failed, generating from realtime data:', e);
            // Fallback: generate approximate peaks from audio element duration
            // Will be replaced by realtime data in drawWave
            peaks = [];
            for (let i = 0; i < PEAK_RES; i++) {
                peaks.push(0.15 + Math.random() * 0.35);
            }
        }
    }

    // ── VU Meter state ──
    const vu = { value: -40, velocity: 0, peak: -40, peakHold: 0 };
    let timeData;

    // ── Color helpers ──
    function barColor(baseGrey, t) {
        const r = Math.round(baseGrey + (PINK.r - baseGrey) * t);
        const g = Math.round(baseGrey + (PINK.g - baseGrey) * t);
        const b = Math.round(baseGrey + (PINK.b - baseGrey) * t);
        return `rgb(${r},${g},${b})`;
    }

    // ── Phosphor glow effect ──
    function applyPhosphor(ctx, w, h) {
        const theme = T();
        if (!theme.phosphor) return;
        // subtle green/amber phosphor afterglow
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.03;
        ctx.fillStyle = currentTheme === 'walnut' ? '#f0c040' : '#4fc3f7';
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
    }

    // ══════════════════════════════════════
    // RENDER WAVEFORM
    // ══════════════════════════════════════
    function drawWave() {
        const dpr = devicePixelRatio;
        const w = waveCanvas.width / dpr;
        const h = waveCanvas.height / dpr;
        if (w < 1) return;

        const theme = T();
        wCtx.clearRect(0, 0, w, h);
        if (!peaks.length) return;

        const bars = resolution;
        const bw = w / bars;
        const gap = Math.max(0.5, bw * 0.15);
        const bw2 = bw - gap;
        const prog = audio.duration ? audio.currentTime / audio.duration : 0;
        const ppb = peaks.length / bars;
        const t = colorAmt / 100;
        let playedColor;
        if (theme.wavePlayed && t < 0.01) {
            playedColor = theme.wavePlayed;
        } else if (theme.wavePlayed) {
            // mix wavePlayed base with pink accent via colorAmt
            const base = theme.wavePlayed;
            const br = parseInt(base.slice(1,3),16), bg = parseInt(base.slice(3,5),16), bb = parseInt(base.slice(5,7),16);
            const mr = Math.round(br + (PINK.r - br) * t);
            const mg = Math.round(bg + (PINK.g - bg) * t);
            const mb = Math.round(bb + (PINK.b - bb) * t);
            playedColor = `rgb(${mr},${mg},${mb})`;
        } else {
            playedColor = barColor(theme.specBase, t);
        }

        for (let i = 0; i < bars; i++) {
            let pk = 0;
            const s = Math.floor(i * ppb);
            const e = Math.floor((i + 1) * ppb);
            for (let j = s; j < e && j < peaks.length; j++) {
                if (peaks[j] > pk) pk = peaks[j];
            }
            const bh = pk * h * 0.88;
            const x = i * bw + gap / 2;
            const y = (h - bh) / 2;
            const played = (i / bars) < prog;

            wCtx.fillStyle = played ? playedColor : theme.waveUnplayed;
            wCtx.fillRect(x, y, Math.max(0.5, bw2), bh);
        }

        // Playhead
        if (audio.duration) {
            wCtx.fillStyle = theme.wavePlayhead;
            wCtx.fillRect(Math.round(prog * w) - 1, 0, 2, h);
        }

        applyPhosphor(wCtx, w, h);

        // Grain
        if (grainAmt > 0) {
            makeGrain();
            wCtx.globalAlpha = grainAmt * 0.003;
            wCtx.fillStyle = wCtx.createPattern(grainTex, 'repeat');
            wCtx.fillRect(0, 0, w, h);
            wCtx.globalAlpha = 1;
        }
    }

    // ══════════════════════════════════════
    // RENDER SPECTRUM
    // ══════════════════════════════════════
    function drawSpec() {
        const dpr = devicePixelRatio;
        const w = specCanvas.width / dpr;
        const h = specCanvas.height / dpr;
        if (w < 1) return;

        const theme = T();

        // background
        sCtx.fillStyle = theme.specBg || theme.canvasBg || theme.panelBg;
        sCtx.fillRect(0, 0, w, h);

        if (analyser && isPlaying) analyser.getByteFrequencyData(freqData);

        const bars = Math.min(resolution, 200);
        const bw = w / bars;
        const gap = Math.max(0.5, bw * 0.15);
        const bw2 = bw - gap;
        const decay = 0.995 - decaySpd * 0.015;
        const bc = analyser ? analyser.frequencyBinCount : 1024;
        const binsPerBar = Math.max(1, Math.floor(bc * 0.55 / bars));
        const t = colorAmt / 100;

        for (let i = 0; i < bars; i++) {
            let sum = 0;
            if (freqData && isPlaying) {
                for (let j = 0; j < binsPerBar; j++) {
                    const idx = i * binsPerBar + j;
                    if (idx < freqData.length) sum += freqData[idx];
                }
            }
            const raw = (freqData && isPlaying) ? sum / binsPerBar / 255 : 0;

            if (raw > smoothBars[i]) smoothBars[i] = raw;
            else smoothBars[i] *= decay;
            if (smoothBars[i] < 0.002) smoothBars[i] = 0;

            if (smoothBars[i] > peakBars[i]) peakBars[i] = smoothBars[i];
            else peakBars[i] *= 0.995;
            if (peakBars[i] < 0.002) peakBars[i] = 0;

            const val = smoothBars[i];
            const bh = val * h * 0.92;
            const x = i * bw + gap / 2;

            if (theme.ledSegments) {
                // LED bar meter style: segmented bars with color zones
                const segments = Math.ceil(bh / 4);
                const segH = 3;
                const segGap = 1;
                for (let s = 0; s < segments; s++) {
                    const sy = h - (s * (segH + segGap)) - segH;
                    const ratio = s / (h / (segH + segGap));
                    let segColor;
                    if (ratio > 0.85) segColor = theme.vuAccent; // hot zone
                    else if (ratio > 0.65) segColor = currentTheme === 'walnut' ? '#f0c040' : '#4fc3f7';
                    else segColor = currentTheme === 'walnut' ? '#a89a8c' : '#8ab4c4';
                    // apply color tint
                    if (t > 0.1) {
                        const mixR = Math.round(parseInt(segColor.slice(1,3)||'aa',16) * (1-t*0.3) + PINK.r * t * 0.3);
                        const mixG = Math.round(parseInt(segColor.slice(3,5)||'aa',16) * (1-t*0.3) + PINK.g * t * 0.3);
                        const mixB = Math.round(parseInt(segColor.slice(5,7)||'aa',16) * (1-t*0.3) + PINK.b * t * 0.3);
                        segColor = `rgb(${mixR},${mixG},${mixB})`;
                    }
                    sCtx.fillStyle = segColor;
                    sCtx.fillRect(x, sy, Math.max(0.5, bw2), segH);
                }
            } else {
                // Standard solid bars
                const activeColor = barColor(theme.specBase, t);
                sCtx.fillStyle = activeColor;
                sCtx.fillRect(x, h - bh, Math.max(0.5, bw2), bh);
            }

            // Peak hold line
            const peakH = peakBars[i] * h * 0.92;
            if (peakH > 2) {
                sCtx.fillStyle = t > 0.1
                    ? `rgba(232,135,154,${0.4 + t * 0.4})`
                    : (theme.ledSegments ? theme.vuAccent : 'rgba(100,100,100,0.5)');
                sCtx.fillRect(x, h - peakH, Math.max(0.5, bw2), theme.ledSegments ? 2 : 1.5);
            }
        }

        applyPhosphor(sCtx, w, h);

        // Grain
        if (grainAmt > 0) {
            makeGrain();
            sCtx.globalAlpha = grainAmt * 0.003;
            sCtx.fillStyle = sCtx.createPattern(grainTex, 'repeat');
            sCtx.fillRect(0, 0, w, h);
            sCtx.globalAlpha = 1;
        }
    }

    // ══════════════════════════════════════
    // VU METER
    // ══════════════════════════════════════
    function drawVU() {
        const dpr = devicePixelRatio;
        const w = vuCanvas.width / dpr;
        const h = vuCanvas.height / dpr;
        if (w < 1) return;
        vCtx.clearRect(0, 0, w, h);

        const theme = T();

        // ── RMS level → dB ──
        let rms = 0;
        if (analyser && isPlaying) {
            analyser.getFloatTimeDomainData(timeData);
            let sum = 0;
            for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
            rms = Math.sqrt(sum / timeData.length);
        }
        const dbRaw = rms > 0.0001 ? 20 * Math.log10(rms) + 3 : -40;
        const targetDb = Math.max(-40, Math.min(5, dbRaw));

        // ── Spring-damper needle physics ──
        const force = (targetDb - vu.value) * 0.08;
        vu.velocity += force;
        vu.velocity *= 0.82;
        vu.value += vu.velocity;
        vu.value = Math.max(-40, Math.min(5, vu.value));

        // Peak hold
        if (vu.value > vu.peak) { vu.peak = vu.value; vu.peakHold = 60; }
        else if (vu.peakHold > 0) vu.peakHold--;
        else vu.peak += (-40 - vu.peak) * 0.04;

        // ── Geometry ──
        const cx = w / 2;
        const pivotY = h * 1.35;
        const radius = Math.min(w * 0.44, h * 0.85);
        const minAngle = Math.PI * 1.18;
        const maxAngle = Math.PI * 1.82;
        const range = maxAngle - minAngle;

        const dbPositions = {
            '-20': 0.00, '-10': 0.18, '-7': 0.30, '-5': 0.40,
            '-3': 0.52, '-1': 0.65, '0': 0.73,
            '1': 0.81, '2': 0.88, '3': 0.95
        };

        function dbToAngle(db) {
            const keys = [-20, -10, -7, -5, -3, -1, 0, 1, 2, 3];
            if (db <= -20) return minAngle;
            if (db >= 3) return minAngle + range * 0.95;
            for (let i = 0; i < keys.length - 1; i++) {
                if (db >= keys[i] && db <= keys[i + 1]) {
                    const lo = dbPositions[keys[i].toString()];
                    const hi = dbPositions[keys[i + 1].toString()];
                    const frac = (db - keys[i]) / (keys[i + 1] - keys[i]);
                    return minAngle + range * (lo + (hi - lo) * frac);
                }
            }
            return minAngle;
        }

        const marks = [
            [-20, '20'], [-10, '10'], [-7, '7'], [-5, '5'],
            [-3, '3'], [-1, '1'], [0, '0'], [1, '1'], [2, '2'], [3, '3']
        ];

        // ── Background ──
        vCtx.fillStyle = theme.vuFace;
        vCtx.fillRect(0, 0, w, h);

        // ── Scale arc — normal zone ──
        const arcW = Math.max(2, w * 0.012);
        vCtx.beginPath();
        vCtx.arc(cx, pivotY, radius, dbToAngle(-20), dbToAngle(0), false);
        vCtx.strokeStyle = theme.vuArc;
        vCtx.lineWidth = arcW;
        vCtx.lineCap = 'round';
        vCtx.stroke();

        // ── Scale arc — accent zone ──
        vCtx.beginPath();
        vCtx.arc(cx, pivotY, radius, dbToAngle(0), dbToAngle(3), false);
        vCtx.strokeStyle = theme.vuAccent;
        vCtx.lineWidth = arcW;
        vCtx.stroke();
        vCtx.lineCap = 'butt';

        // ── Tick marks + labels ──
        const tickFont = Math.max(7, Math.min(13, w * 0.04));
        vCtx.textBaseline = 'middle';

        marks.forEach(([db, label]) => {
            const a = dbToAngle(db);
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            const isHot = db >= 0;
            const isMajor = db === -20 || db === -10 || db === -5 || db === -3 || db === 0;
            const tickLen = isMajor ? Math.max(6, w * 0.04) : Math.max(4, w * 0.025);
            const tickW = isMajor ? Math.max(1.5, w * 0.005) : Math.max(1, w * 0.003);

            const innerR = radius;
            const outerR = radius + tickLen;
            vCtx.beginPath();
            vCtx.moveTo(cx + cos * innerR, pivotY + sin * innerR);
            vCtx.lineTo(cx + cos * outerR, pivotY + sin * outerR);
            vCtx.strokeStyle = isHot ? theme.vuAccent : theme.vuText;
            vCtx.lineWidth = tickW;
            vCtx.stroke();

            const labelR = outerR + Math.max(6, w * 0.03);
            vCtx.font = `700 ${tickFont}px 'Space Mono', monospace`;
            vCtx.fillStyle = isHot ? theme.vuAccent : theme.vuText;
            vCtx.textAlign = 'center';
            vCtx.fillText(label, cx + cos * labelR, pivotY + sin * labelR);
        });

        // ── Minor ticks ──
        const minorDbs = [-15, -8.5, -6, -4, -2, -0.5, 0.5, 1.5, 2.5];
        minorDbs.forEach(db => {
            const a = dbToAngle(db);
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            const isHot = db >= 0;
            const tickLen = Math.max(3, w * 0.018);
            vCtx.beginPath();
            vCtx.moveTo(cx + cos * radius, pivotY + sin * radius);
            vCtx.lineTo(cx + cos * (radius + tickLen), pivotY + sin * (radius + tickLen));
            vCtx.strokeStyle = isHot
                ? (theme.vuAccent + '73')
                : (theme.vuText === '#2a2a2a' ? 'rgba(42,42,42,0.3)' :
                   theme.vuText === '#e4d9d1' ? 'rgba(228,217,209,0.3)' :
                   'rgba(0,0,0,0.3)');
            vCtx.lineWidth = Math.max(0.8, w * 0.002);
            vCtx.stroke();
        });

        // ── Plus / Minus signs ──
        const signFont = Math.max(9, w * 0.045);
        vCtx.font = `700 ${signFont}px 'Space Mono', monospace`;
        vCtx.textAlign = 'center';
        const labelOuter = radius + Math.max(6, w * 0.04) + Math.max(6, w * 0.03) + Math.max(6, w * 0.03);
        const minusA = dbToAngle(-16);
        const plusA = dbToAngle(2.8);
        vCtx.fillStyle = theme.vuText;
        vCtx.fillText('−', cx + Math.cos(minusA) * labelOuter, pivotY + Math.sin(minusA) * labelOuter);
        vCtx.fillStyle = theme.vuAccent;
        vCtx.fillText('+', cx + Math.cos(plusA) * labelOuter, pivotY + Math.sin(plusA) * labelOuter);

        // ── VU label ──
        const vuFont = Math.max(11, w * 0.065);
        vCtx.font = `700 ${vuFont}px 'Bebas Neue', sans-serif`;
        vCtx.fillStyle = theme.vuText;
        vCtx.textAlign = 'center';
        vCtx.fillText('VU', cx, pivotY - radius * 0.35);

        // ── Brand ──
        const brandFont = Math.max(6, w * 0.028);
        vCtx.font = `400 ${brandFont}px 'Space Mono', monospace`;
        vCtx.fillStyle = theme.vuBrand;
        vCtx.fillText('CPG_BEATS', cx, pivotY - radius * 0.18);

        // ── Needle shadow ──
        const needleAngle = dbToAngle(vu.value);
        vCtx.save();
        vCtx.translate(cx + 1.5, pivotY + 1.5);
        vCtx.rotate(needleAngle);
        vCtx.beginPath();
        vCtx.moveTo(0, -w * 0.004);
        vCtx.lineTo(radius * 0.95, 0);
        vCtx.lineTo(0, w * 0.004);
        vCtx.closePath();
        vCtx.fillStyle = 'rgba(0,0,0,0.15)';
        vCtx.fill();
        vCtx.restore();

        // ── Needle ──
        vCtx.save();
        vCtx.translate(cx, pivotY);
        vCtx.rotate(needleAngle);
        vCtx.beginPath();
        vCtx.moveTo(0, -w * 0.005);
        vCtx.lineTo(radius * 0.95, 0);
        vCtx.lineTo(0, w * 0.005);
        vCtx.closePath();
        const needleGrad = vCtx.createLinearGradient(0, -w * 0.01, 0, w * 0.01);
        needleGrad.addColorStop(0, theme.vuNeedle[0]);
        needleGrad.addColorStop(0.5, theme.vuNeedle[1]);
        needleGrad.addColorStop(1, theme.vuNeedle[2]);
        vCtx.fillStyle = needleGrad;
        vCtx.fill();
        vCtx.restore();

        // ── Peak needle (thin accent) ──
        if (vu.peak > -35) {
            const peakAngle = dbToAngle(vu.peak);
            vCtx.save();
            vCtx.translate(cx, pivotY);
            vCtx.rotate(peakAngle);
            vCtx.beginPath();
            vCtx.moveTo(radius * 0.4, 0);
            vCtx.lineTo(radius * 0.92, 0);
            vCtx.strokeStyle = theme.vuAccent + '73';
            vCtx.lineWidth = Math.max(0.8, w * 0.003);
            vCtx.stroke();
            vCtx.restore();
        }

        // ── Pivot screw ──
        const pivotR = Math.max(4, w * 0.022);
        vCtx.beginPath();
        vCtx.arc(cx, pivotY, pivotR, 0, Math.PI * 2);
        const pivGrad = vCtx.createRadialGradient(cx - 1, pivotY - 1, 1, cx, pivotY, pivotR);
        pivGrad.addColorStop(0, theme.vuPivot[0]);
        pivGrad.addColorStop(1, theme.vuPivot[1]);
        vCtx.fillStyle = pivGrad;
        vCtx.fill();

        // ── Pivot slot ──
        vCtx.beginPath();
        vCtx.moveTo(cx - pivotR * 0.6, pivotY);
        vCtx.lineTo(cx + pivotR * 0.6, pivotY);
        vCtx.strokeStyle = currentTheme === 'walnut' ? '#111' : '#111';
        vCtx.lineWidth = Math.max(0.8, w * 0.003);
        vCtx.stroke();
    }

    // ── Tape counter update ──
    function updateTapeCounter() {
        if (!audio.duration || !isFinite(audio.duration)) {
            tapeCounter.textContent = '000';
            return;
        }
        const pct = audio.currentTime / audio.duration;
        const count = Math.floor(pct * 999);
        tapeCounter.textContent = String(count).padStart(3, '0');
    }

    // ── Loop ──
    function render() {
        drawWave();
        drawSpec();
        drawVU();
        updateTapeCounter();
        requestAnimationFrame(render);
    }

    // ══════════════════════════════════════
    // TAPE MOTOR SOUND (synthesized)
    // ══════════════════════════════════════
    function startMotorSound() {
        if (!audioCtx || motorNodes) return;

        // Brown noise for mechanical rumble
        const bufSize = 2 * audioCtx.sampleRate;
        const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
        const out = noiseBuf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < bufSize; i++) {
            const w = Math.random() * 2 - 1;
            out[i] = (last + 0.02 * w) / 1.02;
            last = out[i];
            out[i] *= 3.5;
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = noiseBuf;
        noise.loop = true;

        // Bandpass → motor hum
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 450;
        filter.Q.value = 1.5;

        // High-pitched whine
        const whine = audioCtx.createOscillator();
        whine.type = 'sawtooth';
        whine.frequency.value = 900;
        const whineGain = audioCtx.createGain();
        whineGain.gain.value = 0.03;

        // Master gain for motor
        const masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
        masterGain.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.2);

        noise.connect(filter);
        filter.connect(masterGain);
        whine.connect(whineGain);
        whineGain.connect(masterGain);
        masterGain.connect(gainNode || audioCtx.destination);

        noise.start();
        whine.start();

        motorNodes = { noise, filter, whine, whineGain, masterGain };
    }

    function stopMotorSound() {
        if (!motorNodes || !audioCtx) return;
        const { noise, whine, masterGain } = motorNodes;
        masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.15);
        setTimeout(() => {
            try { noise.stop(); } catch (e) {}
            try { whine.stop(); } catch (e) {}
        }, 200);
        motorNodes = null;
    }

    // ══════════════════════════════════════
    // TRANSPORT CONTROLS
    // ══════════════════════════════════════
    function updateTransportUI() {
        // Clear all active states
        [playBtn, pauseBtn, stopBtn, rewBtn, ffwBtn].forEach(b => b.classList.remove('active'));

        // Play icon state
        playIcon.className = 'd-icon d-play';
        if (transportMode === 'playing' || transportMode === 'ff') {
            playIcon.classList.add('is-playing');
        }

        // LED states
        pwrLed.className = 'deck-led';
        recLed.className = 'deck-led';
        led.className = 'led';

        switch (transportMode) {
            case 'playing':
                playBtn.classList.add('active');
                pwrLed.classList.add('on');
                recLed.classList.add('on');
                led.classList.add('on');
                break;
            case 'paused':
                pauseBtn.classList.add('active');
                pwrLed.classList.add('on');
                recLed.classList.add('on', 'blink');
                break;
            case 'ff':
                ffwBtn.classList.add('active');
                playBtn.classList.add('active');
                pwrLed.classList.add('on');
                recLed.classList.add('on');
                led.classList.add('on');
                break;
            case 'rew':
                rewBtn.classList.add('active');
                pwrLed.classList.add('on');
                recLed.classList.add('on', 'blink');
                break;
            case 'stopped':
                stopBtn.classList.add('active');
                pwrLed.classList.add('on');
                break;
        }
    }

    function stopRewind() {
        if (rewInterval) {
            clearInterval(rewInterval);
            rewInterval = null;
        }
        stopMotorSound();
    }

    function transportPlay() {
        if (transportMode === 'ff') {
            // Return from FF to normal speed
            audio.playbackRate = fxState.slow ? 0.85 : 1.0;
            transportMode = 'playing';
            isPlaying = true;
            stopMotorSound();
            updateTransportUI();
            return;
        }
        stopRewind();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        audio.playbackRate = fxState.slow ? 0.85 : 1.0;
        audio.play();
        isPlaying = true;
        transportMode = 'playing';
        updateTransportUI();
    }

    function transportPause() {
        if (transportMode === 'ff' || transportMode === 'rew') {
            // First stop FF/REW, then pause
            stopRewind();
            audio.playbackRate = fxState.slow ? 0.85 : 1.0;
        }
        if (transportMode === 'paused') {
            // Unpause → play
            transportPlay();
            return;
        }
        audio.pause();
        isPlaying = false;
        transportMode = 'paused';
        updateTransportUI();
    }

    function transportStop() {
        stopRewind();
        audio.pause();
        audio.currentTime = 0;
        audio.playbackRate = fxState.slow ? 0.85 : 1.0;
        isPlaying = false;
        transportMode = 'stopped';
        updateTransportUI();
    }

    function transportFF() {
        if (transportMode === 'ff') {
            // Toggle off → back to play
            transportPlay();
            return;
        }
        stopRewind();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        audio.playbackRate = TAPE_FF_RATE;
        if (!isPlaying) {
            audio.play();
        }
        isPlaying = true;
        transportMode = 'ff';
        startMotorSound();
        updateTransportUI();
    }

    function transportREW() {
        if (transportMode === 'rew') {
            // Toggle off → stop
            stopRewind();
            audio.pause();
            audio.playbackRate = 1.0;
            isPlaying = false;
            transportMode = 'paused';
            updateTransportUI();
            return;
        }
        // Stop current playback
        audio.pause();
        audio.playbackRate = 1.0;
        isPlaying = false;
        transportMode = 'rew';
        startMotorSound();
        updateTransportUI();

        // Seek backwards rapidly
        rewInterval = setInterval(() => {
            if (audio.currentTime <= 0) {
                stopRewind();
                transportMode = 'stopped';
                updateTransportUI();
                return;
            }
            audio.currentTime = Math.max(0, audio.currentTime - TAPE_REW_STEP);
        }, TAPE_REW_INTERVAL);
    }

    // ── Button listeners ──
    playBtn.addEventListener('click', () => {
        if (transportMode === 'playing') transportPause();
        else transportPlay();
    });
    pauseBtn.addEventListener('click', transportPause);
    stopBtn.addEventListener('click', transportStop);
    ffwBtn.addEventListener('click', transportFF);
    rewBtn.addEventListener('click', transportREW);

    audio.addEventListener('ended', () => {
        stopRewind();
        isPlaying = false;
        audio.playbackRate = fxState.slow ? 0.85 : 1.0;
        transportMode = 'stopped';
        updateTransportUI();
    });

    function fmt(s) {
        if (!isFinite(s) || isNaN(s)) return '--:--';
        return `${Math.floor(s / 60)}:${(Math.floor(s % 60) + '').padStart(2, '0')}`;
    }
    audio.addEventListener('loadedmetadata', () => {
        durTime.textContent = fmt(audio.duration);
        metaTime.textContent = fmt(audio.duration);
    });
    audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;
        curTime.textContent = fmt(audio.currentTime);
    });

    // ── Seek (waveform) ──
    let sW = false;
    function seekWave(e) {
        if (!audio.duration) return;
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const r = waveCanvas.getBoundingClientRect();
        audio.currentTime = Math.max(0, Math.min(1, (cx - r.left) / r.width)) * audio.duration;
    }
    waveCanvas.addEventListener('pointerdown', e => { sW = true; seekWave(e); });
    window.addEventListener('pointermove', e => { if (sW) seekWave(e); });
    window.addEventListener('pointerup', () => { sW = false; });

    // ── Keyboard ──
    document.addEventListener('keydown', e => {
        if (!startScreen.classList.contains('out')) return;
        if (e.code === 'Space') {
            e.preventDefault();
            if (transportMode === 'playing') transportPause();
            else transportPlay();
        }
        if (e.code === 'ArrowRight') { e.preventDefault(); transportFF(); }
        if (e.code === 'ArrowLeft') { e.preventDefault(); transportREW(); }
        if (e.code === 'Escape' || e.code === 'KeyS') { transportStop(); }
    });
    document.addEventListener('keyup', e => {
        if (!startScreen.classList.contains('out')) return;
        // Release REW/FF on key up → resume or pause
        if (e.code === 'ArrowRight' && transportMode === 'ff') {
            transportPlay();
        }
        if (e.code === 'ArrowLeft' && transportMode === 'rew') {
            stopRewind();
            transportMode = 'paused';
            updateTransportUI();
        }
    });

    // ── Rocker Switches (Audio FX) ──
    document.querySelectorAll('.switch-unit').forEach(unit => {
        const housing = unit.querySelector('.switch-housing');
        const swLed = unit.querySelector('.switch-led');
        const fxName = unit.dataset.fx;
        if (!housing || !fxName) return;
        housing.addEventListener('click', () => {
            housing.classList.toggle('on');
            swLed.classList.toggle('on');
            toggleFx(fxName);
        });
    });

    // ── Sliders ──
    sldRes.addEventListener('input', () => {
        resolution = +sldRes.value; vR.textContent = resolution;
        resLabel.textContent = resolution + ' BARS';
    });
    sldGrain.addEventListener('input', () => { grainAmt = +sldGrain.value; vG.textContent = grainAmt; });
    sldDecay.addEventListener('input', () => { decaySpd = +sldDecay.value; vD.textContent = decaySpd; });
    sldColor.addEventListener('input', () => { colorAmt = +sldColor.value; vC.textContent = colorAmt; });
    sldVol.addEventListener('input', () => {
        const v = +sldVol.value;
        vV.textContent = v;
        audio.volume = v / 100;
        if (gainNode) gainNode.gain.value = v / 100;
    });

    // ── Beat loading ──
    function loadBeat(beat) {
        if (currentBeat && currentBeat.id === beat.id && isPlaying) return;
        transportStop();
        currentBeat = beat;
        audio.src = beat.audio_url;
        audio.load();

        // Update track info
        document.querySelector('.trk-name').textContent = beat.title || '---';
        const grid = document.querySelectorAll('.trk-grid .tg-v');
        if (grid[0]) grid[0].textContent = beat.bpm || '--';
        if (grid[1]) grid[1].textContent = beat.key || '--';
        if (grid[2]) grid[2].textContent = beat.type || '--';
        if (grid[3]) grid[3].textContent = 'MP3';
        if (grid[4]) grid[4].textContent = '320 KBPS';

        // Update LED dot matrix marquee
        const marqueeText = '   ' + (beat.title || 'CPG_BEATS').toUpperCase() +
            '   ---   ' + (beat.bpm || '--') + ' BPM   ---   ' +
            (beat.key || '') + '   ---   ';
        updateMarquee(marqueeText);

        // Update active state in list
        document.querySelectorAll('.beat-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === beat.id);
        });

        // Reload waveform peaks
        peaks = [];
        if (audioCtx) loadPeaks();

        // Auto-play
        if (audioCtx) {
            audio.addEventListener('canplay', function onCanPlay() {
                audio.removeEventListener('canplay', onCanPlay);
                transportPlay();
            });
        }
    }

    function renderBeatsList(beats) {
        if (!beats.length) {
            beatsList.innerHTML = '<div class="beats-loading">NO BEATS FOUND</div>';
            beatCount.textContent = '0 TRACKS';
            return;
        }
        beatCount.textContent = beats.length + ' TRACK' + (beats.length !== 1 ? 'S' : '');
        beatsList.innerHTML = beats.map(b => `
            <div class="beat-item" data-id="${b.id}">
                <span class="beat-title">${b.title}</span>
                <span class="beat-meta">${b.bpm || '--'} BPM</span>
                <span class="beat-meta">${b.key || '--'}</span>
                <span class="beat-meta">${b.type || '--'}</span>
            </div>
        `).join('');

        beatsList.querySelectorAll('.beat-item').forEach(el => {
            el.addEventListener('click', () => {
                const beat = beats.find(b => b.id === el.dataset.id);
                if (beat) loadBeat(beat);
            });
        });
    }

    async function initBeats() {
        const beats = await BeatsAPI.getAll();
        allBeats = beats;
        renderBeatsList(beats);
        // Auto-select first beat
        if (beats.length) loadBeat(beats[0]);
    }

    // ── Start ──
    $('startBtn').addEventListener('click', () => {
        initAudio();
        startScreen.classList.add('out');
        app.classList.remove('hidden');
        requestAnimationFrame(() => {
            resize();
            initBeats();
        });
    });

    requestAnimationFrame(render);
})();

// Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered', reg))
      .catch(err => console.error('Service Worker registration failed', err));
  });
}

// Web Audio State
let audioCtx = null;
const activeSounds = {};
let fireIntervalId = null;

// Timer State
let timerInterval = null;
let timeRemaining = 1500; // 25 minutes default
let totalDuration = 1500;
let timerRunning = false;
let currentLabel = '專注時間';

// Wake Lock
let wakeLock = null;

// DOM Elements
const timerTime = document.getElementById('timer-time');
const timerLabel = document.getElementById('timer-label');
const timerProgress = document.getElementById('timer-progress');
const btnStart = document.getElementById('btn-start');
const btnReset = document.getElementById('btn-reset');
const presetBtns = document.querySelectorAll('.preset-btn');
const installBtn = document.getElementById('install-btn');
const pwaModal = document.getElementById('pwa-modal');
const modalClose = document.getElementById('modal-close');

// PWA installation detection
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'block';
});

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
if (isIOS) {
  installBtn.style.display = 'block';
}

installBtn.addEventListener('click', () => {
  if (isIOS) {
    pwaModal.style.display = 'flex';
  } else if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
      deferredPrompt = null;
    });
  } else {
    alert('您的瀏覽器已安裝或不支援自動安裝，請從 Safari 選單「加入主畫面」。');
  }
});

modalClose.addEventListener('click', () => pwaModal.style.display = 'none');

// Procedural Audio Nodes Creation
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Generate Brown Noise Buffer (1/f^2)
function createBrownNoiseBuffer(ctx, duration = 3) {
  const sampleRate = ctx.sampleRate;
  const bufferSize = sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);
  let lastOut = 0.0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    data[i] = (lastOut + (0.02 * white)) / 1.02;
    lastOut = data[i];
    data[i] *= 3.5; // compensation
  }
  return buffer;
}

// Generate Pink Noise Buffer (1/f)
function createPinkNoiseBuffer(ctx, duration = 3) {
  const sampleRate = ctx.sampleRate;
  const bufferSize = sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    data[i] = pink * 0.11;
  }
  return buffer;
}

// Sound Controller Objects
const SoundEngine = {
  rain: {
    source: null, filter: null, gain: null,
    start() {
      this.gain = audioCtx.createGain();
      this.gain.gain.value = parseFloat(document.getElementById('vol-rain').value) / 100;
      
      const buffer = createBrownNoiseBuffer(audioCtx);
      this.source = audioCtx.createBufferSource();
      this.source.buffer = buffer;
      this.source.loop = true;
      
      this.filter = audioCtx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 650; // Muffly heavy rain
      
      this.source.connect(this.filter);
      this.filter.connect(this.gain);
      this.gain.connect(audioCtx.destination);
      this.source.start(0);
    },
    stop() {
      if (this.source) {
        this.source.stop();
        this.source.disconnect();
      }
    },
    setVolume(val) {
      if (this.gain) this.gain.gain.setValueAtTime(val, audioCtx.currentTime);
    }
  },
  ocean: {
    source: null, filter: null, gain: null, lfo: null,
    start() {
      this.gain = audioCtx.createGain();
      this.gain.gain.value = 0; // modulated by LFO
      
      const buffer = createBrownNoiseBuffer(audioCtx);
      this.source = audioCtx.createBufferSource();
      this.source.buffer = buffer;
      this.source.loop = true;
      
      this.filter = audioCtx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 350; // Deep ocean wave rumble
      
      // LFO for wave swelling
      this.lfo = audioCtx.createOscillator();
      this.lfo.type = 'sine';
      this.lfo.frequency.value = 0.08; // Wave cycle ~ 12 seconds
      
      const lfoGain = audioCtx.createGain();
      const userMaxVol = parseFloat(document.getElementById('vol-ocean').value) / 100;
      lfoGain.gain.value = userMaxVol / 2; // swing amplitude
      
      this.lfo.connect(lfoGain);
      
      // Base gain offset
      const baseGain = audioCtx.createGain();
      baseGain.gain.value = userMaxVol / 2;
      
      lfoGain.connect(this.gain.gain);
      
      this.source.connect(this.filter);
      this.filter.connect(this.gain);
      this.gain.connect(audioCtx.destination);
      
      this.source.start(0);
      this.lfo.start(0);
    },
    stop() {
      if (this.source) {
        this.source.stop();
        this.source.disconnect();
      }
      if (this.lfo) {
        this.lfo.stop();
        this.lfo.disconnect();
      }
    },
    setVolume(val) {
      this.stop();
      this.start(); // Re-initialize to scale the LFO values
    }
  },
  fire: {
    source: null, filter: null, gain: null,
    start() {
      this.gain = audioCtx.createGain();
      this.gain.gain.value = parseFloat(document.getElementById('vol-fire').value) / 100;
      
      // Fire crackle rumble (pink noise lowpass)
      const buffer = createPinkNoiseBuffer(audioCtx);
      this.source = audioCtx.createBufferSource();
      this.source.buffer = buffer;
      this.source.loop = true;
      
      this.filter = audioCtx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 180;
      
      this.source.connect(this.filter);
      this.filter.connect(this.gain);
      this.gain.connect(audioCtx.destination);
      this.source.start(0);
      
      // Trigger random crackle pops
      const schedulePop = () => {
        const active = document.getElementById('switch-fire').checked;
        if (!active) return;
        
        playFireCrackle(audioCtx, this.gain);
        
        const nextDelay = 50 + Math.random() * 800; // randomized crackle intervals
        fireIntervalId = setTimeout(schedulePop, nextDelay);
      };
      schedulePop();
    },
    stop() {
      if (this.source) {
        this.source.stop();
        this.source.disconnect();
      }
      if (fireIntervalId) {
        clearTimeout(fireIntervalId);
        fireIntervalId = null;
      }
    },
    setVolume(val) {
      if (this.gain) this.gain.gain.setValueAtTime(val, audioCtx.currentTime);
    }
  },
  wind: {
    source: null, filter: null, gain: null, lfo: null,
    start() {
      this.gain = audioCtx.createGain();
      this.gain.gain.value = parseFloat(document.getElementById('vol-wind').value) / 100;
      
      const buffer = createPinkNoiseBuffer(audioCtx);
      this.source = audioCtx.createBufferSource();
      this.source.buffer = buffer;
      this.source.loop = true;
      
      this.filter = audioCtx.createBiquadFilter();
      this.filter.type = 'bandpass';
      this.filter.Q.value = 3.0; // Sharp bandpass for wind whistle
      this.filter.frequency.value = 400;
      
      // Wind speed fluctuation LFO
      this.lfo = audioCtx.createOscillator();
      this.lfo.type = 'sine';
      this.lfo.frequency.value = 0.05; // Wind change cycle ~ 20 seconds
      
      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 300; // Modulate bandpass frequency by +/- 300 Hz
      
      this.lfo.connect(lfoGain);
      lfoGain.connect(this.filter.frequency);
      
      this.source.connect(this.filter);
      this.filter.connect(this.gain);
      this.gain.connect(audioCtx.destination);
      
      this.source.start(0);
      this.lfo.start(0);
    },
    stop() {
      if (this.source) {
        this.source.stop();
        this.source.disconnect();
      }
      if (this.lfo) {
        this.lfo.stop();
        this.lfo.disconnect();
      }
    },
    setVolume(val) {
      if (this.gain) this.gain.gain.setValueAtTime(val, audioCtx.currentTime);
    }
  },
  focus: {
    osc1: null, osc2: null, gain: null,
    start() {
      this.gain = audioCtx.createGain();
      this.gain.gain.value = parseFloat(document.getElementById('vol-focus').value) / 100 * 0.4; // keep low
      
      this.osc1 = audioCtx.createOscillator();
      this.osc1.type = 'sine';
      this.osc1.frequency.value = 120; // 120Hz carrier
      
      this.osc2 = audioCtx.createOscillator();
      this.osc2.type = 'sine';
      this.osc2.frequency.value = 126; // 126Hz carrier (6Hz difference = Theta waves)
      
      this.osc1.connect(this.gain);
      this.osc2.connect(this.gain);
      this.gain.connect(audioCtx.destination);
      
      this.osc1.start(0);
      this.osc2.start(0);
    },
    stop() {
      if (this.osc1) {
        this.osc1.stop();
        this.osc1.disconnect();
      }
      if (this.osc2) {
        this.osc2.stop();
        this.osc2.disconnect();
      }
    },
    setVolume(val) {
      if (this.gain) this.gain.gain.setValueAtTime(val * 0.4, audioCtx.currentTime);
    }
  }
};

// Wood crackle generator pop function
function playFireCrackle(ctx, destNode) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  
  filter.type = 'bandpass';
  filter.frequency.value = 1500 + Math.random() * 3000;
  filter.Q.value = 8;
  
  osc.type = 'triangle';
  osc.frequency.value = 100 + Math.random() * 400;
  
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.01 + Math.random() * 0.05, ctx.currentTime + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03 + Math.random() * 0.05);
  
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(destNode);
  
  osc.start(0);
  osc.stop(ctx.currentTime + 0.15);
}

// Sound Switch Change Events
document.querySelectorAll('.switch input').forEach(toggle => {
  toggle.addEventListener('change', (e) => {
    initAudio();
    const soundKey = e.target.dataset.sound;
    const card = document.getElementById(`card-${soundKey}`);
    
    if (e.target.checked) {
      card.classList.add('active');
      SoundEngine[soundKey].start();
    } else {
      card.classList.remove('active');
      SoundEngine[soundKey].stop();
    }
  });
});

// Sound Volume Slider Events
document.querySelectorAll('.volume-slider').forEach(slider => {
  slider.addEventListener('input', (e) => {
    const soundKey = e.target.id.split('-')[1];
    const val = parseFloat(e.target.value) / 100;
    SoundEngine[soundKey].setVolume(val);
  });
});

// Wake Lock Manager (prevents iOS sleep during meditation/work)
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake Lock active');
    } catch (err) {
      console.error(`${err.name}, ${err.message}`);
    }
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
    console.log('Wake Lock released');
  }
}

// Pomodoro Timer Logic
function updateTimerDisplay() {
  const mins = Math.floor(timeRemaining / 60);
  const secs = timeRemaining % 60;
  timerTime.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  
  // Update circular SVG bar
  const circleOffset = 282.7 - (282.7 * (timeRemaining / totalDuration));
  timerProgress.style.strokeDashoffset = circleOffset;
}

function startTimer() {
  if (timerRunning) return;
  initAudio();
  timerRunning = true;
  btnStart.textContent = '⏸ 暫停';
  btnStart.style.background = 'rgba(255, 255, 255, 0.1)';
  btnStart.style.border = '1px solid var(--border)';
  btnStart.style.boxShadow = 'none';
  
  requestWakeLock();
  
  timerInterval = setInterval(() => {
    if (timeRemaining > 0) {
      timeRemaining--;
      updateTimerDisplay();
    } else {
      clearInterval(timerInterval);
      timerRunning = false;
      playAlertTone();
      saveFocusSession(currentLabel, totalDuration);
      alert(`時間到！已完成${currentLabel}。`);
      resetTimerState();
    }
  }, 1000);
}

function pauseTimer() {
  if (!timerRunning) return;
  clearInterval(timerInterval);
  timerRunning = false;
  btnStart.textContent = '▶ 開始';
  btnStart.style.background = 'linear-gradient(135deg, var(--primary), var(--secondary))';
  btnStart.style.border = 'none';
  btnStart.style.boxShadow = '0 4px 15px var(--glow)';
  
  releaseWakeLock();
}

function resetTimerState() {
  pauseTimer();
  timeRemaining = totalDuration;
  updateTimerDisplay();
}

// Preset Buttons
presetBtns.forEach(btn => {
  btn.addEventListener('click', (e) => {
    presetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    totalDuration = parseInt(btn.dataset.time);
    currentLabel = btn.dataset.label;
    timerLabel.textContent = currentLabel.includes('專注') ? '工作時間' : '休息時間';
    btnReset.textContent = `⏱ 設為 ${Math.floor(totalDuration/60)}m`;
    
    resetTimerState();
  });
});

btnStart.addEventListener('click', () => {
  if (timerRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
});

btnReset.addEventListener('click', () => {
  resetTimerState();
});

// End of timer session tone synthesizer
function playAlertTone() {
  initAudio();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
  osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.25); // E5
  osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.5); // G5
  osc.frequency.setValueAtTime(1046.50, audioCtx.currentTime + 0.75); // C6
  
  gain.gain.setValueAtTime(0, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1.2);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start(0);
  osc.stop(audioCtx.currentTime + 1.3);
}

// Handle Wake Lock re-request on page visibility change
document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    requestWakeLock();
  }
});

// Clear cache & force refresh handler
const refreshBtn = document.getElementById('refresh-btn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    if (typeof showToast === 'function') {
      showToast('正在清除快取並重新載入...');
    } else {
      alert('正在清除快取並重新載入...');
    }
    
    // Unregister service workers
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      } catch (e) {
        console.error('Service Worker unregistration failed:', e);
      }
    }
    
    // Clear Cache Storage
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const key of keys) {
          await caches.delete(key);
        }
      } catch (e) {
        console.error('Cache deletion failed:', e);
      }
    }
    
    // Reload with cache buster
    const url = new URL(window.location.href);
    url.searchParams.set('clear-cache', Date.now().toString());
    window.location.href = url.toString();
  });
}

function saveFocusSession(label, duration) {
  try {
    const sessions = JSON.parse(localStorage.getItem('focus_sessions') || '[]');
    sessions.push({
      label: label,
      duration: duration,
      timestamp: Date.now()
    });
    localStorage.setItem('focus_sessions', JSON.stringify(sessions));
  } catch (e) {
    console.error('Failed to save focus session:', e);
  }
}

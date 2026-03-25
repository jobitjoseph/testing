/**
 * ESP Web Flasher — app.js (Premium Stepped UI Version)
 * Core logic: Firmware fetching from local /firmware/ folder, esptool-js flash engine
 */

import { ESPLoader, Transport } from "https://unpkg.com/esptool-js@0.4.6/bundle.js";

// ════════════════════════════════════════════════════
//  GLOBALS & STATE
// ════════════════════════════════════════════════════
const STATE = {
  currentStep: 1,
  selectedProject: null,
  port: null,
  transport: null,
  espLoader: null,
  isFlashing: false,
  abortFlash: false,
  config: null,
  logLines: 0,
  isLogVisible: true,
};

// ════════════════════════════════════════════════════
//  INITIALIZATION
// ════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.setAttribute('data-theme', 'light');

  checkWebSerial();
  await loadConfig();
  
  // Initial UI state
  goToStep(1);
});

// ════════════════════════════════════════════════════
//  NAVIGATION LOGIC
// ════════════════════════════════════════════════════
window.goToStep = function (step) {
  // Validation
  if (step === 2 && !STATE.selectedProject) {
    showToast('Please select a firmware first', 'warning');
    return;
  }
  if (step === 3 && !STATE.port) {
    showToast('Please connect your device first', 'warning');
    return;
  }

  STATE.currentStep = step;

  // Update Stepper UI
  document.querySelectorAll('.step').forEach((el, idx) => {
    const stepNum = idx + 1;
    el.classList.toggle('active', stepNum === step);
    el.classList.toggle('done', stepNum < step);
  });

  // Update Section Visiblity
  document.querySelectorAll('.step-section').forEach((el, idx) => {
    el.classList.toggle('active', (idx + 1) === step);
  });

  // Step-specific updates
  if (step === 3) {
    document.getElementById('confirm-project-name').textContent = STATE.selectedProject.name;
    // Populate baud rates for step 3
    const bauds = document.getElementById('baud-select');
    if (bauds && STATE.selectedProject.baud_options) {
      bauds.innerHTML = STATE.selectedProject.baud_options.map(b =>
        `<option value="${b}" ${b === STATE.selectedProject.baud_default ? 'selected' : ''}>${b.toLocaleString()}</option>`
      ).join('');
      
      // Update footer display initially
      const display = document.getElementById('current-baud-display');
      if (display) display.textContent = parseInt(bauds.value).toLocaleString();
      
      // Add listener for changes
      bauds.onchange = (e) => {
        if (display) display.textContent = parseInt(e.target.value).toLocaleString();
      };
    }
  }

  log('info', `Navigated to Step ${step}`);
};

// ════════════════════════════════════════════════════
//  WEB SERIAL & CONFIG
// ════════════════════════════════════════════════════
function checkWebSerial() {
  if (!('serial' in navigator)) {
    document.getElementById('webserial-warning').style.display = 'flex';
    log('error', 'Web Serial API not available. Use Chrome or Edge 89+.');
  }
}

async function loadConfig() {
  try {
    const res = await fetch(`./config.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    STATE.config = await res.json();
    log('info', `Loaded ${STATE.config.projects.length} project(s) from config.`);
    renderProjects();
  } catch (e) {
    log('error', `Failed to load config.json: ${e.message}`);
    showToast('Failed to load project config', 'error');
  }
}

function renderProjects() {
  const select = document.getElementById('project-select');
  if (!STATE.config || !STATE.config.projects.length) {
    select.innerHTML = '<option value="" disabled>No projects found.</option>';
    return;
  }

  const options = STATE.config.projects.map(p =>
    `<option value="${p.id}">${p.name} (v${p.version || '—'}) [${p.chip}]</option>`
  ).join('');

  select.innerHTML = '<option value="" disabled selected>— Choose a firmware —</option>' + options;
}

window.selectProject = function (id) {
  if (!id) return;
  STATE.selectedProject = STATE.config.projects.find(p => p.id === id);
  if (!STATE.selectedProject) return;

  const statusText = document.getElementById('step-1-status');
  const nextBtn = document.getElementById('btn-step-1-next');
  
  if (statusText) statusText.textContent = `Ready: ${STATE.selectedProject.name}`;
  if (nextBtn) nextBtn.disabled = false;

  log('accent', `Project selected: ${STATE.selectedProject.name}`);
};

// ════════════════════════════════════════════════════
//  SERIAL CONNECTION
// ════════════════════════════════════════════════════
window.handleConnect = async function () {
  try {
    log('info', 'Requesting serial port…');
    STATE.port = await navigator.serial.requestPort();

    setConnectionState('connected');
    log('success', 'Serial port selected and ready.');
    showToast('Device connected', 'success');

    // Update Step 2 UI
    const chipBadge = document.getElementById('chip-badge-step2');
    if (chipBadge) {
      chipBadge.textContent = STATE.selectedProject.chip;
      document.getElementById('chip-info-summary').style.display = 'flex';
    }
    
    // Show Next button
    const nextBtn = document.getElementById('btn-step-2-next');
    const connectBtn = document.getElementById('btn-connect');
    if (nextBtn) nextBtn.style.display = 'inline-flex';
    if (connectBtn) connectBtn.style.display = 'none';

    STATE.port.addEventListener('disconnect', () => {
      setConnectionState('disconnected');
      log('warn', 'Device disconnected.');
      if (STATE.currentStep > 2) goToStep(2);
    });

  } catch (e) {
    if (e.name !== 'NotFoundError') {
      log('error', `Connection error: ${e.message}`);
      showToast('Connection failed: ' + e.message, 'error');
    }
  }
};

window.handleDisconnect = async function () {
  try {
    if (STATE.transport) { STATE.transport.disconnect(); STATE.transport = null; }
    if (STATE.port && STATE.port.readable) await STATE.port.close();
    STATE.port = null;
    setConnectionState('disconnected');
    log('info', 'Disconnected.');
    
    // Reset Step 2 UI
    document.getElementById('chip-info-summary').style.display = 'none';
    document.getElementById('btn-connect').style.display = 'inline-flex';
    document.getElementById('btn-step-2-next').style.display = 'none';
    
  } catch (e) {
    log('error', `Disconnect error: ${e.message}`);
  }
};

function setConnectionState(status) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  
  if (dot) dot.className = `status-dot ${status}`;
  
  if (status === 'connected') {
    if (text) text.innerHTML = '<strong>Device connected</strong>';
  } else if (status === 'flashing') {
    if (text) text.innerHTML = '<strong>Flashing…</strong>';
  } else {
    if (text) text.innerHTML = 'No device connected';
  }
}

// ════════════════════════════════════════════════════
//  FLASHING & ERASING
// ════════════════════════════════════════════════════
window.handleErase = async function () {
  if (!confirm('⚠️ This will completely erase the flash memory. Continue?')) return;

  STATE.isFlashing = true; 
  updateFlashUI();
  
  try {
    const baud = parseInt(document.getElementById('baud-select')?.value || 115200);
    if (STATE.port.readable) await STATE.port.close();
    
    const transport = new Transport(STATE.port, true);
    const loader = new ESPLoader({ transport, baudrate: baud, terminal: makeTerminal() });

    await loader.main();
    await loader.eraseFlash();

    log('success', '✓ Flash erased successfully.');
    showToast('Flash erased', 'success');

  } catch (e) {
    log('error', `Erase failed: ${e.message}`);
    showToast('Erase failed: ' + e.message, 'error');
  } finally {
    STATE.isFlashing = false;
    updateFlashUI();
  }
};

window.handleFlash = async function () {
  if (STATE.isFlashing) return;

  STATE.isFlashing = true; STATE.abortFlash = false;
  updateFlashUI();

  const project = STATE.selectedProject;
  const baud = parseInt(document.getElementById('baud-select').value);

  document.getElementById('progress-section').style.display = 'block';
  setProgress(0, 'Fetching binaries…');

  log('accent', `══ Flashing ${project.name} @ ${baud.toLocaleString()} baud ══`);

  try {
    const flashFiles = [];
    for (let f of project.flash) {
      if (STATE.abortFlash) throw new Error('Flash aborted.');
      const buffer = await fetchFirmwareBinary(project.id, f.file_id);
      flashFiles.push({ data: arrayBufferToBinaryString(buffer), address: parseInt(f.address, 16) });
    }

    if (STATE.port.readable) await STATE.port.close();

    const transport = new Transport(STATE.port, true);
    STATE.transport = transport;

    const loader = new ESPLoader({
      transport,
      baudrate: baud,
      terminal: makeTerminal(),
    });

    await loader.main();
    await loader.writeFlash({
      fileArray: flashFiles,
      flashSize: project.flash_size || 'keep',
      compress: true,
      reportProgress(fileIndex, written, total) {
        if (STATE.abortFlash) throw new Error('Flash aborted.');
        const pct = Math.round(((fileIndex + (written / total)) / project.flash.length) * 100);
        const fileName = project.flash[fileIndex].file_id;
        setProgress(pct, `Writing ${fileName}…`);
      },
      calculateMD5Hash(image) {
        const wordarray = (typeof image === 'string')
          ? CryptoJS.enc.Latin1.parse(image)
          : CryptoJS.lib.WordArray.create(image);
        return CryptoJS.MD5(wordarray).toString();
      },
    });

    setProgress(100, '✓ Flash complete!');
    await loader.hardReset();

    log('success', '══ ✓ Flash complete! ══');
    showToast('Firmware flashed successfully!', 'success');
    
    document.getElementById('flash-done-actions').style.display = 'flex';
    if (document.getElementById('btn-flash-back')) document.getElementById('btn-flash-back').style.display = 'none';

  } catch (e) {
    log('error', `Flash failed: ${e.message}`);
    showToast('Flash failed: ' + e.message, 'error');
  } finally {
    STATE.isFlashing = false;
    updateFlashUI();
  }
};

function updateFlashUI() {
  const flashBtn = document.getElementById('btn-flash');
  const eraseBtn = document.getElementById('btn-erase');
  const cancelBtn = document.getElementById('btn-cancel');
  const resetBtn = document.getElementById('btn-reset');
  const backBtn = document.getElementById('btn-flash-back');

  if (flashBtn) flashBtn.disabled = STATE.isFlashing;
  if (eraseBtn) eraseBtn.disabled = STATE.isFlashing;
  if (resetBtn) resetBtn.disabled = STATE.isFlashing;
  if (backBtn) backBtn.style.visibility = STATE.isFlashing ? 'hidden' : 'visible';
  if (cancelBtn) cancelBtn.style.display = STATE.isFlashing ? 'inline-flex' : 'none';
}

// ════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════
async function fetchFirmwareBinary(projectId, fileId) {
  const url = `./firmware/${projectId}/${fileId}`;
  log('info', `  Fetching → ${fileId}…`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Binary fetch failed: ${response.status}`);
  return await response.arrayBuffer();
}

function arrayBufferToBinaryString(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return chunks.join('');
}

function setProgress(pct, label) {
  const bar = document.getElementById('progress-bar');
  const pctEl = document.getElementById('progress-pct');
  const lbl = document.getElementById('progress-label');
  if (bar) bar.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (lbl) lbl.textContent = label;
}

// ════════════════════════════════════════════════════
//  LOGGING
// ════════════════════════════════════════════════════
function log(type, message) {
  const console = document.getElementById('log-console');
  if (!console) return;

  STATE.logLines++;
  const badge = document.getElementById('log-count-badge');
  if (badge) badge.textContent = `${STATE.logLines} lines`;

  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const line = document.createElement('div');
  line.className = 'log-line';
  
  let sanitized = message.replace(/[^\x20-\x7E\s\u00A0-\u00FF]/g, '');
  if (sanitized.length > 1000) sanitized = sanitized.substring(0, 1000) + '...';

  line.innerHTML = `<span class="log-time">${time}</span><span class="log-text ${type}">${escapeHtml(sanitized)}</span>`;
  console.appendChild(line);
  console.scrollTop = console.scrollHeight;
}

window.toggleLog = function() {
  STATE.isLogVisible = !STATE.isLogVisible;
  const container = document.getElementById('log-console-container');
  const btn = document.getElementById('btn-toggle-log');
  if (container) container.style.display = STATE.isLogVisible ? 'block' : 'none';
  if (btn) btn.textContent = STATE.isLogVisible ? '▲ Hide' : '▼ Show';
};

window.clearLog = () => {
  STATE.logLines = 0;
  document.getElementById('log-console').innerHTML = '';
  document.getElementById('log-count-badge').textContent = '0 lines';
};

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function makeTerminal() {
  return {
    clean() {},
    writeLine(data) { log('dim', data); },
    write(data) {
      if (typeof data === 'string' && data.trim()) log('dim', data);
      else if (data instanceof Uint8Array) {
        const str = new TextDecoder().decode(data);
        if (str.trim()) log('dim', str);
      }
    },
  };
}

window.handleReset = async function () {
  if (!STATE.port) return;
  try {
    log('info', 'Hard resetting device…');
    if (STATE.port.readable) await STATE.port.close();
    const transport = new Transport(STATE.port, true);
    const loader = new ESPLoader({ transport, baudrate: 115200, terminal: makeTerminal() });
    await loader.main();
    await loader.hardReset();
    await transport.disconnect();
    showToast('Reset successful', 'success');
  } catch (e) {
    log('error', `Reset failed: ${e.message}`);
  }
};

window.handleCancel = () => {
  STATE.abortFlash = true;
  log('warn', '🛑 Cancellation requested…');
};

window.showToast = (message, type = 'info') => {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span></span> ${escapeHtml(message)}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
};

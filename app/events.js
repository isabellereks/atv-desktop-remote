/**
 * Events Module
 * Handles all event binding: IPC, keyboard, window events.
 */

window.atvEvents = (() => {
const { States, appState } = window.atvState;
const device = window.atvDevice;
const views = window.atvViews;
const api = window.atv;

// Key mappings
const keymap = {
    'ArrowUp': 'up',
    'ArrowDown': 'down',
    'ArrowLeft': 'left',
    'ArrowRight': 'right',
    't': 'home',
    'l': 'home_hold',
    'Backspace': 'menu',
    'Escape': 'menu',
    'Space': 'play_pause',
    'Enter': 'select',
    'Previous': 'skip_backward',
    'Next': 'skip_forward',
    '[': 'skip_backward',
    ']': 'skip_forward',
    'g': 'top_menu',
    '+': 'volume_up',
    '=': 'volume_up',
    '-': 'volume_down',
    '_': 'volume_down'
};

const keyDescriptions = {
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    select: 'Select',
    menu: 'Menu',
    top_menu: 'Top menu',
    volume_down: 'Volume down',
    volume_up: 'Volume up',
    play_pause: 'Play / Pause',
    skip_backward: 'Skip back',
    skip_forward: 'Skip forward',
    home: 'TV',
    home_hold: 'Control Center'
};

let qPresses = 0;
let autoKeyboardInterval = null;
let autoKeyboardPrimed = false;
let autoKeyboardWasVisible = false;
let autoKeyboardLastFocused = false;
let autoKeyboardJustClosed = false;
const POLL_TICK_MS  = 50;
const POLL_MIN_MS   = 250;
const POLL_MAX_MS   = 1000;

// Platform-aware helpers for keyboard log messages
const _win = navigator.platform.startsWith('Win');
const _kb  = (emoji, label) => _win ? `[kb:${label}]` : `⌨️ ${emoji}`;
const _arr = _win ? '->' : '→';
let pollIntervalMs  = POLL_MIN_MS;
let pollInFlight    = false;
let nextPollTime    = 0;

function init() {
    api.onShow(() => {
        handleDarkMode();
        views.toggleAltText(true);
        startAutoKeyboardPoll(!autoKeyboardJustClosed);
        autoKeyboardJustClosed = false;
    });
    api.onHide(stopAutoKeyboardPoll);
    api.onResume(reconnect);
    api.onConnectionLost(reconnect);
    api.onKeyboardClosed(() => {
        autoKeyboardPrimed = false;
        autoKeyboardJustClosed = true;
    });

    setupKeyboard();
    window.addEventListener('blur', () => views.toggleAltText(true));
    window.addEventListener('focus', checkStaleConnection);
}

function reconnect() {
    const deviceId = device.getActiveId();
    if (deviceId && appState.state === States.CONNECTED) {
        appState.transition(States.CONNECTING, { deviceId });
    }
}

/**
 * Setup keyboard event listeners
 */
function setupKeyboard() {
    window.addEventListener('keyup', (e) => {
        if (e.key === 'Alt') {
            views.toggleAltText(true);
        }
    });

    window.addEventListener('keydown', event => {
        if (event.altKey || event.key === 'Alt') {
            views.toggleAltText(false);
            return;
        }
        if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('input, select, textarea, [contenteditable]')) return;
        if (target?.closest('button') && (event.key === 'Enter' || event.key === ' ')) return;

        let key = event.key;
        if (key.length === 1) key = key === ' ' ? 'Space' : key.toLowerCase();

        if (key === 'q' && !event.repeat) {
            if (++qPresses === 3) api.quit().catch(() => {});
        } else if (key !== 'q') {
            qPresses = 0;
        }
        if (key === 'h') {
            api.hide().catch(() => {});
            return;
        }
        if (appState.state !== States.CONNECTED) return;
        if (key === 'k') {
            openKeyboard();
        } else if (Object.hasOwn(keymap, key)) {
            sendCommand(key, event.shiftKey);
            event.preventDefault();
        }
    });
}

function checkStaleConnection() {
    if (appState.state === States.CONNECTED && appState.isConnectionStale()) reconnect();
}

/**
 * Send a command to the Apple TV
 * @param {string} key - Key pressed
 * @param {boolean} shifted - Whether shift was held (long press)
 */
async function sendCommand(key, shifted = false) {
    if (appState.state !== States.CONNECTED) return;
    const command = Object.hasOwn(keymap, key) ? keymap[key] : key;
    if (!Object.hasOwn(keyDescriptions, command)) return;
    const holdHome = shifted && command === 'home';

    appState.updateActivity();
    api.flashTrayIcon().catch(() => {});
    views.flashButton(command === 'home_hold' ? 'home' : command);
    views.showCommandFeedback(keyDescriptions[holdHome ? 'home_hold' : command]);

    try {
        await device.sendKey(command, shifted);
    } catch (err) {
        console.error('Could not send remote command:', err);
    }
}

/**
 * Start polling for Apple TV keyboard focus to auto-open the keyboard window.
 *
 * Priming rules:
 *   - Starts primed when the main window becomes visible.
 *   - Fires (opens keyboard) when focused + primed + window not already open.
 *   - Unprimes when the keyboard window closes (user dismissed or auto-close).
 *   - Re-primes on a focused→unfocused transition while unprimed, so the next
 *     time the user navigates to a search field it will open again.
 */
function startAutoKeyboardPoll(prime = true) {
    if (autoKeyboardInterval) return;
    if (prime) autoKeyboardPrimed = true;
    autoKeyboardWasVisible = false;
    autoKeyboardLastFocused = false;
    pollIntervalMs = POLL_MIN_MS;
    pollInFlight   = false;
    nextPollTime   = 0;
    console.log(`${_kb('▶️ ', 'start')} auto-keyboard polling started (${autoKeyboardPrimed ? 'primed' : 'unprimed'})`);

    autoKeyboardInterval = setInterval(async () => {
        if (pollInFlight) return;
        if (Date.now() < nextPollTime) return;
        if (localStorage.getItem('autoKeyboard') === 'false') return;
        if (appState.state !== States.CONNECTED) return;

        pollInFlight = true;
        const pollStart = Date.now();

        // Check visibility first — skip the ATV network call if window is already open
        let visible;
        try {
            visible = await api.isInputVisible();
        } catch (err) {
            console.error(`${_kb('❌', 'err')} auto-keyboard poll error (visibility):`, err);
            pollInFlight = false;
            nextPollTime = pollStart + pollIntervalMs;
            return;
        }

        // Window just closed → unprime so we don't immediately reopen
        if (autoKeyboardWasVisible && !visible) {
            autoKeyboardPrimed = false;
            console.log(`${_kb('🔒', 'lock')} keyboard window auto-closed ${_arr} unprimed`);
        }
        autoKeyboardWasVisible = visible;

        if (!visible) {
            // Keyboard window is closed — query the ATV for focus state
            let focused;
            try {
                focused = await device.getKeyboardFocus();
            } catch (err) {
                console.error(`${_kb('❌', 'err')} auto-keyboard poll error (focus):`, err);
                pollInFlight = false;
                nextPollTime = pollStart + pollIntervalMs;
                return;
            }

            // Focused→unfocused transition while unprimed → re-prime for next search
            if (!autoKeyboardPrimed && autoKeyboardLastFocused && !focused) {
                autoKeyboardPrimed = true;
                console.log(`${_kb('🔑', 'prime')} keyboard unfocused while unprimed ${_arr} re-primed`);
            }

            // Log focus state transitions
            if (focused && !autoKeyboardLastFocused) {
                console.log(`${_kb('🟢', 'on')} keyboard focused (primed: ${autoKeyboardPrimed})`);
            } else if (!focused && autoKeyboardLastFocused) {
                console.log(`${_kb('⚪️', 'off')} keyboard unfocused (primed: ${autoKeyboardPrimed})`);
            }

            // Open keyboard if primed and keyboard has focus
            if (autoKeyboardPrimed && focused) {
                console.log(`${_kb('🪄', 'open')} auto-opening keyboard window`);
                openKeyboard();
            }

            autoKeyboardLastFocused = focused;
        }

        // Adapt polling interval based on how long this poll took
        const elapsed = Date.now() - pollStart;
        if (elapsed >= pollIntervalMs) {
            pollIntervalMs = Math.min(elapsed + POLL_TICK_MS, POLL_MAX_MS);
            console.log(`${_kb('⏱️', 'slow')} poll took ${elapsed}ms ${_arr} interval backed off to ${pollIntervalMs}ms`);
        } else {
            pollIntervalMs = Math.max(pollIntervalMs - POLL_TICK_MS, POLL_MIN_MS);
        }
        nextPollTime = pollStart + pollIntervalMs;
        pollInFlight = false;
    }, POLL_TICK_MS);
}

/**
 * Stop auto-keyboard polling and reset priming state.
 */
function stopAutoKeyboardPoll() {
    if (autoKeyboardInterval) {
        clearInterval(autoKeyboardInterval);
        autoKeyboardInterval = null;
        console.log(`${_kb('🛑', 'stop')} auto-keyboard polling stopped`);
    }
    autoKeyboardPrimed = false;
    autoKeyboardWasVisible = false;
    autoKeyboardLastFocused = false;
    pollIntervalMs = POLL_MIN_MS;
    pollInFlight   = false;
    nextPollTime   = 0;
}

/**
 * Open the keyboard input window
 */
function openKeyboard() {
    api.openInput().catch(() => {});
}

let submittingPin = false;

async function submitPairingCode() {
    if (submittingPin) return;
    const code = $('#pairCode').val();
    if (!/^\d{4}$/.test(code)) {
        views.setStatus('Enter the four-digit PIN.');
        $('#pairCode').focus();
        return;
    }

    submittingPin = true;
    $('#pairCode').val('');
    try {
        const deviceId = await device.finishPair(code);
        if (appState.state === States.PAIRING_1) {
            appState.transition(States.CONNECTING, { deviceId });
        }
    } catch {
        if (appState.state === States.PAIRING_1) {
            views.setStatus('Pairing failed. Check the PIN and make sure your system keychain is unlocked.');
            restartPairing();
        }
    } finally {
        submittingPin = false;
    }
}

/**
 * Restart pairing after a failure
 */
function restartPairing() {
    const deviceName = appState.pairDevice;
    if (deviceName) {
        console.log('Restarting pairing for:', deviceName);
        // Small delay to let user see the error message
        setTimeout(() => {
            if (appState.state !== States.PAIRING_1 || appState.pairDevice !== deviceName) return;
            device.startPair(deviceName)
                .then(() => {
                    console.log('Pairing restarted successfully');
                    views.setStatus('Enter the new PIN shown on your TV.');
                    $('#pairCode').val('').focus();
                })
                .catch(err => {
                    console.error('Failed to restart pairing:', err);
                    views.setStatus('Could not restart pairing. Please try again.');
                    appState.transition(States.SCANNING);
                });
        }, 1500);
    } else {
        appState.transition(States.SCANNING);
    }
}

/**
 * Setup pairing UI handlers - called when entering pairing state
 */
function setupPairingHandlers() {
    console.log('Setting up pairing handlers');

    // Remove old handlers first (including mouse handlers that could interfere)
    $('#pairButton').off('click');

    $('#pairButton').on('click', submitPairingCode);

    // Also handle Enter key in the input
    $('#pairCode').off('keydown').on('keydown', (e) => {
        if (e.key === 'Enter') {
            console.log('Enter pressed in pairCode input');
            e.preventDefault();
            submitPairingCode();
        }
    });
}

/**
 * Handle dark mode changes
 */
function handleDarkMode() {
    const mode = localStorage.getItem('uimode') || 'systemmode';
    const dark = mode === 'darkmode' || (mode === 'systemmode' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    $('body').toggleClass('darkMode', dark);
}

async function scanForDevices() {
    if (appState.state !== States.SCANNING) return;
    const rescan = document.getElementById('scanAgain');
    rescan.disabled = true;
    views.setStatus('Looking for Apple TVs…');
    try {
        const devices = await device.scan();
        if (appState.state === States.SCANNING) views.createDevicePicker(devices);
    } catch {
        if (appState.state === States.SCANNING) views.showScanError();
    } finally {
        rescan.disabled = false;
    }
}

appState.on(States.SCANNING, scanForDevices);

appState.on(States.PAIRING_1, ({ device: id }) => {
    setupPairingHandlers();
    device.startPair(id).catch(() => {
        if (appState.state === States.PAIRING_1 && appState.pairDevice === id) {
            views.setStatus('Could not start pairing. Check Local Network access and unlock your system keychain.');
        }
    });
});

appState.on(States.CONNECTING, ({ deviceId, retry }) => {
    if (!retry) device.connectWithRetry(deviceId);
});

return { init, openKeyboard, handleDarkMode, scanForDevices, sendCommand };
})();

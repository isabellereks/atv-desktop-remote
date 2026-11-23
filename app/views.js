window.atvViews = (() => {
    const { States, appState } = window.atvState;
    const device = window.atvDevice;
    const find = id => document.getElementById(id);
    const navigationDistance = 28;
    let feedbackTimer;

    function init() {
        appState.on('change', ({ newState }) => showView(newState));
        setupNavigation();
        setupButtons();
        find('remoteDropdown').addEventListener('change', event => {
            const deviceId = event.target.value;
            if (deviceId) {
                appState.transition(States.CONNECTING, { deviceId });
            } else {
                appState.transition(States.SCANNING);
            }
        });
        find('atv_picker').addEventListener('change', event => {
            if (event.target.value) appState.transition(States.PAIRING_1, { device: event.target.value });
        });
    }

    function showView(state) {
        const connected = state === States.CONNECTED;
        find('setupScreen').hidden = connected;
        find('runningElements').hidden = !connected;
        find('addNewElements').hidden = true;

        if (connected) {
            const options = device.getSavedDevices().map(({ id, name }) =>
                new Option(name, id, false, id === device.getActiveId()));
            find('remoteDropdown').replaceChildren(...options, new Option('Pair another Apple TV…', ''));
            return;
        }

        const pairing = state === States.PAIRING_1 || state === States.PAIRING_2;
        if (pairing || state === States.SCANNING) {
            find('addNewElements').hidden = false;
            find('results').hidden = true;
            find('pairCodeElements').hidden = !pairing;
            find('scanAgain').hidden = true;
            find('cancelPairing').hidden = !pairing && !device.getActiveId();
        }

        switch (state) {
            case States.SCANNING:
                setStatus('Looking for Apple TVs…');
                break;
            case States.PAIRING_1:
            case States.PAIRING_2:
                setStatus('');
                find('pairCode').value = '';
                find('pairCode').focus();
                break;
            case States.CONNECTING: {
                const retries = appState.connectRetries;
                setStatus(retries ? `Connecting to Apple TV… Attempt ${retries + 1}` : 'Connecting to Apple TV…');
                break;
            }
            case States.INIT:
                setStatus('Starting ATV Remote…');
                break;
        }
    }

    function createDevicePicker(devices) {
        const picker = find('atv_picker');
        picker.replaceChildren(new Option('Select an Apple TV…', ''),
            ...devices.map(({ id, label }) => new Option(label, id)));
        find('results').hidden = devices.length === 0;
        find('scanAgain').hidden = false;
        setStatus(devices.length ? '' : 'No Apple TVs found. Check that both devices are on the same network.');
    }

    function showScanError() {
        find('scanAgain').hidden = false;
        setStatus('Scan failed. Check Local Network access in System Settings.');
    }

    function direction(x, y) {
        if (Math.max(Math.abs(x), Math.abs(y)) < navigationDistance) return null;
        if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
        return y > 0 ? 'down' : 'up';
    }

    function setupNavigation() {
        const pad = document.querySelector('.touch-surface');
        let pointer;
        let suppressClick = false;
        let wheelX = 0;
        let wheelY = 0;
        let lastWheel = 0;
        let lastStep = 0;

        pad.addEventListener('pointerdown', event => {
            if (!event.isPrimary || event.button !== 0) return;
            suppressClick = false;
            pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        });
        window.addEventListener('pointerup', event => {
            if (pointer?.id !== event.pointerId) return;
            const key = direction(event.clientX - pointer.x, event.clientY - pointer.y);
            pointer = null;
            if (key) {
                suppressClick = true;
                window.atvEvents.sendCommand(key);
            }
        });
        window.addEventListener('pointercancel', () => { pointer = null; });
        pad.addEventListener('click', event => {
            if (!suppressClick || event.detail === 0) return;
            suppressClick = false;
            event.stopPropagation();
        }, true);

        pad.addEventListener('wheel', event => {
            if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || event.ctrlKey) return;
            event.preventDefault();
            const now = performance.now();
            if (now - lastWheel > 140) wheelX = wheelY = 0;
            lastWheel = now;
            wheelX -= event.deltaX;
            wheelY -= event.deltaY;
            const key = direction(wheelX, wheelY);
            if (!key || now - lastStep < 120) return;
            wheelX = wheelY = 0;
            lastStep = now;
            window.atvEvents.sendCommand(key);
        }, { passive: false });
    }

    function setupButtons() {
        for (const button of document.querySelectorAll('button[data-key]')) {
            let holdTimer;
            let held = false;
            if (button.dataset.key === 'home') {
                button.addEventListener('pointerdown', event => {
                    if (!event.isPrimary || event.button !== 0) return;
                    held = false;
                    holdTimer = setTimeout(() => {
                        held = true;
                        window.atvEvents.sendCommand('home', true);
                    }, 1000);
                });
                for (const event of ['pointerup', 'pointerleave', 'pointercancel']) {
                    button.addEventListener(event, () => clearTimeout(holdTimer));
                }
            }

            button.addEventListener('click', event => {
                if (held && event.detail > 0) {
                    held = false;
                    return;
                }
                window.atvEvents.sendCommand(button.dataset.key);
            });
        }
    }

    function setStatus(text) {
        find('statusText').textContent = text;
    }

    function showCommandFeedback(text) {
        const feedback = find('cmdFade');
        feedback.textContent = text;
        feedback.classList.add('visible');
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => feedback.classList.remove('visible'), 800);
    }

    function flashButton(key) {
        const button = [...document.querySelectorAll('button[data-key]')]
            .find(element => element.dataset.key === key);
        if (!button) return;
        button.classList.add('is-pressed');
        clearTimeout(button.pressTimer);
        button.pressTimer = setTimeout(() => button.classList.remove('is-pressed'), 160);
    }

    function toggleAltText(showNormal) {
        document.body.classList.toggle('show-shortcuts', !showNormal);
    }

    return { init, createDevicePicker, showScanError, setStatus, showCommandFeedback, flashButton, toggleAltText };
})();

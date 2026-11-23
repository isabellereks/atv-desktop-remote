window.atvDevice = (() => {
    const { States, appState } = window.atvState;
    const api = window.atv;
    let saved = { activeId: null, devices: [] };

    async function load() {
        saved = await api.loadDevices();
    }

    async function finishPair(pin) {
        saved = await api.finishPair(pin);
        return saved.activeId;
    }

    async function connectWithRetry(id) {
        do {
            try {
                if (!await api.connect(id)) return;
                saved.activeId = id;
                appState.transition(States.CONNECTED);
                return;
            } catch {
                if (appState.state !== States.CONNECTING || appState.deviceId !== id) return;
                if (!appState.shouldRetryConnection()) {
                    appState.transition(States.SCANNING);
                    return;
                }
                appState.transition(States.CONNECTING, { deviceId: id, retry: true });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } while (appState.state === States.CONNECTING && appState.deviceId === id);
    }

    return {
        load,
        scan: api.scan,
        startPair: api.startPair,
        cancelPair: api.cancelPair,
        finishPair,
        connectWithRetry,
        sendKey: api.sendKey,
        getKeyboardFocus: api.keyboardFocus,
        getSavedDevices: () => saved.devices,
        getActiveId: () => saved.activeId,
        clearSavedDevices: () => { saved = { activeId: null, devices: [] }; }
    };
})();

const api = window.atv;
const { States, appState } = window.atvState;
const device = window.atvDevice;
const views = window.atvViews;
const events = window.atvEvents;

$(async () => {
    views.init();
    events.init();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', events.handleDarkMode);

    api.onPreferences(({ theme, alwaysOnTop, autoKeyboard }) => {
        localStorage.setItem('uimode', theme);
        localStorage.setItem('alwaysOnTopChecked', String(alwaysOnTop));
        localStorage.setItem('autoKeyboard', String(autoKeyboard));
        events.handleDarkMode();
    });
    api.onClearData(() => {
        localStorage.clear();
        device.clearSavedDevices();
        appState.reset();
        appState.transition(States.SCANNING);
    });

    $('#topTextKBLink').on('click', events.openKeyboard);
    $('#exitLink').on('click', () => api.quit().catch(() => {}));
    $('#cancelPairing').on('click', async () => {
        try {
            await device.cancelPair();
            appState.transition(States.SCANNING);
        } catch {
            views.setStatus('Could not cancel pairing.');
        }
    });

    try {
        events.handleDarkMode();
        await api.setPreferences({
            theme: localStorage.getItem('uimode') || 'systemmode',
            alwaysOnTop: localStorage.getItem('alwaysOnTopChecked') === 'true',
            autoKeyboard: localStorage.getItem('autoKeyboard') !== 'false'
        });
        await device.load();
    } catch {
        $('#initText').hide();
        $('#runningElements').show();
        views.setStatus('Saved pairings are unavailable. Unlock your system keychain and reopen ATV Remote.');
        return;
    }

    if (localStorage.getItem('firstRun') !== 'false') {
        localStorage.setItem('firstRun', 'false');
        await api.showHelp();
    }

    const cleanup = localStorage.getItem('legacyCleanup');
    if (cleanup !== 'done' && cleanup !== 'never') {
        try {
            localStorage.setItem('legacyCleanup', await api.cleanLegacyFiles());
        } catch {
            console.warn('Old ATV Remote files could not be cleaned up.');
        }
    }

    const deviceId = device.getActiveId();
    if (deviceId) {
        appState.transition(States.CONNECTING, { deviceId });
    } else {
        appState.transition(States.SCANNING);
    }
});

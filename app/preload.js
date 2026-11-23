const { contextBridge, ipcRenderer } = require('electron');

const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = channel => callback => ipcRenderer.on(channel, (_event, ...args) => callback(...args));
const role = process.argv.find(arg => arg.startsWith('--atv-window='))?.split('=')[1];

const bridges = {
    remote: {
        async loadDevices() {
            const result = await ipcRenderer.invoke('devices:initialize',
                localStorage.getItem('remote_credentials'), localStorage.getItem('atvcreds'));
            localStorage.removeItem('remote_credentials');
            localStorage.removeItem('atvcreds');
            return result;
        },
        scan: invoke('devices:scan'),
        sendKey: invoke('remote:command'),
        startPair: invoke('devices:start-pair'),
        finishPair: invoke('devices:finish-pair'),
        cancelPair: invoke('devices:cancel-pair'),
        connect: invoke('devices:connect'),
        keyboardFocus: invoke('devices:keyboard-focus'),
        onConnectionLost: listen('devices:connection-lost'),
        isInputVisible: invoke('remote:input-visible'),
        openInput: invoke('remote:open-input'),
        flashTrayIcon: invoke('remote:flash-tray'),
        hide: invoke('remote:hide'),
        quit: invoke('remote:quit'),
        showHelp: invoke('remote:show-help'),
        cleanLegacyFiles: invoke('remote:clean-legacy'),
        setPreferences: invoke('remote:set-preferences'),
        onPreferences: listen('remote:preferences'),
        onClearData: listen('remote:clear-data'),
        onShow: listen('remote:show'),
        onHide: listen('remote:hide'),
        onResume: listen('remote:resume'),
        onKeyboardClosed: listen('remote:keyboard-closed')
    },
    input: {
        sendText: invoke('input:text'),
        keyboardFocus: invoke('input:keyboard-focus'),
        close: invoke('input:close'),
        onOpen: listen('input:open'),
        onClose: listen('input:close'),
        onText: listen('input:current-text'),
        onPreferences: listen('input:preferences')
    },
    hotkey: {
        load: invoke('hotkey:load'),
        save: invoke('hotkey:save'),
        close: invoke('hotkey:close'),
        openDocs: invoke('hotkey:docs')
    }
};

if (Object.hasOwn(bridges, role)) contextBridge.exposeInMainWorld('atv', bridges[role]);

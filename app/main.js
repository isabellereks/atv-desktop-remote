const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, session, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { menubar } = require('menubar');
const { DeviceService } = require('./device-service');

app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');

const files = { remote: 'index.html', input: 'input.html', hotkey: 'hotkey.html' };
const urls = Object.fromEntries(Object.entries(files).map(([role, file]) =>
    [role, pathToFileURL(path.join(__dirname, file)).href]));
const windows = {};
const themes = new Set(['systemmode', 'darkmode', 'lightmode']);
const preferences = { theme: 'systemmode', alwaysOnTop: false, autoKeyboard: true };
const mac = process.platform === 'darwin';
const settingsDir = path.join(process.env.APPDATA || (mac
    ? path.join(app.getPath('home'), 'Library', 'Application Support')
    : path.join(app.getPath('home'), '.local', 'share')), 'ATV Remote');
const hotkeyPath = path.join(settingsDir, 'hotkey.txt');
const remoteSize = { width: 218, height: 554 };
const menuBarItemId = '66d65237-52b1-48cf-8240-b56bcac1155a';

let trayApp;
let inputReady;
let openingInput = false;
let remotePosition;
let positionTimer;
let quitting = false;
let keyboardGeneration = 0;
let lastRemoteShow = 0;
let trayTimers = [];
let normalIcon;
let flashIcon;

const devices = new DeviceService(() => send('remote', 'devices:connection-lost'));

function send(role, channel, ...args) {
    const target = windows[role];
    if (target && !target.isDestroyed()) target.webContents.send(channel, ...args);
}

function webPreferences(role) {
    return {
        preload: path.join(__dirname, 'preload.js'),
        additionalArguments: [`--atv-window=${role}`],
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false
    };
}

function protectWindow(role, window) {
    windows[role] = window;
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('will-attach-webview', event => event.preventDefault());
    window.on('closed', () => {
        if (windows[role] === window) delete windows[role];
    });
}

function handle(role, channel, action, errorMessage = 'ATV Remote could not complete the request.') {
    ipcMain.handle(channel, async (event, ...args) => {
        const window = windows[role];
        if (!window || event.sender !== window.webContents ||
            event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== urls[role]) {
            throw new Error('Unexpected request source.');
        }
        try {
            return await action(...args);
        } catch {
            throw new Error(errorMessage);
        }
    });
}

function syncPreferences() {
    windows.remote?.setAlwaysOnTop(preferences.alwaysOnTop);
    send('remote', 'remote:preferences', preferences);
    send('input', 'input:preferences', preferences);
}

function configureIpc() {
    handle('remote', 'devices:initialize', (...args) => devices.initialize(...args),
        'Saved pairings are unavailable. Unlock your system keychain and reopen ATV Remote.');
    handle('remote', 'devices:scan', () => devices.scan(), 'Could not discover Apple TVs on the local network.');
    handle('remote', 'devices:start-pair', id => devices.startPair(id),
        'Could not start pairing. Check the local network and unlock your system keychain.');
    handle('remote', 'devices:finish-pair', pin => devices.finishPair(pin),
        'Could not pair or save the pairing securely.');
    handle('remote', 'devices:cancel-pair', () => devices.cancelPair());
    handle('remote', 'devices:connect', id => devices.connect(id), 'Could not connect to the paired Apple TV.');
    handle('remote', 'devices:keyboard-focus', () => devices.keyboardFocus());

    handle('remote', 'remote:input-visible', () => Boolean(windows.input?.isVisible()));
    handle('remote', 'remote:open-input', openInput);
    handle('remote', 'remote:flash-tray', flashTray);
    handle('remote', 'remote:hide', hideRemote);
    handle('remote', 'remote:quit', () => app.quit());
    handle('remote', 'remote:show-help', showHelp);
    handle('remote', 'remote:clean-legacy', cleanLegacyFiles);
    handle('remote', 'remote:set-preferences', (values) => {
        if (themes.has(values?.theme)) preferences.theme = values.theme;
        if (typeof values?.alwaysOnTop === 'boolean') preferences.alwaysOnTop = values.alwaysOnTop;
        if (typeof values?.autoKeyboard === 'boolean') preferences.autoKeyboard = values.autoKeyboard;
        syncPreferences();
    });
    handle('remote', 'remote:command', (key, hold) => devices.sendKey(key, hold));

    handle('input', 'input:text', text => {
        if (windows.input?.isVisible()) return devices.setText(text);
    });
    handle('input', 'input:keyboard-focus', () => windows.input?.isVisible() && devices.keyboardFocus());
    handle('input', 'input:close', closeInput);

    handle('hotkey', 'hotkey:load', loadHotkeys);
    handle('hotkey', 'hotkey:save', saveHotkeys, 'Could not save these shortcuts.');
    handle('hotkey', 'hotkey:close', () => windows.hotkey.close());
}

async function openInput() {
    if (openingInput || windows.input?.isVisible()) return;
    openingInput = true;
    const generation = ++keyboardGeneration;
    try {
        await inputReady;
        if (generation !== keyboardGeneration || !windows.input) return;
        windows.input.show();
        send('input', 'input:open', preferences);
        const value = await devices.getText();
        if (generation === keyboardGeneration) send('input', 'input:current-text', value);
    } finally {
        openingInput = false;
    }
}

function closeInput() {
    send('remote', 'remote:keyboard-closed');
    showRemote();
}

function createInputWindow() {
    const window = new BrowserWindow({
        show: false, width: 600, height: 250, minimizable: false, maximizable: false,
        webPreferences: webPreferences('input')
    });
    protectWindow('input', window);
    window.setMenu(null);
    window.on('hide', () => {
        keyboardGeneration++;
        send('input', 'input:close');
    });
    window.on('close', event => {
        if (quitting) return;
        event.preventDefault();
        closeInput();
    });
    window.on('blur', () => {
        if (window.isVisible() && !preferences.alwaysOnTop && Date.now() - lastRemoteShow >= 100) {
            closeInput();
        }
    });
    inputReady = window.loadFile(path.join(__dirname, files.input));
    inputReady.catch(() => console.error('Could not load the keyboard window.'));
}

function openHotkeyWindow() {
    if (windows.hotkey) {
        windows.hotkey.focus();
        return;
    }
    const window = new BrowserWindow({
        width: 500, height: 500, webPreferences: webPreferences('hotkey')
    });
    protectWindow('hotkey', window);
    window.setMenu(null);
    window.on('closed', () => { if (!quitting) registerHotkeys(); });
    window.loadFile(path.join(__dirname, files.hotkey)).catch(() => {
        console.error('Could not load the shortcuts window.');
        window.close();
    });
}

function loadHotkeys() {
    try {
        return fs.readFileSync(hotkeyPath, 'utf8').split(',').map(key => key.trim()).filter(Boolean);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

function saveHotkeys(hotkeys) {
    if (!Array.isArray(hotkeys) || hotkeys.length > 32 ||
        hotkeys.some(key => typeof key !== 'string' || !/^[a-z0-9]+(?:\+[a-z0-9]+)*$/i.test(key) || key.length > 100)) {
        throw new Error('Invalid shortcuts.');
    }
    if (hotkeys.length) {
        fs.mkdirSync(settingsDir, { recursive: true });
        fs.writeFileSync(hotkeyPath, hotkeys.join(','), { mode: 0o600 });
    } else {
        fs.rmSync(hotkeyPath, { force: true });
    }
    windows.hotkey.close();
}

function showRemote() {
    if (!windows.remote) return;
    lastRemoteShow = Date.now();
    keyboardGeneration++;
    windows.input?.hide();
    if (mac) app.show();
    trayApp.showWindow().catch(() => console.error('Could not open the remote window.'));
}

function hideRemote() {
    trayApp.hideWindow();
    if (mac) app.hide();
}

function registerHotkeys() {
    globalShortcut.unregisterAll();
    const toggle = () => windows.remote?.isVisible() ? hideRemote() : showRemote();
    const defaults = mac ? ['Super+Shift+R', 'Command+Control+R'] : ['Super+Shift+R'];
    let hotkeys = [];
    try { hotkeys = loadHotkeys(); } catch { console.error('Could not load shortcuts.'); }
    const register = key => {
        try { return globalShortcut.register(key, toggle); } catch { return false; }
    };
    if (!hotkeys.length || !hotkeys.map(register).every(Boolean)) defaults.forEach(register);
}

function setUpTrayAnimation() {
    if (!mac || !fs.existsSync(path.join(settingsDir, 'animate_icon'))) return;
    normalIcon = nativeImage.createFromPath(path.join(__dirname, 'images', 'icon.png'));
    flashIcon = nativeImage.createFromPath(path.join(__dirname, 'images', 'icon-dark.png'));
    normalIcon.setTemplateImage(true);
}

function flashTray() {
    if (!flashIcon) return;
    trayTimers.forEach(clearTimeout);
    trayTimers = [];
    for (let i = 0; i < 4; i++) {
        trayTimers.push(setTimeout(() => trayApp.tray.setImage(flashIcon), i * 40));
        trayTimers.push(setTimeout(() => trayApp.tray.setImage(normalIcon), i * 40 + 20));
    }
}

async function showHelp() {
    await dialog.showMessageBox({
        type: 'info', title: 'ATV Remote',
        message: 'Pair your Apple TV to use your Mac as a remote.',
        detail: 'Drag the grip at the top to move the remote. Press Option to see keyboard controls, or Command+Shift+R to reopen the remote from anywhere.'
    });
    showRemote();
}

async function cleanLegacyFiles() {
    const found = ['env', 'wsserver.py', 'start_server.sh', 'start_server.bat', 'atv_pip_install.log']
        .map(name => path.join(settingsDir, name)).filter(file => fs.existsSync(file));
    if (!found.length) return 'done';
    const result = await dialog.showMessageBox({
        type: 'question', buttons: ['Clean Up', 'Not Now', 'Don’t Ask Again'],
        defaultId: 1, cancelId: 1, message: 'Remove old app files?',
        detail: 'Files from the older Python-based version of ATV Remote are no longer needed.'
    });
    if (result.response === 2) return 'never';
    if (result.response === 1) return 'pending';
    for (const file of found) fs.rmSync(file, { recursive: true, force: true });
    return 'done';
}

async function clearData() {
    const result = await dialog.showMessageBox({
        type: 'warning', buttons: ['Cancel', 'Clear'], defaultId: 0, cancelId: 0,
        message: 'Clear all saved data?',
        detail: 'This will remove saved pairings and preferences. You will need to pair your Apple TV again.'
    });
    if (result.response !== 1) return;
    try {
        await devices.clear();
        clearTimeout(positionTimer);
        remotePosition = undefined;
        fs.rmSync(remotePositionPath(), { force: true });
        const browserWindow = trayApp.getOption('browserWindow');
        delete browserWindow.x;
        delete browserWindow.y;
        Object.assign(preferences, { theme: 'systemmode', alwaysOnTop: false, autoKeyboard: true });
        windows.input?.hide();
        syncPreferences();
        send('remote', 'remote:clear-data');
    } catch {
        dialog.showErrorBox('ATV Remote', 'Could not clear saved pairings.');
    }
}

function showTrayMenu() {
    const appearance = [
        ['systemmode', 'Follow system settings'], ['darkmode', 'Dark mode'], ['lightmode', 'Light mode']
    ].map(([theme, label]) => ({
        label, type: 'radio', checked: preferences.theme === theme,
        click: () => { preferences.theme = theme; syncPreferences(); }
    }));
    const menu = Menu.buildFromTemplate([
        { label: 'Always on-top', type: 'checkbox', checked: preferences.alwaysOnTop,
            click: item => { preferences.alwaysOnTop = item.checked; syncPreferences(); } },
        { label: 'Automatically open/close keyboard', type: 'checkbox', checked: preferences.autoKeyboard,
            click: item => { preferences.autoKeyboard = item.checked; syncPreferences(); } },
        { type: 'separator' },
        { role: 'about', label: 'About' },
        { type: 'separator' },
        { label: 'Appearance', submenu: appearance },
        { label: 'Change hotkey', click: openHotkeyWindow },
        { type: 'separator' },
        { label: 'Clear saved data', click: clearData },
        { type: 'separator' },
        { role: 'quit', label: 'Quit' }
    ]);
    trayApp.tray.popUpContextMenu(menu);
}

function loadRemotePosition() {
    try {
        const { x, y } = JSON.parse(fs.readFileSync(remotePositionPath(), 'utf8'));
        if (Number.isInteger(x) && Number.isInteger(y)) return { x, y };
    } catch {
        // A missing or damaged preference falls back to the tray position.
    }
}

function remotePositionPath() {
    return path.join(app.getPath('userData'), 'remote-position.json');
}

function saveRemotePosition() {
    clearTimeout(positionTimer);
    if (!remotePosition) return;
    try {
        fs.writeFileSync(remotePositionPath(), JSON.stringify(remotePosition), { mode: 0o600 });
    } catch {
        console.warn('Could not save the remote position.');
    }
}

function restoreRemotePosition() {
    if (!remotePosition) return;
    const { x, y, width, height } = screen.getDisplayMatching({ ...remotePosition, ...remoteSize }).workArea;
    const browserWindow = trayApp.getOption('browserWindow');
    browserWindow.x = Math.max(x, Math.min(remotePosition.x, x + width - remoteSize.width));
    browserWindow.y = Math.max(y, Math.min(remotePosition.y, y + height - remoteSize.height));
}

function createTray() {
    remotePosition = loadRemotePosition();
    let tray;
    if (mac) {
        const icon = nativeImage.createFromPath(path.join(__dirname, 'images', 'icon.png'));
        icon.setTemplateImage(true);
        tray = new Tray(icon, menuBarItemId);
    }
    trayApp = menubar({
        index: urls.remote, icon: path.join(__dirname, 'IconTemplate.png'), tray,
        tooltip: 'ATV Remote',
        preloadWindow: true, showDockIcon: false,
        browserWindow: {
            ...remoteSize, transparent: true, resizable: false, hasShadow: false,
            backgroundColor: '#00000000', webPreferences: webPreferences('remote')
        }
    });
    trayApp.on('show', restoreRemotePosition);
    trayApp.on('before-load', () => {
        const window = trayApp.window;
        protectWindow('remote', window);
        window.on('will-move', (_event, { x, y }) => {
            remotePosition = { x, y };
            clearTimeout(positionTimer);
            positionTimer = setTimeout(saveRemotePosition, 200);
        });
        window.on('show', () => {
            send('remote', 'remote:show');
        });
        window.on('hide', () => {
            send('remote', 'remote:hide');
        });
    });
    trayApp.on('ready', () => {
        setUpTrayAnimation();
        trayApp.tray.on('right-click', showTrayMenu);
        registerHotkeys();
    });
}

function configureLocalSession() {
    const localSession = session.defaultSession;
    localSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    localSession.setPermissionCheckHandler(() => false);
    localSession.setSpellCheckerEnabled(false);
    localSession.webRequest.onBeforeRequest(({ url }, callback) => {
        if (url.startsWith('data:')) {
            callback({ cancel: false });
            return;
        }
        let bundled = false;
        if (url.startsWith('file:')) {
            try {
                const relative = path.relative(__dirname, fileURLToPath(url));
                bundled = relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
            } catch {
                // Reject malformed file URLs.
            }
        }
        callback({ cancel: !bundled });
    });
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', showRemote);
    app.on('activate', showRemote);
    app.on('before-quit', () => {
        quitting = true;
        if (positionTimer) saveRemotePosition();
        trayTimers.forEach(clearTimeout);
        globalShortcut.unregisterAll();
        devices.cancelPair();
        devices.disconnect();
    });
    app.whenReady().then(() => {
        configureLocalSession();
        configureIpc();
        createInputWindow();
        createTray();
        powerMonitor.on('resume', () => send('remote', 'remote:resume'));
        app.setAboutPanelOptions({
            applicationName: 'ATV Remote', applicationVersion: app.getVersion(), credits: 'Brian Harper',
            iconPath: path.join(__dirname, 'images', 'full.png')
        });
    }).catch(() => {
        console.error('ATV Remote could not start.');
        app.quit();
    });
}

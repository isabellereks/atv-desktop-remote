const api = window.atv;
const input = document.getElementById('textInput');
const wrapper = input.parentElement;
const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');

let focusPoll;
let textTimer;
let session = 0;
let typing = false;
let focusLost = 0;
let theme = 'systemmode';
let autoKeyboard = true;

function updateTheme() {
    document.body.classList.toggle('darkMode',
        theme === 'darkmode' || (theme === 'systemmode' && colorScheme.matches));
}

function updatePreferences(preferences) {
    theme = preferences.theme;
    autoKeyboard = preferences.autoKeyboard;
    updateTheme();
}

function cleanup() {
    session++;
    clearInterval(focusPoll);
    clearTimeout(textTimer);
    textTimer = undefined;
    input.value = '';
    typing = false;
}

async function close() {
    await api.close();
}

api.onPreferences(updatePreferences);
api.onOpen(preferences => {
    cleanup();
    updatePreferences(preferences);
    focusLost = 0;
    input.focus();

    let checking = false;
    const currentSession = session;
    focusPoll = setInterval(async () => {
        if (checking) return;
        checking = true;
        const focused = await api.keyboardFocus().catch(() => false);
        checking = false;
        if (currentSession !== session) return;
        wrapper.classList.toggle('good', focused);
        wrapper.classList.toggle('bad', !focused);
        focusLost = focused ? 0 : focusLost + 1;
        if (autoKeyboard && focusLost >= 2) close().catch(() => {});
    }, 1000);
});
api.onClose(cleanup);
api.onText(text => {
    if (!typing) input.value = text;
});

input.addEventListener('input', () => {
    typing = true;
    clearTimeout(textTimer);
    textTimer = setTimeout(() => {
        textTimer = undefined;
        api.sendText(input.value).catch(() => {});
    }, 100);
});
document.addEventListener('keydown', async event => {
    if (event.key !== 'Escape' && event.key !== 'Enter') return;
    if (event.key === 'Enter' && textTimer !== undefined) {
        clearTimeout(textTimer);
        textTimer = undefined;
        await api.sendText(input.value).catch(() => {});
    }
    close().catch(() => {});
});
colorScheme.addEventListener('change', updateTheme);
updateTheme();

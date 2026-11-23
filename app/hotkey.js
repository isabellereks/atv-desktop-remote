const api = window.atv;

function createOption (text, value, selected) {
    if (typeof selected === 'undefined') {
        selected = true;
    }
    var option = document.createElement("option");
    option.text = text;
    option.value = value;
    option.selected = selected;
    return option;
}

function addHotkeys() {
    var combo = $('#parsed-hotkeys').val();
    if (!combo || combo.trim() === '') {
        return;
    }
    // no dupes
    if ($('#all_hotkeys option').toArray().every(option => option.value !== combo)) {
        $('#all_hotkeys').append(createOption(combo, combo));
    }
    $('#hotkeys').val(null).trigger("change");
    $('#parsed-hotkeys').val('');
    addHotkeyOption();
}
function showAllHotkeys() {
    var hotkeys = $('#all_hotkeys').val() || [];
    $('#all-parsed-hotkeys').val(hotkeys.join(','));
}

function saveHotkey() {
    api.save($('#all_hotkeys').val() || []).catch(() => {
        window.alert('Could not save these shortcuts.');
    });
}

function hotkeysFromParsed(parsedHotkeys) {
    var hotkeys = [];
    var keys = parsedHotkeys.split('+');
    keys.forEach(function(key) {
        if (key.length === 1) {
            hotkeys.push(key.toUpperCase());
        } else {
            hotkeys.push(key);
        }
    });
    return hotkeys;
}
function _addHotkeyOption() {
    $('#select2-all_hotkeys-container .select2-selection__choice__display').on('click', function(e) {
        e.stopPropagation();
        var hotkey = $(this).text();

        $('#all_hotkeys option').filter((_index, option) => option.value === hotkey).remove();
        $('#all_hotkeys').trigger('change');

        var keys = hotkey.split('+');
        $('#hotkeys').val(keys).trigger('change');
    });
    showAllHotkeys();
}
function addHotkeyOption() {
    setTimeout(() => {
        _addHotkeyOption();
    }, 10);
}

$(document).ready(async function() {
    $("#addHotkeys").on("click", addHotkeys);
    $("#saveHotkey").on("click", saveHotkey);
    $("#cancelHotkey").on("click", () => api.close());
    var metaKeys = ["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "AltGr", "Shift", "Super"];
    metaKeys.forEach(function(key) {
        var option = document.createElement("option");
        option.text = key;
        option.value = key;
        $('#hotkeys').append(option);
    });

    // Add uppercase letters A-Z
    for (var i = 65; i <= 90; i++) {
        var letter = String.fromCharCode(i);
        var option = document.createElement("option");
        option.text = letter;
        option.value = letter;
        $('#hotkeys').append(option);
    }

    // Add numbers 0-9
    for (var i = 0; i <= 9; i++) {
        var option = document.createElement("option");
        option.text = i;
        option.value = i;
        $('#hotkeys').append(option);
    }
    $('#hotkeys').select2();
    $('#hotkeys').select2({
        placeholder: 'Select keys for combination',
        allowClear: true
    });

    $('#hotkeys').on('change', function() {
        var hotkeys = $(this).val() || [];
        $('#parsed-hotkeys').val(hotkeys.join('+'));
    });
    $('#all_hotkeys').select2({
        placeholder: 'Review your hotkey combinations',
        tags: true,
        minimumResultsForSearch: -1
    });
    $("#all_hotkeys").on('change', function() {
        showAllHotkeys();
    });

    $('#all_hotkeys').on('select2:opening', function(e) {
        e.preventDefault();
    });

    const { shortcuts, defaultHotkey } = await api.load();
    document.getElementById('defaultHotkey').textContent = defaultHotkey;
    shortcuts.forEach(hotkey => $('#all_hotkeys').append(createOption(hotkey, hotkey)));
    addHotkeyOption();
    if (shortcuts.length === 0) {
        $('#hotkeys').val(hotkeysFromParsed(defaultHotkey)).trigger('change');
    }
});

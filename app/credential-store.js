const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isIP } = require('node:net');
const { app, safeStorage } = require('electron');

function normalizeCredentials(value) {
    if (!value || typeof value !== 'object') return null;
    const companion = value.companion || value.Companion;
    if (typeof companion !== 'string' || !companion || companion.length > 4096) return null;

    const result = { companion, airplay: '' };
    const device = value.device;
    const identifier = device?.identifier || value.identifier;
    if (typeof identifier === 'string' && identifier.length <= 255) result.identifier = identifier;
    const airplay = value.airplay || value.credentials;
    if (typeof airplay === 'string' && airplay.length <= 4096) result.airplay = airplay;
    if (device && typeof device.address === 'string' && isIP(device.address) &&
        Number.isInteger(device.port) && device.port > 0 && device.port <= 65535) {
        result.device = {
            name: typeof device.name === 'string' ? device.name.slice(0, 512) : 'Apple TV',
            address: device.address,
            port: device.port,
            identifier: result.identifier
        };
        if (Number.isInteger(device.airplayPort) && device.airplayPort > 0 && device.airplayPort <= 65535) {
            result.device.airplayPort = device.airplayPort;
        }
    }
    return result;
}

async function requireEncryption() {
    if (!await safeStorage.isAsyncEncryptionAvailable() ||
        (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
        throw new Error('Secure storage is unavailable. Unlock your system keychain before pairing.');
    }
}

class CredentialStore {
    pending = Promise.resolve();

    run(operation) {
        const result = this.pending.then(operation);
        this.pending = result.catch(() => {});
        return result;
    }

    get file() {
        return path.join(app.getPath('userData'), 'apple-tv-pairings');
    }

    async read() {
        let encrypted;
        try {
            encrypted = fs.readFileSync(this.file);
        } catch (error) {
            if (error.code === 'ENOENT') return { devices: [], activeId: null };
            throw error;
        }
        await requireEncryption();
        let decrypted = await safeStorage.decryptStringAsync(encrypted);
        if (decrypted.shouldReEncrypt) decrypted = await safeStorage.decryptStringAsync(encrypted);
        return JSON.parse(decrypted.result);
    }

    async write(state) {
        await requireEncryption();
        const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(state));
        const dir = fs.mkdtempSync(path.join(path.dirname(this.file), '.pairings-'));
        try {
            const temp = path.join(dir, 'data');
            fs.writeFileSync(temp, encrypted, { mode: 0o600 });
            fs.renameSync(temp, this.file);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    async migrate(legacyDevices, legacyActive) {
        if (typeof legacyDevices !== 'string' && typeof legacyActive !== 'string') return;
        const state = await this.read();
        if (state.migrated) return;

        const parse = (value) => {
            try { return JSON.parse(value); } catch { return null; }
        };
        const entries = parse(legacyDevices);
        if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
            for (const [name, value] of Object.entries(entries)) {
                const credentials = normalizeCredentials(value);
                if (!credentials) continue;
                if (state.devices.some(device => device.credentials.companion === credentials.companion)) continue;
                state.devices.push({ id: randomUUID(), name: name.slice(0, 512), credentials });
            }
        }
        const active = normalizeCredentials(parse(legacyActive));
        if (active) {
            let entry = state.devices.find(device => device.credentials.companion === active.companion);
            if (!entry) {
                entry = { id: randomUUID(), name: active.device?.name || 'Apple TV', credentials: active };
                state.devices.push(entry);
            }
            state.activeId ||= entry.id;
        }
        state.activeId ||= state.devices[0]?.id || null;
        await this.write({ ...state, migrated: true });
    }

    summary(state) {
        return {
            activeId: state.activeId,
            devices: state.devices.map(({ id, name }) => ({ id, name }))
        };
    }

    clear() {
        fs.rmSync(this.file, { force: true });
    }
}

module.exports = { CredentialStore, normalizeCredentials, requireEncryption };

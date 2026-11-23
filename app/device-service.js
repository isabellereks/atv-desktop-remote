const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const atv = require('@bharper/atv-js');
const { CredentialStore, normalizeCredentials, requireEncryption } = require('./credential-store');

const keys = new Set([
    'up', 'down', 'left', 'right', 'select', 'menu', 'home', 'home_hold', 'top_menu',
    'play_pause', 'skip_backward', 'skip_forward', 'volume_up', 'volume_down', 'volume_mute'
]);

class DeviceService {
    store = new CredentialStore();
    discovered = new Map();
    generation = 0;
    pairing = null;
    connection = null;

    constructor(onConnectionLost) {
        this.onConnectionLost = onConnectionLost;
    }

    initialize(legacyDevices, legacyActive) {
        if ([legacyDevices, legacyActive].some(value => typeof value === 'string' && value.length > 262144)) {
            throw new Error('Saved pairings could not be migrated.');
        }
        return this.store.run(async () => {
            await this.store.migrate(legacyDevices, legacyActive);
            return this.store.summary(await this.store.read());
        });
    }

    async scan() {
        if (!this.scanInFlight) {
            this.scanInFlight = atv.scan(5000).then(devices => {
                this.discovered = new Map(devices.map(device => [randomUUID(), device]));
                return Array.from(this.discovered, ([id, device]) => ({
                    id, label: `${device.name} (${device.address})`
                }));
            }).finally(() => { this.scanInFlight = null; });
        }
        return this.scanInFlight;
    }

    async startPair(id) {
        await requireEncryption();
        const device = this.discovered.get(id);
        if (!device) throw new Error('Scan for your Apple TV and select it again.');

        this.cancelPair();
        const pairing = { device };
        this.pairing = pairing;
        try {
            pairing.session = await atv.startCompanionPairing(device);
        } catch {
            // A canceled session may already have been replaced.
            if (this.pairing === pairing) this.pairing = null;
            throw new Error('Could not start Apple TV pairing.');
        }
        if (this.pairing !== pairing) {
            pairing.session._companionProtocol?.close();
            throw new Error('Pairing was canceled.');
        }
    }

    async finishPair(pin) {
        const pairing = this.pairing;
        if (typeof pin !== 'string' || !/^\d{4}$/.test(pin) || !pairing?.session || pairing.finishing) {
            throw new Error('Enter the four-digit PIN from your Apple TV.');
        }
        pairing.finishing = true;
        try {
            const companion = atv.serializeCredentials(await atv.finishCompanionPairing(pairing.session, pin));
            pairing.session = null;
            if (this.pairing !== pairing) throw new Error('Pairing was canceled.');
            const credentials = normalizeCredentials({ companion, device: pairing.device });
            return await this.store.run(async () => {
                if (this.pairing !== pairing) throw new Error('Pairing was canceled.');
                const state = await this.store.read();
                if (this.pairing !== pairing) throw new Error('Pairing was canceled.');
                const identifier = credentials?.device?.identifier;
                const existing = identifier && state.devices.find(entry =>
                    entry.credentials.identifier === identifier);
                const id = existing?.id || randomUUID();
                if (!credentials?.device) throw new Error('Apple TV reported an invalid network address.');
                const entry = { id, name: credentials.device.name, credentials };
                state.devices = state.devices.filter(device => device.id !== id);
                state.devices.push(entry);
                state.activeId = id;
                await this.store.write(state);
                return this.store.summary(state);
            });
        } finally {
            if (this.pairing === pairing) this.cancelPair();
        }
    }

    cancelPair() {
        const pairing = this.pairing;
        this.pairing = null;
        pairing?.session?._companionProtocol?.close();
    }

    async connect(id) {
        this.disconnect();
        const attempt = this.generation;
        const state = await this.store.run(() => this.store.read());
        const entry = state.devices.find(device => device.id === id);
        if (!entry) throw new Error('Apple TV pairing was not found.');

        const credentials = entry.credentials;
        let device = credentials.device;
        if (!device) {
            const devices = await atv.scan(5000);
            device = credentials.identifier
                ? devices.find(candidate => candidate.identifier === credentials.identifier)
                : (devices.length === 1 ? devices[0] : null);
            if (!device) throw new Error('Could not find the paired Apple TV.');
        }
        if (attempt !== this.generation) return false;
        const connection = await atv.connect(device, credentials);
        if (attempt !== this.generation) {
            atv.disconnect(connection);
            return false;
        }
        try {
            const saved = await this.store.run(async () => {
                const latest = await this.store.read();
                const current = latest.devices.find(device => device.id === id);
                if (attempt !== this.generation || current?.credentials.companion !== credentials.companion) {
                    return false;
                }
                if (latest.activeId !== id || !connection.usedCredentialsMatchProvided || !credentials.device) {
                    const updated = normalizeCredentials(connection.usedCredentials);
                    if (updated) current.credentials = updated;
                    latest.activeId = id;
                    await this.store.write(latest);
                }
                return true;
            });
            if (!saved || attempt !== this.generation) {
                atv.disconnect(connection);
                return false;
            }
        } catch (error) {
            atv.disconnect(connection);
            throw error;
        }
        this.connection = connection;
        atv.onConnectionLost(connection, () => {
            if (this.connection !== connection) return;
            this.connection = null;
            this.onConnectionLost();
        });
        return true;
    }

    disconnect() {
        this.generation++;
        const connection = this.connection;
        this.connection = null;
        if (connection) atv.disconnect(connection);
    }

    async sendKey(key, hold) {
        if (!keys.has(key) || !this.connection) return;
        await atv.sendKey(this.connection, hold === true && key === 'home' ? 'home_hold' : key);
    }

    async keyboardFocus() {
        return Boolean(this.connection && await atv.getKeyboardFocusState(this.connection));
    }

    async getText() {
        const connection = this.connection;
        for (let attempt = 0; attempt < 4 && connection && connection === this.connection; attempt++) {
            const text = await atv.getText(connection);
            if (text || attempt === 3) return text || '';
            await delay(100);
        }
        return '';
    }

    async setText(text) {
        if (typeof text === 'string' && text.length <= 16384 && this.connection) {
            await atv.setText(this.connection, text);
        }
    }

    clear() {
        this.cancelPair();
        this.disconnect();
        return this.store.run(() => this.store.clear());
    }
}

module.exports = { DeviceService };

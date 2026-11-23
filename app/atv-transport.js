const { BlockList, isIP } = require('node:net');
const { networkInterfaces } = require('node:os');
const atv = require('@bharper/atv-js');
const { CompanionConnection, FrameType } = require('@bharper/atv-js/dist/companion/connection.js');
const { readTlv, TlvValue } = require('@bharper/atv-js/dist/pairing/tlv.js');

const privateAddresses = new BlockList();
for (const [address, prefix] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16]]) {
    privateAddresses.addSubnet(address, prefix);
}
privateAddresses.addSubnet('fc00::', 7, 'ipv6');
privateAddresses.addSubnet('fe80::', 10, 'ipv6');

function isLanEndpoint(address, port, interfaces = networkInterfaces()) {
    if (typeof address !== 'string' || !Number.isInteger(port) || port < 1 || port > 65535) return false;
    const version = isIP(address);
    if (!version) return false;

    const family = version === 4 ? 'ipv4' : 'ipv6';
    const [host, zone] = address.split('%');
    if (!privateAddresses.check(host, family)) return false;

    for (const [name, entries] of Object.entries(interfaces)) {
        for (const entry of entries) {
            if (entry.internal || isIP(entry.address) !== version || !entry.cidr) continue;
            if (zone && zone !== name && zone !== String(entry.scopeid)) continue;

            const [local, prefix] = entry.cidr.split('/');
            const subnet = new BlockList();
            subnet.addSubnet(local.split('%')[0], Number(prefix), family);
            if (subnet.check(host, family)) return true;
        }
    }
    return false;
}

// atv-js also opens sockets to addresses found during its internal reconnect scan.
// Guard the shared Companion socket entry point so those retries use the same LAN policy.
const connectCompanion = CompanionConnection.prototype.connect;
CompanionConnection.prototype.connect = async function () {
    if (!isLanEndpoint(this.host, this.port)) {
        throw new Error('The Apple TV address is outside the local network.');
    }
    return connectCompanion.call(this);
};

async function scan() {
    const devices = await atv.scan(5000);
    const interfaces = networkInterfaces();
    return devices.filter(({ address, port }) => isLanEndpoint(address, port, interfaces));
}

async function finishPairing(session, pin) {
    // atv-js 0.3.4 parses the SRP response but does not check the server proof.
    // Require it before the library sends the controller identity.
    const protocol = session._companionProtocol;
    const exchange = protocol.exchangeAuth;
    protocol.exchangeAuth = async function (frame, request) {
        const response = await exchange.call(this, frame, request);
        if (frame === FrameType.PS_Next && readTlv(request._pd).get(TlvValue.SeqNo)?.[0] === 3) {
            const proof = Buffer.isBuffer(response?._pd) && readTlv(response._pd).get(TlvValue.Proof);
            if (!proof || proof.length !== 64) throw new Error('The Apple TV did not authenticate the pairing.');
            session._companionProcedure.srp.srpClient.checkM2(proof);
        }
        return response;
    };
    try {
        return await atv.finishCompanionPairing(session, pin);
    } finally {
        protocol.exchangeAuth = exchange;
    }
}

module.exports = { atv, scan, finishPairing, isLanEndpoint };

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const { CompanionConnection } = require('@bharper/atv-js/dist/companion/connection.js');
const { CompanionPairSetupProcedure } = require('@bharper/atv-js/dist/companion/auth.js');
const { SRPAuthHandler } = require('@bharper/atv-js/dist/pairing/srp.js');
const { readTlv, writeTlv, TlvValue } = require('@bharper/atv-js/dist/pairing/tlv.js');
const { SRP, SrpServer } = require('fast-srp-hap');
const { isLanEndpoint, finishPairing } = require('../atv-transport');

test('only private literal addresses on an attached subnet are eligible', () => {
    const interfaces = {
        ethernet: [
            { address: '10.17.2.21', cidr: '10.17.2.21/24', internal: false },
            { address: 'fd00:11::11', cidr: 'fd00:11::11/64', internal: false }
        ],
        loopback: [{ address: '127.0.0.1', cidr: '127.0.0.1/8', internal: true }],
        public: [{ address: '198.51.100.10', cidr: '198.51.100.10/24', internal: false }]
    };
    assert.equal(isLanEndpoint('10.17.2.88', 49153, interfaces), true);
    assert.equal(isLanEndpoint('fd00:11::12', 49153, interfaces), true);
    for (const address of ['10.17.3.88', 'fd00:12::12', '198.51.100.11', '127.0.0.1', 'tv.local', '224.0.0.251']) {
        assert.equal(isLanEndpoint(address, 49153, interfaces), false, address);
    }
    assert.equal(isLanEndpoint('10.17.2.88', 65536, interfaces), false);
});

test('the Companion socket entry point refuses a non-LAN destination', async () => {
    const connection = new CompanionConnection('198.51.100.11', 49153);
    await assert.rejects(connection.connect(), /outside the local network/);
});

function pairingWithProof(changeProof) {
    const pin = '0741';
    const salt = randomBytes(16);
    const server = new SrpServer(SRP.params.hap, salt, Buffer.from('Pair-Setup'), Buffer.from(pin), randomBytes(32));
    const srp = new SRPAuthHandler();
    srp.initialize();
    const controllerIdentity = new Error('Controller identity step reached');
    const protocol = {
        async exchangeAuth(_frame, request) {
            const values = readTlv(request._pd);
            if (values.get(TlvValue.SeqNo)[0] === 5) throw controllerIdentity;
            server.setA(values.get(TlvValue.PublicKey));
            server.checkM1(values.get(TlvValue.Proof));
            const proof = changeProof(server.computeM2());
            const result = new Map([[TlvValue.SeqNo, Buffer.from([4])]]);
            if (proof) result.set(TlvValue.Proof, proof);
            return { _pd: writeTlv(result) };
        }
    };
    const procedure = new CompanionPairSetupProcedure(protocol, srp);
    procedure.atvSalt = salt;
    procedure.atvPubKey = server.computeB();
    const session = { _type: 'companion', _companionProtocol: protocol, _companionProcedure: procedure };
    return { run: () => finishPairing(session, pin), controllerIdentity };
}

test('pairing checks the SRP server proof before sending controller identity', async () => {
    const valid = pairingWithProof(proof => proof);
    await assert.rejects(valid.run(), error => error === valid.controllerIdentity);

    const altered = pairingWithProof(proof => {
        const copy = Buffer.from(proof);
        copy[0] ^= 1;
        return copy;
    });
    await assert.rejects(altered.run(), /server is not authentic/);

    const missing = pairingWithProof(() => undefined);
    await assert.rejects(missing.run(), /did not authenticate/);
});

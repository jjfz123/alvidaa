'use strict'

// Deliberately constrained PoC: fixed package, fixed path, fixed commands.
// It cannot execute caller-supplied commands or install a caller-selected IPK.

const crypto = require('crypto')
const fs = require('fs')
const net = require('net')

const SOCKET = '/var/run/superwatch_socket'
const IPK = '/APPS/root-probe.ipk'
const PACKAGE = 're.rootprobe'
const PROOF = '/APPS/.re_root_probe/PROOF'
const STATUS = '/APPS/pkgs/opkgmeta/status'
const SAFE_IPK_SHA256 = 'a37db332d49c8efce7da65a305ba9790d2d422fa36b30be83266359884a7fd34'

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function selectedStatusLines(path) {
    try {
        return fs.readFileSync(path, 'utf8')
            .split('\n')
            .filter(line => /^(Uid|Gid|Groups|CapEff|CapBnd|NoNewPrivs):/.test(line))
    } catch (error) {
        return ['unreadable: ' + error.message]
    }
}

function sha256(path) {
    return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')
}

function packagePresent() {
    try {
        return /^Package: re\.rootprobe$/m.test(fs.readFileSync(STATUS, 'utf8'))
    } catch (error) {
        return null
    }
}

function socketMetadata() {
    try {
        const stat = fs.statSync(SOCKET)
        return {
            uid: stat.uid,
            gid: stat.gid,
            mode: '0' + (stat.mode & 0o777).toString(8)
        }
    } catch (error) {
        return { error: error.message }
    }
}

function currentState() {
    let proof = null
    try { proof = fs.readFileSync(PROOF, 'utf8') } catch (error) {}
    return {
        runtimeIdentity: selectedStatusLines('/proc/self/status'),
        socket: socketMetadata(),
        ipkPresent: fs.existsSync(IPK),
        packagePresent: packagePresent(),
        proofPresent: proof !== null,
        proof
    }
}

function socketRequest(payload, timeoutMs) {
    return new Promise(resolve => {
        const chunks = []
        let complete = false
        let client

        function finish(reason, error) {
            if (complete) return
            complete = true
            const data = Buffer.concat(chunks)
            resolve({
                reason,
                error: error ? error.message : null,
                bytes: data.length,
                text: data.toString('utf8').slice(0, 256)
            })
        }

        client = net.createConnection(SOCKET, () => {
            const body = Buffer.from(payload, 'utf8')
            const header = Buffer.alloc(4)
            header.writeUInt32LE(body.length, 0)
            client.write(Buffer.concat([header, body]))
        })
        client.setTimeout(timeoutMs)
        client.on('data', chunk => chunks.push(chunk))
        client.on('end', () => finish('end'))
        client.on('timeout', () => {
            client.destroy()
            finish('timeout')
        })
        client.on('error', error => finish('error', error))
    })
}

async function waitFor(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (predicate()) return true
        await sleep(500)
    }
    return predicate()
}

async function installProbe() {
    if (!fs.existsSync(IPK)) throw new Error('missing staged IPK: ' + IPK)
    const digest = sha256(IPK)
    if (digest !== SAFE_IPK_SHA256) {
        throw new Error('refusing unexpected IPK sha256: ' + digest)
    }

    const payload = '91:53:91;' + IPK + ';' + PACKAGE + ';'
    const reply = await socketRequest(payload, 15000)
    const effectObserved = await waitFor(() => fs.existsSync(PROOF), 15000)
    return {
        action: 'install',
        effectObserved,
        note: 'The socket reply is not treated as the privilege oracle.',
        reply,
        state: currentState()
    }
}

async function cleanupProbe(removeHelper) {
    const reply = await socketRequest('91:54:' + PACKAGE, 15000)
    const effectObserved = await waitFor(
        () => !fs.existsSync(PROOF) && packagePresent() === false,
        15000
    )
    try { fs.unlinkSync(IPK) } catch (error) {
        if (error.code !== 'ENOENT') throw error
    }

    const result = {
        action: 'cleanup',
        effectObserved,
        reply,
        state: currentState(),
        helperRemoved: false
    }
    if (removeHelper && /\/functions\/fetch\/swprobe\.js$/.test(__filename)) {
        fs.unlinkSync(__filename)
        result.helperRemoved = true
    }
    return result
}

module.exports = async function (args) {
    const action = args && args.action ? String(args.action) : 'status'
    if (action === 'status') return { action, state: currentState() }
    if (action === 'install') return installProbe()
    if (action === 'cleanup') return cleanupProbe(Boolean(args && args.removeHelper))
    throw new Error('action must be status, install, or cleanup')
}

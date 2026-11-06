# 58A53FEVS / V0006.09.09F.P0930 — root via the superwatch socket, boot persistence, and debloat

Third documented model generation (after 50A51HUV/U09.01O and 100U7Q/U09.60I).
EU set, VIDAA U09.09, MediaTek MTK9602, kernel 4.19.79, 32-bit ARM userland.
Everything below was measured on the device unless explicitly marked
**UNVERIFIED**. No vendor binaries are included; behavior is described only.

## 1. The root chain (measured end to end)

```text
phoenix service context (uid 314, supplementary group 616)
  -> /var/run/superwatch_socket   (root:616, mode 0660 — group-connectable)
  -> superwatch_server            (uid 0 process)
  -> command 53: RunIpkInstall
  -> /usr/local/scripts/ipk_install.sh
  -> opkg install <ipk>           (postinst runs as uid 0)
```

Proof pattern (ACK is not effect — see §3): a minimal probe IPK whose
`postinst` dumps `/proc/self/status` to a file reported `Uid/Gid 0`,
`CapEff/CapBnd 0000003fffffffff`, `NoNewPrivs 0`, plus an `opkgmeta/status`
entry, plus later an independent key-only SSH session. The socket reply for
that install was `91:-1` — **the negative ACK arrived while the postinst had
already executed as root**. Always confirm with a second oracle.

## 2. superwatch build differences — command IDs are per-build

Static reconstruction of `CommandFactory::registerCommand` from the exact
on-device `superwatch_server` (exfiltrated binary-clean via the FaaS,
see §7) yields this build's registry:

| ID | Command (vtable/typeinfo) | Verified |
|---:|---|---|
| 51 | GetDirUsage | static |
| 52 | RunIpkBackup | static |
| 53 | RunIpkInstall | static + dynamic (root postinst) |
| 54 | RunIpkUninstall | static + dynamic (probe removed, status entry gone) |
| 55 | RunIpkRestore | static |
| 56 | RunCheckPkgsUsd | static |
| 57 | RunRecreateSoftlink | static |
| 58 | Wi-Fi test-mode class | returns 605 for uid 314 |
| 61 | TopEmmc inspection | static (not invoked) |

Wire format (unchanged): `<session>:<cmd>:<session>;<ipk-path>;<package>;`
length-prefixed u32 LE over the UDS. Reply `<session>:<code>`.

**Reply-code semantics (decoded from `handleClientMessage`)**:

- `600` parse OK; `603` parse error; **`604` command id not found**;
  `605` per-command authorization denied; otherwise the command's own return.

Correction to earlier notes: on U09.60 tooling, 82/83 were used for
install/uninstall. **Those ids do not exist on this build — a `604` reply
means "unknown command id", not an authorization wall.** Command ids must be
reconstructed per firmware build; treat any cross-build id map as
coincidence until verified. On this build uid 314 is authorized for every
registered command except id 58.

## 3. Boot persistence — a phoenix JS service that re-arms root

Mechanism (all measured):

- `serviceManager.startAutoStartServices('basic', …)` reads
  `<basic-pkg>/CHA/services/serviceList.json` at phoenix start.
- `route.js pathRouter` resolves `serviceList.json` → `<pkg>/CHA/services/<id>`.
- A service registered with `autoStart: true` starts at boot and (with
  `isKeepAlive: true`) is restarted by phoenix.
- The service waits for the superwatch socket, SHA-256-verifies two staged
  IPKs, sends uninstall-then-install for each, and verifies effect.

A full cold-boot cycle was validated: `start → install → root-ssh verified →
debloat verified → complete`, with a boot-id-bound marker file.

### Design requirements — each learned from a measured failure

1. **The re-arm assets must be readable by uid 314.** Staging them in a
   root-owned `0700` directory makes the service see them as missing and die
   (`fatal missing …`). Either stage readable, or self-heal permissions in
   the IPK `postinst`.
2. **The socket read timeout must exceed the postinst duration.** The
   install postinst runs ~95 s on this build (opkg + keygen + firewall +
   daemon start). A 20 s — or even 90 s — read timeout yields a false
   failure; the work still completes server-side. After any timeout, poll
   verification instead of retrying blind.
3. **Verification oracles must be readable by uid 314.** A root-only
   `dropbear.pid` under a `0700` tree is unreadable to the service, so
   `verify()` fails forever while root SSH is actually up.
   `/proc/net/tcp` (port in LISTEN) is world-readable and works.
4. **Never run opkg concurrently.** A client-side retry storm raced install
   against uninstall; besides churn, it ended with the package's
   `serviceList.json` deleted after that boot. One install at a time, with
   patient verification, converges on the first attempt.

### Hardening notes

- This firmware ships **no ip6tables**; a daemon started with `-p <port>`
  listens on both stacks with no v6 filtering. Bind v4-only with
  `-p 0.0.0.0:<port>` if the host allow-list is IPv4.
- The vendor INPUT policy drops non-allow-listed ports; an explicit
  `iptables -I INPUT 1 -s <admin-host>/32 … -j ACCEPT` from the postinst
  restores reachability (and its exact removal belongs in the rollback).

## 4. Telemetry debloat (measured, reversible)

Targets masked via bind mounts (originals untouched, `/proc/mounts` shows
the block device as source — grep by destination, not by source path):

- `hi_logreport_service` — the local log collector. Listens on
  `127.0.0.1:1969` with fan-in from systemserver, tvmain, hisenseUI,
  phoenix, the browser and others. Its recovered policy carries
  `serduration=30`/`excduration=30` with two vidaahub journal endpoints.
  The 30-second cadence is **configured**; an actual egress packet every
  30 s was not captured and is not claimed.
- `mdharvester`, and the YouTube `--preload` launcher script.

Masked + terminated with a health watch over the core (systemserver,
tvmain, hisenseUI, phoenix) and third-party apps; all survived. A reboot
without the persistence service restores vendor behavior by itself.

## 5. Screen capture (measured)

`/usr/local/bin/screenshot <dir> <name> [type]` — two strings and an
optional integer; `type` defaults to 4. With type 4 the tool returns the
**full composited UI plane** as a 1920×1080 PNG (verified by capturing a
browser page and reading it back pixel-perfect). Types 1–3 and the
video/HDMI-in planes are **UNVERIFIED**; DRM-protected content is expected
to capture black and was not attempted.

## 6. AAA/cloud notes (UNVERIFIED, located only)

The device's cloud sign-in material lives in cleartext in the system JS
package (`services/jhkservice/`): an index-obfuscated `appKey`, an
encrypted `appSecret` constant, and a sign flow whose signature primitive
is `hiutils.hiSdkSignCreate` (callable only from authorized service
contexts — browser pages get a permission error). The MQTT pairing token
is **not** valid for the cloud AAA endpoints (different credential
domain). Not pursued further.

## 7. Tooling pattern — the FaaS foothold (no binaries included)

Functions dropped into the basic package's `functions/fetch/` (deployed via
the stock `fetcher` write primitive, invoked as
`https://localhost:9888/function/basic/fetch/<name>`) gave:

- `sw2` — framed superwatch command sender (the original u7q helper),
- `swexec` — arbitrary command execution as uid 314 (`child_process`),
- `swexfil` — **binary-clean base64 exfiltration** of any 314-readable file
  in 48 KiB chunks — this is how exact vendor binaries were recovered for
  offline RE (string-level transport through the file bridge corrupts
  bytes ≥ 0x80; do not disassemble bridge dumps),
- `swuds`/`swnet` — generic UDS/TCP probes for localhost surface mapping.

The group-616 socket trust plus a per-build command map makes this
generation's root path materially simpler than U09.60I's FaaS/superwatch
chain: no `pkgmgr` indirection, same outcome.

## 8. Open questions

- HDMI-in video plane capture (screenshot types 1–3) — console gameplay
  capture-card use case, untested.
- Continuous VENC (`/dev/fbm_venc`, `/dev/mik/venc`) encoding + ALSA PCM
  capture → LAN streaming; all device nodes exist, nothing wired.
- Whether Hisense shifts command ids again in later builds — the §2 map is
  per-build by construction.

## Disclosure

Per this repository's SECURITY.md, publication is parallel to vendor
notification. The superwatch group-616 trust boundary (§1) and the per-build
command map (§2) post-date the 2026-10-29 report and were notified
separately to `VIDAASecurity@vidaa.com`.

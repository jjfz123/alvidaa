# Model and firmware guides

This directory holds **model- and firmware-specific** root and modding guides.
A guide is published only for the exact model *and* firmware string it was
recorded on. Cross-model material lives in `docs/research/`.

- [58A53FEVS / MTK9602 guide](58A53FEVS/V0006.09.09F.P0930/README.md)
- [50A51HUV / MTK9602 guide](50A51HUV/09.01O.P0813/README.md)
- [50A51HUV findings](50A51HUV/09.01O.P0813/FINDINGS.md)
- [method inventory](../research/EXPLOITS.md)
- [inventory](../research/inventory.json)

## Which guide applies to my TV?

Only the one whose **model and firmware both match**. Check the firmware string
in the TV's system information and compare it character by character.

| Model | Firmware | SoC class | Result | Persistence | Guides |
|---|---|---|---|---|---|
| `58A53FEVS` | `V0006.09.09F.P0930` (VIDAA `U09.09`, EU) | MediaTek MTK9602 | root via phoenix (uid 314, group 616) → superwatch command `53` (per-build id map); key-only SSH, v4-only bind | phoenix `serviceList.json` service, cold-boot validated cycle | [README](58A53FEVS/V0006.09.09F.P0930/README.md) |
| `50A51HUV` | `09.01O.P0813` (VIDAA `U09.01`, US/CAN) | MediaTek MTK9602 | root via browser `../` traversal + `otaTest.sh` boot hook; key-only SSH | `rc.local` hook, observed across boot | [README](50A51HUV/09.01O.P0813/README.md) · [FINDINGS](50A51HUV/09.01O.P0813/FINDINGS.md) |
| `HE40E5600FFWTS` | `V0100.01.00A.N0410` | MediaTek MT53xx / MT5863 class, ARMv7 Cortex-A53 | root via browser + loader shadow; key-only Dropbear SSH on 22; PTY | `HamService` wrapper; owner-verified across reboots (2026-11-04) | [README](HE40E5600FFWTS/V0100.01.00A.N0410/README.md) · [EVIDENCE](HE40E5600FFWTS/V0100.01.00A.N0410/EVIDENCE.md) · [MODDING](HE40E5600FFWTS/V0100.01.00A.N0410/MODDING.md) |
| `100U7Q` (`100U70QEVS`) | `V0000.09.60I.Q0813` (VIDAA `U09.60`, EU_A) | MediaTek MT9655, 32-bit ARM userland | root via `fetcher` write + package `postinst`; key-only root SSH on 8008; PTY | **none automatic**; re-arm with uninstall `83` + install `82` after each reboot | [README](100U7Q/V0000.09.60I.Q0813/README.md) · [EVIDENCE](100U7Q/V0000.09.60I.Q0813/EVIDENCE.md) · [MODDING](100U7Q/V0000.09.60I.Q0813/MODDING.md) |
| `75UR9S` | `V0000.09.60W.Q0624` (VIDAA `U09.0`, US) | MediaTek MT9655, 32-bit ARM userland | same chain as 100U7Q on the `09.60W` build; key-only root SSH on 8008; PTY | **none automatic**; re-arm with uninstall `83` + install `82` after each reboot | [README](75UR9S/V0000.09.60W.Q0624/README.md) |
| `43Q60SEVS` (`43E7DS`, serial type `43E7SE`) | `V0000.09.60W.Q0612` (VIDAA `U09.60`, EU_A) | MediaTek MTK9603 | root via the same fetcher write + package `postinst`; no Dropbear on this build | **vendor service manager** (`serviceList.json` entry + two-file service) | [README](43Q60SEVS/V0000.09.60W.Q0612/README.md) |

This table is hand-maintained; the [tested-model matrix](../../README.md#tested-models)
is generated from `inventory.json` and wins if the two disagree. `scripts/check.sh`
fails if a guide exists here without a row.

These chains are **different and not interchangeable**:

| | 50A51HUV | HE40 | 100U7Q |
|---|---|---|---|
| Entry point | browser file bridge `../` | browser runs as root; file-API whitelist bypass | app-context FaaS write + privileged package socket |
| Root execution | `rc.local` `otaTest.sh` hook | shadow library `DT_INIT` in the browser | IPK `postinst` via the root package daemon |
| Boot persistence | `rc.local` hook, observed across boot | `HamService` wrapper (owner-verified) | none; manual re-arm |
| Recovery | remove the hook + reboot | `rollback.sh` + reboot | uninstall `83` + operator cleanup |

The 50A51HUV entry is the original MTK9602 record; it shares no steps with the
other two. Do not apply one model's paths to another.

**75UR9S is the same chain as 100U7Q**, not a fourth one — same entry point,
same `postinst`, same 8008 daemon. Only the FaaS package that hosts `fetch`
differs (`tv.vidaa.jsservice.basic` instead of `...system`). Read the 100U7Q
guide first, then the [75UR9S deltas](75UR9S/V0000.09.60W.Q0624/README.md).

**43Q60SEVS is the same entry point again** (fetcher write → `/function` exec →
superwatch install), on MTK9603. What differs is the exit: this build ships no
Dropbear, so persistence comes from the vendor's own service manager instead of
a shipped daemon. See the [43Q60SEVS guide](43Q60SEVS/V0000.09.60W.Q0612/README.md).

## How to read the labels

Every guide uses the same vocabulary:

| Label | Meaning |
|---|---|
| **CONFIRMED live (recorded)** | the author's record reports a device observation, usually with output or an artifact. A record claim, not an independent re-test. |
| **CONFIRMED host/build** | reproduced on a build host, not on the TV. |
| **owner-verified** | stated by the device owner after the record; no file in the record set contains the observation. |
| **documented code** | quoted device source/configuration or a build recipe. |
| **UNVERIFIED** | not tested, or explicitly open. Never a recipe. |
| **DEAD END** | tried and rejected; listed so nobody repeats it. |

The HE40 and 100U7Q pages carry an EVIDENCE.md claim matrix with a `file:line`
basis and short quotes; the 50A51HUV record uses FINDINGS.md as its lab-notebook
index. The README page carries the procedure. The MODDING page carries the
system layout and the modding surface, with its own verified/unverified table.

## Ground rules

These guides are for **hardware you own**, on your own LAN.

- **No flashing, no `.pkg`, no UART, no case opening** is the design property of
  these chains. Read-only partitions stay untouched; verified boot stays green.
- **No vendor binaries and no keys are shipped.** Payloads and SSH binaries are
  rebuilt from your own device and the documented patches. Private keys never
  leave your machine.
- **Keep a recovery path.** A root shell or command loop is the way back from a
  broken UI or boot hook. Do not close it until you are done.
- **One change at a time.** Back up every file you replace. Reboot to test.
- **Do not expose debug interfaces to the internet.** The HE40 recon server is
  unauthenticated and drives a root browser; the SSH daemons are key-only root
  access on your LAN.
- **A failed observation applies to one route and one device.** It is not proof
  that a firmware is safe in general.

See [SECURITY.md](../../SECURITY.md) for the disclosure stance and
[AGENTS.md](../../AGENTS.md) if an AI session is doing the work.

## Tools

The scripts referenced by the guides live under [tools/](../../tools/):

| Tree | Contents |
|---|---|
| [tools/he40/](../../tools/he40/) | USB prep, recon server/page, payload and Dropbear builds, TV-side deploy/verify/rollback, templates |
| [tools/u7q/](../../tools/u7q/) | pairing, installer and trigger scripts, install/trigger pages, FaaS helper |
| [tools/fw/](../../tools/fw/) | firmware inventory/map/OTA tooling (not used by the device chains) |
| [tools/tvshell.py](../../tools/tvshell.py) | generic SSH wrapper |
| [tools/deploy-overlay.sh](../../tools/deploy-overlay.sh) | launcher deployment helper |

`tools/*/bin` and `tools/*/tools/pub` are **drop points**, not binary
distributions. Build or supply your own.

## Contributing a model

Add the model to [inventory.json](../research/inventory.json) first, then report
the method result in [exploits.json](../research/exploits.json) — the generated
tables in the repository README and [EXPLOITS.md](../research/EXPLOITS.md) come
from those files. A model guide is worth writing only when the firmware string
is exact and the observations are separable from the inferences. Follow the
status vocabulary above; keep unknowns unknown.

Field definitions for a device report:
[TESTED-MODELS.md](../research/TESTED-MODELS.md).

## Attribution

The 50A51HUV / MTK9602 research and original write-up is by
[@carteakey](https://github.com/carteakey). The HE40 and 100U7Q research is by
[@oOHiyoriOo](https://github.com/oOHiyoriOo); the sanitized source notes are
included under each model's `source/` directory. The guides themselves are
original English text under the repository's MIT license — see
[LICENSE](../../LICENSE).

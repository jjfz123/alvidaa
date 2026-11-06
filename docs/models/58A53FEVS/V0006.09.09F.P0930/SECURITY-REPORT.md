# Root package installation through the group-accessible superwatch socket

## Executive summary

On a Hisense 58A53FEVS running VIDAA firmware `V0000.09.09F.P0930`, a stock
Phoenix JavaScript service runs as UID 314 with supplementary group 616. The
root-owned `superwatch_server` exposes `/var/run/superwatch_socket` as
`root:616` mode `0660` and accepts package-management commands from that
context. Build-specific command 53 invokes the firmware IPK installation
path, ending in `opkg install`; package maintainer scripts execute as UID 0
with the full bounding and effective capability masks.

The measured trust transition is:

```text
Phoenix service (uid 314, supplementary gid 616)
    -> /var/run/superwatch_socket (root:616, 0660)
    -> superwatch_server (uid 0)
    -> command 53 / RunIpkInstall
    -> /usr/local/scripts/ipk_install.sh
    -> opkg install <attacker-controlled IPK>
    -> postinst as uid 0 with full capabilities
```

This converts code execution in a nominally unprivileged stock service into
arbitrary root code execution. The included public PoC is reversible and
non-persistent: it writes only a process-credential proof and then removes it.

## Report metadata

| Field | Value |
|---|---|
| Product | Hisense/VIDAA television platform |
| Tested model | `58A53FEVS_0006` |
| Tested firmware | `V0000.09.09F.P0930` |
| SoC / userland | MediaTek MTK9602 / 32-bit ARM |
| Kernel observed | Linux 4.19.79 |
| Vulnerable boundary | Phoenix service group 616 -> root superwatch package installer |
| Evidence window | 2026-11-05 to 2026-11-06 |
| Tested scope | One owner-controlled television on a private LAN |
| Persistence required | No |
| Read-only firmware modified | No |
| DRM bypass attempted | No |
| Candidate weakness classes | CWE-269; CWE-250; CWE-863 |

No device serial, MAC address, LAN address, credential, certificate, token,
public key, host key or vendor binary is included in this report.

## Severity and impact

**Assessment: High for an attacker who reaches the Phoenix UID-314 service
context.** The issue crosses a local privilege boundary and yields a root
package maintainer script with unrestricted Linux capabilities. Demonstrated
post-exploitation effects included starting a key-only management daemon,
applying reversible bind mounts and surviving a cold boot through a stock
auto-start service. Those effects are evidence of impact, not requirements of
the public PoC.

Root access can affect confidentiality, integrity and availability of the TV's
writable system state. It can also change firewall policy, start services and
alter persistent data under writable partitions. Verified boot remaining green
does not mitigate changes made exclusively in those writable data partitions.

This report does **not** claim an unauthenticated Internet attack. The
demonstrated starting point is local code execution as the Phoenix service
user. A separate browser/file-deployment weakness documented by this project
can provide that context when the TV is made to load owner-controlled content,
but the two prerequisites are kept explicit rather than collapsed into an
unproven remote chain.

## Evidence matrix

| Claim | Evidence type | Result |
|---|---|---|
| Phoenix can reach the socket | Runtime identity + socket metadata | UID 314 has group 616; socket is `root:616` mode `0660` |
| Command 53 is the installer on this build | Static reconstruction of the exact binary | `RunIpkInstall` registered at ID 53 |
| The root broker consumes the caller-selected IPK | Static call path + dynamic package state | Staged package appears in opkg status |
| Maintainer code runs as root | Independent file readback from `postinst` | UID/GID 0, full effective/bounding masks, `NoNewPrivs=0` |
| A negative ACK is not a negative effect | Same-run reply and readback | `91:-1` observed while proof and package entry existed |
| Cleanup is real | Command 54 + two absence oracles | Proof removed and package entry absent |
| Persistence is feasible | Cold-boot runtime validation | Stock Phoenix auto-start service re-armed root and debloat packages |
| Other firmware uses ID 53 | Not tested | Unknown; explicitly build-specific |

Static analysis was performed on a binary-clean private copy of the exact
on-device executable. Runtime claims come from the owner-controlled device;
static reconstruction is not presented as runtime observation.

## Root cause

Three controls fail together:

1. A broadly useful application service is placed in supplementary group 616.
2. A root service exposes a command socket writable by that group.
3. The command policy authorizes an IPK installation operation whose package
   `postinst` executes as root without reducing privileges or constraining the
   package to a vendor-authorized artifact.

The result is a confused-deputy boundary: the low-privilege caller selects the
package while the root broker supplies the authority.

## Technical analysis

### Process and socket observations

The Phoenix service identity and socket metadata were read independently:

```text
Phoenix: uid 314, supplementary group 616
Socket:  /var/run/superwatch_socket
Owner:   root:616
Mode:    0660
Server:  superwatch_server, uid 0
```

Socket access alone was not treated as proof of command authorization. The
command was exercised with a package whose only privileged action was a
credential readback.

### Wire format

Requests are a UTF-8 payload prefixed by a four-byte little-endian length. The
install request used on this build is:

```text
91:53:91;/APPS/root-probe.ipk;re.rootprobe;
```

Command numbers are not a stable cross-firmware API. Static reconstruction of
`CommandFactory::registerCommand` from the exact on-device binary identified:

| ID | Reconstructed command | Validation |
|---:|---|---|
| 51 | `GetDirUsage` | Static only |
| 52 | `RunIpkBackup` | Static only |
| 53 | `RunIpkInstall` | Static and dynamic |
| 54 | `RunIpkUninstall` | Static and dynamic |
| 55 | `RunIpkRestore` | Static only |
| 56 | `RunCheckPkgsUsd` | Static only |
| 57 | `RunRecreateSoftlink` | Static only |
| 58 | Wi-Fi test-mode class | Authorization denied for UID 314 |
| 61 | Top-eMMC inspection | Static only; not invoked |

The preserved `superwatch_server` used for offline analysis had SHA-256:

```text
sha256:a68ba22d19041b66c6833dc745c83e9f9c9fb926a011bf85fd75615d8a696c2d
```

The binary itself is not redistributed.

### Reply codes are not effect oracles

The request parser exposes `600` for parse success, `603` for parse failure,
`604` for an unknown command ID and `605` for command authorization denial.
Other values come from the selected command. During the root probe, the socket
returned `91:-1`, while independent readback showed that the package was
registered and its `postinst` had already executed as root.

Accordingly, every dynamic conclusion used a protected effect oracle:

- install: proof file contents plus the package status entry;
- uninstall control: proof absent plus package status entry absent;
- later management-daemon validation: process credentials plus a listening
  socket and an independent key-only login.

An ACK, timeout or error string alone is not evidence that the privileged
effect did or did not occur.

## Reversible proof of concept

The PoC is in [`tools/u0909f/poc/`](../../../../tools/u0909f/poc/README.md).
It consists of:

- `make_root_probe.py`: deterministic builder for a 920-byte IPK;
- `swprobe.js`: constrained UID-314 FaaS helper for commands 53 and 54;
- `invoke.html`: local UI that calls only `https://localhost:9888` and does
  not upload results.

The helper accepts no arbitrary command, package name or package path. Before
requesting command 53 it verifies this exact SHA-256:

```text
sha256:a37db332d49c8efce7da65a305ba9790d2d422fa36b30be83266359884a7fd34
```

The `postinst` writes only selected fields from its own `/proc/self/status`.
Observed values were:

```text
Uid:         0 0 0 0
Gid:         0 0 0 0
CapEff:      0000003fffffffff
CapBnd:      0000003fffffffff
NoNewPrivs:  0
```

The PoC does not open SSH, alter firewall rules, register a boot service,
disable telemetry, modify a read-only partition or touch `/OAD`.

### Negative control and cleanup

Command 54 was sent for exactly `re.rootprobe`. A clean control required both:

```text
/APPS/.re_root_probe/PROOF absent
Package: re.rootprobe absent from opkg status
```

The public helper also removes the staged IPK and can remove itself. Concurrent
opkg requests must not be used: development testing showed that overlapping
install/uninstall operations can corrupt package state.

## Persistence validation as impact evidence

Persistence was tested separately from the minimal PoC. A Phoenix service
registered with `autoStart: true` and `isKeepAlive: true` waited for the
superwatch socket, verified staged IPK hashes, issued serialized
uninstall/install requests and then checked actual effects.

A cold-boot validation eventually completed the sequence:

```text
boot -> Phoenix auto-start -> command 53 -> root service verified
     -> reversible debloat package verified -> boot-bound completion marker
```

Five engineering failures were resolved before calling this complete:

1. UID 314 could not traverse a root-only staging directory.
2. Concurrent opkg retries damaged service/package state.
3. A transferred JS file contained diagnostic contamination and failed syntax.
4. The service compared the staged IPK against an obsolete digest.
5. Its first root oracle was itself unreadable by UID 314.

The final design used readable staged artifacts, exact SHA-256 checks,
serialized package operations and `/proc/net/tcp` as the unprivileged effect
oracle. A superwatch response timeout still occurred because the root installer
took longer than the response window; patient effect polling converged without
blindly retrying.

This section demonstrates practical persistence impact. It is intentionally
not implemented by the public root PoC.

## Remediation recommendations

1. Change the superwatch socket to `root:root` mode `0600` unless a documented
   non-root client is strictly required.
2. Enforce peer credentials with `SO_PEERCRED` and an operation-specific
   allow-list; do not authorize package installation by supplementary group
   membership alone.
3. Remove `RunIpkInstall`, restore and symlink-recreation operations from the
   UID-314 policy.
4. Require a vendor signature and an immutable package identity before the
   root broker passes an artifact to opkg.
5. Execute package verification and extraction in a confined worker, then run
   maintainer scripts with least privilege or eliminate them for this channel.
6. Make command identifiers and authorization decisions auditable and log the
   authenticated peer UID/PID, package digest and final effect.
7. Address the separate browser/file-deployment path so arbitrary web content
   cannot place code into a trusted Phoenix package.
8. Regression-test that a process with UID 314 and group 616 cannot trigger
   commands 53/54 or any equivalent package-management operation.

## Verification plan for a fix

A patched build should satisfy all of the following:

- UID 314 cannot connect to the socket, or the broker rejects the install
  before opening the caller-selected package.
- The safe probe's `postinst` never runs and no package status entry appears.
- A vendor-authorized update path still succeeds through its intended caller.
- Unknown command IDs, denied commands and execution failures produce distinct
  replies, while logs record the peer and final effect.
- The result survives a cold boot and is rechecked against the exact patched
  firmware binary rather than reusing this build's command map.

## Scope and limitations

- Dynamic testing covers one exact model/firmware tuple.
- Static command-map recovery covers the exact binary hash listed above.
- Other VIDAA releases may renumber, remove or add commands.
- No Internet-scale reachability, WAN attack, HDMI capture, DRM bypass or
  compromise of another person's device was attempted or inferred.
- Vendor binaries and private evidence remain outside the repository.

## Timeline

| Date | Event |
|---|---|
| 2026-11-05 | Socket trust boundary mapped; command registry reconstructed; reversible UID-0 probe and uninstall control completed |
| 2026-11-05 | Key-only root management and reversible telemetry masks validated as impact evidence |
| 2026-11-06 | Phoenix auto-start persistence failures isolated and corrected |
| 2026-11-06 | Cold-boot cycle completed with independent root, mount, process and network oracles |
| Pending | Notify VIDAA/Hisense of this specific post-2026-10-29 chain |

## Disclosure status

The project sent an earlier VIDAA/Hisense research report on 2026-10-29. This
group-616 -> superwatch -> root-package-install boundary was discovered and
validated later. At the time this report was prepared, notification of this
specific new chain was **pending**; publication status should be updated when
the corresponding vendor notice is actually sent.

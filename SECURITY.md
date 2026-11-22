# Security policy

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private reporting:
[**Report a vulnerability**](https://github.com/muttley1973/infranetpro/security/advisories/new) —
or *Security → Advisories → Report a vulnerability*. It opens a thread visible only to you and the
maintainer.

If that form is not available to you, open an issue saying only *"security report, please open a
private channel"* — no details, no proof of concept.

What helps in a report: the version (the login page footer carries it), how the instance is
reached (loopback, reverse proxy, container), and the shortest sequence that reproduces it.

## What to expect

One maintainer, no support contract: reports are answered on a best-effort basis, and saying so is
better than promising a deadline nothing enforces. What is not best-effort is the outcome — a
confirmed issue gets a fix and a release, and the advisory credits you unless you ask otherwise.

## Supported versions

Fixes land on `main` and ship in the next patch release. Only the current line receives them; there
are no long-term branches.

| Version | Security fixes |
|---|---|
| 2.14.x | yes |
| 2.13.x and older | no — upgrade |

## What the threat model already assumes

`ARCHITECTURE.md` §8 is the security model; this section does not restate it. Two premises decide
whether a finding is a vulnerability or a deployment choice:

- **The server binds to `127.0.0.1`.** Publishing it on a network is the operator's decision, and
  is meant to happen behind a TLS reverse proxy (`INFRANET_TRUST_PROXY=1`). A `HOST` outside the
  loopback prints a warning at startup.
- **Live egress is admin-chosen.** SNMP polls and DHCP drivers reach only a host an admin entered.
  The two places where the multi-site map leaves your network are both the **server's**, never
  the browser's (`connect-src 'self'` and `img-src 'self'` stay, pinned by a test): "Find from the
  address" sends the address you pressed it on to a geocoder (OpenStreetMap Nominatim by default,
  `INFRANET_GEOCODER_URL`, admin only), and the Geographic map's tiles are fetched from
  OpenStreetMap by `server/tiles.js` and cached (`INFRANET_TILES_URL`) — that provider sees your
  server's address and which tiles are viewed, never who is looking. Each can be set to `off`, in
  which case nothing is ever sent. Tile coordinates are integers in range and redirects are not
  followed, so neither path can be pointed at another address by a request.

And one premise that is easy to miss, because it is where the interesting input comes from: **the
network being documented is untrusted input**. `sysName`, `sysDescr`, LLDP/CDP neighbour names,
DHCP lease hostnames and HTTP page titles are written by whoever is on that network, and they reach
the interface, the PDF report and the Ansible inventory. So do uploaded skin SVGs and whatever a
DCIM import carries. A finding along one of those paths is squarely in scope.

## Out of scope

- Missing hardening on a deployment that publishes the application with no proxy and no auth layer
  in front of it.
- Scanner output with no demonstrated impact.
- A dependency's own defect: report it upstream. Dependabot security updates are enabled here and
  arrive on their own. If InfraNet's *use* of a library turns a non-issue into an exploitable one,
  that is a report worth making.

## The paid module

`modules/governance` is a paid add-on and does not live in this repository. A report about it goes
through the same private channel.

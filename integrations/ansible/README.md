# InfraNet Pro → Ansible dynamic inventory

Use your InfraNet documentation as a **live Ansible inventory**. InfraNet stays the
source of truth (you document the network, manual-first); Ansible consumes it and
executes. The inventory is built from InfraNet's read-only REST API, so it always
reflects the current project — including IPs that are accurate across VLANs.

```
InfraNet project ──(REST API v1)──> infranet_inventory.py ──> Ansible
```

## What you get

Every device that has an IP becomes an Ansible host (`ansible_host` = its IP),
grouped automatically:

| Group pattern | Example | Meaning |
|---|---|---|
| `type_*`  | `type_switch`, `type_firewall` | by device type |
| `vlan_*`  | `vlan_10`, `vlan_20` | by VLAN (derived from IP ↔ subnet) |
| `rack_*`  | `rack_rk_core` | by rack |
| `brand_*` | `brand_cisco`, `brand_fortinet` | by vendor |

Each host carries these vars (from `_meta.hostvars`):

`ansible_host`, `infranet_id`, `infranet_type`, `mac`, `brand`, `model`, `vlan`,
`rack`, `snmp`.

> Note: SNMP community strings and other secrets are **never** exposed by the API —
> `snmp` is just a boolean telling you whether the device has SNMP configured.

## Requirements

- Ansible on the control node (Python 3 is already required by Ansible).
- Network access to the InfraNet server.
- An **API token** minted by an InfraNet admin (read-only).

## 1. Mint a token

In InfraNet, as an admin, open the browser console and run:

```js
fetch('/api/auth/tokens', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ label: 'ansible' })
}).then(r => r.json()).then(x => console.log(x.token));
// → inp_…  (copy it now — it is shown only once)
```

(A token-management panel in the admin UI is on the way; until then, use the console.)

## 2. Configure

```bash
export INFRANET_URL=http://10.0.0.5:8421     # your InfraNet server
export INFRANET_TOKEN=inp_xxxxxxxxxxxxxxxx    # the token from step 1
export INFRANET_PROJECT=8                      # the project id to expose
chmod +x infranet_inventory.py
```

Optional:

```bash
export INFRANET_INSECURE=1     # skip TLS verification (self-signed lab certs only)
export INFRANET_TIMEOUT=10     # HTTP timeout in seconds (default 10)
```

## 3. Use it

```bash
# See the whole inventory / the group tree
ansible-inventory -i infranet_inventory.py --list
ansible-inventory -i infranet_inventory.py --graph

# Target everything, or a group
ansible all          -i infranet_inventory.py -m ping
ansible type_switch  -i infranet_inventory.py -m ping
ansible vlan_10      -i infranet_inventory.py -m ping

# Run a playbook
ansible-playbook -i infranet_inventory.py example-playbook.yml
```

To make it the default inventory, drop this in an `ansible.cfg` next to your project:

```ini
[defaults]
inventory = ./infranet_inventory.py
```

## Environment reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `INFRANET_URL` | yes | — | Base URL of the InfraNet server |
| `INFRANET_TOKEN` | yes | — | API token (`inp_…`), minted by an admin |
| `INFRANET_PROJECT` | yes | — | Numeric project id to expose |
| `INFRANET_INSECURE` | no | `0` | `1`/`true` to skip TLS verification |
| `INFRANET_TIMEOUT` | no | `10` | HTTP timeout in seconds |

## How it works

`infranet_inventory.py` implements Ansible's inventory-script contract:

- `--list` performs `GET ${INFRANET_URL}/api/v1/projects/${INFRANET_PROJECT}/ansible-inventory`
  with the bearer token and prints the JSON verbatim.
- `--host <name>` returns `{}` because all host vars are provided via `_meta.hostvars`.

It is read-only and stateless: nothing is written back to InfraNet. The API surface
is fully described at `${INFRANET_URL}/api/v1/openapi.json`.

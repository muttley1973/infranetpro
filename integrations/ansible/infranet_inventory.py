#!/usr/bin/env python3
# ============================================================
#  InfraNet Pro — Ansible dynamic inventory
#
#  Turns an InfraNet project into a live Ansible inventory by reading the
#  read-only REST API (GET /api/v1/projects/<id>/ansible-inventory). InfraNet
#  stays the source of truth; Ansible is the executor. Hosts are grouped by
#  type_*, vlan_*, rack_* and brand_*, with `ansible_host` set to each device IP.
#
#  Dependencies: none (Python 3 standard library only) — Python ships wherever
#  Ansible runs, so this stays drop-in.
#
#  Configuration (environment variables):
#    INFRANET_URL       base URL of the InfraNet server (e.g. http://10.0.0.5:8421)
#    INFRANET_TOKEN     API token minted by an admin (starts with "inp_")
#    INFRANET_PROJECT   numeric project id to expose as inventory
#    INFRANET_INSECURE  optional: "1"/"true" to skip TLS verification (self-signed labs)
#    INFRANET_TIMEOUT   optional: HTTP timeout in seconds (default 10)
#
#  Usage:
#    ansible-inventory -i infranet_inventory.py --list
#    ansible all -i infranet_inventory.py -m ping
#    ansible-playbook -i infranet_inventory.py site.yml
# ============================================================
import json
import os
import ssl
import sys
import urllib.error
import urllib.request


def _fail(msg):
    """Print an error to stderr and exit non-zero so Ansible surfaces it."""
    sys.stderr.write("infranet_inventory: " + msg + "\n")
    sys.exit(1)


def _env():
    url = (os.environ.get("INFRANET_URL") or "").strip().rstrip("/")
    token = (os.environ.get("INFRANET_TOKEN") or "").strip()
    project = (os.environ.get("INFRANET_PROJECT") or "").strip()
    missing = [n for n, v in (("INFRANET_URL", url), ("INFRANET_TOKEN", token), ("INFRANET_PROJECT", project)) if not v]
    if missing:
        _fail("missing required environment variable(s): " + ", ".join(missing))
    try:
        timeout = float(os.environ.get("INFRANET_TIMEOUT") or "10")
    except ValueError:
        timeout = 10.0
    insecure = (os.environ.get("INFRANET_INSECURE") or "").strip().lower() in ("1", "true", "yes", "on")
    return url, token, project, timeout, insecure


def _fetch_inventory():
    url, token, project, timeout, insecure = _env()
    endpoint = "{0}/api/v1/projects/{1}/ansible-inventory".format(url, project)
    req = urllib.request.Request(endpoint, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/json",
    })
    ctx = None
    if insecure:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = " — " + e.read().decode("utf-8", "replace")
        except Exception:
            pass
        if e.code == 401:
            _fail("401 unauthorized: check INFRANET_TOKEN (mint one as admin)." + detail)
        if e.code == 404:
            _fail("404 not found: check INFRANET_PROJECT id." + detail)
        _fail("HTTP {0} from {1}{2}".format(e.code, endpoint, detail))
    except urllib.error.URLError as e:
        _fail("cannot reach {0}: {1}".format(endpoint, e.reason))
    except Exception as e:  # noqa: BLE001 — last-resort guard, report and exit
        _fail("unexpected error contacting {0}: {1}".format(endpoint, e))

    try:
        return json.loads(body)
    except ValueError:
        _fail("server did not return valid JSON (is INFRANET_URL the InfraNet server?)")


def main(argv):
    args = argv[1:]
    # Ansible script contract: --host <name> returns that host's vars. We expose
    # all vars via _meta.hostvars in --list, so --host can return an empty object.
    if "--host" in args:
        sys.stdout.write(json.dumps({}))
        return
    # --list (or no argument) → emit the full dynamic inventory verbatim.
    inventory = _fetch_inventory()
    sys.stdout.write(json.dumps(inventory, indent=2, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv)

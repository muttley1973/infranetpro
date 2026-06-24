# Licensing — InfraNet Pro

InfraNet Pro is **dual-licensed**. You may use it under **either** of the following,
at your choice:

1. the **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)** — the
   open-source license, free of charge; **or**
2. a **commercial license** purchased from the author, for cases where the AGPL
   obligations are not acceptable.

---

## 1. Open-source license (AGPL-3.0-or-later)

The full text is in [LICENSE](LICENSE). In plain terms, under the AGPL you are free to:

- **use** InfraNet Pro for any purpose, including in a company;
- **study** and modify the source code;
- **share** it and your modified versions.

In exchange, the AGPL asks one main thing — its defining clause:

> If you run a **modified** version of InfraNet Pro to provide a service to others
> **over a network**, you must make the **complete corresponding source code** of your
> modified version available to those users, under the AGPL.

This "network use = distribution" rule is what distinguishes the AGPL from the ordinary
GPL, and it is deliberate: it keeps improvements open even when the software is offered
as a hosted/SaaS service rather than shipped as a download.

You must also keep the copyright and license notices intact, and any work that
incorporates InfraNet Pro source must itself be released under the AGPL.

**Most users — homelabs, internal company documentation, evaluation, learning,
self-hosting without redistribution — are fully covered by the AGPL at no cost.**

---

## 2. Commercial license

The AGPL is not suitable for everyone. Buy a commercial license if you want to:

- **embed** InfraNet Pro (in whole or in part) into a **closed-source product**;
- **redistribute** a modified version under terms other than the AGPL;
- obtain it **without the AGPL copyleft obligations** for any other reason.

The commercial license grants the same software under proprietary terms, decoupled from
the AGPL's source-disclosure requirements. Terms (per-seat, per-deployment, or OEM) are
agreed case by case.

> 📧 **Contact:** iu3npr@gmail.com — subject "InfraNet Pro — commercial license".

---

## 3. What is free, and what is commercial

**The application is fully open source.** Everything in this repository — manual network
documentation (floor plans, racks, structured cabling, VLANs) **and** the SNMP discovery,
Sync, topology and drift features — is released under the AGPL above and is fully
functional at no cost. There is no crippled "community edition": the open repository is
the complete, working product. InfraNet Pro is an **on-premise** tool — it runs on your own
machine or server, with no cloud component — so it is **not** offered as a hosted/SaaS service.

Funding sustains the project **without** locking core features away. The paid offerings
sit *around* the open core, not inside it:

- **Custom integration & device support** *(the main paid engagement)* — adapting InfraNet
  Pro to a company's **specific or proprietary devices and management APIs**, and writing
  the drivers/fingerprints needed to discover, poll and document them.
- **Optional add-ons, sold separately and *not* part of this repository** — vendor-accurate
  **panel-skin packs** (the rendering engine is open; the artwork packs and authoring
  know-how are not) and **premium vendor driver packs** (e.g. per-vendor wireless or
  extended power monitoring beyond the open baseline).
- **Support & development** — priority support / SLA and bespoke development.
- **Commercial license** (see §2) — only if you need terms the AGPL cannot give, e.g.
  embedding InfraNet Pro into a closed-source product or redistributing under other terms.

In short: the open AGPL edition is the whole tool; the commercial side is **custom device
integration**, optional add-on packs, support, and the license escape hatch.

---

## 4. Contributing

Because InfraNet Pro is dual-licensed, the author must retain the right to relicense
contributions under the commercial license. **By submitting a contribution (pull
request, patch) you agree that your contribution is licensed under the AGPL *and* that
the author may also distribute it under the commercial license** (a Developer
Certificate of Origin / lightweight CLA model). If you cannot agree to this, please
open an issue to discuss before contributing code.

---

*Why dual licensing? It keeps the project genuinely open — anyone can read, run and
improve it — while letting the author sustain the work through companies that need
terms the AGPL cannot give them. It is the same model used by OpenNMS, Grafana and
Zabbix in this space.*

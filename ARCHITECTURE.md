# InfraNet Pro — Architecture

> The mental model, not a line-by-line reference. Read this first; then the code
> reads itself. For the full feature manual, see the PDF in this repo
> (`MANUALE_TECNICO_IT.pdf` / `TECHNICAL_MANUAL_EN.pdf`).

InfraNet Pro is a **self-hosted L1/L2 network documentation tool** — racks,
cabling, ports, VLANs, MAC/FDB, LLDP/CDP topology, SNMP discovery — with a
visual, commercial-grade UI. Vanilla JS frontend, Node/Express backend, JSON
file storage. **Minimal tooling** (a lightweight esbuild bundle for the frontend,
introduced by the in-progress ESM migration — see §10), **no framework.**

---

## 1. Non-negotiable principles

These are deliberate. Don't "fix" them without understanding why:

1. **Minimal build.** Pure `lib/*.js` stay plain UMD-lite (no transpile, Node
   tests import them as-is). The glue layer is being migrated to ES modules bundled
   by **esbuild** (`npm run build` → `dist/app.bundle.js`) to kill the implicit
   global coupling + `typeof` guards. **The JS strangler is complete:** all
   `lib/app-*.js` glue **and** the nucleus (`src/app.js`) are now ESM in the bundle.
   The only remaining classic `<script>`s are the pure `lib/*.js` and `export.js`
   (by design — golden lib-script rule). See §10.
2. **Zero esoteric dependencies.** Backend uses only Express, bcryptjs,
   express-session/rate-limit, net-snmp, pdfkit. Tests use **`node --test`
   only** — zero test dependencies. This is a point of pride and a selling point.
3. **`lib/` pure + glue.** Reusable logic lives in pure, testable modules in
   `lib/`. The glue (now ESM modules in `src/app-*.js`, bundled by esbuild) wires
   that logic to the DOM. (See §3.)
4. **Manual-first** ([ADR](docs/adr/manual-first.md)). User-entered data always
   wins; SNMP/discovery never silently overwrites a manual value.
5. **Localhost-bound.** The server binds `127.0.0.1` only. It is a LAN tool that
   runs *inside* the network it documents, not a public service.

> **Why these exist — decision records.** The *why* behind the rules that make the
> tool trustworthy lives in **[`docs/adr/`](docs/adr/)**: the data-integrity
> principles [manual-first](docs/adr/manual-first.md),
> [no-invention](docs/adr/no-invention.md) ("InfraNet computes, the AI narrates"),
> [vendor-neutral](docs/adr/vendor-neutral.md) ("build for every vendor, the lab
> only validates") and [measured-not-declared](docs/adr/measured-not-declared.md),
> plus architectural decisions such as [pure `lib/` modules](docs/adr/pure-lib-modules.md)
> (ADR D4). Code comments cite these by tag (`paletto #2`, `ADR D4`, …); every tag
> resolves from [`docs/adr/README.md`](docs/adr/README.md).

---

## 2. File map

```text
server.js              Express bootstrap: static files, auth, routers, listen (127.0.0.1)
auth.js                Sessions, bcrypt login, roles (admin/viewer), user CRUD
server/                Backend (CommonJS): projects-store, netscan, classify,
                       pdf-report, label-sheet, routes/{projects,discovery,export,ai,skins,device-types,organization}
server/organization-store.js  data/organization.json — ONE organisation per installation,
                       never inside a project (a copy in each would be the same fact twice).
                       Atomic write + .bak; a corrupt file restarts from empty, never invented.
server/routes/organization.js  GET (open) returns the organisation with its coherence audit in
                       one call; PUT (admin) re-normalises the body and reports what was written
                       and what was refused. The reasoning is in §4 (data flow) and §8.
server/routes/projects.js  Project CRUD, and the two halves of an honest save: a file-derived
                       ETag (never `updated_at`) refuses a superseded PUT with 409, and a DIRTY
                       EPOCH (src/app-core.js) keeps the unsaved signal lit for an edit made mid-save.
                       No If-Match = old behaviour, on purpose (imports/scripts/benches). See §4.
server/routes/device-types.js  GET /api/device-types -> data/device-types.json: native templates
                       (ports + frontPanel) from CC0 data via tools/import-device-types.js. "Apply
                       model" feeds the DEFAULT rack renderer — no new drawing. See tools/README.md.
server/ai-config.js    AI assistant config: enabled/endpoint/model/key + scope/features
                       (data/ai-config.json git-ignored; key server-side only, env INFRANET_AI_KEY)
server/ai/             AI assistant: context.js (sanitized facts, scope-aware, secret-filtered —
                       see §8b), prompt.js (grounding it/en + §4c help catalog), provider.js
                       (OpenAI-compatible, node:https, zero-dep); routes/ai.js wires them.
server/module-registry.js  Generic paid-module seam: loadModules mounts modules/<name>/server if
                       present (modules/ gitignored, private repo, in-process); getNav feeds
                       GET /api/modules; onProjectDelete cleans a module's sidecars. Core-agnostic.
drivers/snmp.js        SNMP v1/v2c/v3 driver
engine/                sysObjectID + OUI classification engines (plugin loaders)
plugins/               Seed vendor catalogs (zero database)

lib/                   Shared browser + test modules (the heart of the app)
  i18n.js              t(key,vars), it/en dictionaries, glossary  (pure)
  provenance.js     The envelope: how a value is known. `declared` (a person wrote it, and
                    it never ages — a decision does not expire), `measured{at}` (read from a
                    device at a stated instant), `derived{from}`. A bare value is NOT promoted
                    to `declared` for convenience, and a measurement whose timestamp cannot be
                    read stays undated instead of being stamped with the current time. The age
                    scale is a REQUIRED argument, never a silent default: `proof.js` (6h/7d/30d)
                    and `temporal-confidence.js` (30d/60d) answer different questions and
                    legitimately keep different half-lives. Composes with source-ref.js
                    (epistemics vs identity), so there is no fourth `imported` origin.
  certainty.js      ONE ALPHABET for "how much do I trust this", over engines that stay
                    separate. Six signs — measured / declared / derived / contradicted /
                    undeclared / unread — and a pure map from each engine's REAL keys onto
                    them (proof.js, linkstate.js, temporal-confidence.js, the Overview's
                    `prov`, presence.js). ⛔ It does NOT merge the engines: provenance.js is
                    right that they keep legitimately different half-lives, and each one
                    still computes exactly what it computed. What is unified is the WORD.
                    ⚠️ And no colour is decided here — the grade is semantic, the ink comes
                    from the stylesheet's tokens (`.cty-<grade>`); a guard greps this file
                    for a hex literal. Keys that are NOT a certainty are declared as such
                    (`NOT_A_CERTAINTY`) rather than left unmapped, because silence would not
                    distinguish "different axis" from "forgotten": `lag` says what a link
                    IS, and Discovery's high/mid/low say how STRONG a guess is. The
                    reasoning is in §4 (one question, one alphabet).
  inter-site.js     The multi-site layer, ABOVE the per-site projects: an organisation with
                    its sites (each a projectRef — a reference, never a copy), WAN uplinks and
                    inter-site links over TWO closed vocabularies, because one field held two
                    questions and an IPsec inside an MPLS had to drop one of them: `transport`
                    (internet/mpls/vpls/vpws/vxlan/evpn/directLink/other) says what it travels
                    ON, `tunnel` (none/ipsec/gre/wireguard/openvpn/l2tp/sdwan/other) says what
                    runs on TOP; each carries `other` + a free label as a DECLARED escape hatch,
                    never an open string. An out-of-vocabulary value on either axis becomes null
                    and does NOT drop the row (the old `kind` DISCRIMINATED the union, so refusing
                    was right there; these two are optional like `role` or `state`, and losing a
                    whole link over one crooked word would be a cure worse than the disease); a
                    document still written with `kind` migrates onto the axis it belonged to, and
                    only when NEITHER axis is already set, so a migrated file is never touched
                    twice. `reach` — which subnets a link makes reachable at each end — is
                    one concept for every nature (on an ipsec it IS the encryption domain), so no
                    vendor-specific word and no viewpoint-dependent local/remote; and so is
                    `underlayUplinkIds`, WHICH WAN LINES CARRY IT — the recovery question, not an
                    sdwan one, which is where it used to live.
                    vendor's word and no viewpoint-dependent local/remote. Both ends carry the
                    device that holds them (a ref into the site's project, OR a hand-typed name
                    — mutually exclusive), because on an MPLS the end is the CE; and so do
                    `provider`/`circuitId`, for the same reason — every kind is bought from
                    someone under a code, and that code is what you dictate when it is down;
                    and so does `name`, because "what is this link called" is one question too
                    — «GRE-LAB» is the name, «GRE» is the nature, and the map draws the second.
                    `publicIps` is
                    a LIST: a business line comes with a routed block, IPv6 rides the same line
                    and an HA pair exposes several. An unknown transport or tunnel drops to null
                    and is SAID, never corrected into a neighbouring value.
  inter-site-audit.js  Coherence of the declared multi-site model — no network, no discovery.
                    INCOHERENCES (something is wrong) and GAPS (nothing is broken, but you
                    cannot answer) in separate lists, plus `notChecked`: every check that
                    could not run leaves its name and its reason, the same discipline as
                    ipam-audit.js — an empty list must mean "I looked", never also "I didn't".
                    Which check is of which kind is said by `INTER_SITE_AUDIT_PROBLEMS` /
                    `INTER_SITE_AUDIT_GAPS`, which are code and not prose: a sentence here
                    that counted them would go stale the next time one is added, and this one
                    did — it said five and five while they had become nine and eight.
                    Among the incoherences: an address declared PUBLIC that is not one
                    (RFC1918, CGNAT, loopback…), classified by `addrScope` (cidr.js) off the
                    IANA registry. Documentation ranges are deliberately exempt — they are
                    what the field's own hint suggests writing.
  inter-site-layout.js  Where each site goes on the map, as coordinates: no SVG, no DOM, no
                    strings — which is what lets the browser and the PDF export (and the coming
                    draw.io one) draw the SAME map. Deterministic and physics-free (a graph that re-settles
                    on every open cannot be compared with yesterday's or printed twice alike);
                    the shape follows the DECLARED role, and zero hubs or two fall back to a
                    ring rather than picking one for you. Labels are deliberately NOT measured
                    (a pure module cannot know a font) — the renderer measures the drawn SVG
                    with getBBox() and hands back BOTH rulers: the real box sizes and the gap
                    the longest edge label needs. The ring radius clears three things, not one:
                    two neighbours on the ring, the HUB IN THE MIDDLE (a third box nobody was
                    comparing — with real box sizes the hub and its spokes overlapped by 122px
                    and the link vanished under them), and the label that has to fit between
                    them. Separation uses the axis test (ONE axis apart is enough), never the
                    sum of the two boxes' radii along the line — that shortcut leaves a
                    wide-flat and a tall-narrow box overlapping at 45°.
  inter-site-report.js  The WAN chapter of the dossier, as DATA: one row per WAN line and per
                    link, with what it takes to rebuild them after an incident. Codes only, no
                    words (the glue translates — same split as pdu-report.js). What is missing
                    stays `null` and is COUNTED in the totals: a line with no circuit id is the
                    finding, not a hole in the layout. A ref that does not resolve says which
                    of five things happened (linked / typed / missing / unreadable / none), and
                    "not found" is never said without having looked. Carries the organisation
                    it was built from, so the map comes from the SAME coordinates as the panel.
  inter-site-svg.js  That map as printable SVG: white ground DECLARED as a rectangle, every
                    colour an attribute — the panel's SVG wears CSS classes and follows the
                    THEME, so through svg-to-pdfkit it would print as black shapes, or as a
                    dark theme's light text on white paper. Vector, never a raster. Words
                    arrive already written and the text is measured OUTSIDE (the PDF measures
                    with its own engine, which is inter-site-layout.js's ④ ruler). No glyph
                    outside CP1252: the hub is marked with a WORD, because a standard PDF font
                    draws a glyph it lacks wrong instead of substituting it.
  xml-escape.js     The one XML escaper (5 chars, XML entities). Separate from escapeHTML —
                    different context — but ONE, shared by drawio-export.js and
                    inter-site-svg.js: the second XML format we emit would otherwise have been
                    an identical copy of the first. Pinned by test/html-escaping.test.js.
  project-schema.js  What every field of state/node/spec/port/link IS — document / measure /
                    derived / private / secret — and therefore what happens to it in a portable
                    export. A field a person can type in the UI stays a `document`: erring
                    towards document adds one field to an export the user made themselves,
                    erring towards measure DELETES somebody's work.
  cidr.js           IPv4+IPv6 prefix arithmetic; `addrFamily`/`addrKey` = the identity of
                    a single ADDRESS (both families canonical), `addrScope` = WHERE it can
                    live — `global`, or which special-purpose range says it cannot (RFC 6890,
                    a registry rather than a vendor list). For IPv6 it TRANSLATES `ipv6Class`
                    (ipv6.js) instead of re-deciding what `fe80::/10` is; the vocabulary
                    `ADDR_SCOPES` is derived from the tables, because the panel asks `t()`
                    for each scope by name. `segmentKey` = the segment
                    an address belongs to — the DECLARED prefix containing it (most
                    specific first), and only where nothing is declared the /24 (v4) /
                    /64 (v6) convention, stated here instead of assumed per file. One
                    definition each, used by l3-gateway/ipam-audit and by drift-snapshot,
                    project-networks, correlate, topology-plan, dhcp-lease: the same rule
                    written in two layers diverges, and it is always the incomplete one
                    that wins. A segment key is only comparable against one built from
                    the SAME prefix list — producer and consumer must be handed it  (pure)
  netnames.js linkstate.js correlate.js cabling.js
  topo-lines.js frontpanel.js stack.js ha-pair.js
  topology-plan.js  buildTopologyPlan / inferUnmanagedNodes / classifyIntermediary:
                    assemble tiered links from a Sync poll + infer a hidden multi-port
                    intermediary behind a 2–4-MAC access port and suggest its role
                    (subnet → gateway · virtual OUI → hypervisor · randomised MAC → AP ·
                    else switch) — the Sync flags the port as a shared L2 segment with
                    that suggestion; the user materialises it from the Shared L2 panel  (pure)
  power-mib.js wifi-spec.js cable-labels.js drift-report.js
  ansible-netos.js  vendorToNetworkOs → ansible_network_os from the documented
                    vendor + measured sysDescr (conservative; null on unknown)  (pure)
  backup-ref.js     validateBackupRef → the config-backup POINTER (never the
                    config); rejects embedded credentials + control chars  (pure)
  project-networks.js  deriveProjectNetworks (/24s from devices+leases →
                    covered/blocked/open) + annotateNetworksVerification (join with
                    the Verifica outcome: presence badge per subnet + non-verifiable
                    devices nested under their /24, absorbing the old bucket)  (pure)
  overview.js       buildOverview → the read-only Overview view's facts in three
                    columns (Document · Conformance · Expansion). Each row = number +
                    provenance (declared/measured/derived/none) + optional drill-down
                    items (with peer/tag/group/of for the glue to render as name/word/
                    tabs). Pure COMPOSITION of spare-ports/project-networks/hw-
                    capabilities/TYPES — no new measurement; every word lives in the
                    glue (src/app-overview.js), never in the lib. Each section also
                    carries a health rollup (ok/warn/bad + issue count) that drives
                    the at-a-glance verdict; the since-last-read delta is glue-side
                    (localStorage, per project — viewing never dirties state)  (pure)
  os-icon.js        resolveOsIcon → OS string / family / TTL / VM-guest / node-OS /
                    hypervisor-platform → which logo + brand colour, with a CONFIDENCE
                    gate: a specific logo only from an authoritative source (sysDescr /
                    manual / guest-OS / platform), a grey family glyph from a TTL hint,
                    nothing when unknown. Emits <use href="#os-…">  (pure)
  os-icon-sprite.js AUTO-GENERATED inline <symbol> sprite (20 logos): Simple Icons
                    (CC0, mono, currentColor) + VectorLogoZone (CC0) & dashboard-icons
                    (Apache-2.0) COLOUR marks (own viewBox/colours) + 3 original glyphs
                    (windows/hypervisor/netdev). Injected once by src/app-os-icons.js  (data)
  ai-grounding.js   extractEntities + checkGrounding (citations + anti-invention)  (pure)
  ai-draft.js       splitDraftBlocks (segments AI reply → text + Ansible draft cards)  (pure)
  onboarding.js     nextStep(summary) → deterministic «next step» chip (onboarding §4d)  (pure)
  health-alerts.js  computeHealthAlerts → deterministic problem alerts from SNMP telemetry (RAM/disk/ink/UPS)  (pure)
  ui-catalog.js     extractCatalog/catalogLines: derive UI help (buttons+tooltips) from HTML+i18n  (pure)
  ipam.js           computeIpamUsage incl. nextFree (next free host = «suggested IP»).
                    Three populations, not two: documented devices, active DHCP leases,
                    and the plan's RESERVATIONS — declared, on no device, and not free.
                    A reservation that already carries a device counts once, as the device  (pure)
  ipam-model.js     prefixes are first-class, the VLAN is an optional reference; migration
                    from the 2.8.x shape where the subnet was a field of the VLAN.
                    `prefix.reserved[]` holds the booked addresses: they belong to the
                    NETWORK, not to a device — a booked address has no device by definition  (pure)
  lag-audit.js      checkLagMembers → how each member is built (speed/VLAN uniformity);
                    checkLagPlacement → where they live and how many (single-member
                    bundle, members across devices that are not one logical switch —
                    the «one chassis?» answer is injected, since lib/stack.js owns it);
                    checkLagPair → LACP mode across the two ends  (pure)
  ipam-audit.js     buildIpamAudit → duplicate addresses (v4+v6, canonical) + overlapping
                    prefixes + addresses outside the declared plan + VLANs the document
                    carries and the plan never names (IPAM hygiene, doc↔doc). The VLAN check
                    compares against what was DECLARED — a name or a network — and never
                    against `vlanColors`, which fills itself in with every VLAN ever seen and
                    would make the check pass on every project; the site native is never
                    accused, being the floor. `isContainerPrefix` = the one answer to «is this
                    prefix a container», declared by hand or said by the DCIM, so a hierarchy
                    written by hand can stop being reported as an overlap;
                    ⭐ `notChecked[]` names every check that could not run, because an
                    empty list used to mean both «nothing found» and «never looked», and
                    an audit that says nothing is believed;
                    compareCidr = the one address-space ordering, shared with the panel  (pure)
  l3-gateway.js     buildL3Report → one row PER DECLARED PREFIX (not per VLAN): who routes
                    each network, both families. `byVlan` is the derived per-VLAN view for
                    the SVI binding, which is the only genuinely per-VLAN fact.
                    ⚠️ A VLAN with no network keeps a row of its own only when somebody
                    performed an ACT on it — gave it a name, or chose who routes it. A
                    colour is not an act: `vlans` arrives from `vlanColors`, which fills
                    itself in and which a brand-new project already carries five entries
                    of, so listing those printed «declared VLAN, no network» about VLANs
                    nobody had declared. Same warning ipam-audit already carried; the
                    palette itself stays whole, so a prefix citing VLAN 40 keeps its
                    colour — what narrows is who earns a row  (pure)
  lag-audit.js      checkLagMembers → LAG member consistency (speed/VLAN mismatch);
                    checkLagPair → LACP cross-end mode coherence (both-passive /
                    lacp-vs-static)  (pure)
  lag-reconcile.js  isLagEligibleType (active-only, no passive/pass-through) +
                    stripLagOnPassive + reconcileLagMemberConflicts (one member per
                    active port, manual-first) — LAG data hygiene on load + auto-link  (pure)
  dcim-site-proposal.js  after an import: is this project a SITE of the organisation?
                    Pure decision only (propose / link / conflict / multi / already),
                    so the wizard can offer it and the answer stays testable without a
                    server. It OFFERS: joining the organisation is a declaration, and an
                    import that registered itself would decide on the user's behalf. A
                    project born from more than one NetBox site is refused with the
                    reason — one site is one project.
  dcim-wan.js       NetBox CIRCUITS → the organisation's WAN lines. Pure: turns circuits
                    into CANDIDATES (it writes nothing and does not know the organisation).
                    One end at a site → uplink; two sites → inter-site link; a carrier
                    PROVIDER NETWORK stays an uplink and the cloud is SAID, because several
                    sites on one MPLS cloud are not pairs of connected sites and inferring
                    the adjacencies would invent N·(N−1)/2 links. The link `kind` is never
                    guessed from the circuit type (free text of that instance): it enters as
                    `other` carrying those words. Only ACTIVE circuits become candidates — an
                    uplink has no state field, so a `planned` one would be indistinguishable
                    from a line in service. The bandwidth that enters is the PORT one —
                    `port_speed` on the SITE-side termination, kbps → Mbps — because the
                    field is presented as «Port bandwidth»; the circuit’s `commit_rate` is
                    NEVER a fallback, since on the real archive `FW-VR-100M` sells 100 Mbps
                    over a 1000 Mbps port and the two are different numbers. Reads both
                    termination shapes (≤4.1 `site`/`provider_network`, 4.2+ `termination_type`)
                    and re-checks the scope row by row, because NetBox ignores an unknown
                    query filter and answers with the whole archive.
  dcim-vpn.js       NetBox's `vpn/` app (L2VPN + tunnels) → INTER-SITE LINKS. Pure, and the
                    twin of dcim-wan.js: circuits say what a site buys, these say what
                    binds it to the others. Here the kind IS translated — `l2vpn.type` and
                    `tunnel.encapsulation` are CLOSED NetBox vocabularies (vpls→vpls,
                    ipsec-*→ipsec), unlike a circuit type, which is free text of the
                    instance; anything with no counterpart enters as `other` with NetBox's
                    label. ⚠️ `outside_ip` and `peerIp` CROSS: the peer of A is B's outside
                    address. Roles hub/spoke give the topology, two peers give nothing
                    ("mesh" is a claim about the whole set). Multipoint is refused with the
                    reason rather than split into pairs. Where an end lives is injected
                    (`siteOf`), so the module stays pure. ⚠️ NetBox accepts `?site_id=` here
                    and IGNORES it (measured on 4.6.7): the belt is the only real scoping.
  subbar-stats.js   computeSubbarStats → sub-header numbers: doc completeness
                    (withIp/addressable), device count (rooms excluded), SNMP health
                    (ok/err/warn/none) — same field defs as api-shape/app-drift  (pure)
  mac-class.js      What a MAC IS, for the whole project: `macKey` (canonical, to compare)
                    and `macFormat` (uppercase, to display); anything that is not a MAC
                    returns '' — a non-MAC used as a key is a string comparison in
                    disguise. Accepts colons, dashes, Cisco dots, bare 12 hex. Also
                    isVirtualMac/isRandomizedMac (BYOD, one merged OUI list);
                    sharedMacsInBatch (a MAC on ≥2 IPs = shared next-hop) + gatewayMacSet
                    (documented L3 gateways) → discovery skips by-MAC merge on those, no
                    gateway collapse. netnames/topology-plan/dhcp-lease/ai-grounding
                    delegate here; the Verify indexes with the injected normaliser, never
                    a bare toLowerCase — that holds only while every source spells a MAC
                    the same way  (pure)
  device-signatures.js  canonical sysObjectID→type table (OID_TYPE_VOTES; oidTypeVotes/
                    oidType/oidIsType) — single source read by the fusion scorer AND
                    the client _guessType (no OID drift)  (pure)
  discovery-mdns.js canonical mDNS(DNS-SD)+SSDP(UPnP) helpers: query build, wire-format
                    parse (DNS compression, SSDP headers, UPnP XML), service→type map
                    (vendor-neutral) + aggregateSweep. Drives server _mdnsSsdpSweep  (pure)
  radio.js          radio interfaces: pid/anchor/linkKind/seeds       (pure)
  power-groups.js   outlet GROUPS of a UPS/strip: two declared axes (switching:
                    switched|always · backup: battery|surge) + the group read from the
                    outlet NAME («Group 2 - Output 1», «Segment1_3», «Primary Group»,
                    «Non Programmable», «Surge Only») — one parser shared by the catalog
                    generator and the panel. DECLARED, never measured: RFC 1628 has no
                    outlet groups, each vendor keeps them in a private MIB  (pure)
  wifi-assoc.js     isWirelessInterface (ifType ieee80211 / name) + isUnicastMac (drops
                    broadcast/multicast/null ARP noise) + classifyFdbAssociations (FDB →
                    wireless vs wired) + collectWirelessClients (unifies FDB-L2 and ARP/ND-L3
                    neighbour signals, FDB wins) + resolveClientAssoc (BSS by VLAN) — drives
                    the auto-link's Layer 4c wireless associations (all-in-one, L3 APs/routers
                    and PC/SoftAP hotspots; L3 path gated on broadcasting an SSID)  (pure)
  vlan-trunk.js     carriedVlans + effLinkVlans (trunk derivato)       (pure)  …
                       (PURE only — the ex-`lib/app-*.js` GLUE now lives in src/)
src/app.js             Core bootstrap/nucleus: state init, init(), bindEvents, expose()
                       (ESM; imported 2nd in src/main.js after app-types). Cohesive helper
                       clusters extracted → app-ipam/app-cables/app-history/app-index/app-props-tabs.js
netmapper.html         The app shell + the <script> load order (authoritative)
styles/                Modular CSS (11 ordered partials + design tokens) — ex style.css; see styles/README.md
build.js               esbuild build of the frontend ESM bundle (dist/app.bundle.js)
src/                   GLUE migrated to ESM (bundled): _bridge, main, app-types (TYPES,
                       imported first), + all ex-`lib/app-*.js`
src/app-inter-site.js  "Sites and links": the multi-site layer with a face. Map (SVG from
                       lib/inter-site-layout.js) and hand entry in ONE panel — not two features:
                       a map nobody can populate stays empty forever, and a form with no map
                       never shows what it is for. Does NOT recompute the audit (it travels in
                       the route's answer) and ADOPTS the server's reply after saving, so a
                       subnet coming back canonical or a link being refused is visible.
                       Per site it can also READ THE WAN LINES from the DCIM (lib/dcim-wan.js
                       via POST /api/integrations/dcim/wan): additive like the networks button,
                       scoped by the project's own `state.source.dcim.sites` rather than by
                       whoever is looking, and everything it could not place is listed in the
                       panel instead of dropped.
src/app-org-context.js "Where am I": answers whether the OPEN project is a site declared by the
                       organisation (site.projectRef — read, never guessed by name), so the
                       sub-header can offer the step back up. Imports NOTHING on purpose: the
                       sub-header reads it on every render and the panel invalidates it after
                       saving, and importing either would close an ESM cycle — which in a bundle
                       surfaces as an `undefined` at runtime, not as a build error. Tells "not
                       loaded yet" apart from "not a site": announcing the second while the first
                       is true would flash a false statement on every cold start.
src/_bridge.js         Migration bridge: win.* read, expose() publish (sparirà a fine migrazione)
src/store.js           Shared mutable view-state behind a proxy (state/selId/… ex-win.*)
src/app-delegation.js  Delegated click/change/input listeners: data-act/change/input="key" → imported fn
test/                  node --test: pure-lib tests + smoke-app (vm + DOM stub)
```

---

## 2.1 Rack front-panel rendering

The native rack renderer is the final visual projection of a device's neutral
`frontPanel` state. The renderer keeps the main data rows, SFP/QSFP groups and
dedicated management slots separate, while interface identity and numbering
remain in the same model used by NetBox import and **Apply model**.

For high-density combinations, `_renderAllNow` adds the visual-only `dense-xxl`
class when an SFP block is present and either the main row has at least 20 slots,
the SFP groups contain at least 8 slots, or the combined row and SFP count reaches
28. The CSS then reduces inter-block gaps, cell dimensions and border overhead and
disables the historical fixed translations. It does not reorder ports, change
`frontPanel`, alter `state.ports` or change the vendor-neutral classification.

The regression scenario in `test/render-density.test.js` protects a 54-port device
with 12 SFP slots and one MGMT slot, asserting that all 54 data interfaces and the
dedicated management interface remain rendered.

## 3. The key pattern: pure lib + glue

Every non-trivial piece of logic is a **pure UMD-lite module** in `lib/`: it works
in Node (for tests) and in the browser (exposed as a global via `Object.assign`).

```js
// lib/example.js — PURE: no DOM, no globals, just data in → data out
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function buildSomething(model) { /* pure */ return result; }
  return { buildSomething };
});
```

The **glue** (`src/app-*.js`, ESM) calls `buildSomething(...)` and turns the result into
HTML/DOM. **Logic is unit-tested in `lib/`; presentation is not.** When adding a
feature: put the *decision* logic in a pure lib with tests, keep the glue thin.

A **display** decision can be a pure lib too, and `lib/node-label.js` is the case worth
copying: it answers "how does this device read" — a readable part plus an address —
without ever touching `node.name`, which is a *declared* field. It exists because the
Discover import stores the IP as the name when no hostname is found, so the honest fix
was to derive the label from what is already measured (classified type + OUI vendor),
never to write a guess into the document. The point of putting it in `lib/` is that a
single implementation then serves **every** surface — floor plan, drift report, audit
log, L3 map, cable labels, dossier — through one glue function (`getNodeDisplayName`),
instead of each surface reinventing the fallback. Server-side consumers (`server/pdf-report.js`)
require it directly; `src/` modules import it as ESM (like `lib/ipv6.js`), which keeps
it off the Axis-A `win.*` ratchet entirely.

Recent example: `lib/drawio-export.js` (`buildDrawioXml`) builds the draw.io / mxGraph
rack export as pure data-in → data-out (native `mxCell`s, calibrated against
diagrams.net); its glue `exportDrawio()` and the menu wiring live in the classic
`export.js`, which is outside **both** bridge ratchets (§10) — so the new menu item is
wired with `addEventListener`, never an inline `onclick` (which would push the Axis-B
`MAX_INLINE_HANDLERS` ratchet), and reads the pure lib as a bare global (no `win.*`,
which would push the Axis-A `MAX_WIN_REFS` ratchet). The same lib also emits the
intra-rack cabling as native edges on one activatable draw.io layer **per VLAN** (named
with the VLAN name), routed in per-cable lanes + stagger so nothing overlaps — and it
stays pure: the VLAN number/name and the per-cable colour arrive as **injected helpers**
from the glue (`linkVlan`/`vlanName`/`linkColor`, mirroring the live view's resolution),
never read from globals. On the same layer it also emits a **cable table** (one row per
cable); each row carries a native draw.io **custom action link** (`data:action/json`)
that, in View/lightbox mode, persistently highlights the matching edge (a *Set Style* on
`strokeWidth`, radio-style, with the header as reset) and scrolls to it — the readable
way to isolate one cable without tracing lines. The page format is chosen **per rack**
from the content bounds: A4 portrait, auto-switching to A3 when a tall rack or long table
overflows A4.

The glue is now **ESM** (`src/`, bundled by esbuild) with explicit `import`/`export`
where ritirato, plus the transitional `window` bridge (`src/_bridge.js`) for what's
not yet retired. Only the remaining classic `<script>`s — the pure `lib/*.js` and
`export.js` — still share one global lexical scope. Beware of name collisions — see
Gotchas.

---

## 4. Data flow

A project is a single `state` object (see `_buildDefaultState()` in `src/app.js`):

```text
state = { schemaVersion, racks[], currentRack, nodes[], links[], ports{}, vlanColors{},
          vlanNames{}, ipam{prefixes[], vlans{}, addresses[]}, lagGroups{}, lagModes{},
          guestVlans[], … }
```

- **node**: `{ id, type, name, rackU, sizeU, ports, rackId, ip, ip6, ip6Manual, … }` — `ip6` is a **distinct** IPv6 field with the same manual-first padlock as `ip` (`ip6Manual`): the Sync auto-populates it from the device's own SNMP address (`ipAddressTable`), or Neighbour Discovery proposes it; never merged into `ip`, the IPv4 IPAM, or the Ansible host
- **link**: `{ id, src:'nodeId-portN', dst:'nodeId-portN', … }`
- **port**: `state.ports['nodeId-N'] = { status, speed, vlan, ip, … }` — `ip` is the address **of that interface**, not of the device: a router answers on one address per port, and while the model held a single address per device the second interface could only be recorded as a second device. `node.ip` stays the management address. Declared manual-first: stored as typed, with the panel flagging anything that is not an IPv4 rather than refusing it. Not offered on passive ports (patch panels, wall outlets), where copper passes through and no interface terminates

Mutation → render → persist:
`updateN(...)/setLinkProp(...)` mutate `state` → call `renderAll()` (or a scoped
`renderScope('props'|'cables'|'floor'|...)`) → `markDirty()` → `saveProject()`
serializes `state` to JSON via `PUT /api/<projectId>`.

Load path: `loadProject(id)` fetches the stored `state` and runs it through
`_migrateState()` (`src/app.js`) before it becomes the live model. `schemaVersion` is
written in the envelope and in the state; unknown future versions are preserved rather
than silently downgraded. Migration is idempotent and mostly additive (defaults for new fields, legacy VLAN/radio/link
repairs), with one structural step: `_normalizeProjectNodeIds` **canonicalizes
device IDs** that don't already match the `<type-prefix><n>` scheme (an imported
`core1` switch becomes `sw1`) and remaps every ID-embedding reference — link
`src`/`dst`, `ports` keys, and LAG identifiers. **Invariant:** a reference that
embeds a device ID must be remapped on *both* sides or it dangles — in particular
the port-side `ports[].lagGroup` and the `state.lagGroups` map keys go through one
shared `remapLagId` helper so they stay aligned across formats (`snmp-lag-…`,
`lldp-lag-a||b`, `lag-<id>-poN`). App-created projects already use canonical IDs,
so this is a no-op for them; it only reshapes imported/generated projects.

The server saves the main project with a temporary file, `fsync`, rename and `.bak`
fallback. ⚠️ **The temporary is named after the write, not after the process** — a name per
process meant every save of the same project inside one server shared one filename, and the
day any of that I/O became asynchronous two saves would have overwritten each other's
temporary before the rename, which being atomic would then have delivered a *valid* file
holding half of each. A unique name creates an obligation the fixed one did not have, so a
failed write removes its own temporary rather than leaving an orphan nobody collects.
And the fallback is **declared**: `readProjectFile(id)` says whether the
content came from the project file or from the last valid copy, and in the second case
whether the file was missing or unreadable. A GET reports it in a response header (never
in the body, which is the DTO the REST API v1 also serves) and the browser warns before
the older content can be saved back over the newer one; `loadProject(id)` stays the
plain one-value call for everything that has nobody to tell. The floor-plan image is a sidecar under `projects/assets/`; timeline and
snapshot history are separate files under `projects/history/<id>/`, written atomically
with `fsync` and pruned when a project is deleted. The browser JSON export is a portable
envelope, not a raw server backup: it redacts SNMP credentials and sanitizes backup
references before download, and the importer unwraps both this format and legacy state
files.

⚠️ **The project list is paid once per write, not once per read.** `listProjects()` used to
re-read and re-parse every project file on every call, synchronously, in the single server
process — and the per-site device counts on the multi-site map come out of that same call, so
the cost grew with the number of sites. Each row depends only on its own file, so rows are
kept and rebuilt when that file changes. ⭐ **Whether it changed is decided by the very two
facts `projectEtag` already trusts** to refuse a save when somebody has overwritten a project
underneath one in flight — last-written time to the millisecond, and size — read from one
place, so the weaker use can never disagree with the stronger one. `saveProject` drops its own
row directly, which covers the one case no signature can see (two writes in the same
millisecond at the same size), and the map is rebuilt each pass from the files that are
actually there rather than pruned, so a deleted project falls out by itself and the cache
cannot grow. Rows are handed out copied: a change of speed must not quietly change the
contract callers already had.

`renderAll()` (rAF-coalesced) rebuilds the rack chassis, floor, cables overlay and
the right panel. `renderProps()` dispatches by selection (`selType`/`selId`) to
`_renderNodeProps` / `_renderLinkProps` / `_renderPortProps` / `_renderFloorProps`.
At the tail of each rebuild it also refreshes the sub-header (`src/app-subbar.js`
`renderSubbar` → `#modern-subbar`: breadcrumb · active VLAN-filter chip · project
stats) — a bare-global typeof-guarded call, so no new `win.*` reference.

Floor nodes also carry a **presence overlay** derived from the last Drift report,
built on an **honest presence** model — *"no answer" is not "dead"*, so **red**
requires a signal a live host cannot suppress:
- **green** (no overlay) — any positive signal: SNMP answered, MAC in a switch FDB,
  an active DHCP lease, an ARP reply during the sweep, or the **router's neighbour
  tables** — the IPv4 ARP table (`ipNetToMediaTable`/`ipNetToPhysicalTable`, `snmpArp`)
  or the IPv6 Neighbor Discovery cache (`ipNetToPhysicalTable` IPv6 rows, `snmpNd`) —
  proving a device alive on a VLAN *behind* a router (green **across subnets**, no ping
  from the server needed; ND catches IPv6-only or ARP-aged hosts the ARP path misses).
  A positive signal always wins over any absence hint.
- **red** (`.node-absent`, bucket `macOrphan`) — only from `trustAbsentNodeIds`: a
  **local ARP-miss** (the `/api/reachability` sweep returns `absent:true` only for an
  IP on the server's own segment, by real netmask, that never appears in ARP after the
  ping) or a **switch access port down for ≥ N syncs** (the switch is authoritative on
  its own port's link; the down-streak is the anti-flap). Of these two, only the
  **local ARP-miss** needs the sweep, so it fires solely on **Verifica**; the
  **switch-port-down** signal needs no sweep, so a plain **Sync** *can* turn a node red
  once its down-streak matures (`portDownStreak` accumulates sync after sync). What a
  plain Sync never does is red a node that is merely **silent** — that stays grey.
- **grey** (`.node-unverified`, bucket `unverified`) — everything else: FDB ageing,
  host-filtered ICMP, a mute SNMP agent, a remote/unreached subnet. Honest "don't know".

### Port state: shut by hand vs simply without link

`ifOperStatus` says whether a port has link; `ifAdminStatus` (IF-MIB `.7`, read since
2.9.2) says whether a person turned it off. The two are different facts — the first is
a symptom (device off, dead NIC, SFP pulled), the second a decision written on the
device — and the rack draws them apart *because* they are apart. A port in `shutdown`
keeps the near-black `--shut-color`: a decision asks nothing of anybody, and whoever
made it knows. No link across `DOWN_STREAK_N` verifies takes **amber** `--nolink-color`,
because an ambiguous symptom is precisely the thing somebody has to walk over and look
at. Everything unknown stays plain grey — a port nobody has measured is not a symptom.
Neither of the two glows: the live states glow because they are lit, these signal
without pretending to be.

⚠️ That amber is deliberately **not** `#f5a623`, the interface's generic warning amber
(AI chips, verification rows, overridden fields): two ambers that coincide get merged by
the eye and the colour stops saying anything. On the ports themselves there is now only
one amber, because the port state that used to own the other — `idle` — is gone. It said
four different things depending on the layer reading it, nothing consulted it to decide
anything, and the same SNMP reading that produced it also started the down-streak that
turned it into *this* amber three verifies later. A port switches, does not switch, or is
faulty; the two readings that had no colour (`testing`, `dormant`) survive as `operWait`,
a measurement printed in the port panel in the device's own words. And the hex is written
**three times** — the CSS token plus the
two exports, which build files outside the browser where a token does not exist — which
is this project's most expensive shape of defect, here landing on a PDF handed to a
customer with a port one colour on screen and another on paper. Unifying is impossible
(a `.css` cannot be imported from Node), so the second house recipe applies:
`test/porta-senza-link-colore.test.js` compares the three copies and refuses any two of
the five port states that resolve to the same value.

The rule is `portShade()` in **`lib/port-state.js`**, read by both renderers (the
generated front panel and the vector skin), by the port Properties, by the PDF dossier
and by the draw.io export — one definition, because a drawing that colours the same
concept with rules of its own is this project's most expensive class of bug. Three
invariants live there: the field **absent means "not known"**, never "port is up"
(hence `=== true`); a status **declared by hand wins the drawing** (a measurement that
contradicts it surfaces in the Verify, not by overwriting the pixel); and the reading is
**forgotten** by `forgetPortMeasure()` as soon as the switch stops confirming it, so a
strong assertion cannot outlive its evidence.

On the cable side a **declared** cable over a shut port becomes `declared-shut`
(bucket `diverged`, badge "Port shut", Drift category `shutCable`) — never `ghost`,
which means "inferred, and its evidence evaporated".

An **inferred** cable over a shut port is not a ghost either, and this is the subtle
part: the down-streak that feeds both the `no-link` shade and `ghostCable` counts
consecutive verifies without link — but a port in `shutdown` has no link *by decision*,
which is not an observation about the cable. `nextDownStreak()` therefore returns 0
while `adminDown === true` (the same choice already made for a mute device: if we
cannot observe, we do not accumulate), `applyPollResult` clears the streak on the
true→false transition so a reopened port must re-earn its `no-link` over N real
verifies, and `buildDriftReport` skips a cable whose end is shut regardless of a
streak stored by an older save. Without this, shutting a port for a few verifies
turned every inferred cable on it into a ghost — 35% opacity and a sparse dash, which
on screen reads as gone — and reopening the port jumped straight back to the no-link
shade, on a streak matured for the wrong reason.

The streak counts a **measurement**, not `port.status`. That field has three writers
with three meanings — the user drawing a cable, the DCIM import, the poll — and when
`ifOperStatus` does not arrive it keeps the *previous* value, so the series advanced on
an observation nobody had repeated. `operUp` is therefore written beside `adminDown` by
the poll alone, with the same three states (`true` link, `false` down, **absent** not
measured) and the same expiry — `forgetPortMeasure()` drops them together. Absent
covers both ways a reading fails to exist: the agent answers `unknown(4)`, which RFC
2863 defines as "cannot determine" and which used to come out amber, and the interface
simply not appearing in the walk, after which `applyPollResult` forgets the measurements
of every mapped port that walk did not cover. A project saved before 2.9.2 carries no
`operUp` and accumulates nothing until the first poll writes it, which is exactly what
is known about it.

### A VLAN that was never declared

The SNMP reader used to close every interface with `vlan: f.vlan || 1`. A device that
publishes nothing about a port's VLAN — a Cisco vIOS answers neither `dot1qPvid` nor
`vmVlan`, measured — still produced a 1, and in the document that 1 was
indistinguishable from a measured one. Everything downstream treated it as a
measurement: `_getLinkVlan` returns the VLAN of an *active* port before it ever
consults the propagated one, so a VLAN declared by hand or propagated from upstream
could not prevail. It was not overruled, it was stepped over.

The field is now left **absent**, and the readers needed no change: they already fall
through to the propagated VLAN when it is missing. The client converter
`_snmpVlanToUi` had in fact documented this exact case for a long time and never got
the chance to apply it, because the driver handed it a 1 instead of nothing — two
layers holding opposite definitions of one value, with the lower one winning. When
reading these paths, the question to ask of any default is *who else believes this is
a measurement*.

Not inventing new ones turned out to be only half of it. `ports[pid].vlan` **is** the
measurement — the hand-written value lives in `vlanOvr` — but `_snmpVlanToUi` kept the
previous value whenever a poll had nothing to say about a port, which made every
invented 1 immortal: no later reading could remove it. It is forgotten now, on the same
ground `forgetPortMeasure` already forgets `adminDown`/`operUp` for ports a walk did not
cover. The two cases stay apart on purpose: here the walk *did* cover the port and the
device said nothing about its VLAN, which is stronger evidence than silence about the
port itself, so only this one drops the value.

### What a cable is — and the eight places that used to answer

`_getLinkVlan` answers *what is the native VLAN of this link*, and that is correct; it is
also what `_getLinkTrunk` uses as the trunk native. The colour was asking it the wrong
question. On an access cable the native is the whole truth, but on a trunk it is one VLAN
among several and legitimately 1, so painting it says «VLAN 1» about a cable carrying four.

`lib/link-vlan-color.js` answers a different question — *what is this cable* — with four
outcomes, each saying one thing only:

| outcome | when | shown as |
|---|---|---|
| `vlan` | exactly one VLAN applies | that VLAN’s colour |
| `trunk` | it carries more than one | neutral + the carried VLANs as pills |
| `routed` | the port is declared L3, or measured as not being a port of the bridge: it routes | neutral, and the panel says why |
| `conflict` | both ends name a VLAN, with equal authority, and the two differ | neutral; the panel names both numbers, lists it among the cable’s problems at error level (`vlan-ends-disagree`, the access twin of `native-mismatch`), and the topology legend explains this second neutral |

⭐ The fourth does not describe the cable, it describes **us**: the document contradicts
itself, so there is no answer until somebody decides. The ladder used to take the first
end that spoke and paint its VLAN with `known: true` — a cable with 20 on one side and 30
on the other read «VLAN 20, set by hand», identical hex for hex to the case where the two
ends agree. On the wire an access link like that carries nothing: it was the only state in
which the drawing was *certain* and the network was broken. Falling through to the next
rung would have been worse still — the bottom rung is the site native, so a real
contradiction would have come out as a plausible number.

⚠️ Only between ends that hold the **same** authority, and only on access links. A PC does
not contradict a switch (it has no say — `lib/vlan-authority.js` already filters it out);
a declared value against a measured one is not a conflict but manual-first, and the place
to discuss those two is Verifica; and on a trunk `vlanOvr` is the *native*, whose
disagreement already has a name of its own (`native-mismatch`).

⭐ **A cable that switches always has a VLAN, so it always has a colour.** «VLAN not
declared» is not a state that exists in switching: every port of a bridge has a PVID, and
where nobody configured one that PVID is 1. Two claims, kept apart because they rest on
different things: the default PVID of 1 and the 1..4094 range are **standard** (`dot1qPvid`
carries `DEFVAL { 1 }` in RFC 4363, and the range is in the YANG IEEE publishes for
802.1Q-2022), while *VLAN 1 cannot be deleted* is a **multi-vendor fact** — EXOS ships a
«Default» VLAN with VID 1, Junos puts everything in access on the default, Aruba uses 1
untagged — and not a clause of 802.1Q. Measured on the bench, the Arista reports PVID 1 on
every untouched port and VLAN 1’s membership list contains exactly those: a list of members,
not a complement. So the last rung of the access ladder
is the **site native VLAN** (`state.nativeVlan`, 1 by default, declarable for a site whose
native sits elsewhere). It is deliberately last: one rung higher it would cover a real
answer with a plausible number. The provenance travels with the outcome and the panel
always prints it — the number alone would let a default pass for a reading.

⚠️ `routed` stays outside that floor, and it is the only case where a VLAN genuinely does
not exist: VLAN 1 is the floor of the *switching domain*, not of the universe. Three proofs
on three vendors, measured on the bench, and they are kept together because they close the
argument from both sides. Where nothing switches there is no floor: make a Cisco port routed
and the switch allocates it an internal VLAN from the extended range (1006–4094) rather than
putting it in 1, and the MikroTik edge router — no bridge ports, no VLAN table — has no VLAN 1
at all. Where something does switch the floor is really there, which is the Arista membership
list above. One of the three on its own reads as one vendor's behaviour; the set does not.

⭐ **On a trunk no VLAN wins.** Every rule for electing one was tried and each asserted
something untrue; the case that settles it is an interface doing management *and* VLAN 30 —
it has no answer, not a hard one. So a multi-VLAN trunk takes no colour, and the VLANs it
carries are shown together at equal weight. A trunk carrying exactly one VLAN keeps its
colour: there nothing is chosen, it is observed.

**Where that answer lives on screen.** All of it — the outcome, the port mode, the native
VLAN, the carried ones and the colour override — sits in one collapsible section of the
cable panel, the same `details.props-collapsible` every other section of the properties
panel uses, with the model's own verdict previewed in the head while it is closed. What
the section says once it does not say again: on a trunk the carried VLANs *are* the pills,
not a sentence repeating them, and the provenance line appears everywhere except a
multi-VLAN trunk — which asserts no VLAN at all, so it has no default that could pass for
a reading. The port **mode** is not in there at all: TRUNK/ACCESS is a property of the
link, so it stands with the badges that answer *what is this cable* — first among them,
before the state, the discovery protocol and the proof state.

⚠️ The VLAN field in that section is **editable, and writes an override onto the active
port**. It therefore carries only the *declaration*, empty when there is none, and shows
what applies as a placeholder. Pre-filling it with a fallback is the driver's «VLAN 1»
defect one layer up and in a worse place: there, one keystroke turns a stopgap into the
user's own assertion. A placeholder asserts nothing; a value does.

**A bundle's VLAN is declared once, and written to every member.** On real hardware a
Port-channel is configured once and the members inherit; members that disagree do not
aggregate at all, which is what `checkLagMembers` already warned about. The LAG row
therefore carries its own VLAN field, and `setLagVlan()` writes `vlanOvr` onto every port
of the group — an empty value clears them rather than writing 1, since «nothing declared»
and «declared VLAN 1» are different states. Writing it onto the members, rather than
holding it on the group, keeps two properties: no other layer has to learn what a LAG is,
and the coherence warning stays **reachable** if somebody later changes one port by hand.

⛔ The shortcut refused here is worth recording, because it looks elegant: letting an
undeclared member inherit from a sibling inside `propagateVlans()`. It would write a
number onto a port nobody declared — the defect this release exists to close — and it
would silence the one warning that catches a genuinely broken bundle. A test pins both
halves, including the fact that propagation does *not* inherit.

⚠️ **One VLAN means one in total, native included.** The count used to filter VLAN 1 out, so
a trunk with native 1 plus one tagged VLAN passed for «carrying a single VLAN» and took that
colour — while two VLANs cross that copper, since the native's untagged traffic goes over it
as well. Measured across the real projects: three cables, two of them access-point uplinks
carrying management untagged in VLAN 1 and the SSID tagged in 99. The filter was the common
practice («don't use VLAN 1») mistaken for a description of the wire. A known limit stays: a
VLAN 1 *pruned* from the trunk does not really cross and we count it anyway — but that error
leads to neutral, which asserts nothing, rather than to painting the wrong VLAN.

On an access cable one VLAN does apply, so the ladder looks for *which*: a hand-set value,
a measured one, the propagated one, a dot1Q sub-interface standing on the cabled port, then
the declared network of an end that has **exactly one cable** — its address can only be
talking about that cable. A multi-homed device’s address says nothing about *this* one.

⚠️ **Who may name the VLAN is not «an active device» but «one that switches VLANs»**
(`lib/vlan-authority.js`). *Active* is a property of the type — our own classification — and
says nothing about whether the device assigns VLANs. The discriminant is already in the
measurement and needs no vendor list: a device whose entire VLAN world is `[1]` has named
only the VLAN that exists when nothing is configured, so its `vlan=1` means *my port is
untagged*, not *this cable is in VLAN 1* — and it cannot be authoritative about a VLAN it
does not know. Measured on the bench: a wireless controller and an EXOS switch, both
answering on 10.10.99.x and therefore living in VLAN 99, published `vlan=1` with a VLAN
world of `[1]` and overruled the declared network. A device that does know other VLANs and
still says 1 is *choosing*, and keeps its authority.

⭐ **Where a VLAN stops is decided the way the hardware decides it**: a frame keeps its
identity until a VLAN-aware port reclassifies it. So «does this device classify VLANs?»
(`isVlanAware`, one definition read by the cable colour, the propagation and the port
panel) is not «is the type active»: an **unmanaged switch** is a plain 802.1D bridge —
forwards on MAC, no VLAN table, adds and strips no tags — and its whole inside is one
broadcast domain, so the VLAN arriving at its edge applies to every one of its sockets.
Before this, the VLAN reached its uplink port and died there. It is **declared** (`swMgmt`
in the Switch panel, a field that already existed and nothing read) and never inferred: a
managed switch nobody has polled looks identical, and guessing would push a VLAN through a
device that in fact keeps VLANs apart. Only `unmanaged` is transparent — a smart-managed
switch has VLANs and classifies like a managed one.

That untagged 1 is not thrown away, it is demoted: it sits **below** the declared sources,
as `untagged`, so a flat network — where 1 really is the only VLAN there is — still reads
VLAN 1, while a declared network wins wherever the two disagree. The same rule governs
propagation, or the discarded claim would cross the cable as `vlanProp` and win one rung
lower: a **passive** port still inherits an untagged VLAN (it has none of its own), an
**active** one inherits only a value that carries authority.

⚠️ **The VLAN legend's routed badge is a filter, and it shares `store._filterVlan`.**
It shows only when some cable actually falls there, reads «L3» (the same in both languages —
the full word opens its tooltip), and a click on it shows only routed cables, exactly as a
click on a VLAN badge shows only that VLAN's. It is a *value* of the VLAN filter rather than
a switch of its own because the two are mutually exclusive: asking for VLAN 30 and for the
cables that are in no VLAN at all is not a question. ⚠️ That makes `_filterVlan` a variable
that holds a number **or** the string `FILTER_ROUTED` (`src/app-popup.js`) — the comparisons
`_effPortVlan(pid) === store._filterVlan` therefore stay false, which is the right answer (no
port has "routed" as its VLAN), not a coincidence to lean on. Which cables are routed is not
recomputed for the filter: it comes from the same verdict that colours them. The other neutral
entry, a cable whose two ends disagree, stays read-only — a finding to close, not a view to
inhabit.

⚠️ **`routed` is consulted last, never first.** Owning an IP address is normal for any
host; it is the switch side that decides whether a cable is in a VLAN. Measured on the
bench: with the check placed first, a VyOS router and a wireless controller sitting on
access ports in VLAN 99 both came out as routed links. It only distinguishes *why* no VLAN
applies — a routed port is a fact with nothing missing, while a switched one always has a
VLAN — and the evidence is the standard address-to-interface table, of which only the IPv6
rows were previously kept.

⚠️ **«Routes» is measured as «is not a port of the bridge»**, which is what the word means;
owning an address is only an indication, since every host has one. The evidence is
`dot1dBasePortIfIndex` (BRIDGE-MIB), already walked to translate PVIDs. It is used
asymmetrically on purpose: being **in** the table is a veto — that port switches — while
being absent from it proves nothing, because a vIOS publishes the table for two ports out
of eight and another unit of the same image for none. So the two measurements keep their
own names, `ownsIp` and `bridges` (absent, not false, when the agent is silent), and
`isRoutedPort` composes them in one place.

⚠️ **But a port can also be DECLARED routed, and that comes before both measurements.**
Port mode (`state.ports[pid].mode`) has a third value beside `access` and `trunk`:
`routed`. It reaches the engine as `declaredRouted` on the paint end and is consulted at
rung 0 of `linkPaintVlan` — above `vlanOvr` too, because the two sentences are not about
the same thing: `vlanOvr` states the PVID of one port, `routed` states that this *cable*
carries no VLAN, and on a single wire the sentence about the wire decides the wire. On the
same port they cannot collide, since `setPortMode('routed')` deletes `vlanOvr` and
`trunkVlans` — a document must not hold two incompatible statements and let the reader
choose. It also beats the `bridges` veto: manual-first is not suspended when it is
convenient, so the declaration stands and the port panel says the two disagree. Without
this a project drawn by hand could never produce a routed cable at all: the wire between
two routers fell to the site-native floor and was painted VLAN 1, asserting that it
switches. ⚠️ It is not consulted on trunks — a trunk switches by definition — and the UI
does not offer L3 there. ⚠️ It is a third value of one field rather than a separate
switch, because two independent controls answering «what kind of port is this?» can
contradict each other and one field cannot.

The optional companion is `state.ports[pid].routedNet`: the `cidr` of one of the declared
networks (`ipam.prefixes[]`). It stores only the key — `prefixesOf` stays the authority on
prefixes — and it feeds the port column of the device's «Gateway L3 / SVI» section, which
previously said *which* network a device routes but never from where. ⚠️ Optional on
purpose: requiring it would block the half-drawn case, and the cable's colour depends on
the mode alone. ⚠️ The picker lists **every** declared network, `prefixesWithoutVlan` first
and the rest labelled with their VLAN. Restricting it to VLAN-less networks was the first
cut and it was wrong twice over: a real project declares five networks that all have a
VLAN, so the field came up empty and the mode looked broken; and the *measured* path calls
a port routed even when its address sits in a network that has a VLAN, so the declared path
would have refused to name what the measured one happily concludes. ⚠️ The `<select>`
carries `data-no-manual="1"`: `_enableManualValueInProps` appends a «Custom…» option to
every select in the panel, and this field is a **reference** — a typed CIDR would point at
nothing and would be a second place for a network to live. ⚠️ Never inferred, neither from the port's own
declared address (`ports[pid].ip` — an indication any NIC satisfies, the very reason the
measured field was renamed from `routed` to `ownsIp`) nor from the VLAN card's «routed by»,
which proves the device sits *inside* that VLAN, the opposite of what it looks like.

The glue `src/app-link-color.js` is the only translator from that outcome to a colour.
Before, eight sites computed it — `app.js` ×3, `topo-lines.js` ×2, `export.js` ×2, the
properties colour picker — and they had already diverged: the topology used the pair’s most
frequent VLAN while the rack used the native, so one cable could be two colours.
`test/link-color-unica-definizione.test.js` refuses a ninth: no file outside the owner may
index `vlanColors[…]` with a cable’s VLAN. Its three indexes (sub-interfaces by parent port,
cables per node, VLAN of a node’s IP) are rebuilt by `propagateVlans()` rather than by an
invalidation contract of their own — one lifecycle instead of two that drift.

Three sources fill part of the gap the invention used to paper over, all declared by
the device and none inferred: the **native VLAN of a Cisco trunk**
(`vlanTrunkPortNativeVlan`, zero meaning "no native frames" and treated as silence);
the **VLAN of a dot1Q sub-interface** (`cviRoutedVlanIfIndex`, whose index carries the
VLAN *and* the physical port, so it declares the parent too — the standard
`ifStackTable` still decides and the Cisco row only fills its gaps); and what an
**aggregate** declares to its member ports, which is looked up by the aggregate's
interface index rather than its logical id. That last lookup had used the logical id
since it was written, so the inheritance had never once run — invisible on images
that do not publish membership at all, which is most of them.

A sub-interface enters the document as a **logical port**: the same shape the NetBox
import already gives its logical interfaces, not a second model. It is not cablable,
takes no positional slot and stays out of cable resolution, but it carries the VLAN
and the address — on a router-on-a-stick that address is the one InfraNet is talking
through, and it used to be discarded along with the interface. Its identity is the
interface *name*, never the ifIndex: without `snmp-server ifindex persist` the indexes
are reshuffled on reboot and the port would split in two at the next verification.

### Measured hardware identity, and its age

`node.integration.inventory` is what ENTITY-MIB said about a device: make, model,
serial, firmware. It is a **measurement**, so it has an age — which nothing tracked
until 2.9.2. The field had two states ("there" / "not there") and was rewritten on
every poll with whatever arrived, `null` included, which cut both ways: a read that
carried no identity **erased** a good measurement taken months earlier, and whatever
survived was compared against the declared fields as if freshly read, producing
"device replaced" from a partial walk.

ENTITY-MIB is walked by index, and on many agents the chassis sits at a very high one
(on a GS1900-24, index 67,108,992, while a "Stack" entry sits at 64). A truncated walk
therefore leaves the accessory rows and the scorer crowns the survivor — so
`drivers/snmp.js` refuses to build an identity when nothing in the walk is a CHASSIS
(class 3) or a MODULE (class 9): classes 11 (stack) and 5 (slot) describe how a device
is organised, not what it is.

**`lib/identity-reconcile.js`** holds the rule, in three states: *reconfirmed* (this
poll measured it: `measuredAt`, no flag), *last known* (the poll succeeded but brought
no identity — the previous measurement is kept, marked `stale`, with its original
date), *never measured* (`null`). An inventory object carrying none of the four
identity fields is not a measurement at all, so it cannot displace one. Nothing is
touched on a **failed** poll: nothing was measured and nothing was contradicted.

The consequence is the point: whoever **accuses** asks `isConfirmedMeasure()` —
`lib/drift-snapshot.js` (`measuredIds` → the `identityDrift` bucket), `lib/overview.js`
(`_identity.mismatch`, the recovery lens) and `export.js` (`identityMismatch` in the
handover dossier), three engines that each carried their own copy of the comparison.
Whoever **informs** reads it regardless — the model to buy again, the firmware to
reflash, the Properties placeholders — with the panel saying "last known, not
reconfirmed" and the date, since a months-old model otherwise reads as freshly
measured.

Rack devices keep their SNMP LED instead of an overlay. The buckets cover documented
devices with an IP but no MAC too (`doc.ipOnly`), checked per-node rather than per-MAC.
The signals are assembled in `lib/drift-snapshot.js` (`buildSnmpSnapshot`: `presentNodeIds`,
`trustAbsentNodeIds`, `macAtIp`, `snmpArp`, `snmpNd`) and decided in `lib/drift-report.js`;
a stale DHCP lease is deliberately never a red signal (imported old files would mass-flag),
and `snmpNd` is presence-only (never IP-change, to avoid a cross-family false positive). An
**opt-in** setting (off by default, in the DHCP lease import panel) additionally annotates
a grey device whose DHCP lease is **released** (the device sent DHCPRELEASE) as "likely disconnected"
(`releasedMacs`) — a weak hint that stays grey, never red, and only from `released` state
(never from lease expiry).

**A MAC at an address the document knows is not an undocumented device** (2026-08-23).
The "undocumented" bucket matches observed MACs against documented ones, and infrastructure
has no documented MAC to match: a switch or a router exposes no device MAC over SNMP, so the
node is carried by its address alone and its signature can never meet a row of any forwarding
table. On the bench SW-CORE's switched interface was accused at every Verify — true in form,
wrong in substance, and impossible to close. `buildDocSnapshot` therefore also returns
**`knownIps`**: every address the document knows *and has no MAC for* — the management address
of a MAC-less node, plus the **declared gateways** of the plan, which are the other interfaces
of those same devices (curing only the first left the siblings accused). If ARP places an
observed MAC at one of them, it is that device's MAC and the finding is dropped; a multihomed
device needs only one of its live addresses to match. An address the document *does* have a MAC
for stays out: there a different MAC is a changed identity, and deserves a signal of its own.

### One question, one alphabet: how certainty is said

Looking at any row a person asks one question — *how much do I trust this?* — and until
2.11.3 the app answered it in **seven vocabularies**: `proof`, `linkstate`,
`temporal-confidence`, the Overview's `prov`, Discovery's `conf`, `status`, and the
presence classes. They were never synonyms, which is why the worst case was measurable: a
cable's Status row could mount **five** badges, three of them answering that one question
in three incompatible notations — a link-state word, a proof word, and a percentage that
contradicted both.

**`lib/certainty.js` unifies the ALPHABET, not the model.** The engines are not merged and
none of them changed: `provenance.js` is right that they keep legitimately different
half-lives — a declaration does not age, a measurement does, and at a rate that depends on
what was measured. What is shared is the sign a reader sees: six of them, ordered from the
most load-bearing to the least — `measured`, `declared`, `derived`, `contradicted`,
`undeclared`, `unread`. Four are not new: they are the provenance dots the Overview already
had and which never left that screen.

Three properties of that alphabet carry weight:

- **The two absences are separate signs, drawn identically.** `undeclared` is the absence of
  a *declaration*, `unread` the absence of a *reading*: symmetric to the two positive
  origins, and they ask different people to move — one asks you to write something, the
  other asks a probe to go and look. Collapsing them (as `prov:'none'` did) told the reader
  a value was missing without saying who had to act, and on the Overview's `verify` row the
  label *not declared* was plainly false, since no declaration was missing there. But the
  empty ring is the same for both: the word carries the meaning and the colour only confirms
  it — the rule `11-overview.css` had already written for itself.
- **A key that is not a certainty is DECLARED as such** (`NOT_A_CERTAINTY`), because silence
  would not distinguish "this is a different axis" from "somebody forgot to map it".
  `linkstate`'s `lag` says what a link *is* — the same axis as TRUNK/ACCESS — not how much
  it is trusted; Discovery's high/mid/low say how *strong* a guess is, and that score is an
  additive vote over heterogeneous signals that reaches «high» with no SNMP and no LLDP at
  all (NetBIOS 14 + SMB 20 + services 18 + hostname 12 + MAC 12 + ping 10 = 86), so grading
  it `measured` would pass a well-summed pile of clues off as a reading. The difference is
  qualitative, not quantitative — which `lib/linkstate.js` had already written about itself.
- **The grade carries no colour.** `.cty-<grade>` defines one ink and tint, border and dot
  are derived from it with `color-mix`, so a grade's colour exists in exactly one place.

`test/certainty.test.js` **derives** each engine's key set from that engine's own source
instead of listing it: the map necessarily enumerates, so the proof must not — a state added
to `proof.js` or `linkstate.js` and not mapped here turns the guard red rather than slipping
through as an unlabelled badge.

---

## 5. Recipe: add a new device type

1. `src/app-types.js` — add an entry to `TYPES` (`name`, `icon`, `isRack`/`isFloor`,
   `ports`, flags).
2. `src/app-properties.js` (or the relevant `src/app-properties-*.js`) — add the
   device-specific `<details>` block inside the props renderer (the per-type `if` chain).
3. `netmapper.html` — add the palette `<div class="equip-item" data-type="...">`.
4. i18n — add the label keys (`dev.<type>`, plus any `f.*` field keys) to both
   `it` and `en` in `lib/i18n.js`; tag palette/header with `t(...)`/`data-i18n`.
5. Run `npm run check` + `npm run lint` + `npm test`; verify in the browser.

---

## 6. Rendering & overlays

Report overlays (Drift, Free ports, L3 map) follow one pattern: a `*EnsureOverlay()`
creates the modal **once**, a render function fills it on each open. Because the
shell is created once, **the title is given an `id` and refreshed on every render**
so language changes apply when reopened.

A11y for this dynamic `.drift-overlay` family is provided by the same outside
observer that covers the static tool modals (`src/app-modal-a11y.js`): overlays
appended to `document.body` are auto-registered, get `role="dialog"` /
`aria-modal` / `aria-labelledby` stamped once, and receive the shared focus-trap,
focus-restore and Escape handling (Esc closes the topmost dialog via its real X —
never acting on what's behind it; the base alert/confirm cancels on Esc). New
overlays only need the conventions: `.drift-overlay > .drift-modal > .drift-head`
with an X button and a `*-title` id.

**Golden rule for i18n / dynamic text:** elements that JS rewrites via
`innerHTML` / `textContent` / `.title` **ignore `data-i18n`** — translate them with
`t()` at the JS source, or the translation gets overwritten. See the PDF manual (i18n chapter).

---

## 7. Testing

- **Pure-lib tests** (`test/*.test.js`, `node --test`): the safety net for all
  logic. Fast, zero-dep. **3,549 tests** at the time of writing. Includes the AI assistant's **anti-leak guard**
  (`test/ai-context.test.js`): asserts no SNMP community / credential / secret-named
  field can ever reach the AI context (data-security paletto, build-failing). Also
  covers the previously-untested **auth surface** end-to-end (`test/auth-api.test.js`
  mounts `auth.register` on a throwaway Express app — real login/logout, RBAC,
  self-guards, last-admin protection, session-invalidation, login rate-limiter; plus
  `test/auth-store.test.js` for the user store and the corrupt-file guard) and the
  **panel-skin sanitizer** against a battery of `on*`/`<script>` bypass payloads
  (`test/panel-skin.test.js`).
- **Golden-master render** (`test/golden-render.test.js`): snapshots the rendered
  `innerHTML` of every device's Properties panel + the 4 scopes + the generated
  rack render vs `test/golden/render-golden.json`, to catch unintended UI changes.
  **Active by default** as a gate (UI considered stable after the June 2026
  redesign): skip with `SKIP_GOLDEN=1`, refresh the baseline after a deliberate UI
  change with `UPDATE_GOLDEN=1 node --test test/golden-render.test.js`.
- **Invariant guards** — the tests that protect a *rule* rather than a behaviour.
  Each one is measured, monotonic (its ceiling may only fall) and, where it can
  be, **derived from the source rather than restating it**: a guard that lists
  what it checks goes green and blind the day the list grows.
  - **HTML escaping** (`tools/html-escape-scan.js` + `test/html-escaping.test.js`).
    The app builds its UI with template literals and `innerHTML`, so nothing
    escapes for us; the scanner tries to *prove* every `${…}` in an HTML template
    safe and ratchets the residue per file. Its own fixtures pin the behaviour in
    both directions, which matters because a scanner that breaks permissively
    stays green forever. Two blind spots were closed on 2026-08-31: it did not
    descend into **nested templates** (a value one level deep was invisible and
    uncounted) and it did not skip **comments** inside an expression (one
    apostrophe in an Italian `//` opened a string and swallowed the rest).
    Interpolations actually examined went 3810 → 4922 on the same sources.
  - **Type scale** (`test/type-scale-ratchet.test.js`): a hard zero on
    declarations that rewrite a token's own value by hand, plus a ratchet on the
    remaining off-scale sizes. The forbidden literals are read out of
    `styles/01-tokens.css`, never listed.
  - **Badge contrast** (`test/badge-ink.test.js`): every solid badge colour, read
    from the colour tables in the source, must reach WCAG AA with the ink
    `badgeInk()` picks for it.
  - **Bridge ratchets** (`test/bridge-ratchet.test.js`): `MAX_WIN_REFS` and
    `MAX_INLINE_HANDLERS`, see §10.
- **Smoke E2E** (`test/smoke-app.test.js` + `tools/smoke-dom-stub.js`): loads the
  whole app into `node:vm` with a stubbed DOM and exercises `renderAll`/`renderProps`
  to catch crashes (missing globals, wrong script order). It does **not** verify
  visual fidelity.
- **Headless E2E** (`test/e2e/critical-flows.test.js` + `test/e2e/helpers/server.js`):
  drives the app in a **real Chrome** (Playwright on the system browser via
  `channel:'chrome'` — no Chromium download) bypassing login with
  `INFRANET_DEV_NO_AUTH=1`. It spawns an isolated server (`INFRANET_PROJECTS_DIR`/
  `INFRANET_SKINS_DIR` → temp dir, so it never touches real data) and exercises the
  critical flows on the real DOM/JS: bundle load with zero JS errors, cable routing
  (`getCablePath` direction-true + TIA-568 pass-through verdicts), VLAN propagation
  AP→client over wireless, BSS re-association, and a real pointer click → selection →
  Properties panel. Removes the "not reproducible in browser" blind spot the DOM
  stub can't cover. **Off by default** (needs Chrome + a server spawn): run with
  `RUN_E2E=1 npm run e2e`. `npm test` reports it as skipped.
- `test/smoke-ui.test.js` still asserts UX markers in the rendered HTML inside the
  DOM stub. For *manual* visual inspection in dev, `INFRANET_DEV_NO_AUTH=1` (see
  auth.js) lets the preview tooling reach the UI without a login — off by default,
  localhost-only, never for production.

Commands: `npm run check` (syntax), `npm run lint` (ESLint gate), `npm test` (all
tests), `npm run typecheck` (tsc JSDoc), `RUN_E2E=1 npm run e2e` (headless browser
E2E), `npm start` (server on `http://localhost:8421`). CI runs all of them.

---

## 8. Security model (summary)

bcrypt-hashed passwords (cost 12), server-side sessions (httpOnly, sameSite=strict;
`secure` behind a TLS proxy via `INFRANET_TRUST_PROXY=1`), a rate-limited login,
admin/viewer roles, and **scan/poll routes gated to admin**. `execFile` is always
called with an argument array (no shell → no injection). The session secret and the
first-run admin password are generated with a **CSPRNG** (`crypto.randomBytes` /
`crypto.randomInt`), never `Math.random`. Every `projectId` reaching the filesystem
is coerced to a positive integer (no path traversal). The user store is written
**atomically** (temp + fsync + rename, with a `.bak`, via `atomicWriteFile`); a
present-but-corrupt `users.json` recovers from the `.bak` and, failing that, **halts
startup** instead of regenerating a default admin over existing accounts. The same
atomic write (owner-only `0o600` where a secret is involved) protects
`api-tokens.json`, `data/ai-config.json` and the shared skin SVGs. **Uploaded skin
SVGs are sanitized** (regex on the server, a real DOM parse on the client for both
preview and rack) so an event handler / `<script>` in a shared skin-pack cannot run
in another user's Properties panel. **Every value interpolated into HTML goes
through an escaper** — an invariant, not a habit, because the UI is built with
template literals and `innerHTML` and the input is not only the operator's
keyboard: `sysName`, `sysDescr`, DHCP lease hostnames, HTTP titles and LLDP
neighbour names arrive from the devices, i.e. from anyone on the network being
documented. It rests on more than a thousand hand-written escaper calls, so it is
held up by a static guard rather than by discipline (`tools/html-escape-scan.js`,
§7), which proves what it can and ratchets the rest per file. **Login runs a constant bcrypt compare** (dummy
hash for unknown usernames) to deny user-enumeration by timing, and a **global
Express error handler** returns JSON — never an HTML stack trace — for
malformed/oversized bodies or thrown route errors. The data
surfaces — AI context, REST DTOs, exports — are **allowlist-only**: secrets are
structurally excluded and a build-failing guard test enforces it. (The PDF
report's per-device asset register is built from the same `nodeToDevice` DTO
(minus structural cabling — wall ports and electrical panels are not IT assets —
via `isStructuralCabling`), so no SNMP community or credential can reach the
exported document; report chrome is
localized it/en server-side while device data is emitted verbatim.) Binds to
`127.0.0.1`. Every response carries **baseline security headers** — a `Content-Security-Policy`
(self-hosted assets: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
`frame-ancestors 'none'`; inline kept, since the UI needs it), `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`. `GET /api/projects/:id` **redacts SNMP secrets** (community + v3
passphrases) for a non-admin reader (viewers can't save → loss-free), and the
`INFRANET_DEV_NO_AUTH` bypass is **fail-closed** (honoured only on a loopback bind, non-production).
`users.json`,
`.session-secret`, `api-tokens.json`, `data/ai-config.json`, `projects/` are
git-ignored. A 2026-06 AppSec audit found **no critical issues**; a
2026-07 follow-up (again no critical) closed the remaining highs (panel-skin XSS, auth
test coverage, project-list robustness); a third **2026-07-21 six-domain audit** (zero
critical, avg 7.8/10) closed 8 highs (all ② no-invention) + 15 mediums, the SNMP layer
live-verified on real hardware. The whole surface — including the auth flow — is covered
by regression tests (`test/ai-context.test.js`,
`test/ai-route-security.test.js`, `test/auth-api.test.js`, `test/panel-skin.test.js`, `test/security-hardening.test.js`). Do **not** expose the instance to the public
internet — it is a network scanner with command execution; the right access model
is VPN/LAN.

---

## 9. Gotchas / conventions

- **Script order matters** (`netmapper.html`): a global used before it is defined
  breaks silently. `lib/i18n.js` loads first so `t()` is available everywhere.
- **Shadowing:** some functions use a local `const t` (e.g. `rep.totals`). The
  global i18n `t()` is shadowed there — rename the local (e.g. `tot`) before using
  `t()`.
- **An interface name is matched through `lib/netnames.js`, never compared raw.**
  `_ifNameMeta` normalises on three levels — exact, compact, vendor-neutral — so
  `Gi1/1` and `GigabitEthernet1/1` are one interface, and a numeric fallback catches
  the agents that announce a bare `1` for a port whose description is `EXOS-VM Port 1`.
  Two shapes are worth knowing: the generic noun trailing a name (*Port*, *Interface*)
  is decoration and is ignored **only** when testing the management family, so
  `Management Port` is `mgmt` while `Port 1` stays the physical port 1; and an
  interface whose name *begins* with `virtual` is not a port you can cable, which is
  how a wireless controller publishing `Virtual Interface` beside its real port —
  same ifType, same MAC — stopped being counted as a two-port device. Getting that
  count wrong is not cosmetic: a neighbour announced on a multi-port device has its
  far end deduced rather than known, and the link is downgraded to an inference.
- **Windows:** Git shows LF→CRLF warnings; harmless. The login page blocks the
  preview tooling unless you authenticate.
- **Don't add a new *runtime* dependency** without a strong reason (the build is
  esbuild-only, a dev dep).
- **Shared state lives behind `src/store.js`** (getter/setter proxy su `window`):
  i moduli ESM leggono/scrivono `store.state`, `store.selId`, `store._viewMode`, …
  (23+ simboli pure-data, ADR D18), mentre `window.X` resta vivo per i classic
  (`export.js`/inline). `TYPES` è ora `export const` in `app-types.js` (importato dai
  consumatori; resta su `window.TYPES` via `expose()` per i classic). Le funzioni del
  nucleo (`renderAll`, `renderProps`, `showAlert`, …) sono `export` e importate. Ciò
  che resta sul ponte (`win.*`, 264 letture — erano ~1800) sono funzioni non ancora ritirate
  (`selected`/`checked`/`_build*`).
- **Commit only when asked.** Keep secrets and user data out of the repo.
- **SNMP walk — adaptive retry kills FDB truncation under crawl load (2026-07-04).** The crawl's
  `pollNeighbors` walks the forwarding table (FDB) alongside LLDP/CDP and ARP — many single-column
  GETBULK walks on the same agent (limited to `WALK_CONCURRENCY`, default 4). A small-business switch
  under that pressure drops UDP; a GETBULK times out and net-snmp's `subtree` returns a **partial**
  FDB with no downstream error → macsuck placed some/all MACs on no port ("sometimes 0 badges"). Fix
  in `_runWalks` (`drivers/snmp.js`): a **timed-out** walk is retried on the same base with
  `max-repetitions` **halved** (25 → 12 → 6, floor `WALK_MIN_REPS`) + backoff — the netdisco bulkwalk-retry
  strategy. Idempotent (`oid→value`, a retry overwrites partials); healthy devices never retry; a
  deliberate loop/runaway abort is not retried. `SNMP_WALK_RETRIES` (default **1** — the first
  halved-reps retry recovers nearly all truncations; a second quartered pass cost real crawl time
  for a marginal gain; `0` truly disables). **Crawl scope (2026-07-07):** in `pollNeighbors` the retry
  is restricted to the **FDB group** (`FDB_RETRY_BASES` — dot1d/dot1q FDB + the bridge-port→ifIndex
  map), the only family whose truncation breaks macsuck; LLDP/CDP/ARP that time out fail immediately
  instead of paying repeated timeouts (they only cost fewer neighbours/hosts, not a badge bug). Other
  callers (`poll`/printer/host-resources/`walkSession`) pass no scope → every base still retries.
  Pure-ish + unit-tested with a mock session.
- **LLDP identifiers are read from their declared subtype, not their length (2026-08-20).**
  Every LLDP identifier travels with a subtype naming what it is. `drivers/snmp.js` used to
  infer that from the value's size — six bytes meant a MAC — which failed both ways on the
  bench: a MAC rendered as seventeen bytes of text by one agent was dropped whole, and a port
  named `Gi1/24` became an address belonging to nobody. The subtype columns
  (`lldpRemChassisIdSubtype`, `lldpRemPortIdSubtype`, `lldpLocPortIdSubtype`) are now part of
  the walk; `lldpMac()` accepts both encodings; a chassis id declared *local* yields no MAC
  rather than an invented one. **The encoding is the answering agent's choice, not the
  advertiser's** — the same chassis id arrives in two shapes depending on which device you ask —
  so the rule is driven by the subtype and never by vendor. Agents that publish no subtype keep
  the historical behaviour.
- **The local port of a neighbour is resolved, not assumed (2026-08-20).** `lldpLocPortNum` is
  the agent's own numbering space and need not be the ifIndex space (measured: Arista
  `Management1` = LLDP port 97 / ifIndex 999001; ExtremeXOS ports 1-3 / ifIndex 1001-1003, with
  no port description at all). The name comes from `lldpLocPortDesc` first — on Cisco the full
  `GigabitEthernet0/0`, the form that matches the interface table — then from the advertised
  identifier when its subtype names an interface, and only then from the old ifIndex guess.
- **A neighbour that produces no link is reported, not dropped (2026-08-20).** `buildNeighborCandidates`
  takes an optional collector and records why: `device-unknown` (identity read, absent from the
  document → scan it), `no-identity` (nothing lookup-able was announced → our gap), or
  `local-port-unresolved` (the protocol named a port that matches none). Counts surface in the
  AutoLink diagnostics line. Where **both** devices are known and only the port is missing, the
  pair becomes an **adjacency**: `buildTopoLines` draws it with `?` in place of the port name
  (`m.adjacencies`, fed from `store._topoAdjacencies` — a measurement, replaced by each Sync and
  kept out of the saved document). A real cable between the two still marks the pair confirmed:
  the precise supersedes the approximate, and that rule stays in the passes that already own it.
- **Vendor recognition — full IANA PEN + IEEE OUI registries (2026-07-04).** Two bundled,
  refreshable datasets back vendor resolution, so a new device is recognized without a code
  change (the fix to a recurring "vendor X is missing" class of reports):
  - **MAC → vendor**: `data/oui-db.json` (~57k IEEE prefixes, MA-L/M/S + IAB), refreshed by
    `npm run update-oui` (`scripts/update-oui-db.js`). Consumed by the priority-0 catch-all OUI
    plugin; per-vendor plugins (Cisco/Apple/…) override it to add `deviceType`.
  - **SNMP sysObjectID → vendor**: `data/pen-db.json` (~66k IANA Private Enterprise Numbers),
    refreshed by `npm run update-pen` (`scripts/update-pen-db.js`, which parses IANA's flat
    `enterprise-numbers` file). `_vendorByObjectId` maps the enterprise number (7th arc of
    `1.3.6.1.4.1.<PEN>`) against it. The curated `PEN_VENDOR` (~50 entries) wins for clean short
    names; the registry is the fallback (lazy-loaded, degrades to the curated table if the file
    is missing). **Lab caveat**: virtual images (vEOS/vIOS) carry a hypervisor MAC with no IEEE
    OUI, so their vendor comes from SNMP (PEN) — proven live: a lab Arista (`sysObjectID
    …30065.1.2759`) resolves to **Arista** where the MAC path can't see it.
- **Discovery engine — killing phantom ARP-observed rows (2026-07-04).** Live debugging
  of a real `/24` traced a swarm of low-confidence "observed" phantom IPs to TWO
  distinct ARP paths; both are now authoritative-source-aware:
  - **ARP-SNMP is off-segment only.** The crawl harvests each SNMP device's
    `ipNetToMediaTable` (`buildArpCandidates`, the `arpnip` step) to find hosts the
    collector can't ICMP directly. But on the home LAN it was surfacing **on-segment**
    dead IPs out of a neighbour's *stale* ARP cache — root cause: an on-segment Synology
    (`.120`, SNMP public) whose ARP table was full of sleeping/departed entries. Fix:
    `buildArpCandidates` takes `localSubnets` (the collector's own `/24`s from
    `_readLocalInterfaceMap`) and **skips any candidate in a local subnet** — for
    on-segment IPs the local sweep/ARP is authoritative, so a dead one isn't resurrected
    from a remote device's stale table. Off-segment (the feature's real purpose) is
    unaffected. Verified in-browser: full `/24` scan 7 phantoms → 0.
    ⭐ **And since 2026-08-23 the surviving candidates are asked who they are**
    (`probeArpCandidates`, `server/crawl-bfs.js`, probe/decorate injected like the BFS).
    They used to be described without being questioned — passively observed, low confidence,
    typed by the classifier's floor as a PC — while answering SNMP with the crawl's own
    community one UDP round-trip away; a sweep of the same subnet found every one of them
    managed. It happens whenever a device does not speak the collector's neighbour protocol:
    on the bench the Arista speaks only LLDP and the Cisco switches only CDP, and three pieces
    of infrastructure came out as PCs (crawl 8 devices, sweep 11). One that answers with the
    name of a device already found is a second address of it, not a new device; one that stays
    silent is left exactly as it was.
  - **Local ARP read is state-aware on Windows.** `_readArpMap` now uses `netsh
    interface ipv4 show neighbors` (has the neighbour state) instead of `arp -a`, keeping
    only rows whose physical-address column is a real MAC. "Unreachable"/"Incomplete"
    entries carry the localized *state* there (no MAC) → excluded by matching the MAC
    token, **not** the state string (robust across Windows locales; avoids the
    `task_977d2930` trap). `_parseNeighbors` is pure + tested (IT/EN/any-locale).
  - **Stale-duplicate demote — `_demoteStaleArpDup`, two passes.** *Pass 1:* an ARP-only
    row whose MAC is live/DHCP at **another** IP is a stale cache entry of the same device
    → *Inactive*. *Pass 2 (double-phantom, 2026-07-04):* the **same** MAC on two-or-more
    ARP-only rows with **no** strong anchor anywhere (no ping/SNMP/DHCP) is one device
    caught mid DHCP-renewal in a stale cache (common with randomized/BYOD + mobile MACs) —
    keep one representative (highest IP, deterministic via `_ipToNum`), demote the rest to
    *Inactive*. Manual-first: demoted rows stay visible + re-selectable. Prompted by an
    Advanced IP Scanner side-by-side that showed the same MAC at two IPs (a phone at `.180`
    **and** `.240`; a randomized MAC at `.122` **and** `.234`). Pure + unit-tested.
  - **Web fingerprint — fast base, patient deep-scan (2026-07-04).** The HTTP/HTTPS title
    probe (feeds vendor + type from a banner like `GS1200-8` / `Keil-EWEB` / `lighttpd`)
    stays **aggressive (450/650 ms) in the base scan** so a `/24` stays fast. Embedded web
    UIs on UPSs / NAS / cheap switches answer slower and were missed; when **deep-scan** is
    on, discovery re-probes them **patiently (900/1200 ms), in parallel** with the
    NetBIOS/SMB/TCP identity scan, but only the rows still missing a title. The everyday
    fast path is unchanged. `server/routes/discovery.js`.
  - **Crawl heartbeat (UX).** The LLDP/CDP expansion is long (SNMP poll per switch +
    macsuck at the end); the Scansiona button shows "Espansione…" + spinner and the
    progress line updates per probed device (+ located count) so it doesn't look frozen.
  - **Crawl orchestration — level-synchronised parallel BFS (2026-07-07).** The
    neighbour-expansion BFS was extracted from the SSE route into `server/crawl-bfs.js`
    (`crawlNetwork`, probe/pollNeighbors **injected** → unit-tested with zero network).
    It processes each BFS depth-level with a **bounded worker pool**, then a barrier
    updates order-dependent state (`seenName` dedup, `discoveredBy`, `results`) iterating
    the frontier **sorted by IP** → deterministic: `pool=1` and `pool=N` give identical
    output (unit test with skewed latencies + live lab: same device set at pool 1 vs 4).
    Only the *deep* phase parallelises (authenticated SNMP polling of discovered devices —
    not a scan signature); the base host sweep stays sequential/paced (**anti-IDS**).
    Pool = `CRAWL_POOL` (default **4**, clamp 1-32): low on purpose — socket footprint =
    pool (Raspberry-friendly) and the lab returns-knee is ~4-6 (floor = slowest device).
- **Discovery engine — DHCP-as-source + macsuck device location (2026-07-04).**
  Two "see it without a ping" additions, from live testing (Synology DHCP + a Zyxel GS1900):
  - **DHCP leases as a discovery source.** The sweep route (`/api/discover`) accepts
    `dhcpLeases` in the body (the frontend sends `store._dhcpLeases`). After the sweep it
    appends a candidate row for every leased IP **inside the scanned subnet** that wasn't
    already found — decorated by the same `_decorateDiscoveryRow` pipeline (OUI vendor,
    hostname), `alive:false` (observed, **not** pre-selected — manual-first). The scorer
    (`_buildDiscoveryMeta`) gains a `dhcp` evidence (weight 14, an authoritative IP-MAC
    binding across all VLANs) that **replaces** the generic `mac` evidence for a lease row
    (no double-count, honest source label). Works with **zero SNMP**. Frontend marks the row
    `_via:'dhcp'` (source badge + "observed" state).
  - **macsuck — `locateMacsOnEdge(fdbBySwitch, opts)` in `lib/correlate.js`.** The crawl
    (`/api/discover/topology`) already got each switch's FDB from `pollNeighbors` (`fdbTable`)
    and threw it away; it now collects it and, at end-of-crawl, locates every target MAC
    (crawl results + `targetMacs` the frontend passes from the sweep) on its access port,
    emitting a single `type:'located'` SSE event `{ edges:{ [macLower]: {switchIp, switchName,
    ifName, macCount, edge, shared, ambiguous} } }`. The frontend `_discApplyEdges` matches by
    lowercased MAC and renders `_discEdgeBadge`. Placement rule (netdisco-canonical): the
    **edge** = the port with the fewest co-learned MACs (`<= edgeMax`, default 4 → direct
    link); if none, the least-busy **non-LAG** port → **shared** ("behind *port*", an AP /
    unmanaged switch); a MAC seen only on a busy **LAG uplink** is left unplaced. Virtual NICs
    excluded. **Pure, vendor-neutral** (BRIDGE-MIB `dot1dTpFdb` / Q-BRIDGE `dot1qTpFdb`).
    ⚠️ **Needs a switch that exposes the FDB over SNMP** (real Cisco/Aruba/HPE/Zyxel/Arista):
    the lab's Cisco vIOS returns an empty bridge FDB (same limit family as `vmVlan`/`dot1qPvid`
    — proven by escalating probes incl. ping-then-read and `community@vlan`), so macsuck is
    unit-tested + validated on real hardware (Zyxel GS1900), not on vIOS. Manual-first: the
    location is a badge hint, not an auto-created cable (auto-cable-on-import is a deliberate
    follow-up).
- **Discovery engine — scan speed, confidence pre-select, de-dup, BYOD vendor (2026-07-04).**
  From live testing on a real `/24`:
  - **Single-ping sweep + ARP-authoritative liveness.** The spaced double-ping retry (below)
    doubled the time spent on every dead IP; on a full `/24` of empty addresses that pushed the
    scan past the client timeout (~3× slower on dead IPs, measured). The sweep now sends **one**
    ICMP probe by default (`pingRetries` still opt-in, 1–4). Reliability moves to **ARP**, the
    authoritative liveness on a LAN (as nmap does): after the sweep, an on-segment host with a
    **local ARP entry** is marked `alive` even if its ICMP reply was lost (`pingReachable` stays
    false → it weighs as ARP in scoring, not a fake ping), so ICMP-filtered hosts appear too.
    Cross-subnet is safe — the local ARP cache holds only the gateway for off-segment IPs, so no
    false positives. `server/routes/discovery.js`.
  - **Stealth (anti-IDS) pacing — opt-in (2026-07-07).** The base sweep pings *unknown* IPs, the
    one phase with a scan signature that can trip a rate-based IDS/IPS on the network being
    documented. `POST /api/discover` with `stealth: true` (or `scanDelay: <ms>`) **serialises** the
    sweep (concurrency 1) and spaces probes by a **jittered** delay (default 400 ms ±30% — a fixed
    interval is itself a detectable cadence) — nmap's polite/T2 profile. Enrichment/deep are also
    serialised. It covers **only** the base sweep; the deep/LLDP-CDP polling of already-known
    authenticated devices stays parallel (`CRAWL_POOL`) as it isn't a scan signature. Default is
    unchanged (fast/parallel). No hosts lost (same alive set on vs off, validated live). Pure
    `_stealthDelayMs` (jitter, injectable rand) in `server/netscan.js` + unit tests.
    **Refined 2026-07-09:** Stealth also **randomizes the target order** — a sequential
    `.1→.254` sweep is a scan signature just like a fixed interval — on *both* the ping sweep
    **and** the SNMP/enrichment phase (each an independent shuffle; the enrichment phase also
    inherits the jittered pacing). Pure `_shuffled` (Fisher-Yates, injectable rand) + unit tests;
    verified end-to-end against the real `/api/discover` route (ping+SNMP sequential on
    Normal/Safe vs shuffled on Stealth; concurrency 64/32/1 and 16/8/1).
  - **Windows PC names via NetBIOS (2026-07-09).** A Windows host speaks no SNMP and rarely
    advertises its name over mDNS, so it came out nameless. The base flow now resolves it with a
    single **NBSTAT** (NetBIOS node-status) query sent **directly over UDP 137** per *alive,
    still-nameless* host (~40 ms, cross-platform; the `nbtstat` CLI probes every local NIC and
    waits out the dead ones — 10–30 s+ on multi-NIC hosts — kept only as a Windows fallback) — on
    the **Normal and Safe** cadences (a single NBSTAT on a known-alive host is within Safe's light anti-IDS; gentler
    concurrency on Safe), **off on Stealth** (no NetBIOS footprint). The box running InfraNet
    appears in its own scan but `nbtstat` can't query its own IP, so the **local host is named from
    `os.hostname()`** in every cadence (no network probe). Windows-only (nbtstat); a NetBT-disabled
    host with SMB open still relies on the **SMB** identity signal. `server/routes/discovery.js`.
  - **Pre-selection gated on confidence (15%).** A ping-only phantom (the exit-code artifact
    below) scores ~10% (only the `reachability` evidence); anything real starts at ~20% (a bare
    ARP MAC is ≈22%, SNMP ≥57%) — the bands don't overlap, verified with the real scorer on the
    lab. Discovery now pre-checks a row only if `alive && confidence ≥ 15`; the phantoms stay
    visible (greyed `.disc-lowconf`, hand-selectable) but out of the default import
    (`DISC_PRESELECT_MIN_CONF`, `src/app-discovery.js`).
  - **De-dup across sweep and crawl.** The crawl/ARP-SNMP de-dup set (`knownIps`) now starts from
    every swept IP (`store._discResults`), not just the seeds, so a host already found by the sweep
    isn't proposed twice when it also appears in a switch's SNMP ARP table. MACs are normalized to
    one canonical **uppercase** form for all sources (`_discEnsureMeta`), so the same device can't
    slip a MAC-based de-dup (the sweep emitted uppercase, the ARP path lowercase).
  - **Vendor identity ≠ device type + one classifier.** The fusion scorer never keyword-matches the
    vendor *company name* for the generic type nouns `gateway|switch|router|firewall` (those are
    stripped before the vendor enters the type text) — so a "Gateway Inc." PC isn't a router; type
    comes from behaviour/structure (sysObjectID map, `sysServices` bits, `sysDescr` product tokens,
    TCP probes, SMB/NetBIOS role) and the vendor's real *brand* tokens still vote. NetBIOS is off by
    default on modern Windows (nbtstat is silent) → the live "it's a Windows host" signal is **SMB**:
    port 445 + enumerated shares (or RDP/WSD) and **no** print ports (9100/515/631) → `pc`, beating a
    printer-vendor NIC. The Discover UI now treats this server engine as the single source of truth
    (`serverAuthoritative` in `src/app-discovery.js`); the thin client `_guessType` only fills gaps.
    `engine/fusion-scorer.js` is the single authoritative classifier (`server/classify.js` wraps it);
    the in-line "legacy twin" was removed once the fusion path was proven, with the 55-device
    `tests/classify-golden.test.js` as the behaviour freeze.
  - **Signal tiering — a measured signal always beats a vendor-identity inference (2026-07-07).** A
    per-vendor MAC-OUI plugin proposes a device-type *candidate* (Zyxel→router, D-Link→router, …); that
    guess used to be scored high enough (≤80) to beat a real banner/model/port signal, so a Zyxel box
    whose web page reads *"Intelligent Switch"* was typed `router`. The OUI device-type is now weighted
    like the other identity hints (~45), so **any** measured signal outranks it — one rule for every OUI
    plugin, **no `plugins/oui/*` vendor file edited** (that would be the per-vendor hack the vendor-neutral
    rule forbids). Behavioural detection is by **protocol, not brand**: Google Cast (`_castProbe` →
    `/setup/eureka_info` + ports 8008/8009 in `DEEP_TCP_PORTS`) → `tv` for any make, like RTSP→camera; and
    the **OS** fingerprint decides `mobile` (Android/iOS) vs `pc` (`plugins/os-fingerprint.js` emits the
    type, not the brand). A device known *only* by a vendor/OS inference (a MAC with no measured signal)
    has its confidence capped — honest, manual-first. `engine/fusion-scorer.js`, `server/classify.js`,
    `plugins/os-fingerprint.js`, `server/netscan.js`, `server/routes/discovery.js`; validated by two live
    LAN scans (Zyxel switch, Shield/Chromecast→tv, Huawei tablet→mobile; every correct device unchanged).
  - **Merge-guards on the render path (audit F4/F5).** The guard that stops a next-hop/gateway MAC
    from collapsing remote hosts onto the gateway node ran only on import; it now also runs on the
    preview/table index (`_discAttachMergeGuards`), so a remote host no longer inherits the gateway's
    type and the New/Update badges match what import does. A blocked (next-hop) MAC is treated as
    absent throughout `_discFindExistingDevice`, so it can't raise a false IP-vs-MAC conflict.
    `src/app-discovery-classify.js`.
  - **BYOD vendor from the device's own name.** A randomized/private Wi-Fi MAC has no OUI, so the
    vendor was blank. The vendor resolution now falls back to a **hostname/mDNS brand** the device
    announces (`iPhone-…`→Apple, `Galaxy…`→Samsung, …; `_vendorFromHostname`, conservative list, no
    false positives), and where nothing is derivable the table shows an honest **"Private · random
    MAC"** label instead of an empty cell (`_discVendorLabel` + `isRandomizedMac`). The IEEE
    "Private" OUI value is left untouched. Vendor-neutral. `server/classify.js`, `src/app-discovery.js`.
  - **Table + hidden-panel UX/perf.** The Scopri table uses a fixed column layout (`.disc-scan-table`,
    `table-layout:fixed`) and the "SNMPv3 to configure" badge is shortened to "v3" next to the SNMP
    source. And `renderProps()` is skipped in `_renderAllNow` when the panel is hidden and nothing is
    selected (the floor branch scans every VLAN's IPAM), with the IPAM lookups memoized per render
    frame — a speed-up on large projects (audit F6). `src/app-render-core.js`, `src/app.js`,
    `src/app-properties-floor.js`.
- **Discovery engine — hardened by live multivendor PnetLab validation (2026-07).**
  - **Access VLAN — `vmVlan` fallback + a manual-first guard (addressed).** The access VLAN
    is now read from CISCO-VLAN-MEMBERSHIP-MIB (`vmVlan`, `9.9.68.1.2.2.1.2`, per ifIndex)
    when Q-BRIDGE `dot1qPvid` doesn't carry it — standard-first (used only where PVID is
    missing/1 and `vmVlan` > 1), vendor-neutral (empty subtree on non-Cisco → no effect).
    ⚠️ The standard read itself records **nothing** when the decoded value falls outside
    1..4094: `dot1qPvid` is a `VlanIndex`, so a zero there is a decoding error and not a port
    in VLAN 1, and it used to be written down as 1 — a failure wearing the shape of a
    measurement, which on a device that switches VLANs carries enough authority to outrank a
    hand-documented network. An unreadable PVID is now an absence, which is also why `vmVlan`
    fills it: because there is nothing there, not because it beat a 1.
    And an SNMP read of VLAN 1 (default/native, or simply not exposed on an image) never
    overwrites a hand-documented non-default VLAN (`_snmpVlanToUi` guard). `drivers/snmp.js`,
    `src/app-snmp.js`. *(Lab image `vios_l2` exposes **neither** `dot1qPvid`-real **nor**
    `vmVlan`, so on that lab the manual-first guard is what protects the documented VLAN; a
    real Cisco IOS/NX-OS reads it correctly via `vmVlan`. Trunk VLANs come through fine via
    CISCO-VTP-MIB `9.9.46`.)*
  - **The ping-sweep retries, now SPACED** (default 2, `pingRetries` 1–4; ~200 ms between
    attempts) so a host that drops the first ICMP (a VPCS, a slow stack, ARP-warmup behind a
    gateway) isn't missed. Live measurement showed the loss is **bursty/correlated**: two
    back-to-back pings fail *together* ~27% of the time on a rate-limited path, so an unspaced
    retry is nearly useless — a small gap drops the retry outside the loss window. Cost falls
    only on hosts that already missed the first try. Applies to the reachability audit too.
    `_pingHostRetry`, `server/netscan.js`.
  - **No false SNMPv3 on non-SNMP hosts (addressed).** The v3 credential-less detection used
    to treat *any* non-timeout error as "live v3 agent needing credentials"; an ICMP
    port-unreachable from an alive host with no SNMP (VPCS/PC/IoT) raises a
    `ResponseInvalidError`, so those hosts intermittently surfaced as SNMPv3 "to configure".
    It now requires a genuine USM **remote engineID** — the authoritative engineID present
    *and* different from net-snmp's own local engine — a signal only a real agent produces.
    Vendor- and library-version-neutral (no PEN/prefix hardcoded). Validated live: VPCS/PC/SRV
    → 0 false v3, Cisco/VyOS still detected. `_v3RemoteEngineDiscovered`, `drivers/snmp.js`.
  - **Off-segment, ping-only hosts surfaced via SNMP ARP (addressed).** On a path that
    rate-limits ICMP, a full `/24` sweep saturates it and even the gateway is intermittently
    lost (measured: a VPCS surfaced in 2 of 5 sweeps), and a device that speaks **neither SNMP
    nor LLDP/CDP** and is **off-segment** (no local ARP MAC) has ICMP as its only signal — so
    retry-spacing alone can't guarantee it appears. The **LLDP/CDP crawl** now also reads the
    **SNMP ARP table** (`ipNetToMediaTable`, already returned by `pollNeighbors` — previously
    discarded) of every crawled switch/router and proposes the hosts it sees at L2/L3: the
    off-segment host's IP+MAC (hence OUI vendor) is known **with no ICMP**. Gated on the
    existing *"Expand via LLDP/CDP"* toggle (no new switch); noise-bounded to the **scanned
    subnet** (`scanCidr` → the client passes it, the route filters ARP IPs to it); MAC unicast
    only, deduped, capped at 256 with a logged/emitted note (no silent truncation). Presented
    as **observed, low-confidence, NOT pre-selected** (`snmpReachable:false, alive:false`),
    with an "ARP (via <switch>)" badge; **refined by the already-imported DHCP leases**
    (`store._dhcpLeases`): a MAC/IP match attaches the real hostname and lifts confidence
    (seen in ARP *and* DHCP = a real host, not a stale ARP row). `buildArpCandidates`
    (`lib/correlate.js`), `server/routes/discovery.js`, `_discArpRow` (`src/app-discovery.js`).
    Validated live: the lab VPCS (`10.10.10.100`, missed 2–3/5 by the sweep) is proposed from
    SW-CORE's ARP without any ping.
  - **Still open — the ping sweep trusts the `ping` exit code** (`_pingHost`). On Windows,
    `ping` exits `0` even for a router's *"destination host unreachable"* reply, so empty IPs
    **behind an L3 gateway** can be counted as live (the gateway rate-limits the ICMP errors
    → a handful of scattered phantoms, not the whole subnet). A real echo-reply must be
    required (`ttl=` / `bytes from`) **and** unreachable replies excluded; the text fallback
    (`'1 received'`) is Linux-only, so on Windows the buggy exit-code path still wins.
- **Discovery engine — SNMP port mapping is now ifName-anchored (2026-07).** A live
  **multivendor** PnetLab run (Cisco vIOS ×3, MikroTik RouterOS, VyOS and Ubuntu/net-snmp
  + VPCS; two LACP bundles, four VLANs, L3-lite) confirmed recognition / HOST-RESOURCES /
  LAG-trunk-VLAN reads, and surfaced a merge bug: `applyPollResult` mapped SNMP interfaces
  to ports **positionally** (`${nodeId}-${idx+1}`), so on a **hand-documented** switch whose
  port order didn't match the device's ifIndex order, a trunk/Port-channel member's data was
  written onto a port where an endpoint was cabled → the endpoint got pulled into the LAG.
  Now interfaces are matched **by ifName** (stable re-syncs with `snmp-server ifindex persist`),
  a hand-cabled port without an ifName is **preserved** (never clobbered), and a genuine
  endpoint-vs-trunk conflict is **surfaced** (`portReconcileConflicts` → amber panel warning),
  not silenced. The LLDP-LAG naming was also fixed to pick the aggregator that actually
  connects the peer (by `lagId`/trunk VLANs). `src/app-snmp.js`, `src/app-autolink.js`,
  `src/app-properties-node.js`. Follow-ups from a live re-test: the reconcile warning now
  fires **only** on a genuine access-vs-trunk mismatch (not on hand-documented trunk members);
  the ghost-cable *"port down for N syncs"* check **ignores hand-cabled ports without an
  ifName** (their status is stale/mis-mappable, `src/app-drift.js`); and when a single manual
  cable to a confirmed LLDP/CDP neighbor sits on a port without an ifName, the **real interface
  name is backfilled** onto that documented port (in SNMP form) and freed from the positional
  one it had landed on, so future syncs match it by ifName (`src/app-autolink.js`). A related
  guard: an **FDB uplink-resolution cable** (`MAC-UPLINK`) — where a documented switch's MAC is
  learned on a *local* LAG port but the *remote* end (often an SNMP-blind switch) and its port
  are only guessed (`<node>-1`) — is **never promoted to a LAG member**. Even though the local
  port is a LAG member and both ends are switches (which would otherwise stamp `lagLogicalKey`),
  the link stays a single *"Inferred · to verify"* cable so `linkState()` doesn't mislabel it
  "LAG"; the guard runs at both the candidate-build and the dedup (`_refreshLagMeta`) passes, the
  latter also self-healing any link previously mislabelled (`src/app-autolink.js`). Manual-first
  and vendor-neutral throughout. The Scopri **crawl** also no longer blanks the vendor of an
  LLDP/CDP-discovered neighbor: the backend resolves it from `sysObjectID` (e.g. Cisco from
  PEN 9), but a stale `vendor:''` default in the merge was overwriting it *after* the spread,
  so crawled devices showed Vendor "—" while a directly-scanned device kept it. The merge now
  preserves the resolved vendor (`_discCrawlRow`, `src/app-discovery.js`). The discovery items
  still open are the ping-sweep **exit-code false-positive** and the **off-segment ping-only**
  miss under sweep load (both above).

---

## 10. Frontend evolution (ESM strangler **complete**, merged to `main`)

- **ESM migration (esbuild).** The glue (`app.js` + ~37 `lib/app-*.js`) was
  decomposed into explicit ES modules bundled by esbuild, one file at a time,
  behind a `window` bridge (`src/_bridge.js`) so the app stayed green at each step.
  Pure `lib/*.js` stay UMD-lite (imported as CJS by esbuild; Node tests unchanged).
  **Status: JS strangler complete,
  merged to `main` (`8b77e63`)** — all `lib/app-*.js` glue **and** the nucleus (`src/app.js`)
  are ESM in the bundle. The only remaining classic `<script>`s are the pure `lib/*.js` and
  `export.js` (by design).
- **`app.js` decomposition (2026-08-04).** The 2685-line nucleus was split into 5 cohesive
  ESM modules — `app-ipam.js` (IPAM occupancy), `app-cables.js` (cable labels/setters),
  `app-history.js` (undo/redo + dirty + audit), `app-index.js` (O(1) lookups + port/node
  getters), `app-props-tabs.js` (right-panel tabs + manual-value select). Each is a **verbatim
  move** (golden byte-identical). `app.js` keeps the bootstrap + the final
  `expose()` and **re-exports every moved symbol**, so the 41 consumer modules were untouched;
  both ratchets are unchanged. State init and the entry render/event wiring stay in `app.js`.
- **Retiring the `window` bridge — RESUMED (2026-08-01): finishing it, one panel at a time.**
  > **Decision (2026-08-01): the bridge-retirement effort is active again.** After being parked as a
  > spare-time task on 2026-07-14, Axis B is now being driven down deliberately — one properties-panel
  > surface per commit, each with full gates + a live check + a golden strip-compare (which proves the
  > only diff is the handler-attribute swap). The two ratchets stay monotonic regression guards (counts
  > may only *hold or shrink*); lowering them toward the structural floor is once again an active goal.
  > Axis A is already at its floor; Axis B is the active front.

  `src/_bridge.js` still lets not-yet-retired
  code reach globals (`win.*` read, `expose()` publish). Removing it has **two independent axes**,
  each tracked so it can only move forward:
  - **Axis A — `win.*` → real `import`.** A monotonic ratchet (`test/bridge-ratchet.test.js`,
    `MAX_WIN_REFS`, may only decrease) has driven `win.*` references down to the ceiling that
    constant holds — the number lives **only** there, because a copy of it here would go stale
    the first time the ratchet moves and nothing would notice. Every
    retirable function is imported, and mutable view-state (`state`, `selId`, `_history`, …) lives
    behind a proxy in `src/store.js`. The residue is the pure `lib/*.js` `<script>` globals and their
    `typeof` guards. ⚠️ It was long held that importing one of those would re-bundle the UMD and
    clobber the live `<script>` copy — which holds only for a lib that carries **state**. A stateless
    one can be imported by `src/` while its `<script>` tag stays for the classic scripts and the e2e
    page probes: both copies come from the same source and hold nothing, so in a built tree they
    cannot say different things. `lib/vlan-trunk.js` is the worked example (2026-08-23), and the
    reason to do it was not the count. Reaching an engine through a global obliges every caller to
    carry a fallback for «what if it is not there», and such a fallback answers instead of admitting
    ignorance: one of them stated that a cable which did not exist carried VLAN 1. An imported module
    is either present or the bundle does not start, so the case disappears together with the answer
    it was inventing.
  - **Axis B — inline handlers (`onclick`/`onchange`/`oninput`/…) → event delegation.** Inline handlers
    are *why* the bridge still exists (they resolve names in page lexical scope). **A monotonic ratchet
    (`MAX_INLINE_HANDLERS` in `test/bridge-ratchet.test.js`, may only decrease) now caps their count —
    currently 32 across `src/*.js` templates + `netmapper.html` static — so Axis B is measured and
    converges like Axis A; the target is the structural floor. Every property-panel and overlay
    surface in `src/*.js` is delegated, and so is `netmapper.html`'s static shell (buttons, tabs,
    dialogs — each action registered in its owning module). At 32 the remaining handlers are all
    non-migratable with the current harness. The residue is: the PDF/label export dialogs and the
    export-menu items (JSON/PDF/dossier/labels — they call `export.js`, a classic non-ESM `<script>`;
    delegating them would need a `win.*` read and breach the Axis-A floor, so they stay by design),
    plus the canvas interactions (wheel / drop / dragover / contextmenu / scroll / mouse-enter-leave +
    `app-render-core`'s pointer-down) that still await new harness event types.** `src/app-delegation.js`
    installs **one delegated listener per event type** on the document — `data-act` for `click`,
    `data-change` for `change` (selects, checkboxes, file inputs, committed numbers), `data-input` for
    live `input` (typing), `data-focus` for `focus` (attached as `focusin`, which bubbles — plain
    `focus` does not), `data-blur` for `blur` (attached as `focusout`, which bubbles — used to commit a
    field on focus loss), `data-dragstart` for `dragstart`, `data-toggle` for a `<details>` accordion's
    `toggle` (which does **not** bubble, so it is delegated in the **capture** phase), and `data-keydown`
    for `keydown` (the handler receives the event) — so an element
    carries `data-<type>="key"` (arguments read off the element via
    `el.value`/`el.checked`/`data-*`), and the module that **owns** the function registers
    `{ key: (el) => fn(el.value) }` at load: the handler is an **imported** function, off `window`. For a
    menu, the owner registers the toggle and each item is registered by the module that owns that item
    (importing the owner's `close` helper). Migrated so far: undo/redo, the rack/zoom/palette toolbar,
    the account + Report header menus, the project toolbar (`New/Rename/Duplicate/Delete/Save`), the AI
    assistant buttons, the non-click controls of the rack size (`change`), the palette search
    (`input`) and the CSV/DHCP import dialogs (file pickers, live-lease vendor selector, paste-area
    previews), the project + rack selectors plus the Discover/Topology "select all" and the
    deep-TCP-scan preference checkboxes (`change`), the map-image + JSON-import file pickers
    (`change`), and the global search box (`input` + `focus` + `keydown`). Of the static HTML the
    change/input/focus/keydown surfaces are done — only the export panel's remain (`export.js` classic)
    — but **~54 handlers are still inline** there (report/discovery/import/PDF-export click actions
    and status chips, plus the canvas interactions — wheel / drop / dragover / contextmenu / scroll /
    mouse-enter-leave — that still need new harness event types).
    The migration then moves into the **handlers inside dynamically-rendered templates** (rows/cards built by `innerHTML`
    at runtime) — these migrate identically, because a document-level delegated listener also catches
    events from elements created *after* load. Dynamic clusters done so far: the Discover table rows
    (`disc-row`/`disc-type`), the search-results dropdown (`search-pick`), the Drift panel's seven
    one-click actions (`drift-*`, with row keys/CIDRs in `data-key`/`data-cidr`), the three report
    overlays — Audit log, Spare ports and L3 (`audit-*`/`spare-*`/`l3-*`, VLAN id in `data-vid`), the
    Adopt modal (`adopt-close`/`adopt-apply`/`adopt-selall`; its entry points stay exposed),
    the Drift "Explain with AI" button (`drift-explain`) — which made `aiExplainDrift` the AI module's
    first ESM `export` (it was a bridge-only module until then) — and the whole **"Users & access" /
    "Change password" modal** (static tabs/close/create + dynamically-rendered user & token rows via
    `um-*`/`tk-*`/`chpwd-*`, ids in `data-id`), which retired twelve functions from the bridge and
    made `openUserManager`/`umSwitchTab` proper ESM exports imported by `app-ai.js` — fixing a latent
    bug where the admin "AI settings" entry never opened the modal because `openUserManager` was read
    as an (unexposed, undefined) `window` global — and three topology/management surfaces: the
    **management-protocols editor modal** (`mgmt-proto-*`; only the modal migrates — its static
    buttons plus the dynamically-rendered proto rows via `data-input`/`data-act` — while the gear that
    opens it stays inline because it lives in the golden properties panel), the **topology-crawl
    modal** (`topo-crawl-*`, the backdrop keeps its "don't close mid-crawl" wrapper behind the
    `ev.target === el` guard), and the **topology hover-tooltip** (`#topo-tip`, rendered by
    `_showTopoTip` in `app-popup.js`: `topo-create-link`/`topo-nav-rack` with the pair-key/rack-id in
    `data-*`). Then the **golden properties panels** themselves began migrating, one panel per commit:
    the shared **section accordions** (every `<details>` → `data-toggle="props-section"`, delegated in
    the capture phase — the harness gained the `toggle` type for this); the **cable panel**
    (`app-properties-link.js` — its twelve `setLinkProp` fields collapse to one `link-prop` action, the
    field in `data-lprop` and the trim/number coercion in `data-coerce`, and the harness gained `blur`
    via `focusout` for the trunk-VLAN commit); the **floor / project-context panel**
    (`app-properties-floor.js` — `updateVlanIpam`'s three fields collapse to `vlan-ipam-field`,
    `updateUiColor` to `ui-color`, the two `scaleBgImage` steps to `bg-scale-step`); and the **port
    panel + port popup** (`app-properties-port.js` + `app-popup.js` — the port-domain functions export
    from `app-ports.js`/`app-vlan-autopoll.js`, and the actions **shared across both surfaces**
    (`port-field` with the `vlanOvr` numeric coercion, `port-speed`, …) register **once** in the leaf
    module both import, so they are never double-registered, while the actions carrying a surface-specific
    tail — `renderProps()` in the panel, `closePop()` in the popup — stay local). The three header buttons
    (expand-all / collapse-all / reset-sections) are shared actions registered once in `app-properties.js`
    and reused by every panel. Every properties panel + overlay in `src/*.js` is now delegated, and so
    is `netmapper.html`'s static shell (buttons, tabs, dialogs); the residue is the `export.js`-backed
    export dialogs (classic `<script>`, inline by design) and the canvas interactions awaiting new
    harness event types. `_bridge.js` / `expose()` are deleted only when Axis B is finished. *(Side note: the AI help
    catalog in `lib/ui-catalog.js`, which reads the real button labels/tooltips, derives a button's action
    from `data-act` as well as `onclick`, so delegated buttons stay in the assistant's catalog.)*

    **Coercion — `data-ncoerce`.** A `change` handler receives a string, and the attribute says
    what to make of it: absent = string, `num`, `bool`, `int`/`int-empty` (clamped by
    `data-nmin`/`data-nmax`), `intdef`/`floatdef` (falling back to `data-ndef`), and the three
    **optional** ones — `intopt`, `floatopt`, `stropt`. Those three are how
    [paletto #2](docs/adr/no-invention.md) reaches the *input* surface: an empty or unparseable
    field yields `undefined` and `updateN` **deletes** the key rather than writing the default
    back, so "not declared" is expressible and the suggested value can sit in the `placeholder`
    without asserting anything. An editable field that arrives pre-filled is a statement, and the
    handover dossier — which omits whatever `spec` does not carry — would contradict it. What
    keeps a default is what is not a claim about the customer's equipment: drawing geometry,
    structural counts that generate real objects, and the parameters the tool itself connects
    with. `test/campi-non-inventati.test.js` scans the panel sources and refuses the next one.
- **ESLint gate (`eslint.config.js`, v9).** `no-undef` is enforced as a safety net where
  the module system is explicit (Node/CommonJS + UMD `lib/`) and is **off on `src/`** until
  the `window` bridge is retired (then it re-enables). Cosmetic rules are warnings, so the
  gate is green; it runs in CI via `npm run lint`.
- **Modular CSS + tokens.** The old `style.css` monolith was split into 11 ordered
  partials in `styles/` and no longer exists (loaded via `<link>` in cascade order, served
  by `/styles/:file`; the split itself is documented in `styles/README.md`). Design tokens (colors/surfaces/shadows; **radius**, **font
  families** and now the **type scale** applied; **spacing/z-index/transition**
  documented) live in `styles/01-tokens.css`. See **`styles/README.md`**.
  Two families only — `--font-ui` and `--font-mono` — and no new `font-family`
  outside them. An **address is interface text, not code**: IP, CIDR, MAC and
  gateway use `--font-ui` with `tabular-nums`, declared once in `02-base.css`
  with the class list; monospace is reserved for `<code>`/`<kbd>`, logs, API
  tokens, raw `sysDescr`, config textareas and the rack silkscreen.
- **Headless E2E.** `test/e2e/` drives the app in a real Chrome (Playwright on the
  system browser via `INFRANET_DEV_NO_AUTH`, isolated temp store) — see §7.
- **Floor/rack navigation parity.** Both canvases pan via a `transform: translate`
  (floor: `floorView`, rack: `rackView.x/y` on `#rack-chassis-wrap`) + wheel-zoom;
  the rack's zoom percentage is also its **fit-to-width** button (`rack-fit` →
  `rackFitZoom`/`fitRack`), and turns amber while the chassis is wider than its
  viewport — the sides, and with them a device's state ring, fall outside
  `overflow:hidden` and there was no one-gesture way back. ⚠️ The break-even is
  measured with `offsetWidth`: `#rack-chassis-wrap` has a `transition` on its
  transform, so mid-animation `getBoundingClientRect()` reports a value between two
  zooms — and one already multiplied by the scale. ⚠️ Rack devices are all
  `position:relative` with no `z-index`, so paint order is DOM order: a device
  carrying a **state ring** (absent / declared-off / status-conflict) is lifted above
  its neighbours, or the one below repaints over the ring's bottom edge and the alert
  degrades into a single line;
  the rack has **no scrollbars** (`overflow:hidden`). Drag on empty area pans, drag
  on a device moves it, Space+drag pans anywhere. Rack px→U conversion reads the
  `--ru-h` token (`rackUPx()`), never a hardcoded unit height.

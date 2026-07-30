'use strict';
// ============================================================
//  CORPUS DI CLASSIFICAZIONE — la rete di sicurezza che mancava
// ============================================================
//  Il tipo di un apparato lo decidono DUE motori: il FusionScorer lato
//  server (`_classifyDiscoveredDevice`) e `_guessType` lato client. Finora
//  nessuno dei due aveva uno snapshot: si poteva cambiare una regex e
//  scoprire mesi dopo che una stampante era diventata un server.
//
//  Questo file e' l'INGRESSO; l'uscita attesa vive in
//  test/golden/classify-golden.json (server) e nel blocco e2e omonimo
//  (client, che gira nel browser). Il flusso e' quello del golden di
//  rendering: si guarda il diff PRIMA di rigenerare.
//
//  Righe REALI: prese dai sysDescr del progetto «Rete+Lab» e ANONIMIZZATE
//  (niente hostname, IP o MAC veri — il repo e' pubblico). Sono stringhe di
//  prodotto: quelle contano per la classificazione, non l'identita' di chi
//  le possiede.
//
//  `expect` NON e' un'asserzione (tranne che per le righe `reg-*`): e' il tipo
//  che quella riga DOVREBBE avere secondo i tre paletti. Dove oggi il motore
//  risponde altro, il golden registra la risposta di oggi e il commento dice
//  perche' e' sbagliata.
//
//  ⚠️ `expect: ''` significa «da questi segnali il tipo NON e' deducibile», ed e'
//  volutamente IRRAGGIUNGIBILE: l'architettura restituisce sempre un tipo. Oggi
//  la risposta onesta e' il ripiego — `customrack` («apparato gestito, funzione
//  ignota») quando c'e' un segnale di gestione, `pc` quando non c'e' nulla. Un
//  vero tipo «ignoto» sarebbe un concetto nuovo nel catalogo e nella legenda:
//  lacuna DICHIARATA, non un test che aspetta di passare.
// ============================================================

/** @type {{id:string, note:string, expect:string, row:Object}[]} */
const CORPUS = [

  // ── Righe reali (anonimizzate) ────────────────────────────────────────
  { id: 'real-vios-l2', expect: 'switch', note: 'switch virtuale del banco: sysServices dichiara L2',
    row: { descr: 'Cisco IOS Software, vios_l2 Software (vios_l2-ADVENTERPRISEK9-M), Experimental Version 15.2(20200924:215240) [sweickge-sep24-2020-l2iol-release 135]', sysServices: 2, snmpReachable: true, alive: true } },
  { id: 'real-hp-jetdirect', expect: 'printer', note: 'scheda di rete stampante HP',
    row: { descr: 'HP ETHERNET MULTI-ENVIRONMENT', snmpReachable: true, alive: true } },
  { id: 'real-gs1900', expect: 'switch', note: 'switch web-managed, solo il modello nel sysDescr',
    row: { descr: 'GS1900-24', sysServices: 2, snmpReachable: true, alive: true } },
  { id: 'real-nas-linux', expect: 'nas', note: 'NAS che si presenta come Linux. `diskstation` (la LINEA DI PRODOTTO Synology, quella che il device scrive da solo) non e in NAS_RE: oggi esce server. Il gemello qui sotto, che nomina il vendor, viene riconosciuto — il riconoscimento dipende da quale delle due stringhe capita nel sysDescr',
    row: { descr: 'Linux DiskStation 4.4.302+ #72806 SMP Mon Jul 21 23:16:00 CST 2025 x86_64', snmpReachable: true, alive: true } },
  { id: 'real-nas-linux-vendor', expect: 'nas', note: 'REGRESSIONE: lo stesso NAS quando il sysDescr nomina il vendor',
    row: { descr: 'Linux Synology 4.4.302+ #72806 SMP Mon Jul 21 23:16:00 CST 2025 x86_64', snmpReachable: true, alive: true } },
  { id: 'real-esxi', expect: 'hypervisor', note: 'ESXi: funzione dichiarata',
    row: { descr: 'VMware ESXi 7.0.3 build-21424296 VMware, Inc. x86_64', snmpReachable: true, alive: true } },
  { id: 'real-windows-host', expect: 'pc', note: 'agente SNMP di Windows desktop',
    row: { descr: 'Hardware: Intel64 Family 6 Model 158 Stepping 9 AT/AT COMPATIBLE - Software: Windows Version 6.3 (Build 19045 Multiprocessor Free)', snmpReachable: true, alive: true } },
  { id: 'real-routeros-chr', expect: 'router', note: 'RouterOS: funzione nel nome del prodotto',
    row: { descr: 'RouterOS CHR', sysServices: 4, snmpReachable: true, alive: true } },
  { id: 'real-vyos', expect: 'router', note: 'VyOS',
    row: { descr: 'VyOS 1.5-rolling-202406170021', sysServices: 4, snmpReachable: true, alive: true } },
  { id: 'real-linux-kvm-host', expect: 'server', note: 'host Linux con KVM: NON un KVM switch (il guard esiste per questo)',
    row: { descr: 'Linux 5.4.0-29-generic #33-Ubuntu SMP Wed Apr 29 14:32:27 UTC 2020 x86_64', snmpReachable: true, alive: true } },
  { id: 'real-wlc', expect: 'wlanctrl', note: 'controller wireless: ruolo distinto dall AP',
    row: { descr: 'Cisco Controller', snmpReachable: true, alive: true } },
  { id: 'real-junos-firewall', expect: 'firewall', note: 'si dichiara firewall: la funzione vince sull OS',
    row: { descr: 'Junos Firewall', snmpReachable: true, alive: true } },

  // ── V7 · marchi multi-prodotto dentro le regole di tipo ───────────────
  { id: 'v7-apc-pdu-explicit', expect: 'pdu', note: 'PDU APC che si dichiara PDU: la funzione deve battere il marchio',
    row: { descr: 'APC Rack PDU 2G, Metered, ZeroU, 20A', snmpReachable: true, alive: true } },
  { id: 'v7-apc-pdu-model-only', expect: '', note: 'V7 — solo modello + marca: oggi esce UPS perche \\bapc\\b sta in UPS_RE. APC fa anche PDU/ATS/rack: senza altro segnale il tipo NON e deducibile',
    row: { descr: 'APC AP7921', alive: true } },
  { id: 'v7-apc-ups-real', expect: 'ups', note: 'REGRESSIONE: un UPS APC vero deve restare UPS (linea di prodotto, non marca)',
    row: { descr: 'APC Smart-UPS 1500 RM', snmpReachable: true, alive: true } },
  { id: 'v7-apc-ats', expect: 'ats', note: 'REGRESSIONE: transfer switch APC → ats, non ups ne switch di rete',
    row: { descr: 'APC Automatic Transfer Switch AP7724', snmpReachable: true, alive: true } },
  { id: 'v7-raritan-kvm', expect: 'kvm', note: 'V7 — Raritan Dominion KX e un KVM over IP, ma `raritan` sta in PDU_RE',
    row: { descr: 'Raritan Dominion KX III', snmpReachable: true, alive: true } },
  { id: 'v7-raritan-pdu-real', expect: 'pdu', note: 'REGRESSIONE: il PDU Raritan vero resta PDU (linea PX)',
    row: { descr: 'Raritan PX3-5190R', snmpReachable: true, alive: true } },
  { id: 'v7-juniper-srx', expect: 'firewall', note: 'REGRESSIONE: SRX = firewall, con o senza il nome del vendor davanti',
    row: { descr: 'Juniper Networks SRX300 Services Gateway', snmpReachable: true, alive: true } },
  { id: 'v7-srx-bare-model', expect: 'firewall', note: 'stesso apparato senza il nome del vendor: la regola deve valere sul MODELLO',
    row: { descr: 'SRX345, JUNOS Software Release [21.4R3]', snmpReachable: true, alive: true } },
  { id: 'v7-vsrx-junos-boilerplate', expect: 'firewall', note: 'REGRESSIONE (trovata dalla review del 2026-07-30): il sysDescr Junos standard di un vSRX dice «internet router», e in "vsrx" NON c\'e\' confine di parola prima di `srx` — la regola per modello non lo prendeva e la parola `router` (80) vinceva',
    row: { descr: 'Juniper Networks, Inc. vsrx internet router, kernel JUNOS 22.4R3', snmpReachable: true, alive: true } },
  { id: 'v7-vsrx-services-gateway', expect: 'firewall', note: 'stesso apparato, altra forma di sysDescr',
    row: { descr: 'Juniper Networks vSRX Services Gateway', snmpReachable: true, alive: true } },
  { id: 'v7-juniper-mx', expect: 'router', note: 'REGRESSIONE: MX = router',
    row: { descr: 'Juniper Networks MX204 Universal Routing Platform', snmpReachable: true, alive: true } },
  { id: 'v7-mx-bare-model', expect: 'router', note: 'MX senza vendor davanti',
    row: { descr: 'MX204, JUNOS Base OS boot [20.4R3]', snmpReachable: true, alive: true } },

  // ── V7 · la parola batte la misura (il pezzo piu grave) ───────────────
  { id: 'v7-ios-xe-measured-l2', expect: 'switch', note: 'V7 — sysServices MISURA L2 (45) ma la parola `ios` (55) vota router e vince: una parola batte una misura',
    row: { descr: 'Cisco IOS XE Software, Version 17.06.05', sysServices: 2, snmpReachable: true, alive: true } },
  { id: 'v7-ios-measured-l3', expect: 'router', note: 'REGRESSIONE: L3 puro misurato → router (qui parola e misura concordano)',
    row: { descr: 'Cisco IOS Software, ISR4331, Version 16.9.4', sysServices: 4, snmpReachable: true, alive: true } },
  { id: 'v7-ios-no-measure', expect: 'router', note: 'senza misura la parola puo ancora classificare, ma a confidenza bassa',
    row: { descr: 'Cisco IOS Software, Version 15.2', alive: true } },
  { id: 'v7-catalyst-l2', expect: 'switch', note: 'REGRESSIONE: Catalyst con L2 misurato',
    row: { descr: 'Cisco IOS Software, Catalyst L3 Switch Software (CAT9K)', sysServices: 2, snmpReachable: true, alive: true } },

  // ── V4 · piattaforme di emulazione (classe, non inventario del banco) ─
  { id: 'v4-pnetlab', expect: 'server', note: 'PNETLab: piattaforma di emulazione',
    row: { descr: 'PNETLab 5.3.9', snmpReachable: true, alive: true } },
  { id: 'v4-eve-ng', expect: 'server', note: 'EVE-NG: stessa classe',
    row: { descr: 'EVE-NG Professional 5.0', snmpReachable: true, alive: true } },
  { id: 'v4-gns3', expect: 'server', note: 'V4 — GNS3 e la stessa classe di PNETLab ma non e nella lista: la lista era il banco, non la classe',
    row: { descr: 'GNS3 VM 2.2.43', snmpReachable: true, alive: true } },
  { id: 'v4-containerlab', expect: 'server', note: 'V4 — containerlab, stessa classe, stessa assenza',
    row: { descr: 'containerlab v0.54.2', snmpReachable: true, alive: true } },
  { id: 'v4-cml', expect: 'server', note: 'V4 — Cisco Modeling Labs, stessa classe, stessa assenza',
    row: { descr: 'Cisco Modeling Labs 2.6', snmpReachable: true, alive: true } },

  // ── V5 · divergenze note fra i due classificatori (solo marca) ────────
  //  Righe volutamente POVERE: una marca e nient altro. Il paletto ② dice
  //  che senza un segnale di funzione il tipo non e deducibile; il client
  //  invece decide lo stesso, e decide DIVERSAMENTE dal server.
  { id: 'v5-vendor-cisco-bare', expect: '', note: 'V5 — client: `cisco` nudo → switch. Cisco fa switch, router, AP, firewall, telefoni',
    row: { vendor: 'Cisco Systems', alive: true } },
  { id: 'v5-vendor-sony-bare', expect: '', note: 'V5 — client: `sony` → tv. Sony fa anche telecamere e proiettori',
    row: { vendor: 'Sony Corporation', alive: true } },
  { id: 'v5-vendor-apc-bare', expect: '', note: 'V5 — client: `apc` → ups',
    row: { vendor: 'American Power Conversion', alive: true } },
  { id: 'v5-vendor-daikin-bare', expect: '', note: 'V5 — client: `daikin` → iot',
    row: { vendor: 'Daikin Industries', alive: true } },
  { id: 'v5-vendor-huawei-bare', expect: '', note: 'V5 — client: `huawei` → pc. Huawei fa switch, router, AP, telefoni',
    row: { vendor: 'Huawei Technologies', alive: true } },
  { id: 'v5-vendor-intel-bare', expect: '', note: 'V5 — client: `intel` → pc. Un OUI Intel sta su qualunque NIC, server compresi',
    row: { vendor: 'Intel Corporate', alive: true } },

  // ── Regressioni da preservare (i casi gia a norma) ────────────────────
  { id: 'reg-synology-oid', expect: 'nas', note: 'sysObjectID Synology',
    row: { objectId: '1.3.6.1.4.1.6574.1', snmpReachable: true } },
  { id: 'reg-fortinet-oid', expect: 'firewall', note: 'sysObjectID Fortinet',
    row: { objectId: '1.3.6.1.4.1.12356.101.1', snmpReachable: true } },
  { id: 'reg-hp-laserjet', expect: 'printer', note: 'linea di prodotto stampante',
    row: { descr: 'HP LaserJet Pro MFP M428fdw' } },
  { id: 'reg-catalyst-2960', expect: 'switch', note: 'modello switch nel sysDescr',
    row: { descr: 'Cisco IOS Software, Catalyst 2960' } },
  { id: 'reg-fortigate-text', expect: 'firewall', note: 'funzione dichiarata nel testo',
    row: { descr: 'FortiGate-60F firewall' } },
  { id: 'reg-desktop-hostname', expect: 'pc', note: 'convenzione hostname Windows, nessun segnale di gestione',
    row: { hostname: 'DESKTOP-ABC123' } },
  { id: 'reg-reolink-vendor', expect: 'webcam', note: 'vendor mono-prodotto: resta una regola legittima',
    row: { vendor: 'Reolink', hostname: 'cam-ingresso', alive: true } },
  { id: 'reg-lg-webos-tv', expect: 'tv', note: 'stringa di PRODOTTO webOS, non il marchio LG',
    row: { descr: 'LG webOS TV', vendor: 'LG Electronics' } },
  { id: 'reg-lg-washer', expect: 'iot', note: 'stesso marchio, natura diversa: elettrodomestico',
    row: { descr: 'LG ThinQ Washing Machine', vendor: 'LG Electronics' } },
  { id: 'reg-arista-veos', expect: 'switch', note: 'PEN Arista + L2 misurato',
    row: { descr: 'Arista Networks EOS version 4.28.3M running on an Arista Networks vEOS', objectId: '1.3.6.1.4.1.30065.1.3011', snmpReachable: true, sysServices: 2, alive: true } },
  { id: 'reg-aruba-cx', expect: 'switch', note: 'linea di prodotto switch',
    row: { descr: 'Aruba JL658A CX 6300M 24SFP+ 4SFP56 Switch', sysServices: 2, snmpReachable: true } },
  { id: 'reg-unifi-ap', expect: 'ap', note: 'access point',
    row: { descr: 'UniFi AP-AC-Pro 6.5.28', alive: true } },
  { id: 'reg-grandstream-pbx', expect: 'pbx', note: 'centralino, non telefono',
    row: { descr: 'Grandstream UCM6304 IP PBX', snmpReachable: true } },
  { id: 'reg-yealink-phone', expect: 'voip', note: 'telefono SIP',
    row: { descr: 'Yealink SIP-T46S IP Phone', alive: true } },
  { id: 'reg-eaton-ups', expect: 'ups', note: 'UPS di un vendor diverso da APC: la classe non deve dipendere dal marchio',
    row: { descr: 'Eaton 9PX 3000 UPS', snmpReachable: true } },
  { id: 'reg-kvm-hostname-hypervisor', expect: 'hypervisor', note: 'hostname `kvm-host` = QEMU/KVM, NON un KVM switch',
    row: { descr: 'Proxmox VE 8.2', hostname: 'kvm-host-01', snmpReachable: true } },
];

module.exports = { CORPUS };

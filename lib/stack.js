// Stack/StackWise helpers — primitive pure per lo stacking di switch.
// Condivise browser + test/server (UMD-lite, stesso pattern di lib/correlate.js).
//
// Modello: ogni node membro di uno stack ha questi 3 campi opzionali su
// `node.spec` (annidato per coerenza col refactor P0.1):
//   - stackId        : string identificativo dello stack (es. 'stk-core')
//   - stackMemberId  : intero 1..N. 1 = master per convenzione
//   - stackRole      : 'master' | 'member' (derivato; esplicito solo se override)
//
// Nodi con `stackId` assente sono standalone. Due nodi con lo stesso `stackId`
// sono nello stesso stack logico. Il master e' quello con `stackMemberId=1`
// (oppure con `stackRole='master'` esplicito, vince se in conflitto).
//
// La lib resta pura: NON tocca DOM, NON conosce TYPES; accetta semplicemente
// un array di nodes (`state.nodes`) e legge i campi `spec.stack*`.
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        Object.assign(root, factory());
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Lettura sicura del campo stacking: gestisce sia `node.spec.stack*`
    // (nuovo, post-P0.1) sia `node.stack*` (legacy/promosso per facilita').
    function _stackId(node)       { return node?.spec?.stackId       ?? node?.stackId       ?? null; }
    function _stackMemberId(node) {
        const v = node?.spec?.stackMemberId ?? node?.stackMemberId;
        const n = parseInt(v, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    function _stackRole(node) {
        const r = node?.spec?.stackRole ?? node?.stackRole;
        return r === 'master' || r === 'member' ? r : null;
    }

    // True se il nodo e' parte di uno stack (ha uno stackId valido).
    function isInStack(node) {
        const id = _stackId(node);
        return typeof id === 'string' && id.length > 0;
    }

    // Tutti i membri di uno stack, ordinati per stackMemberId crescente.
    // Membri senza memberId valido vanno in coda con un ordinamento stabile per id.
    function getStackMembers(nodes, stackId) {
        if (!Array.isArray(nodes) || !stackId) return [];
        return nodes
            .filter(n => _stackId(n) === stackId)
            .sort((a, b) => {
                const ai = _stackMemberId(a);
                const bi = _stackMemberId(b);
                if (ai === bi) return String(a.id || '').localeCompare(String(b.id || ''));
                if (ai === null) return 1;
                if (bi === null) return -1;
                return ai - bi;
            });
    }

    // Il master dello stack: prima si cerca un nodo con role='master' esplicito,
    // poi il nodo con memberId=1, poi il primo membro ordinato come fallback.
    function getStackMaster(nodes, stackId) {
        const members = getStackMembers(nodes, stackId);
        if (!members.length) return null;
        const explicit = members.find(n => _stackRole(n) === 'master');
        if (explicit) return explicit;
        const byId = members.find(n => _stackMemberId(n) === 1);
        if (byId) return byId;
        return members[0];
    }

    // Prossimo memberId libero dentro lo stack. Restituisce il piu' piccolo
    // intero >= 1 non ancora usato. Utile per "Aggiungi al membro" quando
    // l'utente non specifica una posizione.
    function getNextMemberId(nodes, stackId) {
        const members = getStackMembers(nodes, stackId);
        const taken = new Set(members.map(_stackMemberId).filter(v => v !== null));
        let i = 1;
        while (taken.has(i)) i++;
        return i;
    }

    // Tutti gli stackId distinti presenti nello state, ordinati alfabeticamente.
    function getAllStackIds(nodes) {
        if (!Array.isArray(nodes)) return [];
        const set = new Set();
        for (const n of nodes) {
            const id = _stackId(n);
            if (typeof id === 'string' && id.length > 0) set.add(id);
        }
        return Array.from(set).sort();
    }

    // True se `memberId` e' libero per `stackId` (non usato da nessun altro nodo,
    // escluso `excludeNodeId` se passato — utile per validare un cambio di
    // memberId sullo stesso nodo).
    function isMemberIdAvailable(nodes, stackId, memberId, excludeNodeId) {
        if (!stackId || !Number.isFinite(memberId) || memberId < 1) return false;
        return !getStackMembers(nodes, stackId).some(n =>
            n.id !== excludeNodeId && _stackMemberId(n) === memberId
        );
    }

    // Ruolo effettivo del nodo dentro il suo stack (derivato).
    // Restituisce: 'master' | 'member' | null se non in stack.
    function getEffectiveRole(nodes, node) {
        if (!isInStack(node)) return null;
        const stackId = _stackId(node);
        const master = getStackMaster(nodes, stackId);
        return master && master.id === node.id ? 'master' : 'member';
    }

    // Etichetta breve per badge UI: 'Sm' = master, 'S2'/'S3'/... = member#.
    // Restituisce null se il nodo non e' in stack.
    function getBadgeLabel(nodes, node) {
        if (!isInStack(node)) return null;
        const role = getEffectiveRole(nodes, node);
        if (role === 'master') return 'Sm';
        const mid = _stackMemberId(node);
        return mid ? `S${mid}` : 'S?';
    }

    // Riepilogo testuale per la preview della fisarmonica (summary chiuso).
    //   Standalone       -> null (chiamante decide se mostrare nulla o "Standalone")
    //   Master di N membri -> "Master · N membri"
    //   Membro #K          -> "Membro #K"
    function getStackSummary(nodes, node) {
        if (!isInStack(node)) return null;
        const stackId = _stackId(node);
        const members = getStackMembers(nodes, stackId);
        const role = getEffectiveRole(nodes, node);
        if (role === 'master') return `Master · ${members.length} membri`;
        const mid = _stackMemberId(node);
        return mid ? `Membro #${mid}` : 'Membro';
    }

    // Nome porta qualificato secondo convenzione Cisco IOS-XE / Aruba CX /
    // Juniper VC: `<member>/0/<port>` quando il device e' in uno stack,
    // altrimenti il numero porta semplice.
    //   Standalone, port 24      -> "24"
    //   Member 1, port 24        -> "1/0/24"
    //   Member 2, port 1         -> "2/0/1"
    // Il middle "0" e' lo slot sub-modulo (fixed per i fixed-config switch).
    function getQualifiedPortName(node, portNum) {
        const n = String(portNum);
        if (!isInStack(node)) return n;
        const mid = _stackMemberId(node);
        if (!mid) return n;
        return `${mid}/0/${n}`;
    }

    // Rileva quando un LAG attraversa piu' membri dello stesso stack.
    // Caso reale: Port-channel1 con Gi1/0/24 + Gi2/0/24 (uplink ridondato
    // tra master e member#2). Cisco lo chiama "cross-stack EtherChannel" e
    // permette HA del link di uplink.
    //
    // Input: `memberPortIds` = array di pid del LAG (es. ['sw1-24','sw2-24']);
    //        `pidToNodeId` = funzione che restituisce il nodeId dato un pid.
    //
    // Output: { isCross, stackId, memberIds } dove:
    //   isCross = true se i pid appartengono a >=2 device dello stesso stack
    //   stackId = id dello stack attraversato (null se non cross)
    //   memberIds = array dei nodeId distinti delle device membre (ordinato)
    //
    // Note: LAG fra device di stack DIVERSI o fra standalone NON e' cross-member
    // (e' un caso topologicamente differente — coperto da DCT switch-switch).
    function getLagCrossMemberInfo(nodes, memberPortIds, pidToNodeId) {
        const empty = { isCross: false, stackId: null, memberIds: [] };
        if (!Array.isArray(memberPortIds) || memberPortIds.length < 2) return empty;
        if (typeof pidToNodeId !== 'function') return empty;
        const nodeIds = new Set();
        for (const pid of memberPortIds) {
            const nid = pidToNodeId(pid);
            if (nid) nodeIds.add(nid);
        }
        if (nodeIds.size < 2) return empty;
        // Verifica che TUTTI i nodi siano nello stesso stack
        const byId = new Map(nodes.map(n => [n.id, n]));
        let sharedStackId = null;
        for (const nid of nodeIds) {
            const node = byId.get(nid);
            const sid = _stackId(node);
            if (!sid) return empty; // un nodo non in stack -> non e' cross-member
            if (sharedStackId === null) sharedStackId = sid;
            else if (sharedStackId !== sid) return empty; // stack diversi
        }
        return {
            isCross: true,
            stackId: sharedStackId,
            memberIds: Array.from(nodeIds).sort(),
        };
    }

    // Campi che lo stack condivide a livello di management (UN solo IP, UN
    // hostname logico per il cluster, UNA istanza SNMP via il master).
    // I membri ereditano questi valori dal master e non andrebbero editati
    // separatamente. Usato dall'UI per disabilitare gli input sui membri e
    // dal setter per propagare dal master ai membri.
    const STACK_SHARED_FIELDS = Object.freeze([
        'hostname', 'ip', 'mac',
        // integration e' un sottooggetto: i suoi campi (host, community,
        // driver, port, timeout) seguono lo stesso pattern.
    ]);
    const STACK_SHARED_INTEGRATION_FIELDS = Object.freeze([
        'driver', 'host', 'community', 'port', 'timeout',
        'username', 'authProto', 'authPass', 'privProto', 'privPass',
    ]);

    // Sincronizza i campi shared dal master ai membri.
    // Mutazione in-place; chiama renderAll/markDirty dal caller.
    // Restituisce array dei nodi modificati (per logging/dirty tracking).
    function propagateMasterToMembers(nodes, masterNode) {
        if (!masterNode || !isInStack(masterNode)) return [];
        const stackId = _stackId(masterNode);
        const role = getEffectiveRole(nodes, masterNode);
        if (role !== 'master') return [];
        const members = getStackMembers(nodes, stackId).filter(m => m.id !== masterNode.id);
        const changed = [];
        for (const m of members) {
            let did = false;
            for (const f of STACK_SHARED_FIELDS) {
                if (masterNode[f] !== undefined && m[f] !== masterNode[f]) {
                    m[f] = masterNode[f];
                    did = true;
                }
            }
            // integration sub-object
            if (masterNode.integration && typeof masterNode.integration === 'object') {
                if (!m.integration || typeof m.integration !== 'object') m.integration = {};
                for (const f of STACK_SHARED_INTEGRATION_FIELDS) {
                    if (masterNode.integration[f] !== undefined && m.integration[f] !== masterNode.integration[f]) {
                        m.integration[f] = masterNode.integration[f];
                        did = true;
                    }
                }
            }
            if (did) changed.push(m);
        }
        return changed;
    }

    // Auto-detection di uno stack da pattern di interfacce SNMP (P7.3).
    // Riceve array di stringhe (ifDescr / ifName) raccolte dal poll SNMP del
    // device e cerca pattern del tipo `<member>/<slot>/<port>` con member>=1
    // su >=2 valori distinti — indicatore tipico di stack/Virtual Chassis.
    //
    // Pattern supportati (most common first):
    //   1. Cisco IOS-XE       "GigabitEthernet1/0/1", "Gi2/0/24", "Te3/1/4"
    //   2. Arista cEOS/7300   "Ethernet1/1/1", "Et2/1/1"
    //   3. Juniper VC         "ge-1/0/0", "xe-2/0/0", "et-3/0/0"
    //   4. Aruba CX           "1/1/1", "2/1/24" (pure numeric)
    //
    // Output:
    //   { stackDetected, memberIds, suggestedFormat, sampleNames }
    //
    // NOTA: il pattern `M/0/N` puo' confondersi con uno chassis modulare a
    // line card (es. Catalyst 6500). La distinzione finale e' a sysObjectID /
    // hardware — qui detettiamo solo il PATTERN, l'utente conferma via banner.
    function detectStackFromInterfaces(interfaceNames) {
        const empty = { stackDetected: false, memberIds: [], suggestedFormat: null, sampleNames: [] };
        if (!Array.isArray(interfaceNames) || interfaceNames.length === 0) return empty;

        const memberSet = new Set();
        const samples = new Map(); // memberId -> first sample name seen
        let detectedFormat = null;

        for (const rawName of interfaceNames) {
            if (typeof rawName !== 'string') continue;
            const name = rawName.trim();
            if (!name) continue;

            let match;
            let format = null;
            let member = null;

            // Pattern 1: <letters><M>/<S>/<P> — Cisco IOS-XE, Arista 7300/cEOS
            match = name.match(/^([a-zA-Z]+)(\d+)\/(\d+)\/(\d+)$/);
            if (match) {
                const prefix = match[1].toLowerCase();
                member = parseInt(match[2], 10);
                if (/^(ethernet|et)$/.test(prefix)) format = 'arista';
                else format = 'cisco-iosxe';
            }
            // Pattern 2: <letters>-<M>/<S>/<P> — Juniper VC (ge-/xe-/et-/me-/fe-)
            if (!match) {
                match = name.match(/^([a-zA-Z]+)-(\d+)\/(\d+)\/(\d+)$/);
                if (match) {
                    member = parseInt(match[2], 10);
                    format = 'juniper-vc';
                }
            }
            // Pattern 3: pure numeric <M>/<S>/<P> — Aruba CX
            if (!match) {
                match = name.match(/^(\d+)\/(\d+)\/(\d+)$/);
                if (match) {
                    member = parseInt(match[1], 10);
                    format = 'aruba-cx';
                }
            }

            if (member !== null && Number.isFinite(member) && member >= 1) {
                memberSet.add(member);
                if (!samples.has(member)) samples.set(member, name);
                if (!detectedFormat) detectedFormat = format;
            }
        }

        const memberIds = Array.from(memberSet).sort((a, b) => a - b);
        const stackDetected = memberIds.length >= 2;
        const sampleNames = memberIds.map(mid => samples.get(mid));

        return { stackDetected, memberIds, suggestedFormat: detectedFormat, sampleNames };
    }

    return {
        isInStack,
        getStackMembers,
        getStackMaster,
        getNextMemberId,
        getAllStackIds,
        isMemberIdAvailable,
        getEffectiveRole,
        getBadgeLabel,
        getStackSummary,
        getQualifiedPortName,
        getLagCrossMemberInfo,
        propagateMasterToMembers,
        detectStackFromInterfaces,
        STACK_SHARED_FIELDS,
        STACK_SHARED_INTEGRATION_FIELDS,
    };
});

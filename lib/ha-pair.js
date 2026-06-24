// HA pair / cluster helpers — primitive pure per modellare l'Alta Affidabilita
// di firewall / router / WLAN controller / NAS / server (P8.1).
//
// IMPORTANTE: lo stacking (P7) e l'HA sono concetti **architetturalmente
// diversi**. Stack = N unita fondono in UNA logica con UN solo IP; HA = 2 o N
// unita restano DISTINTE, ciascuna con proprio IP, sincronizzano solo stato
// sessione / failover. Esempi reali HA:
//   - Palo Alto active/passive HA1+HA2
//   - Fortinet FortiGate FGCP
//   - Cisco ASA failover
//   - Cisco WLC 9800 SSO
//   - Aruba Mobility Conductor cluster
//   - Synology HA storage cluster
//
// Modello tag-based su `node.spec` (coerente con P7 Stacking e refactor P0.1):
//   - haPeer    : string | id del partner per HA pair 1-1 (es. 'fw-2')
//   - haGroupId : string | identificativo cluster N>2 (es. 'ha-edge-wlc')
//   - haRole    : 'active' | 'standby' | 'member'
//   - haMode    : 'active-passive' | 'active-active' | 'cluster-N'
//   - haSync    : 'state-full' | 'config-only' | 'failover-only' (opt)
//
// `haPeer` e `haGroupId` sono mutuamente esclusivi:
//   - pair 1-1: usa haPeer (simmetrico: A.peer=B implica B.peer=A)
//   - cluster N>2: usa haGroupId (tutti i membri condividono lo stesso id)
//
// La lib resta pura: nessun DOM, nessun TYPES coupling. La verifica
// `haEligible` e' delegata al chiamante (in app.js) che fa il lookup TYPES.
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        Object.assign(root, factory());
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Lettura sicura dei campi HA: gestisce sia `node.spec.ha*`
    // (nuovo, post-P0.1) sia `node.ha*` (legacy/promosso).
    function _haPeer(node)    { return node?.spec?.haPeer    ?? node?.haPeer    ?? null; }
    function _haGroupId(node) { return node?.spec?.haGroupId ?? node?.haGroupId ?? null; }
    function _haRole(node) {
        const r = node?.spec?.haRole ?? node?.haRole;
        return r === 'active' || r === 'standby' || r === 'member' ? r : null;
    }
    function _haMode(node) {
        const m = node?.spec?.haMode ?? node?.haMode;
        return m === 'active-passive' || m === 'active-active' || m === 'cluster-N' ? m : null;
    }
    function _haSync(node) {
        const s = node?.spec?.haSync ?? node?.haSync;
        return s === 'state-full' || s === 'config-only' || s === 'failover-only' ? s : null;
    }

    // True se il nodo e' in HA pair O in HA cluster.
    function isInHaGroup(node) {
        const peer = _haPeer(node);
        const gid  = _haGroupId(node);
        return (typeof peer === 'string' && peer.length > 0)
            || (typeof gid  === 'string' && gid.length  > 0);
    }

    // Solo pair 1-1.
    function isInHaPair(node) {
        const peer = _haPeer(node);
        return typeof peer === 'string' && peer.length > 0;
    }

    // Solo cluster N>2.
    function isInHaCluster(node) {
        const gid = _haGroupId(node);
        return typeof gid === 'string' && gid.length > 0;
    }

    // Restituisce il nodo partner per HA pair 1-1, oppure null.
    function getHaPeer(nodes, node) {
        if (!Array.isArray(nodes)) return null;
        const peerId = _haPeer(node);
        if (!peerId) return null;
        return nodes.find(n => n && n.id === peerId) || null;
    }

    // Tutti i membri di un cluster identificato da groupId, ordinati per
    // ruolo (active prima, poi standby, poi member) e id.
    function getHaClusterMembers(nodes, groupId) {
        if (!Array.isArray(nodes) || !groupId) return [];
        const roleOrder = { active: 0, standby: 1, member: 2 };
        return nodes
            .filter(n => _haGroupId(n) === groupId)
            .sort((a, b) => {
                const ra = roleOrder[_haRole(a)] ?? 99;
                const rb = roleOrder[_haRole(b)] ?? 99;
                if (ra !== rb) return ra - rb;
                return String(a.id || '').localeCompare(String(b.id || ''));
            });
    }

    // Restituisce TUTTI i nodi correlati a `node` via HA (pair O cluster),
    // esclusi se stessi. Utile per UI/lista.
    function getHaPartners(nodes, node) {
        if (!isInHaGroup(node)) return [];
        if (isInHaPair(node)) {
            const peer = getHaPeer(nodes, node);
            return peer ? [peer] : [];
        }
        // Cluster: tutti i membri del gruppo eccetto se stesso
        return getHaClusterMembers(nodes, _haGroupId(node)).filter(n => n.id !== node.id);
    }

    // Tutti i groupId distinti presenti nello state, ordinati alfabeticamente.
    function getAllHaGroupIds(nodes) {
        if (!Array.isArray(nodes)) return [];
        const set = new Set();
        for (const n of nodes) {
            const gid = _haGroupId(n);
            if (typeof gid === 'string' && gid.length > 0) set.add(gid);
        }
        return Array.from(set).sort();
    }

    // Etichetta breve per badge / preview:
    //   pair active   -> "Active in coppia con <name>"
    //   pair standby  -> "Standby di <name>"
    //   cluster active -> "Active in cluster <groupId>"
    //   cluster member -> "Membro di cluster <groupId>"
    function getHaSummary(nodes, node) {
        if (!isInHaGroup(node)) return null;
        const role = _haRole(node) || 'active';
        if (isInHaPair(node)) {
            const peer = getHaPeer(nodes, node);
            const peerName = peer ? (peer.name || peer.hostname || peer.id) : '?';
            if (role === 'active')  return `Active in coppia con ${peerName}`;
            if (role === 'standby') return `Standby di ${peerName}`;
            return `In coppia con ${peerName}`;
        }
        // Cluster
        const gid = _haGroupId(node);
        const verb = role === 'active' ? 'Active' : role === 'standby' ? 'Standby' : 'Membro';
        return `${verb} in cluster ${gid}`;
    }

    // Lettera per badge UI rack: A = active, S = standby, M = member.
    function getHaBadgeLabel(node) {
        if (!isInHaGroup(node)) return null;
        const role = _haRole(node);
        if (role === 'active')  return 'A';
        if (role === 'standby') return 'S';
        if (role === 'member')  return 'M';
        // Senza ruolo esplicito ma in gruppo: default A (active assunto)
        return 'A';
    }

    // Propaga simmetria nei pair 1-1: quando si setta A.peer=B, anche B.peer
    // deve diventare A. Side-effect su `nodes` (mutazione in-place sul partner).
    // Se B aveva un peer precedente C diverso da A, C.peer viene pulito
    // (un solo partner per device). Restituisce array dei nodi modificati.
    function propagateHaSymmetry(nodes, node) {
        if (!Array.isArray(nodes)) return [];
        if (!isInHaPair(node)) return [];
        const peerId = _haPeer(node);
        const peer = nodes.find(n => n && n.id === peerId);
        if (!peer) return [];
        const changed = [];
        // Se il peer aveva un altro partner C, pulisci C
        const peersPrevPeer = _haPeer(peer);
        if (peersPrevPeer && peersPrevPeer !== node.id) {
            const prevC = nodes.find(n => n && n.id === peersPrevPeer);
            if (prevC && prevC.spec) {
                delete prevC.spec.haPeer;
                delete prevC.spec.haRole;
                delete prevC.spec.haMode;
                delete prevC.spec.haSync;
                changed.push(prevC);
            }
        }
        // Setta il peer simmetrico su B
        if (!peer.spec) peer.spec = {};
        peer.spec.haPeer = node.id;
        // Ruolo complementare: se node e' active, peer diventa standby (e viceversa)
        const myRole = _haRole(node);
        if (myRole === 'active')  peer.spec.haRole = 'standby';
        else if (myRole === 'standby') peer.spec.haRole = 'active';
        // Modalita e sync condivisi
        const myMode = _haMode(node);
        if (myMode) peer.spec.haMode = myMode;
        const mySync = _haSync(node);
        if (mySync) peer.spec.haSync = mySync;
        changed.push(peer);
        return changed;
    }

    // Validazione cluster: max 1 active per pair (active-passive), nessun limite
    // per active-active. Restituisce { valid, errors[] }.
    function validateHaSymmetry(nodes) {
        const errors = [];
        if (!Array.isArray(nodes)) return { valid: true, errors };
        // 1. Check pair simmetria: ogni nodo con haPeer deve essere puntato dal peer
        for (const n of nodes) {
            if (!isInHaPair(n)) continue;
            const peerId = _haPeer(n);
            const peer = nodes.find(x => x && x.id === peerId);
            if (!peer) {
                errors.push(`Nodo ${n.id}: peer '${peerId}' inesistente`);
                continue;
            }
            const reverse = _haPeer(peer);
            if (reverse !== n.id) {
                errors.push(`Asimmetria: ${n.id}.peer=${peerId} ma ${peerId}.peer=${reverse}`);
            }
        }
        // 2. Check cluster active-passive: max 1 active per gruppo
        const groupIds = getAllHaGroupIds(nodes);
        for (const gid of groupIds) {
            const members = getHaClusterMembers(nodes, gid);
            const activeCount = members.filter(m => _haRole(m) === 'active').length;
            const mode = members.find(m => _haMode(m))?.spec?.haMode;
            if (mode === 'active-passive' && activeCount > 1) {
                errors.push(`Cluster '${gid}': trovati ${activeCount} active ma mode=active-passive (max 1)`);
            }
        }
        return { valid: errors.length === 0, errors };
    }

    // Campi che NON vengono sincronizzati cross-HA: ogni unita mantiene
    // propria identita di management (a differenza dello stack).
    // Documentato come marker, non usato in codice (HA non propaga config).
    const HA_INDEPENDENT_FIELDS = Object.freeze([
        'hostname', 'ip', 'mac', // ogni unita ha proprio IP/hostname/MAC
        // integration.* (credenziali SNMP): potenzialmente diverse per peer
    ]);

    return {
        isInHaGroup,
        isInHaPair,
        isInHaCluster,
        getHaPeer,
        getHaClusterMembers,
        getHaPartners,
        getAllHaGroupIds,
        getHaSummary,
        getHaBadgeLabel,
        propagateHaSymmetry,
        validateHaSymmetry,
        HA_INDEPENDENT_FIELDS,
    };
});

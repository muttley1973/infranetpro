// Test per lib/ha-pair.js — primitive HA pair / cluster (P8.1).
// Modello: node.spec.haPeer / haGroupId / haRole / haMode / haSync.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    isInHaGroup, isInHaPair, isInHaCluster,
    getHaPeer, getHaClusterMembers, getHaPartners, getAllHaGroupIds,
    getHaSummary, getHaBadgeLabel,
    propagateHaSymmetry, validateHaSymmetry,
    HA_INDEPENDENT_FIELDS,
} = require('../lib/ha-pair.js');

// Helper: crea un nodo HA pair (1-1)
function pair(id, peerId, role, mode) {
    const spec = { haPeer: peerId };
    if (role) spec.haRole = role;
    if (mode) spec.haMode = mode;
    return { id, name: id.toUpperCase(), type: 'firewall', spec };
}
// Helper: crea un nodo HA cluster (N>2)
function cluster(id, groupId, role, mode) {
    const spec = { haGroupId: groupId };
    if (role) spec.haRole = role;
    if (mode) spec.haMode = mode;
    return { id, name: id.toUpperCase(), type: 'wlanctrl', spec };
}
function standalone(id) { return { id, name: id.toUpperCase(), type: 'firewall' }; }

// ============================================================================
// isInHaGroup / isInHaPair / isInHaCluster
// ============================================================================

test('isInHaGroup: nodo standalone -> false', () => {
    assert.equal(isInHaGroup(standalone('fw1')), false);
});

test('isInHaGroup: nodo con haPeer -> true', () => {
    assert.equal(isInHaGroup(pair('fw1', 'fw2', 'active')), true);
});

test('isInHaGroup: nodo con haGroupId -> true', () => {
    assert.equal(isInHaGroup(cluster('wlc1', 'ha-edge', 'active')), true);
});

test('isInHaPair: solo pair', () => {
    assert.equal(isInHaPair(pair('fw1', 'fw2', 'active')), true);
    assert.equal(isInHaPair(cluster('wlc1', 'ha-edge', 'active')), false);
    assert.equal(isInHaPair(standalone('fw1')), false);
});

test('isInHaCluster: solo cluster', () => {
    assert.equal(isInHaCluster(cluster('wlc1', 'ha-edge', 'active')), true);
    assert.equal(isInHaCluster(pair('fw1', 'fw2', 'active')), false);
    assert.equal(isInHaCluster(standalone('fw1')), false);
});

test('isInHaGroup: back-compat lettura su node.haPeer (non in spec)', () => {
    assert.equal(isInHaGroup({ id: 'fw1', haPeer: 'fw2' }), true);
});

test('isInHaGroup: null/undefined -> false', () => {
    assert.equal(isInHaGroup(null), false);
    assert.equal(isInHaGroup(undefined), false);
    assert.equal(isInHaGroup({}), false);
});

// ============================================================================
// getHaPeer
// ============================================================================

test('getHaPeer: ritorna nodo partner', () => {
    const fw1 = pair('fw1', 'fw2', 'active');
    const fw2 = pair('fw2', 'fw1', 'standby');
    assert.equal(getHaPeer([fw1, fw2], fw1).id, 'fw2');
    assert.equal(getHaPeer([fw1, fw2], fw2).id, 'fw1');
});

test('getHaPeer: nodo senza peer -> null', () => {
    assert.equal(getHaPeer([], standalone('fw1')), null);
});

test('getHaPeer: peer inesistente -> null', () => {
    const fw1 = pair('fw1', 'ghost', 'active');
    assert.equal(getHaPeer([fw1], fw1), null);
});

// ============================================================================
// getHaClusterMembers
// ============================================================================

test('getHaClusterMembers: ordina active -> standby -> member', () => {
    const nodes = [
        cluster('wlc3', 'ha-edge', 'member'),
        cluster('wlc1', 'ha-edge', 'active'),
        cluster('wlc2', 'ha-edge', 'standby'),
    ];
    const result = getHaClusterMembers(nodes, 'ha-edge');
    assert.deepEqual(result.map(n => n.id), ['wlc1', 'wlc2', 'wlc3']);
});

test('getHaClusterMembers: filtra per groupId', () => {
    const nodes = [
        cluster('a', 'cl-A', 'active'),
        cluster('b', 'cl-B', 'active'),
        cluster('c', 'cl-A', 'standby'),
    ];
    assert.deepEqual(getHaClusterMembers(nodes, 'cl-A').map(n => n.id), ['a', 'c']);
});

test('getHaClusterMembers: gruppo inesistente -> []', () => {
    assert.deepEqual(getHaClusterMembers([cluster('a', 'cl-A', 'active')], 'cl-X'), []);
});

// ============================================================================
// getHaPartners
// ============================================================================

test('getHaPartners: pair -> [peer]', () => {
    const fw1 = pair('fw1', 'fw2', 'active');
    const fw2 = pair('fw2', 'fw1', 'standby');
    const partners = getHaPartners([fw1, fw2], fw1);
    assert.equal(partners.length, 1);
    assert.equal(partners[0].id, 'fw2');
});

test('getHaPartners: cluster -> tutti i membri eccetto se stesso', () => {
    const nodes = [
        cluster('wlc1', 'ha-edge', 'active'),
        cluster('wlc2', 'ha-edge', 'standby'),
        cluster('wlc3', 'ha-edge', 'member'),
    ];
    const partners = getHaPartners(nodes, nodes[0]);
    assert.deepEqual(partners.map(n => n.id), ['wlc2', 'wlc3']);
});

test('getHaPartners: standalone -> []', () => {
    assert.deepEqual(getHaPartners([], standalone('fw1')), []);
});

// ============================================================================
// getAllHaGroupIds
// ============================================================================

test('getAllHaGroupIds: deduplica + ordina', () => {
    const nodes = [
        cluster('a', 'cl-zeta', 'active'),
        cluster('b', 'cl-alpha', 'active'),
        cluster('c', 'cl-zeta', 'standby'),
        pair('fw1', 'fw2', 'active'),
        standalone('sw1'),
    ];
    assert.deepEqual(getAllHaGroupIds(nodes), ['cl-alpha', 'cl-zeta']);
});

test('getAllHaGroupIds: nessun cluster -> []', () => {
    assert.deepEqual(getAllHaGroupIds([standalone('fw1'), pair('fw2', 'fw3', 'active')]), []);
});

// ============================================================================
// getHaSummary
// ============================================================================

test('getHaSummary: standalone -> null', () => {
    assert.equal(getHaSummary([], standalone('fw1')), null);
});

test('getHaSummary: pair active', () => {
    const fw1 = pair('fw1', 'fw2', 'active');
    const fw2 = pair('fw2', 'fw1', 'standby');
    assert.equal(getHaSummary([fw1, fw2], fw1), 'Active in coppia con FW2');
});

test('getHaSummary: pair standby', () => {
    const fw1 = pair('fw1', 'fw2', 'active');
    const fw2 = pair('fw2', 'fw1', 'standby');
    assert.equal(getHaSummary([fw1, fw2], fw2), 'Standby di FW1');
});

test('getHaSummary: cluster active', () => {
    const wlc1 = cluster('wlc1', 'ha-edge', 'active');
    assert.equal(getHaSummary([wlc1], wlc1), 'Active in cluster ha-edge');
});

test('getHaSummary: cluster member', () => {
    const wlc3 = cluster('wlc3', 'ha-edge', 'member');
    assert.equal(getHaSummary([wlc3], wlc3), 'Membro in cluster ha-edge');
});

// ============================================================================
// getHaBadgeLabel
// ============================================================================

test('getHaBadgeLabel: A/S/M', () => {
    assert.equal(getHaBadgeLabel(pair('fw1', 'fw2', 'active')), 'A');
    assert.equal(getHaBadgeLabel(pair('fw2', 'fw1', 'standby')), 'S');
    assert.equal(getHaBadgeLabel(cluster('wlc3', 'ha-edge', 'member')), 'M');
});

test('getHaBadgeLabel: standalone -> null', () => {
    assert.equal(getHaBadgeLabel(standalone('fw1')), null);
});

test('getHaBadgeLabel: in gruppo senza ruolo -> "A" default', () => {
    const n = { id: 'fw1', spec: { haPeer: 'fw2' } };
    assert.equal(getHaBadgeLabel(n), 'A');
});

// ============================================================================
// propagateHaSymmetry
// ============================================================================

test('propagateHaSymmetry: B.peer diventa A (simmetria)', () => {
    const fw1 = pair('fw1', 'fw2', 'active', 'active-passive');
    const fw2 = standalone('fw2');
    const nodes = [fw1, fw2];
    const changed = propagateHaSymmetry(nodes, fw1);
    assert.equal(changed.length, 1);
    assert.equal(changed[0].id, 'fw2');
    assert.equal(fw2.spec.haPeer, 'fw1');
    assert.equal(fw2.spec.haRole, 'standby', 'active -> standby complementare');
    assert.equal(fw2.spec.haMode, 'active-passive');
});

test('propagateHaSymmetry: ruolo complementare standby -> active', () => {
    const fw1 = pair('fw1', 'fw2', 'standby', 'active-passive');
    const fw2 = standalone('fw2');
    propagateHaSymmetry([fw1, fw2], fw1);
    assert.equal(fw2.spec.haRole, 'active');
});

test('propagateHaSymmetry: rompe vecchio pair se peer aveva altro partner', () => {
    // Inizialmente fw2 era in pair con fw3
    const fw3 = pair('fw3', 'fw2', 'standby');
    const fw2 = pair('fw2', 'fw3', 'active');
    // Ora fw1 vuole fw2 come suo peer
    const fw1 = pair('fw1', 'fw2', 'active');
    const nodes = [fw1, fw2, fw3];
    propagateHaSymmetry(nodes, fw1);
    // fw2 ora punta a fw1
    assert.equal(fw2.spec.haPeer, 'fw1');
    // fw3 NON ha piu' peer (era orfano)
    assert.equal(fw3.spec.haPeer, undefined);
    assert.equal(fw3.spec.haRole, undefined);
});

test('propagateHaSymmetry: peer inesistente -> []', () => {
    const fw1 = pair('fw1', 'ghost', 'active');
    const changed = propagateHaSymmetry([fw1], fw1);
    assert.deepEqual(changed, []);
});

test('propagateHaSymmetry: nodo standalone -> []', () => {
    assert.deepEqual(propagateHaSymmetry([], standalone('fw1')), []);
});

// ============================================================================
// validateHaSymmetry
// ============================================================================

test('validateHaSymmetry: pair simmetrico -> valid', () => {
    const fw1 = pair('fw1', 'fw2', 'active');
    const fw2 = pair('fw2', 'fw1', 'standby');
    const res = validateHaSymmetry([fw1, fw2]);
    assert.equal(res.valid, true);
    assert.deepEqual(res.errors, []);
});

test('validateHaSymmetry: asimmetria -> errore', () => {
    const fw1 = pair('fw1', 'fw2', 'active');
    const fw2 = pair('fw2', 'fw3', 'active'); // punta a fw3, non a fw1
    const fw3 = standalone('fw3');
    const res = validateHaSymmetry([fw1, fw2, fw3]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => /[Aa]simmetri/.test(e)));
});

test('validateHaSymmetry: peer inesistente -> errore', () => {
    const fw1 = pair('fw1', 'ghost', 'active');
    const res = validateHaSymmetry([fw1]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('inesistente')));
});

test('validateHaSymmetry: cluster active-passive con 2 active -> errore', () => {
    const w1 = cluster('w1', 'ha-edge', 'active', 'active-passive');
    const w2 = cluster('w2', 'ha-edge', 'active', 'active-passive');
    const res = validateHaSymmetry([w1, w2]);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some(e => /active-passive/.test(e)));
});

test('validateHaSymmetry: cluster active-active multi-active -> valid', () => {
    const w1 = cluster('w1', 'ha-edge', 'active', 'active-active');
    const w2 = cluster('w2', 'ha-edge', 'active', 'active-active');
    const res = validateHaSymmetry([w1, w2]);
    assert.equal(res.valid, true);
});

test('HA_INDEPENDENT_FIELDS contiene hostname/ip/mac (a differenza dello stack)', () => {
    assert.ok(HA_INDEPENDENT_FIELDS.includes('hostname'));
    assert.ok(HA_INDEPENDENT_FIELDS.includes('ip'));
    assert.ok(HA_INDEPENDENT_FIELDS.includes('mac'));
});

// ============================================================================
// Scenari realistici
// ============================================================================

test('scenario: Palo Alto active/passive HA pair', () => {
    const pa1 = pair('pa-1', 'pa-2', 'active', 'active-passive');
    const pa2 = pair('pa-2', 'pa-1', 'standby', 'active-passive');
    const nodes = [pa1, pa2];
    assert.equal(validateHaSymmetry(nodes).valid, true);
    assert.equal(getHaSummary(nodes, pa1), 'Active in coppia con PA-2');
    assert.equal(getHaSummary(nodes, pa2), 'Standby di PA-1');
    assert.equal(getHaBadgeLabel(pa1), 'A');
    assert.equal(getHaBadgeLabel(pa2), 'S');
});

test('scenario: Cisco WLC 9800 cluster 3 unita', () => {
    const w1 = cluster('wlc-1', 'wlc-edge', 'active', 'cluster-N');
    const w2 = cluster('wlc-2', 'wlc-edge', 'standby', 'cluster-N');
    const w3 = cluster('wlc-3', 'wlc-edge', 'member', 'cluster-N');
    const nodes = [w1, w2, w3];
    assert.deepEqual(getAllHaGroupIds(nodes), ['wlc-edge']);
    assert.equal(getHaClusterMembers(nodes, 'wlc-edge').length, 3);
    assert.equal(getHaPartners(nodes, w1).length, 2);
    assert.equal(validateHaSymmetry(nodes).valid, true);
});

test('scenario: Fortinet FGCP active/active', () => {
    const fg1 = pair('fg-1', 'fg-2', 'active', 'active-active');
    const fg2 = pair('fg-2', 'fg-1', 'active', 'active-active');
    const nodes = [fg1, fg2];
    assert.equal(validateHaSymmetry(nodes).valid, true);
    assert.equal(getHaBadgeLabel(fg1), 'A');
    assert.equal(getHaBadgeLabel(fg2), 'A');
});

test('scenario: HA e Stacking coesistono senza interferenze', () => {
    // Switch in stack (P7) + firewall in HA (P8) — entita disgiunte
    const sw1 = { id: 'sw-1', type: 'switch', spec: { stackId: 'stk-core', stackMemberId: 1 } };
    const sw2 = { id: 'sw-2', type: 'switch', spec: { stackId: 'stk-core', stackMemberId: 2 } };
    const fw1 = pair('fw-1', 'fw-2', 'active');
    const fw2 = pair('fw-2', 'fw-1', 'standby');
    const nodes = [sw1, sw2, fw1, fw2];
    // Stack switch: NON in HA
    assert.equal(isInHaGroup(sw1), false);
    assert.equal(isInHaGroup(sw2), false);
    // Firewall pair: NON in stack
    assert.equal(isInHaGroup(fw1), true);
    assert.equal(isInHaGroup(fw2), true);
});

// Test per lib/stack.js — primitive di stacking switch.
// Modello: node.spec.stackId / stackMemberId / stackRole.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    isInStack, getStackMembers, getStackMaster, getNextMemberId,
    getAllStackIds, isMemberIdAvailable, getEffectiveRole,
    getBadgeLabel, getStackSummary,
    getQualifiedPortName, getLagCrossMemberInfo, propagateMasterToMembers,
    detectStackFromInterfaces,
    STACK_SHARED_FIELDS, STACK_SHARED_INTEGRATION_FIELDS,
} = require('../lib/stack.js');

// Helper: crea un nodo membro di stack con spec annidato
function member(id, stackId, memberId, role) {
    const spec = { stackId };
    if (memberId !== undefined) spec.stackMemberId = memberId;
    if (role !== undefined)     spec.stackRole = role;
    return { id, type: 'switch', spec };
}
function standalone(id) { return { id, type: 'switch' }; }

// ============================================================================
// isInStack
// ============================================================================

test('isInStack: nodo con stackId valido -> true', () => {
    assert.equal(isInStack(member('sw1', 'stk-1', 1)), true);
});

test('isInStack: nodo senza stackId -> false', () => {
    assert.equal(isInStack(standalone('sw1')), false);
});

test('isInStack: nodo con stackId vuoto/null -> false', () => {
    assert.equal(isInStack({ id: 'sw1', spec: { stackId: '' } }), false);
    assert.equal(isInStack({ id: 'sw1', spec: { stackId: null } }), false);
    assert.equal(isInStack({ id: 'sw1', spec: {} }), false);
    assert.equal(isInStack(null), false);
    assert.equal(isInStack(undefined), false);
});

test('isInStack: back-compat lettura su node.stackId (non in spec)', () => {
    assert.equal(isInStack({ id: 'sw1', stackId: 'stk-1' }), true);
});

// ============================================================================
// getStackMembers
// ============================================================================

test('getStackMembers: ordina per memberId crescente', () => {
    const nodes = [
        member('sw3', 'stk-1', 3),
        member('sw1', 'stk-1', 1),
        member('sw2', 'stk-1', 2),
    ];
    const result = getStackMembers(nodes, 'stk-1');
    assert.deepEqual(result.map(n => n.id), ['sw1', 'sw2', 'sw3']);
});

test('getStackMembers: filtra per stackId', () => {
    const nodes = [
        member('sw1', 'stk-a', 1),
        member('sw2', 'stk-b', 1),
        member('sw3', 'stk-a', 2),
    ];
    assert.deepEqual(getStackMembers(nodes, 'stk-a').map(n => n.id), ['sw1', 'sw3']);
    assert.deepEqual(getStackMembers(nodes, 'stk-b').map(n => n.id), ['sw2']);
});

test('getStackMembers: membri senza memberId vanno in coda', () => {
    const nodes = [
        member('sw3', 'stk-1'),       // no memberId
        member('sw1', 'stk-1', 1),
        member('sw2', 'stk-1'),       // no memberId
    ];
    const result = getStackMembers(nodes, 'stk-1');
    assert.equal(result[0].id, 'sw1', 'sw1 (memberId=1) primo');
    // sw2 e sw3 in coda, ordine stabile per id
    assert.ok(result.slice(1).map(n => n.id).every(id => ['sw2', 'sw3'].includes(id)));
});

test('getStackMembers: stack inesistente -> array vuoto', () => {
    assert.deepEqual(getStackMembers([], 'stk-x'), []);
    assert.deepEqual(getStackMembers([member('sw1', 'stk-1', 1)], 'stk-x'), []);
});

test('getStackMembers: input non-array -> array vuoto', () => {
    assert.deepEqual(getStackMembers(null, 'stk-1'), []);
    assert.deepEqual(getStackMembers(undefined, 'stk-1'), []);
});

// ============================================================================
// getStackMaster
// ============================================================================

test('getStackMaster: nodo con stackRole="master" esplicito vince', () => {
    const nodes = [
        member('sw1', 'stk-1', 1),                    // memberId=1 ma role implicito
        member('sw2', 'stk-1', 2, 'master'),          // role esplicito master
    ];
    assert.equal(getStackMaster(nodes, 'stk-1').id, 'sw2');
});

test('getStackMaster: fallback su memberId=1 se nessun role esplicito', () => {
    const nodes = [
        member('sw2', 'stk-1', 2),
        member('sw1', 'stk-1', 1),
        member('sw3', 'stk-1', 3),
    ];
    assert.equal(getStackMaster(nodes, 'stk-1').id, 'sw1');
});

test('getStackMaster: fallback su primo membro ordinato se mancano memberId', () => {
    const nodes = [
        member('sw3', 'stk-1'),
        member('sw1', 'stk-1'),
    ];
    // Tutti senza memberId -> ordina per id, primo = sw1
    assert.equal(getStackMaster(nodes, 'stk-1').id, 'sw1');
});

test('getStackMaster: stack vuoto -> null', () => {
    assert.equal(getStackMaster([], 'stk-x'), null);
});

// ============================================================================
// getNextMemberId
// ============================================================================

test('getNextMemberId: stack vuoto -> 1', () => {
    assert.equal(getNextMemberId([], 'stk-1'), 1);
});

test('getNextMemberId: id contigui 1..N -> N+1', () => {
    const nodes = [
        member('sw1', 'stk-1', 1),
        member('sw2', 'stk-1', 2),
        member('sw3', 'stk-1', 3),
    ];
    assert.equal(getNextMemberId(nodes, 'stk-1'), 4);
});

test('getNextMemberId: id con buco -> primo buco', () => {
    const nodes = [
        member('sw1', 'stk-1', 1),
        member('sw3', 'stk-1', 3),
        member('sw4', 'stk-1', 4),
    ];
    assert.equal(getNextMemberId(nodes, 'stk-1'), 2);
});

test('getNextMemberId: ignora altri stack', () => {
    const nodes = [
        member('sw1', 'stk-1', 1),
        member('sw2', 'stk-2', 1),
        member('sw3', 'stk-2', 2),
    ];
    assert.equal(getNextMemberId(nodes, 'stk-1'), 2);
    assert.equal(getNextMemberId(nodes, 'stk-2'), 3);
});

// ============================================================================
// getAllStackIds
// ============================================================================

test('getAllStackIds: deduplica + ordina', () => {
    const nodes = [
        member('sw1', 'stk-edge',  1),
        member('sw2', 'stk-core',  1),
        member('sw3', 'stk-edge',  2),
        standalone('sw4'),
        member('sw5', 'stk-core',  2),
        member('sw6', 'stk-acme',  1),
    ];
    assert.deepEqual(getAllStackIds(nodes), ['stk-acme', 'stk-core', 'stk-edge']);
});

test('getAllStackIds: nessuno stack -> []', () => {
    assert.deepEqual(getAllStackIds([standalone('sw1'), standalone('sw2')]), []);
});

// ============================================================================
// isMemberIdAvailable
// ============================================================================

test('isMemberIdAvailable: id libero -> true', () => {
    const nodes = [member('sw1', 'stk-1', 1), member('sw2', 'stk-1', 2)];
    assert.equal(isMemberIdAvailable(nodes, 'stk-1', 3), true);
    assert.equal(isMemberIdAvailable(nodes, 'stk-1', 99), true);
});

test('isMemberIdAvailable: id occupato -> false', () => {
    const nodes = [member('sw1', 'stk-1', 1), member('sw2', 'stk-1', 2)];
    assert.equal(isMemberIdAvailable(nodes, 'stk-1', 1), false);
    assert.equal(isMemberIdAvailable(nodes, 'stk-1', 2), false);
});

test('isMemberIdAvailable: excludeNodeId -> id su quel nodo conta libero', () => {
    const nodes = [member('sw1', 'stk-1', 1), member('sw2', 'stk-1', 2)];
    assert.equal(isMemberIdAvailable(nodes, 'stk-1', 1, 'sw1'), true);
    assert.equal(isMemberIdAvailable(nodes, 'stk-1', 2, 'sw1'), false);
});

test('isMemberIdAvailable: id invalidi -> false', () => {
    assert.equal(isMemberIdAvailable([], 'stk-1', 0), false);
    assert.equal(isMemberIdAvailable([], 'stk-1', -1), false);
    assert.equal(isMemberIdAvailable([], 'stk-1', NaN), false);
    assert.equal(isMemberIdAvailable([], '',      1),   false);
});

// ============================================================================
// getEffectiveRole
// ============================================================================

test('getEffectiveRole: standalone -> null', () => {
    assert.equal(getEffectiveRole([], standalone('sw1')), null);
});

test('getEffectiveRole: derivato da posizione nello stack', () => {
    const nodes = [
        member('sw1', 'stk-1', 1),
        member('sw2', 'stk-1', 2),
        member('sw3', 'stk-1', 3),
    ];
    assert.equal(getEffectiveRole(nodes, nodes[0]), 'master');
    assert.equal(getEffectiveRole(nodes, nodes[1]), 'member');
    assert.equal(getEffectiveRole(nodes, nodes[2]), 'member');
});

test('getEffectiveRole: master esplicito override', () => {
    const nodes = [
        member('sw1', 'stk-1', 1),
        member('sw2', 'stk-1', 2, 'master'),
    ];
    assert.equal(getEffectiveRole(nodes, nodes[0]), 'member');
    assert.equal(getEffectiveRole(nodes, nodes[1]), 'master');
});

// ============================================================================
// getBadgeLabel
// ============================================================================

test('getBadgeLabel: master -> Sm, members -> S<n>', () => {
    const nodes = [
        member('sw1', 'stk-1', 1),
        member('sw2', 'stk-1', 2),
        member('sw3', 'stk-1', 3),
    ];
    assert.equal(getBadgeLabel(nodes, nodes[0]), 'Sm');
    assert.equal(getBadgeLabel(nodes, nodes[1]), 'S2');
    assert.equal(getBadgeLabel(nodes, nodes[2]), 'S3');
});

test('getBadgeLabel: standalone -> null', () => {
    assert.equal(getBadgeLabel([], standalone('sw1')), null);
});

test('getBadgeLabel: membro senza memberId -> S?', () => {
    const n = member('sw1', 'stk-1');
    assert.equal(getBadgeLabel([n], n), 'Sm', 'unico membro = fallback master');
});

// ============================================================================
// getStackSummary
// ============================================================================

test('getStackSummary: standalone -> null', () => {
    assert.equal(getStackSummary([], standalone('sw1')), null);
});

test('getStackSummary: master mostra conteggio membri', () => {
    const nodes = [
        member('sw1', 'stk-1', 1),
        member('sw2', 'stk-1', 2),
        member('sw3', 'stk-1', 3),
    ];
    assert.equal(getStackSummary(nodes, nodes[0]), 'Master · 3 membri');
});

test('getStackSummary: membro mostra posizione', () => {
    const nodes = [
        member('sw1', 'stk-1', 1),
        member('sw2', 'stk-1', 2),
    ];
    assert.equal(getStackSummary(nodes, nodes[1]), 'Membro #2');
});

// ============================================================================
// Scenari realistici
// ============================================================================

test('scenario: stack Cisco StackWise di 3 switch, eliminazione master', () => {
    let nodes = [
        member('sw1', 'stk-core', 1),
        member('sw2', 'stk-core', 2),
        member('sw3', 'stk-core', 3),
    ];
    // master attuale
    assert.equal(getStackMaster(nodes, 'stk-core').id, 'sw1');

    // l'utente elimina sw1: dopo l'eliminazione il master atteso e' sw2
    nodes = nodes.filter(n => n.id !== 'sw1');
    assert.equal(getStackMaster(nodes, 'stk-core').id, 'sw2');
    assert.equal(getEffectiveRole(nodes, nodes[0]), 'master', 'sw2 ora promosso');

    // prossimo memberId libero: 1 (lo slot di sw1 e' libero)
    assert.equal(getNextMemberId(nodes, 'stk-core'), 1);
});

test('scenario: due stack indipendenti coesistono', () => {
    const nodes = [
        member('a1', 'stk-A', 1), member('a2', 'stk-A', 2),
        member('b1', 'stk-B', 1), member('b2', 'stk-B', 2), member('b3', 'stk-B', 3),
        standalone('sw-edge'),
    ];
    assert.deepEqual(getAllStackIds(nodes), ['stk-A', 'stk-B']);
    assert.equal(getStackMembers(nodes, 'stk-A').length, 2);
    assert.equal(getStackMembers(nodes, 'stk-B').length, 3);
    assert.equal(isInStack(nodes[5]), false);
});

test('scenario: back-compat con stackId/stackMemberId promossi a livello nodo', () => {
    // Vecchi progetti potrebbero salvare i campi direttamente sul nodo
    // invece che dentro spec (pre-refactor P0.1)
    const nodes = [
        { id: 'sw1', type: 'switch', stackId: 'stk-legacy', stackMemberId: 1 },
        { id: 'sw2', type: 'switch', stackId: 'stk-legacy', stackMemberId: 2 },
    ];
    assert.equal(isInStack(nodes[0]), true);
    assert.equal(getStackMaster(nodes, 'stk-legacy').id, 'sw1');
    assert.equal(getStackMembers(nodes, 'stk-legacy').length, 2);
});

// ============================================================================
// P7.2 Tappa B — getQualifiedPortName
// ============================================================================

test('getQualifiedPortName: standalone -> "N"', () => {
    assert.equal(getQualifiedPortName(standalone('sw1'), 24), '24');
    assert.equal(getQualifiedPortName(standalone('sw1'), 1), '1');
});

test('getQualifiedPortName: in stack -> "<member>/0/<port>"', () => {
    assert.equal(getQualifiedPortName(member('sw1', 'stk-1', 1), 24), '1/0/24');
    assert.equal(getQualifiedPortName(member('sw2', 'stk-1', 2), 1),  '2/0/1');
    assert.equal(getQualifiedPortName(member('sw3', 'stk-1', 3), 48), '3/0/48');
});

test('getQualifiedPortName: in stack senza memberId valido -> fallback "N"', () => {
    const n = { id: 'sw1', type: 'switch', spec: { stackId: 'stk-1' } };
    assert.equal(getQualifiedPortName(n, 24), '24');
});

test('getQualifiedPortName: back-compat letture su node.stackMemberId (no spec)', () => {
    const n = { id: 'sw1', type: 'switch', stackId: 'stk-1', stackMemberId: 2 };
    assert.equal(getQualifiedPortName(n, 7), '2/0/7');
});

// ============================================================================
// P7.2 Tappa B — getLagCrossMemberInfo
// ============================================================================

test('getLagCrossMemberInfo: meno di 2 pid -> non cross', () => {
    const nodes = [member('sw1', 'stk-1', 1)];
    const res = getLagCrossMemberInfo(nodes, ['sw1-24'], pid => pid.split('-')[0]);
    assert.equal(res.isCross, false);
});

test('getLagCrossMemberInfo: tutti pid sullo stesso device -> non cross', () => {
    const nodes = [member('sw1', 'stk-1', 1)];
    const res = getLagCrossMemberInfo(nodes, ['sw1-23', 'sw1-24'], pid => pid.split('-')[0]);
    assert.equal(res.isCross, false);
});

test('getLagCrossMemberInfo: 2 device dello stesso stack -> cross', () => {
    const nodes = [
        member('sw1', 'stk-core', 1),
        member('sw2', 'stk-core', 2),
    ];
    const res = getLagCrossMemberInfo(nodes, ['sw1-24', 'sw2-24'], pid => pid.split('-')[0]);
    assert.equal(res.isCross, true);
    assert.equal(res.stackId, 'stk-core');
    assert.deepEqual(res.memberIds, ['sw1', 'sw2']);
});

test('getLagCrossMemberInfo: 3 device dello stesso stack -> cross', () => {
    const nodes = [
        member('sw1', 'stk-core', 1),
        member('sw2', 'stk-core', 2),
        member('sw3', 'stk-core', 3),
    ];
    const res = getLagCrossMemberInfo(nodes,
        ['sw1-24', 'sw2-24', 'sw3-24'],
        pid => pid.split('-')[0]);
    assert.equal(res.isCross, true);
    assert.equal(res.stackId, 'stk-core');
    assert.deepEqual(res.memberIds, ['sw1', 'sw2', 'sw3']);
});

test('getLagCrossMemberInfo: device in stack diversi -> NON cross', () => {
    const nodes = [
        member('sw1', 'stk-A', 1),
        member('sw2', 'stk-B', 1),
    ];
    const res = getLagCrossMemberInfo(nodes, ['sw1-24', 'sw2-24'], pid => pid.split('-')[0]);
    assert.equal(res.isCross, false, 'stack diversi non e\' cross-member');
});

test('getLagCrossMemberInfo: un device standalone -> NON cross', () => {
    const nodes = [
        member('sw1', 'stk-1', 1),
        standalone('sw2'),
    ];
    const res = getLagCrossMemberInfo(nodes, ['sw1-24', 'sw2-24'], pid => pid.split('-')[0]);
    assert.equal(res.isCross, false, 'mix stack+standalone non e\' cross-member');
});

test('getLagCrossMemberInfo: pidToNodeId mancante -> non cross', () => {
    const nodes = [member('sw1', 'stk-1', 1), member('sw2', 'stk-1', 2)];
    const res = getLagCrossMemberInfo(nodes, ['sw1-24', 'sw2-24'], null);
    assert.equal(res.isCross, false);
});

// ============================================================================
// P7.2 Tappa B — propagateMasterToMembers
// ============================================================================

test('propagateMasterToMembers: master non in stack -> []', () => {
    const nodes = [standalone('sw1')];
    assert.deepEqual(propagateMasterToMembers(nodes, nodes[0]), []);
});

test('propagateMasterToMembers: nodo non master -> []', () => {
    const nodes = [
        member('sw1', 'stk-1', 1),
        member('sw2', 'stk-1', 2),
    ];
    // sw2 e' membro, non master
    assert.deepEqual(propagateMasterToMembers(nodes, nodes[1]), []);
});

test('propagateMasterToMembers: propaga hostname/ip/mac ai membri', () => {
    const master = {
        id: 'sw1', type: 'switch', spec: { stackId: 'stk-1', stackMemberId: 1 },
        hostname: 'core01.lan', ip: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:01',
    };
    const m2 = {
        id: 'sw2', type: 'switch', spec: { stackId: 'stk-1', stackMemberId: 2 },
        hostname: 'old.lan', ip: '0.0.0.0',
    };
    const m3 = {
        id: 'sw3', type: 'switch', spec: { stackId: 'stk-1', stackMemberId: 3 },
    };
    const nodes = [master, m2, m3];
    const changed = propagateMasterToMembers(nodes, master);
    assert.equal(changed.length, 2);
    assert.equal(m2.hostname, 'core01.lan');
    assert.equal(m2.ip, '192.168.1.10');
    assert.equal(m2.mac, 'aa:bb:cc:dd:ee:01');
    assert.equal(m3.hostname, 'core01.lan');
});

test('propagateMasterToMembers: propaga integration.* ai membri', () => {
    const master = {
        id: 'sw1', type: 'switch', spec: { stackId: 'stk-1', stackMemberId: 1 },
        integration: { driver: 'snmp-v2c', community: 'public', port: 161 },
    };
    const m2 = {
        id: 'sw2', type: 'switch', spec: { stackId: 'stk-1', stackMemberId: 2 },
    };
    const nodes = [master, m2];
    const changed = propagateMasterToMembers(nodes, master);
    assert.equal(changed.length, 1);
    assert.equal(m2.integration.driver, 'snmp-v2c');
    assert.equal(m2.integration.community, 'public');
    assert.equal(m2.integration.port, 161);
});

test('propagateMasterToMembers: non sovrascrive con undefined (master non ha quel campo)', () => {
    const master = {
        id: 'sw1', type: 'switch', spec: { stackId: 'stk-1', stackMemberId: 1 },
        hostname: 'core01.lan',
        // master non ha ip esplicito
    };
    const m2 = {
        id: 'sw2', type: 'switch', spec: { stackId: 'stk-1', stackMemberId: 2 },
        ip: '192.168.1.99',
    };
    const nodes = [master, m2];
    propagateMasterToMembers(nodes, master);
    assert.equal(m2.hostname, 'core01.lan');
    assert.equal(m2.ip, '192.168.1.99', 'ip del membro NON sovrascritto');
});

test('STACK_SHARED_FIELDS contiene i campi base condivisi', () => {
    assert.ok(STACK_SHARED_FIELDS.includes('hostname'));
    assert.ok(STACK_SHARED_FIELDS.includes('ip'));
    assert.ok(STACK_SHARED_FIELDS.includes('mac'));
});

test('STACK_SHARED_INTEGRATION_FIELDS contiene i campi SNMP', () => {
    assert.ok(STACK_SHARED_INTEGRATION_FIELDS.includes('driver'));
    assert.ok(STACK_SHARED_INTEGRATION_FIELDS.includes('community'));
    assert.ok(STACK_SHARED_INTEGRATION_FIELDS.includes('host'));
});

// ============================================================================
// P7.3 Tappa C — detectStackFromInterfaces (auto-detection da SNMP)
// ============================================================================

test('detectStackFromInterfaces: input vuoto o non-array -> non rilevato', () => {
    assert.equal(detectStackFromInterfaces([]).stackDetected, false);
    assert.equal(detectStackFromInterfaces(null).stackDetected, false);
    assert.equal(detectStackFromInterfaces(undefined).stackDetected, false);
    assert.equal(detectStackFromInterfaces('Gi1/0/1').stackDetected, false);
});

test('detectStackFromInterfaces: standalone Cisco (Gi0/X) -> non rilevato', () => {
    // Catalyst 2960X standalone: tutte le porte hanno member=0
    const ifaces = ['GigabitEthernet0/1', 'GigabitEthernet0/2', 'GigabitEthernet0/24'];
    const res = detectStackFromInterfaces(ifaces);
    assert.equal(res.stackDetected, false);
    assert.deepEqual(res.memberIds, []);
});

test('detectStackFromInterfaces: standalone Cisco IOSv (Gi0/X) -> non rilevato', () => {
    // IOSvL2 / IOS Router: pattern 2-segment "Gi0/N" senza 3-segment
    const ifaces = ['GigabitEthernet0/0', 'GigabitEthernet0/1', 'GigabitEthernet0/2'];
    const res = detectStackFromInterfaces(ifaces);
    assert.equal(res.stackDetected, false);
});

test('detectStackFromInterfaces: stack Cisco StackWise 2 membri -> rilevato', () => {
    const ifaces = [
        'GigabitEthernet1/0/1', 'GigabitEthernet1/0/2', 'GigabitEthernet1/0/24',
        'GigabitEthernet2/0/1', 'GigabitEthernet2/0/2', 'GigabitEthernet2/0/24',
    ];
    const res = detectStackFromInterfaces(ifaces);
    assert.equal(res.stackDetected, true);
    assert.deepEqual(res.memberIds, [1, 2]);
    assert.equal(res.suggestedFormat, 'cisco-iosxe');
    assert.equal(res.sampleNames[0], 'GigabitEthernet1/0/1');
    assert.equal(res.sampleNames[1], 'GigabitEthernet2/0/1');
});

test('detectStackFromInterfaces: stack Cisco StackWise 3 membri short form -> rilevato', () => {
    const ifaces = [
        'Gi1/0/1', 'Gi1/0/24', 'Te1/1/1',
        'Gi2/0/1', 'Gi2/0/24', 'Te2/1/1',
        'Gi3/0/1', 'Gi3/0/24', 'Te3/1/1',
    ];
    const res = detectStackFromInterfaces(ifaces);
    assert.equal(res.stackDetected, true);
    assert.deepEqual(res.memberIds, [1, 2, 3]);
    assert.equal(res.suggestedFormat, 'cisco-iosxe');
});

test('detectStackFromInterfaces: Aruba CX VSF 2 membri -> rilevato', () => {
    const ifaces = ['1/1/1', '1/1/24', '1/1/25', '2/1/1', '2/1/24'];
    const res = detectStackFromInterfaces(ifaces);
    assert.equal(res.stackDetected, true);
    assert.deepEqual(res.memberIds, [1, 2]);
    assert.equal(res.suggestedFormat, 'aruba-cx');
});

test('detectStackFromInterfaces: Aruba CX 6300M standalone (1/1/X) -> non rilevato (solo member 1)', () => {
    // Singolo CX 6300M: member=1 ovunque, NON e' uno stack
    const ifaces = ['1/1/1', '1/1/24', '1/1/48'];
    const res = detectStackFromInterfaces(ifaces);
    assert.equal(res.stackDetected, false);
    assert.deepEqual(res.memberIds, [1]);
});

test('detectStackFromInterfaces: Juniper Virtual Chassis -> rilevato', () => {
    const ifaces = [
        'ge-0/0/0', 'ge-0/0/24',  // member 0 (slot only, no stack)
        'ge-1/0/0', 'ge-1/0/24',  // member 1
        'ge-2/0/0', 'ge-2/0/24',  // member 2
    ];
    const res = detectStackFromInterfaces(ifaces);
    assert.equal(res.stackDetected, true);
    assert.deepEqual(res.memberIds, [1, 2]);
    assert.equal(res.suggestedFormat, 'juniper-vc');
});

test('detectStackFromInterfaces: Arista cEOS/7300 multi-member -> rilevato', () => {
    const ifaces = [
        'Ethernet1/1/1', 'Ethernet1/1/24',
        'Ethernet2/1/1', 'Ethernet2/1/24',
        'Ethernet3/1/1',
    ];
    const res = detectStackFromInterfaces(ifaces);
    assert.equal(res.stackDetected, true);
    assert.deepEqual(res.memberIds, [1, 2, 3]);
    assert.equal(res.suggestedFormat, 'arista');
});

test('detectStackFromInterfaces: Arista standalone 7050 (Ethernet1, Ethernet2) -> non rilevato', () => {
    const ifaces = ['Ethernet1', 'Ethernet2', 'Ethernet48'];
    const res = detectStackFromInterfaces(ifaces);
    assert.equal(res.stackDetected, false);
});

test('detectStackFromInterfaces: stack non-contiguo (1, 3, 5) -> rilevato', () => {
    // Caso reale: stack con buchi (member 2 e 4 eliminati o offline)
    const ifaces = [
        'Gi1/0/1', 'Gi1/0/24',
        'Gi3/0/1', 'Gi3/0/24',
        'Gi5/0/1', 'Gi5/0/24',
    ];
    const res = detectStackFromInterfaces(ifaces);
    assert.equal(res.stackDetected, true);
    assert.deepEqual(res.memberIds, [1, 3, 5]);
});

test('detectStackFromInterfaces: input misti (validi + invalidi) -> ignora invalidi', () => {
    const ifaces = [
        'GigabitEthernet1/0/1',
        null,                        // skippato
        undefined,                   // skippato
        '',                          // skippato (trim vuoto)
        'GigabitEthernet2/0/1',
        42,                          // skippato (non-string)
        'Vlan100',                   // skippato (non matcha alcun pattern)
        'Loopback0',                 // skippato
        'GigabitEthernet3/0/1',
    ];
    const res = detectStackFromInterfaces(ifaces);
    assert.equal(res.stackDetected, true);
    assert.deepEqual(res.memberIds, [1, 2, 3]);
});

test('detectStackFromInterfaces: stack di 9 membri (max StackWise Plus) -> tutti rilevati', () => {
    const ifaces = [];
    for (let m = 1; m <= 9; m++) {
        ifaces.push(`GigabitEthernet${m}/0/1`);
        ifaces.push(`GigabitEthernet${m}/0/24`);
    }
    const res = detectStackFromInterfaces(ifaces);
    assert.equal(res.stackDetected, true);
    assert.equal(res.memberIds.length, 9);
    assert.deepEqual(res.memberIds, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

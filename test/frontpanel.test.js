// Test per lib/frontpanel.js — normalizzazione stato front-panel.
// Copre: clamp/default SFP+MGMT, back-compat (mgmtPort:true, numberTop/oddTop,
// layout legacy), filtraggio MGMT su tipi non eligibili, label trim/default.
const test = require('node:test');
const assert = require('node:assert/strict');
const { frontPanelState, frontPanelLegacyState, frontPanelPortLabel, frontPanelSfpGroups } = require('../lib/frontpanel.js');

// ============================================================================
// frontPanelState — stato canonico
// ============================================================================

test('frontPanelState: device senza frontPanel -> defaults sani', () => {
    const s = frontPanelState({ type: 'switch' }, 24, true);
    assert.equal(s.baseLayout, 'auto');
    assert.equal(s.oneBottom, false);
    assert.equal(s.numberTop, true);
    assert.equal(s.oddTop, true);
    assert.equal(s.separateSfp, false);
    assert.equal(s.sfpRight, true);
    assert.equal(s.sfpCount, 0);
    assert.equal(s.mgmtEligible, true);
    assert.equal(s.mgmtCount, 0);
    assert.equal(s.mgmtPort, false);
    assert.equal(s.mgmtPosition, 'left');
    assert.equal(s.mgmtLabel, 'MGMT');
    assert.equal(s.portCount, 24);
});

test('frontPanelState: mgmtEligible=false forza mgmtCount=0 anche se settato', () => {
    const n = { type: 'patchpanel', frontPanel: { mgmtCount: 3 } };
    const s = frontPanelState(n, 24, false);
    assert.equal(s.mgmtEligible, false);
    assert.equal(s.mgmtCount, 0);
    assert.equal(s.mgmtPort, false);
});

test('frontPanelState: clamp mgmtCount 0..4', () => {
    const make = (v) => frontPanelState({ type: 'switch', frontPanel: { mgmtCount: v } }, 24, true);
    assert.equal(make(-5).mgmtCount, 0);
    assert.equal(make(0).mgmtCount, 0);
    assert.equal(make(2).mgmtCount, 2);
    assert.equal(make(4).mgmtCount, 4);
    assert.equal(make(99).mgmtCount, 4);
    assert.equal(make('3').mgmtCount, 3);
    assert.equal(make('abc').mgmtCount, 0);
});

test('frontPanelState: back-compat mgmtPort:true -> mgmtCount:1', () => {
    const n = { type: 'switch', frontPanel: { mgmtPort: true } };
    const s = frontPanelState(n, 24, true);
    assert.equal(s.mgmtCount, 1);
    assert.equal(s.mgmtPort, true);
});

test('frontPanelState: mgmtCount esplicito vince su mgmtPort legacy', () => {
    const n = { type: 'switch', frontPanel: { mgmtPort: true, mgmtCount: 3 } };
    const s = frontPanelState(n, 24, true);
    assert.equal(s.mgmtCount, 3);
});

test('frontPanelState: mgmtPort:false legacy -> mgmtCount:0', () => {
    const n = { type: 'switch', frontPanel: { mgmtPort: false } };
    const s = frontPanelState(n, 24, true);
    assert.equal(s.mgmtCount, 0);
});

test('frontPanelState: mgmtPosition right rispettato; left default', () => {
    const sLeft  = frontPanelState({ type: 'switch', frontPanel: { mgmtCount: 1, mgmtPosition: 'left'  } }, 24, true);
    const sRight = frontPanelState({ type: 'switch', frontPanel: { mgmtCount: 1, mgmtPosition: 'right' } }, 24, true);
    const sUnk   = frontPanelState({ type: 'switch', frontPanel: { mgmtCount: 1, mgmtPosition: 'top'   } }, 24, true);
    const sNone  = frontPanelState({ type: 'switch', frontPanel: { mgmtCount: 1                          } }, 24, true);
    assert.equal(sLeft.mgmtPosition,  'left');
    assert.equal(sRight.mgmtPosition, 'right');
    assert.equal(sUnk.mgmtPosition,   'left',  'valori sconosciuti -> default left');
    assert.equal(sNone.mgmtPosition,  'left',  'assenza -> default left');
});

test('frontPanelState: mgmtLabel trim + fallback MGMT su empty/whitespace', () => {
    const cases = [
        [undefined,     'MGMT'],
        ['',            'MGMT'],
        ['   ',         'MGMT'],
        ['iLO',         'iLO'],
        ['  iDRAC  ',   'iDRAC'],
        ['Gi0/0',       'Gi0/0'],
        ['me0',         'me0'],
        [42,            'MGMT'],  // non-string -> fallback
    ];
    for (const [input, expected] of cases) {
        const fp = input === undefined ? { mgmtCount: 1 } : { mgmtCount: 1, mgmtLabel: input };
        const s = frontPanelState({ type: 'switch', frontPanel: fp }, 24, true);
        assert.equal(s.mgmtLabel, expected, `input ${JSON.stringify(input)}`);
    }
});

// ============================================================================
// SFP block
// ============================================================================

test('frontPanelState: sfpCount clamp 0..48', () => {
    const make = (v, sep=true) => frontPanelState({ type: 'switch', frontPanel: { separateSfp: sep, sfpCount: v } }, 96, true);
    assert.equal(make(-2).sfpCount, 0);
    assert.equal(make(0).sfpCount, 0);
    assert.equal(make(4).sfpCount, 4);
    assert.equal(make(24).sfpCount, 24);
    assert.equal(make(48).sfpCount, 48);
    assert.equal(make(99).sfpCount, 48);
    assert.equal(make('6').sfpCount, 6);
});

test('frontPanelState: sfpCount default a 4 quando separateSfp:true ma sfpCount assente', () => {
    const n = { type: 'switch', frontPanel: { separateSfp: true } };
    const s = frontPanelState(n, 24, true);
    assert.equal(s.sfpCount, 4);
    assert.equal(s.separateSfp, true);
});

test('frontPanelState: sfpRight default true; false rispettato', () => {
    const sDef  = frontPanelState({ type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4                  } }, 24, true);
    const sLeft = frontPanelState({ type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4, sfpRight: false } }, 24, true);
    assert.equal(sDef.sfpRight,  true);
    assert.equal(sLeft.sfpRight, false);
});

// ============================================================================
// oneBottom unification
// ============================================================================

test('frontPanelState: oneBottom esplicito vince', () => {
    const sTrue  = frontPanelState({ type: 'switch', frontPanel: { oneBottom: true  } }, 24, true);
    const sFalse = frontPanelState({ type: 'switch', frontPanel: { oneBottom: false } }, 24, true);
    assert.equal(sTrue.oneBottom, true);
    assert.equal(sTrue.numberTop, false);
    assert.equal(sTrue.oddTop, false);
    assert.equal(sFalse.oneBottom, false);
    assert.equal(sFalse.numberTop, true);
    assert.equal(sFalse.oddTop, true);
});

test('frontPanelState: back-compat numberTop:false -> oneBottom:true', () => {
    const s = frontPanelState({ type: 'switch', frontPanel: { numberTop: false } }, 24, true);
    assert.equal(s.oneBottom, true);
});

test('frontPanelState: back-compat oddTop:false -> oneBottom:true', () => {
    const s = frontPanelState({ type: 'switch', frontPanel: { oddTop: false } }, 24, true);
    assert.equal(s.oneBottom, true);
});

test('frontPanelState: nessun flag -> oneBottom:false (default storico)', () => {
    const s = frontPanelState({ type: 'switch', frontPanel: {} }, 24, true);
    assert.equal(s.oneBottom, false);
});

// ============================================================================
// baseLayout
// ============================================================================

test('frontPanelState: baseLayout passa attraverso', () => {
    for (const layout of ['auto', 'linear', 'sequential', 'alternating']) {
        const s = frontPanelState({ type: 'switch', frontPanel: { baseLayout: layout } }, 24, true);
        assert.equal(s.baseLayout, layout);
    }
});

test('frontPanelState: legacy `layout` (pre-baseLayout) -> dispatch a frontPanelLegacyState', () => {
    const s = frontPanelState({ type: 'switch', frontPanel: { layout: 'twoRowOddEven' } }, 24, true);
    assert.equal(s.baseLayout, 'alternating');
    assert.equal(s.oddTop, true);
});

test('frontPanelState: portCount eredita dall argomento', () => {
    const s24 = frontPanelState({ type: 'switch' }, 24, true);
    const s48 = frontPanelState({ type: 'switch' }, 48, true);
    const s0  = frontPanelState({ type: 'switch' }, 0,  true);
    assert.equal(s24.portCount, 24);
    assert.equal(s48.portCount, 48);
    assert.equal(s0.portCount,  0);
});

// ============================================================================
// frontPanelLegacyState (pre-`baseLayout` projects)
// ============================================================================

test('frontPanelLegacyState: layout linear', () => {
    const s = frontPanelLegacyState({ layout: 'linear' }, 8);
    assert.equal(s.baseLayout, 'linear');
    assert.equal(s.portCount, 8);
    assert.equal(s.separateSfp, false);
});

test('frontPanelLegacyState: layout twoRowSequential', () => {
    const s = frontPanelLegacyState({ layout: 'twoRowSequential' }, 24);
    assert.equal(s.baseLayout, 'sequential');
});

test('frontPanelLegacyState: layout twoRowOddEven (Cisco standard)', () => {
    const s = frontPanelLegacyState({ layout: 'twoRowOddEven' }, 48);
    assert.equal(s.baseLayout, 'alternating');
    assert.equal(s.oddTop, true);
});

test('frontPanelLegacyState: layout twoRowEvenOdd (invertito)', () => {
    const s = frontPanelLegacyState({ layout: 'twoRowEvenOdd' }, 48);
    assert.equal(s.baseLayout, 'alternating');
    assert.equal(s.oddTop, false);
});

test('frontPanelLegacyState: layout uplink24/uplink48 -> alternating + 4 SFP', () => {
    const s24 = frontPanelLegacyState({ layout: 'uplink24' }, 28);
    const s48 = frontPanelLegacyState({ layout: 'uplink48' }, 52);
    assert.equal(s24.baseLayout, 'alternating');
    assert.equal(s24.separateSfp, true);
    assert.equal(s24.sfpCount, 4);
    assert.equal(s48.separateSfp, true);
    assert.equal(s48.sfpCount, 4);
});

test('frontPanelLegacyState: layout sconosciuto -> auto defaults', () => {
    const s = frontPanelLegacyState({ layout: 'xyz' }, 24);
    assert.equal(s.baseLayout, 'auto');
    assert.equal(s.separateSfp, false);
});

test('frontPanelLegacyState: fp=null/undefined -> auto safe defaults', () => {
    const sNull  = frontPanelLegacyState(null, 24);
    const sUndef = frontPanelLegacyState(undefined, 24);
    assert.equal(sNull.baseLayout, 'auto');
    assert.equal(sUndef.baseLayout, 'auto');
    assert.equal(sNull.portCount, 24);
});

// ============================================================================
// Integrazione: scenari realistici end-to-end
// ============================================================================

test('scenario: switch 24-porte Cisco standard con MGMT + 4 SFP', () => {
    const n = {
        type: 'switch',
        frontPanel: {
            baseLayout: 'alternating',
            separateSfp: true,
            sfpCount: 4,
            sfpRight: true,
            mgmtCount: 1,
            mgmtPosition: 'left',
        },
    };
    const s = frontPanelState(n, 28, true);
    assert.equal(s.baseLayout, 'alternating');
    assert.equal(s.sfpCount, 4);
    assert.equal(s.sfpRight, true);
    assert.equal(s.mgmtCount, 1);
    assert.equal(s.mgmtPosition, 'left');
    assert.equal(s.mgmtLabel, 'MGMT');
    assert.equal(s.portCount, 28);
});

test('scenario: server Dell con iDRAC come MGMT', () => {
    const n = {
        type: 'server',
        frontPanel: { mgmtCount: 1, mgmtLabel: 'iDRAC' },
    };
    const s = frontPanelState(n, 4, true);
    assert.equal(s.mgmtCount, 1);
    assert.equal(s.mgmtLabel, 'iDRAC');
});

test('scenario: progetto vecchio con mgmtPort:true + sfpCount esplicito', () => {
    // Simula un progetto salvato prima dell\'introduzione di mgmtCount
    const n = {
        type: 'switch',
        frontPanel: { mgmtPort: true, separateSfp: true, sfpCount: 2 },
    };
    const s = frontPanelState(n, 26, true);
    assert.equal(s.mgmtCount, 1, 'mgmtPort:true legge come count=1');
    assert.equal(s.sfpCount, 2);
});

test('scenario: patchpanel non eligibile MGMT', () => {
    const n = {
        type: 'patchpanel',
        frontPanel: { mgmtCount: 2, mgmtLabel: 'tentativo-hack' },
    };
    const s = frontPanelState(n, 24, false);
    assert.equal(s.mgmtCount, 0);
    assert.equal(s.mgmtEligible, false);
});

// ============================================================================
// SFP independent numbering — sfpStartNum + sfpPrefix
// ============================================================================

test('frontPanelState: sfpStartNum default null (numerazione continuata)', () => {
    const s = frontPanelState({ type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4 } }, 28, true);
    assert.equal(s.sfpStartNum, null);
    assert.equal(s.sfpPrefix, '');
});

test('frontPanelState: sfpStartNum esplicito 1 -> riparte da 1', () => {
    const s = frontPanelState({ type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4, sfpStartNum: 1 } }, 28, true);
    assert.equal(s.sfpStartNum, 1);
});

test('frontPanelState: sfpStartNum clamp >= 1 e <= 999', () => {
    const make = (v) => frontPanelState({ type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4, sfpStartNum: v } }, 28, true);
    assert.equal(make(-5).sfpStartNum, null);
    assert.equal(make(0).sfpStartNum, null);
    assert.equal(make(1).sfpStartNum, 1);
    assert.equal(make(49).sfpStartNum, 49);
    assert.equal(make(999).sfpStartNum, 999);
    assert.equal(make(1000).sfpStartNum, null);
    assert.equal(make('abc').sfpStartNum, null);
});

test('frontPanelState: sfpPrefix trim + clamp 6 caratteri', () => {
    const cases = [
        [undefined, ''],
        ['',       ''],
        ['  ',     ''],
        ['Te',     'Te'],
        ['  xe ',  'xe'],
        ['Fortyy', 'Fortyy'],
        ['VeryLong', 'VeryLo'],  // clamp a 6
        [42,       ''],          // non-string
    ];
    for (const [input, expected] of cases) {
        const fp = input === undefined ? { separateSfp: true, sfpCount: 4 } : { separateSfp: true, sfpCount: 4, sfpPrefix: input };
        const s = frontPanelState({ type: 'switch', frontPanel: fp }, 28, true);
        assert.equal(s.sfpPrefix, expected, `input ${JSON.stringify(input)}`);
    }
});

// ============================================================================
// frontPanelPortLabel — label generation
// ============================================================================

test('frontPanelPortLabel: porta normale -> numero', () => {
    const n = { type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4 } };
    assert.equal(frontPanelPortLabel(n, 5, 28, true), '5');
    assert.equal(frontPanelPortLabel(n, 24, 28, true), '24');
});

test('frontPanelPortLabel: SFP senza custom -> numerazione continuata (default)', () => {
    const n = { type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4 } };
    // SFP sono porte 25-28, default continuate
    assert.equal(frontPanelPortLabel(n, 25, 28, true), '25');
    assert.equal(frontPanelPortLabel(n, 28, 28, true), '28');
});

test('frontPanelPortLabel: sfpStartNum=1 -> SFP riparte da 1', () => {
    const n = { type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4, sfpStartNum: 1 } };
    assert.equal(frontPanelPortLabel(n, 25, 28, true), '1');
    assert.equal(frontPanelPortLabel(n, 26, 28, true), '2');
    assert.equal(frontPanelPortLabel(n, 27, 28, true), '3');
    assert.equal(frontPanelPortLabel(n, 28, 28, true), '4');
});

test('frontPanelPortLabel: sfpStartNum=1 + sfpPrefix=Te -> Te1..Te4 (Cisco Cat 9300)', () => {
    const n = { type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4, sfpStartNum: 1, sfpPrefix: 'Te' } };
    assert.equal(frontPanelPortLabel(n, 25, 28, true), 'Te1');
    assert.equal(frontPanelPortLabel(n, 26, 28, true), 'Te2');
    assert.equal(frontPanelPortLabel(n, 27, 28, true), 'Te3');
    assert.equal(frontPanelPortLabel(n, 28, 28, true), 'Te4');
});

test('frontPanelPortLabel: sfpStartNum=49 + sfpPrefix=Hu -> Hu49..Hu52 (Cisco 9500-48Y)', () => {
    const n = { type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4, sfpStartNum: 49, sfpPrefix: 'Hu' } };
    assert.equal(frontPanelPortLabel(n, 49, 52, true), 'Hu49');
    assert.equal(frontPanelPortLabel(n, 50, 52, true), 'Hu50');
    assert.equal(frontPanelPortLabel(n, 51, 52, true), 'Hu51');
    assert.equal(frontPanelPortLabel(n, 52, 52, true), 'Hu52');
});

test('frontPanelPortLabel: prefisso senza startNum -> usa continuata + prefisso', () => {
    const n = { type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4, sfpPrefix: 'SFP' } };
    assert.equal(frontPanelPortLabel(n, 25, 28, true), 'SFP25');
});

test('frontPanelPortLabel: prefisso "xe" + restart -> xe1..xe4 (Juniper EX)', () => {
    const n = { type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4, sfpStartNum: 1, sfpPrefix: 'xe' } };
    assert.equal(frontPanelPortLabel(n, 25, 28, true), 'xe1');
    assert.equal(frontPanelPortLabel(n, 28, 28, true), 'xe4');
});

test('frontPanelPortLabel: prefisso "sfp-sfpplus" + restart -> MikroTik CRS', () => {
    const n = { type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4, sfpStartNum: 1, sfpPrefix: 'sfp' } };
    assert.equal(frontPanelPortLabel(n, 25, 28, true), 'sfp1');
});

test('frontPanelPortLabel: porta NON SFP non viene mai trasformata', () => {
    const n = { type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4, sfpStartNum: 1, sfpPrefix: 'Te' } };
    // porte 1-24 sono dati, non SFP
    assert.equal(frontPanelPortLabel(n, 1, 28, true), '1');
    assert.equal(frontPanelPortLabel(n, 24, 28, true), '24');
});

test('frontPanelPortLabel: separateSfp=false -> tutte le porte sono "normali"', () => {
    const n = { type: 'switch', frontPanel: { sfpStartNum: 1, sfpPrefix: 'Te' } };
    // sfpStartNum/sfpPrefix sono presenti ma separateSfp false -> ignorati
    assert.equal(frontPanelPortLabel(n, 25, 28, true), '25');
});

test('frontPanelPortLabel: portNum non finito -> string fallback', () => {
    const n = { type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4 } };
    assert.equal(frontPanelPortLabel(n, 'abc', 28, true), 'abc');
});

// ============================================================================
// Scenari realistici enterprise
// ============================================================================

test('scenario: Cisco Catalyst 9300-24P (24 data + 4 SFP+ Te1/1/1-4)', () => {
    const n = { type: 'switch', frontPanel: {
        separateSfp: true, sfpCount: 4, sfpRight: true,
        sfpStartNum: 1, sfpPrefix: 'Te',
    } };
    // Data ports: 1-24
    assert.equal(frontPanelPortLabel(n, 1,  28, true), '1');
    assert.equal(frontPanelPortLabel(n, 24, 28, true), '24');
    // SFP+ uplinks: Te1, Te2, Te3, Te4
    assert.equal(frontPanelPortLabel(n, 25, 28, true), 'Te1');
    assert.equal(frontPanelPortLabel(n, 28, 28, true), 'Te4');
});

test('scenario: Cisco Catalyst 9500-48Y (48 SFP28 25G + 4 QSFP28 100G Hu49-52)', () => {
    const n = { type: 'switch', frontPanel: {
        separateSfp: true, sfpCount: 4, sfpRight: true,
        sfpStartNum: 49, sfpPrefix: 'Hu',
    } };
    // Data (25G SFP): 1-48
    assert.equal(frontPanelPortLabel(n, 1,  52, true), '1');
    assert.equal(frontPanelPortLabel(n, 48, 52, true), '48');
    // QSFP28 100G uplinks
    assert.equal(frontPanelPortLabel(n, 49, 52, true), 'Hu49');
    assert.equal(frontPanelPortLabel(n, 52, 52, true), 'Hu52');
});

test('scenario: MikroTik CRS328-24P-4S+ (24 ether + 4 sfp-sfpplus)', () => {
    const n = { type: 'switch', frontPanel: {
        separateSfp: true, sfpCount: 4, sfpRight: true,
        sfpStartNum: 1, sfpPrefix: 'sfp',
    } };
    assert.equal(frontPanelPortLabel(n, 24, 28, true), '24');
    assert.equal(frontPanelPortLabel(n, 25, 28, true), 'sfp1');
    assert.equal(frontPanelPortLabel(n, 28, 28, true), 'sfp4');
});

test('scenario: Aruba CX 6300M-24G-4SFP56 (numerazione continuata 1/1/N)', () => {
    // Aruba CX usa numerazione continuata 1/1/1..28 — default nostro
    const n = { type: 'switch', frontPanel: {
        separateSfp: true, sfpCount: 4, sfpRight: true,
        // niente sfpStartNum/sfpPrefix -> continuata
    } };
    assert.equal(frontPanelPortLabel(n, 25, 28, true), '25');
    assert.equal(frontPanelPortLabel(n, 28, 28, true), '28');
});

// ============================================================================
// Secondo blocco SFP (sfp2Count / sfp2StartNum / sfp2Prefix)
// ============================================================================

test('frontPanelState: sfp2Count default 0', () => {
    const s = frontPanelState({ type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4 } }, 28, true);
    assert.equal(s.sfp2Count, 0);
    assert.equal(s.sfp2StartNum, null);
    assert.equal(s.sfp2Prefix, '');
});

test('frontPanelState: sfp2Count clamp 0..48', () => {
    const make = (v) => frontPanelState({ type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4, sfp2Count: v } }, 100, true);
    assert.equal(make(-5).sfp2Count, 0);
    assert.equal(make(0).sfp2Count, 0);
    assert.equal(make(4).sfp2Count, 4);
    assert.equal(make(24).sfp2Count, 24);
    assert.equal(make(48).sfp2Count, 48);
    assert.equal(make(99).sfp2Count, 48);
});

test('frontPanelState: sfp2 startNum + prefix paralleli a sfp1', () => {
    const s = frontPanelState({ type: 'switch', frontPanel: {
        separateSfp: true, sfpCount: 4, sfp2Count: 4,
        sfpStartNum: 1, sfpPrefix: 'Te',
        sfp2StartNum: 49, sfp2Prefix: 'Hu',
    } }, 32, true);
    assert.equal(s.sfpStartNum, 1);
    assert.equal(s.sfpPrefix, 'Te');
    assert.equal(s.sfp2StartNum, 49);
    assert.equal(s.sfp2Prefix, 'Hu');
});

test('frontPanelSfpGroups: nessun blocco -> []', () => {
    const groups = frontPanelSfpGroups({ type: 'switch' }, 24, true);
    assert.deepEqual(groups, []);
});

test('frontPanelSfpGroups: solo sfp1 -> 1 gruppo', () => {
    const groups = frontPanelSfpGroups({ type: 'switch', frontPanel: { separateSfp: true, sfpCount: 4 } }, 28, true);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].ports, [25, 26, 27, 28]);
});

test('frontPanelSfpGroups: sfp1 + sfp2 -> 2 gruppi distinti', () => {
    const groups = frontPanelSfpGroups({ type: 'switch', frontPanel: {
        separateSfp: true, sfpCount: 4, sfp2Count: 4,
        sfpStartNum: 1, sfpPrefix: 'Te',
        sfp2StartNum: 49, sfp2Prefix: 'Hu',
    } }, 32, true);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].ports, [25, 26, 27, 28]);
    assert.equal(groups[0].prefix, 'Te');
    assert.equal(groups[0].startNum, 1);
    assert.deepEqual(groups[1].ports, [29, 30, 31, 32]);
    assert.equal(groups[1].prefix, 'Hu');
    assert.equal(groups[1].startNum, 49);
});

test('frontPanelPortLabel: porte block 1 e block 2 con prefisso diverso', () => {
    const n = { type: 'switch', frontPanel: {
        separateSfp: true, sfpCount: 4, sfp2Count: 4,
        sfpStartNum: 1, sfpPrefix: 'Te',
        sfp2StartNum: 49, sfp2Prefix: 'Hu',
    } };
    // Data: 1..24
    assert.equal(frontPanelPortLabel(n, 1,  32, true), '1');
    assert.equal(frontPanelPortLabel(n, 24, 32, true), '24');
    // Block 1: porte 25-28 -> Te1-Te4
    assert.equal(frontPanelPortLabel(n, 25, 32, true), 'Te1');
    assert.equal(frontPanelPortLabel(n, 28, 32, true), 'Te4');
    // Block 2: porte 29-32 -> Hu49-Hu52
    assert.equal(frontPanelPortLabel(n, 29, 32, true), 'Hu49');
    assert.equal(frontPanelPortLabel(n, 32, 32, true), 'Hu52');
});

test('frontPanelPortLabel: 2 blocchi con numerazione continuata (default)', () => {
    // Senza startNum/prefix custom, entrambi continuano dalla numerazione naturale
    const n = { type: 'switch', frontPanel: {
        separateSfp: true, sfpCount: 4, sfp2Count: 4,
    } };
    assert.equal(frontPanelPortLabel(n, 25, 32, true), '25');
    assert.equal(frontPanelPortLabel(n, 28, 32, true), '28');
    assert.equal(frontPanelPortLabel(n, 29, 32, true), '29');
    assert.equal(frontPanelPortLabel(n, 32, 32, true), '32');
});

// ============================================================================
// Scenari realistici 2 blocchi enterprise
// ============================================================================

test('scenario: Cisco Catalyst 9300X-24Y4D (24 data + 4 SFP28 Te + 4 QSFP28 Hu)', () => {
    const n = { type: 'switch', frontPanel: {
        separateSfp: true, sfpRight: true,
        sfpCount: 4,  sfpStartNum: 1,  sfpPrefix: 'Te',
        sfp2Count: 4, sfp2StartNum: 49, sfp2Prefix: 'Hu',
    } };
    // 24 data + 4 SFP28 (Te1-Te4) + 4 QSFP28 (Hu49-Hu52) = 32 ports total
    assert.equal(frontPanelPortLabel(n, 1,  32, true), '1');
    assert.equal(frontPanelPortLabel(n, 24, 32, true), '24');
    assert.equal(frontPanelPortLabel(n, 25, 32, true), 'Te1');
    assert.equal(frontPanelPortLabel(n, 28, 32, true), 'Te4');
    assert.equal(frontPanelPortLabel(n, 29, 32, true), 'Hu49');
    assert.equal(frontPanelPortLabel(n, 32, 32, true), 'Hu52');
});

test('scenario: Juniper QFX5120-48Y8C (48 SFP28 + 8 QSFP28)', () => {
    const n = { type: 'switch', frontPanel: {
        separateSfp: true, sfpRight: true,
        sfpCount: 0,                                    // niente "SFP" tradizionali separati (sono i data)
        sfp2Count: 8, sfp2StartNum: 49, sfp2Prefix: 'et', // 8 QSFP28 uplinks
    } };
    // 48 data SFP28 + 8 QSFP28 (et49-et56) = 56 total
    assert.equal(frontPanelPortLabel(n, 1,  56, true), '1');
    assert.equal(frontPanelPortLabel(n, 48, 56, true), '48');
    assert.equal(frontPanelPortLabel(n, 49, 56, true), 'et49');
    assert.equal(frontPanelPortLabel(n, 56, 56, true), 'et56');
});

test('scenario: Arista 7050QX-32 (32 QSFP+ + 4 SFP+)', () => {
    const n = { type: 'switch', frontPanel: {
        separateSfp: true, sfpRight: true,
        // Data ports = 32 QSFP+ (Et1-Et32), uplinks 4 SFP+ (Et33-Et36)
        sfp2Count: 4, sfp2StartNum: 33, sfp2Prefix: 'Et',
    } };
    assert.equal(frontPanelPortLabel(n, 32, 36, true), '32');
    assert.equal(frontPanelPortLabel(n, 33, 36, true), 'Et33');
    assert.equal(frontPanelPortLabel(n, 36, 36, true), 'Et36');
});

// Front-panel state machine — funzioni pure di normalizzazione del layout porte.
// Condivise browser + test/server (UMD-lite, stesso pattern di lib/correlate.js).
//
// Responsabilita':
// - normalizzare `node.frontPanel` su uno stato canonico
// - gestire back-compat di campi legacy (`numberTop`/`oddTop` -> `oneBottom`,
//   `layout` -> `baseLayout`, `mgmtPort:true` -> `mgmtCount:1`)
// - clamp e default sui contatori SFP (0..8) e MGMT (0..4)
// - filtrare MGMT su tipi non eligibili (`mgmtEligible` passato dal chiamante)
//
// NON tocca DOM, NON dipende da `TYPES`: la verifica di eligibility e' delegata
// al chiamante (in app.js) che fa il lookup `TYPES[node.type]?.mgmtEligible` e lo
// passa come terzo argomento. Cosi' lib/ resta pura e testabile in node.
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        Object.assign(root, factory());
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Stati derivati da progetti molto vecchi (pre-`baseLayout`). Mappa il
    // campo legacy `layout` ai campi nuovi (`baseLayout`, flag derivati).
    function frontPanelLegacyState(fp, portCount) {
        const _fp = fp || {};
        const _pc = portCount || 0;
        const legacy = _fp.layout || 'auto';
        if (legacy === 'linear') return {
            baseLayout: 'linear', numberTop: true, oddTop: true,
            separateSfp: false, sfpRight: true, sfpCount: 0, portCount: _pc,
        };
        if (legacy === 'twoRowSequential') return {
            baseLayout: 'sequential', numberTop: true, oddTop: true,
            separateSfp: false, sfpRight: true, sfpCount: 0, portCount: _pc,
        };
        if (legacy === 'twoRowOddEven') return {
            baseLayout: 'alternating', numberTop: true, oddTop: true,
            separateSfp: false, sfpRight: true, sfpCount: 0, portCount: _pc,
        };
        if (legacy === 'twoRowEvenOdd') return {
            baseLayout: 'alternating', numberTop: true, oddTop: false,
            separateSfp: false, sfpRight: true, sfpCount: 0, portCount: _pc,
        };
        if (legacy === 'uplink24' || legacy === 'uplink48') return {
            baseLayout: 'alternating', numberTop: true, oddTop: true,
            separateSfp: true, sfpRight: true, sfpCount: 4, portCount: _pc,
        };
        return {
            baseLayout: 'auto', numberTop: true, oddTop: true,
            separateSfp: false, sfpRight: true, sfpCount: 0, portCount: _pc,
        };
    }

    // Stato canonico del front panel di un device. `mgmtEligible` indica se il
    // tipo del device supporta porte MGMT dedicate (es. switch, router, firewall
    // si; ups, patchpanel no). Il chiamante lo deriva da TYPES[node.type]
    // perche' la lib non conosce il catalogo TYPES.
    function frontPanelState(node, portCount, mgmtEligible) {
        const fp = (node && node.frontPanel) || {};
        if (fp.layout && !fp.baseLayout) return frontPanelLegacyState(fp, portCount || 0);
        // sfpCount: 0..24. Default 4 quando `separateSfp` e' attivo ma sfpCount
        // non e' stato esplicitamente impostato (retrocompatibilita').
        const rawSfp = fp.sfpCount;
        const sfpCount = (rawSfp === undefined || rawSfp === null || rawSfp === '')
            ? (fp.separateSfp ? 4 : 0)
            : Math.max(0, Math.min(48, parseInt(rawSfp, 10) || 0));
        // SFP numbering: in molti enterprise switch le porte SFP hanno una
        // numerazione propria, non continuata dalle porte dati.
        //   - Cisco Catalyst 9300: data Gi1/0/1..24 + SFP+ Te1/1/1..4 (riparte)
        //   - Cisco Catalyst 9500-48Y: data ...1/0/48 + Hu1/0/49..52 (continua)
        //   - Juniper EX4300: data ge-0/0/0..47 + xe-0/2/0..3 (riparte)
        //   - MikroTik CRS328: data ether1..24 + sfp-sfpplus1..4 (riparte+prefisso)
        // sfpStartNum: null/undefined = numerazione CONTINUATA (default storico,
        // copre il 70% dei vendor consumer/SMB). Number >= 1 = riparte da quel
        // numero (es. sfpStartNum=1 -> "1,2,3,4"; sfpStartNum=49 -> "49,50,51,52").
        const rawSfpStart = fp.sfpStartNum;
        let sfpStartNum = null;
        if (rawSfpStart !== undefined && rawSfpStart !== null && rawSfpStart !== '') {
            const n = parseInt(rawSfpStart, 10);
            if (Number.isFinite(n) && n >= 1 && n <= 999) sfpStartNum = n;
        }
        // sfpPrefix: stringa prepost all'etichetta SFP (es. "Te", "Hu", "xe").
        // Vuoto/non valida -> nessun prefisso. Lunghezza max 6 caratteri.
        const sfpPrefix = (typeof fp.sfpPrefix === 'string' && fp.sfpPrefix.trim())
            ? fp.sfpPrefix.trim().slice(0, 6)
            : '';
        // Secondo blocco SFP (opzionale): per device con due gruppi di uplink
        // distinti come Cisco Cat 9300X-24Y4D (4xSFP28 + 4xQSFP28), Juniper
        // QFX5120-48Y8C, ecc. Stesso schema di parametri del primo (count,
        // startNum, prefix). Lato di posizionamento condiviso con sfp1
        // (sfpRight controlla entrambi). Renderizzato dopo sfp1 nello stesso
        // lato. Default count=0 -> blocco secondario assente.
        const rawSfp2 = fp.sfp2Count;
        const sfp2Count = (rawSfp2 === undefined || rawSfp2 === null || rawSfp2 === '')
            ? 0
            : Math.max(0, Math.min(48, parseInt(rawSfp2, 10) || 0));
        const rawSfp2Start = fp.sfp2StartNum;
        let sfp2StartNum = null;
        if (rawSfp2Start !== undefined && rawSfp2Start !== null && rawSfp2Start !== '') {
            const n2 = parseInt(rawSfp2Start, 10);
            if (Number.isFinite(n2) && n2 >= 1 && n2 <= 999) sfp2StartNum = n2;
        }
        const sfp2Prefix = (typeof fp.sfp2Prefix === 'string' && fp.sfp2Prefix.trim())
            ? fp.sfp2Prefix.trim().slice(0, 6)
            : '';
        // `oneBottom` unifica i due vecchi `numberTop` e `oddTop` (concettualmente
        // la stessa cosa: dove sta la porta 1, su sequential vs alternating).
        // Back-compat: se un progetto vecchio ha uno dei due flag a false,
        // derivo oneBottom = true.
        let oneBottom;
        if (fp.oneBottom !== undefined) {
            oneBottom = !!fp.oneBottom;
        } else if (fp.numberTop === false || fp.oddTop === false) {
            oneBottom = true;
        } else {
            oneBottom = false;
        }
        // Porte MGMT dedicate: 0..4 fuori dal range 1..N delle porte dati.
        // Default 0 (utente le aggiunge una alla volta).
        // Back-compat: vecchio boolean `mgmtPort:true` -> `mgmtCount:1`.
        const _mgmtEligible = !!mgmtEligible;
        const rawMgmt = fp.mgmtCount;
        let mgmtCount;
        if (rawMgmt === undefined || rawMgmt === null || rawMgmt === '') {
            mgmtCount = fp.mgmtPort === true ? 1 : 0;
        } else {
            mgmtCount = Math.max(0, Math.min(4, parseInt(rawMgmt, 10) || 0));
        }
        if (!_mgmtEligible) mgmtCount = 0;
        const mgmtPosition = fp.mgmtPosition === 'right' ? 'right' : 'left';
        const mgmtLabel = (typeof fp.mgmtLabel === 'string' && fp.mgmtLabel.trim())
            ? fp.mgmtLabel.trim()
            : 'MGMT';
        return {
            baseLayout: fp.baseLayout || 'auto',
            oneBottom,
            // Campi legacy derivati: tutto il codice che li usa nei renderer
            // (frontPanelRows, ecc.) continua a funzionare invariato.
            numberTop: !oneBottom,
            oddTop:    !oneBottom,
            separateSfp: !!fp.separateSfp,
            sfpRight: fp.sfpRight !== false,
            sfpCount,
            sfpStartNum,
            sfpPrefix,
            sfp2Count,
            sfp2StartNum,
            sfp2Prefix,
            mgmtEligible: _mgmtEligible,
            mgmtCount,
            mgmtPort: mgmtCount > 0,
            mgmtPosition,
            mgmtLabel,
            portCount: portCount || 0,
        };
    }

    // Gruppi di porte SFP (1 o 2 blocchi), ognuno con i propri parametri di
    // numerazione. Restituisce array di gruppi nell'ordine [sfp1, sfp2].
    // I gruppi vengono renderizzati come `.rack-sfp-side` separati nel
    // rack-view, allineati sullo stesso lato.
    //
    // Esempio Cisco Cat 9300X-24Y4D (24 data + 4 SFP28 Te + 4 QSFP28 Hu):
    //   portCount=32, sfpCount=4, sfp2Count=4
    //   group[0] = { ports: [25,26,27,28], startNum: 1,  prefix: 'Te' }
    //   group[1] = { ports: [29,30,31,32], startNum: 49, prefix: 'Hu' }
    function frontPanelSfpGroups(node, portCount, mgmtEligible) {
        const fp = frontPanelState(node, portCount, mgmtEligible);
        const pc = fp.portCount;
        const groups = [];
        if (!fp.separateSfp || pc < 1) return groups;
        const sfp1 = Math.min(fp.sfpCount, pc);
        const sfp2 = Math.min(fp.sfp2Count, Math.max(0, pc - sfp1));
        if (sfp1 > 0) {
            const start = pc - sfp1 - sfp2 + 1;
            groups.push({
                ports: Array.from({ length: sfp1 }, (_, i) => start + i),
                startNum: fp.sfpStartNum,
                prefix: fp.sfpPrefix,
            });
        }
        if (sfp2 > 0) {
            const start = pc - sfp2 + 1;
            groups.push({
                ports: Array.from({ length: sfp2 }, (_, i) => start + i),
                startNum: fp.sfp2StartNum,
                prefix: fp.sfp2Prefix,
            });
        }
        return groups;
    }

    // Etichetta da mostrare per una porta del front panel. Combina la logica
    // SFP custom (startNum + prefix) per ENTRAMBI i blocchi sfp1/sfp2.
    // Non e' destinata a porte MGMT (quelle hanno pid e label propri).
    //
    // Esempi:
    //   - Porta 5 normale -> "5"
    //   - Porta 25 (sfpCount=4 di 28 totali) senza custom -> "25" (continuata)
    //   - Porta 25 con sfpStartNum=1 + sfpPrefix="Te" -> "Te1"
    //   - Porta 29 (block 2, sfp2Count=4) con sfp2StartNum=49 + sfp2Prefix="Hu" -> "Hu49"
    function frontPanelPortLabel(node, portNum, portCount, mgmtEligible) {
        const num = parseInt(portNum, 10);
        if (!Number.isFinite(num)) return String(portNum);
        const fp = frontPanelState(node, portCount, mgmtEligible);
        const pc = fp.portCount;
        // Clamp IDENTICO a frontPanelSfpGroups: se sfp1+sfp2 > portCount i blocchi
        // resi vengono ridotti li' (sfp2 = min(sfp2, pc-sfp1)). L'etichetta DEVE
        // usare gli stessi conteggi clampati, altrimenti una porta resa nel blocco 1
        // riceverebbe l'etichetta (prefisso/startNum) del blocco 2.
        const sfp1 = Math.min(fp.sfpCount, pc);
        const sfp2 = Math.min(fp.sfp2Count, Math.max(0, pc - sfp1));
        if (!fp.separateSfp || (sfp1 === 0 && sfp2 === 0)) {
            return String(num);
        }
        // Block 2: porte (pc-sfp2+1)..pc — controllato per primo, e' il piu' esterno
        if (sfp2 > 0 && num > pc - sfp2 && num <= pc) {
            const idx = num - (pc - sfp2); // 1..sfp2
            const displayNum = (fp.sfp2StartNum !== null && fp.sfp2StartNum !== undefined)
                ? (fp.sfp2StartNum + idx - 1)
                : num;
            return `${fp.sfp2Prefix || ''}${displayNum}`;
        }
        // Block 1: porte (pc-sfp1-sfp2+1)..(pc-sfp2)
        if (sfp1 > 0 && num > pc - sfp1 - sfp2 && num <= pc - sfp2) {
            const idx = num - (pc - sfp1 - sfp2); // 1..sfp1
            const displayNum = (fp.sfpStartNum !== null && fp.sfpStartNum !== undefined)
                ? (fp.sfpStartNum + idx - 1)
                : num;
            return `${fp.sfpPrefix || ''}${displayNum}`;
        }
        // Porta dati normale
        return String(num);
    }

    // ── Numerazione progressiva patch panel ─────────────────────────────
    // Piu' patch panel possono formare una CATENA di numerazione continua:
    // il pannello B "continua da" A → le sue porte partono da (ultima di A)+1.
    // `recordsById`: { [id]: { ports:Number, continueFrom:id|'', startNum:Number|undefined } }
    //   - startNum (>=1) impostato → numerazione MANUALE (porta 1 = startNum);
    //     alternativa alla catena, vince su continueFrom.
    //   - continueFrom → offset = offset(predecessore) + porte(predecessore).
    //   - nessuno dei due → offset 0 (indipendente, 1..N — comportamento storico).
    // Guard anti-ciclo: una catena che si avvolge viene troncata a 0 (mai loop).
    function panelNumberOffset(panelId, recordsById, _seen) {
        const rec = recordsById && recordsById[panelId];
        if (!rec) return 0;
        const manual = parseInt(rec.startNum, 10);
        if (Number.isFinite(manual) && manual >= 1) return manual - 1;
        const prevId = rec.continueFrom;
        if (!prevId) return 0;
        _seen = _seen || new Set();
        if (_seen.has(panelId)) return 0;          // ciclo → tronca
        _seen.add(panelId);
        const prev = recordsById[prevId];
        if (!prev) return 0;                        // predecessore eliminato → indipendente
        const prevPorts = parseInt(prev.ports, 10) || 0;
        return panelNumberOffset(prevId, recordsById, _seen) + prevPorts;
    }

    // Etichetta numerica di una porta dati di patch panel con offset applicato.
    function patchPanelPortLabel(panelId, portNum, recordsById) {
        const num = parseInt(portNum, 10);
        if (!Number.isFinite(num)) return String(portNum);
        return String(num + panelNumberOffset(panelId, recordsById));
    }

    // True se seguendo `continueFrom` da `fromId` si raggiunge `targetId`
    // (cioe' fromId e' A VALLE di targetId nella catena). La UI lo usa per
    // escludere dalla tendina "continua da" i pannelli che creerebbero un ciclo.
    function panelChainReaches(fromId, targetId, recordsById) {
        if (!fromId || !targetId) return false;
        const seen = new Set();
        let cur = fromId;
        while (cur && !seen.has(cur)) {
            if (cur === targetId) return true;
            seen.add(cur);
            const rec = recordsById[cur];
            cur = rec && rec.continueFrom;
        }
        return false;
    }

    return {
        frontPanelState,
        frontPanelLegacyState,
        frontPanelPortLabel,
        frontPanelSfpGroups,
        panelNumberOffset,
        patchPanelPortLabel,
        panelChainReaches,
    };
});

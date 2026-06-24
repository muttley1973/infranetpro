import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, uid } from './app-util.js';
import { markDirty, pushHistory, renderCables, _showToast } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)

// ============================================================
// CSV IMPORT FRONTEND
// Import rapido di nodi rack/floor da CSV.
// ============================================================

const _CSV_TYPES = Object.keys(TYPES);

function openCsvImport(){
    document.getElementById('csv-textarea').value = '';
    document.getElementById('csv-preview').style.display = 'none';
    document.getElementById('csv-errors').textContent = '';
    document.getElementById('csv-import-btn').disabled = true;
    document.getElementById('csv-overlay').classList.add('open');
}

function closeCsvImport(){
    document.getElementById('csv-overlay').classList.remove('open');
}

function loadCsvFile(input){
    const file = input.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = e=>{
        document.getElementById('csv-textarea').value = e.target.result;
        previewCsv();
        input.value = '';
    };
    reader.readAsText(file);
}

function previewCsv(){
    const raw = document.getElementById('csv-textarea').value.trim();
    const { rows, errors } = _parseCsvData(raw);
    const prevDiv = document.getElementById('csv-preview');
    const errDiv = document.getElementById('csv-errors');
    const importBtn = document.getElementById('csv-import-btn');

    if(!raw){
        prevDiv.style.display = 'none';
        importBtn.disabled = true;
        return;
    }

    errDiv.textContent = errors.length ? t('pnl.seg.rowsWithErrors',{rows:errors.join(', ')}) : '';
    const validRows = rows.filter(r=>!r._err);
    importBtn.disabled = validRows.length === 0;

    const cols = ['name','hostname','ip','type','rack','rackU','sizeU','ports'];
    const tbl = document.getElementById('csv-preview-table');
    tbl.innerHTML = `<thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>`
        + rows.slice(0,10).map(r=>{
            const bg = r._err ? 'background:rgba(248,81,73,.08)' : '';
            return `<tr style="${bg}">${cols.map(c=>`<td style="font-size:0.73rem;padding:3px 6px">${escapeHTML(r[c]||'')}</td>`).join('')}</tr>`;
        }).join('') + '</tbody>';
    prevDiv.style.display = '';
}

function _parseCsvData(raw){
    const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    if(lines.length < 2) return { rows:[], errors:[] };
    const header = lines[0].split(',').map(h=>h.trim().toLowerCase());
    const rows = [];
    const errors = [];
    lines.slice(1).forEach((line, i)=>{
        const vals = line.split(',').map(v=>v.trim());
        const r = {};
        header.forEach((h, j)=>{ r[h] = vals[j] || ''; });
        if(!r.name){
            r._err = 'name mancante';
            errors.push(i + 2);
        } else if(r.type && !_CSV_TYPES.includes(r.type)){
            r._err = `tipo "${r.type}" non valido`;
            errors.push(i + 2);
        }
        rows.push(r);
    });
    return { rows, errors };
}

function importCsvNodes(){
    const raw = document.getElementById('csv-textarea').value.trim();
    const { rows } = _parseCsvData(raw);
    const validRows = rows.filter(r=>!r._err);
    if(!validRows.length){
        _showToast(t('msg.ui.noValidRows'), 'warn');
        return;
    }

    pushHistory();
    let imported = 0;
    const usedNodeIds = new Set((store.state.nodes || []).map(n => String(n.id || '')));

    const rackCache = {};
    const _getRackId = (rackName)=>{
        if(!rackName) return store.state.currentRack || null;
        const key = rackName.trim().toLowerCase();
        if(rackCache[key]) return rackCache[key];
        const existing = store.state.racks.find(r=>(r.name || '').toLowerCase() === key);
        if(existing){
            rackCache[key] = existing.id;
            return existing.id;
        }
        const newRack = { id:uid('rack'), name:rackName.trim(), sizeU:42 };
        store.state.racks.push(newRack);
        rackCache[key] = newRack.id;
        return newRack.id;
    };

    validRows.forEach(r=>{
        const type = r.type || 'switch';
        const def = TYPES[type];
        if(!def) return;
        const isRack = def.isRack;
        const sU = parseInt(r.sizeU, 10) || def.sizeU || 1;

        if(isRack){
            const rackId = _getRackId(r.rack);
            if(!rackId){
                console.warn('[CSV] Nessun rack disponibile per:', r.name);
                return;
            }
            const rackU = parseInt(r.rackU, 10) || win._findFreeU(rackId, sU);
            const n = {
                id:win._nextNodeId(type, usedNodeIds),
                type,
                name:r.name,
                hostname:r.hostname || '',
                ip:r.ip || '',
                rackId,
                rackU,
                sizeU:sU,
                ports:parseInt(r.ports, 10) || def.ports || 0,
            };
            if(r.ip) n.integration = { driver:'snmp-v2c', host:r.ip, community:'public' };
            store.state.nodes.push(n);
        } else {
            const placed = store.state.nodes.filter(n=>TYPES[n.type]?.isFloor && !TYPES[n.type]?.isStructural).length;
            const n = {
                id:win._nextNodeId(type, usedNodeIds),
                type,
                name:r.name,
                hostname:r.hostname || '',
                ip:r.ip || '',
                x:60 + ((placed % 8) * 80),
                y:60 + (Math.floor(placed / 8) * 80),
                ports:def.ports || 1,
            };
            store.state.nodes.push(n);
        }
        imported++;
    });

    if(!store.state.currentRack && store.state.racks.length > 0) store.state.currentRack = store.state.racks[0].id;
    markDirty();
    renderAll();
    renderCables();
    closeCsvImport();
    _showToast(t('msg.ui.devicesImported',{imported}), 'ok');
}

expose({ openCsvImport, closeCsvImport, loadCsvFile, previewCsv, importCsvNodes });

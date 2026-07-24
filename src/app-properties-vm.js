// ============================================================
// PROPERTIES PANEL — renderer VM (macchina virtuale, selType==='vm')
// ============================================================
// Quinto scope del dispatcher renderProps (dopo node/port/link/floor). La VM NON
// e' un nodo del progetto: vive annidata in host.vms[], quindi la selezione e' a
// due livelli — selId = l'HOST (evidenziazione a schermo e nodeById invariati),
// selVmId = la VM. Ci si arriva dalla lista compatta nel pannello dell'host
// (app-hypervisor.js `_vmRowHtml` → data-act="vm-open").
//
// Perche' una scheda dedicata invece del vecchio blocco espanso in lista: una VM
// documentata per la CONSEGNA porta molto piu' del suo indirizzo (ruolo/servizio
// erogato, risorse allocate, responsabile, backup, criticita'), e stampare tutto
// dentro la lista la rendeva illeggibile gia' a 4-5 VM. La lista elenca, la
// scheda edita.
//
// TUTTI i campi sono DICHIARATI dall'utente: nessun dato qui viene da una misura
// SNMP (le MIB standard non modellano i guest). Cio' che non e' compilato resta
// vuoto e il dossier stampa '-' — mai un valore inventato o un default.
//
// ASSE B: questa superficie nasce SENZA handler inline. Ogni campo scrive via
// data-change="vm-field" + data-vm-field (registrati in app-hypervisor.js), i
// bottoni via data-act. Le fisarmoniche sono `open` e non persistono lo stato:
// l'evento `toggle` non fa bubbling, quindi non e' delegabile, e un ontoggle=""
// inline farebbe risalire il cricchetto.
// ============================================================
import { t } from './_bridge.js';
import { store } from './store.js';
import { escapeHTML } from './app-util.js';
import { nodeById, getNodeDisplayName, _enableManualValueInProps } from './app.js';
import { _buildPropsHeader } from './app-properties.js';
import { _nodeVms, _vmIntg } from './app-hypervisor.js';
import { _mgmtBuildUrl, _mgmtProtoDef, _mgmtProtoOptionsHtml } from './app-management.js';
import { vmNics, vmPrimaryIp } from '../lib/vm-nics.js';   // lib pura importata ESM (come lib/ipv6.js)

// Sistemi guest: stessa lista dell'host (un guest e' un OS, non una piattaforma).
const _VM_GUEST_OS = [
    ['win-srv',   'Windows Server'],
    ['win',       'Windows (client)'],
    ['linux',     'Linux'],
    ['bsd',       'BSD / pfSense / OPNsense'],
    ['appliance', 'Appliance (virtual)'],
    ['container', 'Container / Docker'],
    ['altro',     '—'],
];

// Criticita' del servizio erogato dalla VM. Scala DICHIARATA dall'utente, usata
// nel dossier di consegna: e' l'attributo che un registro asset in stile CMDB
// chiede per ogni configuration item. Vuoto = non dichiarata (nessun default:
// assegnare "media" d'ufficio sarebbe un'invenzione).
const _VM_CRITICALITY = [
    ['low',      'vm.crit.low'],
    ['medium',   'vm.crit.medium'],
    ['high',     'vm.crit.high'],
    ['critical', 'vm.crit.critical'],
];

// CONVENZIONE del pannello: i valori di lib/i18n.js sono GIA' HTML-safe (contengono
// entita' pronte, es. 'Rete &amp; Accesso') e vanno inseriti GREZZI — ri-escaparli
// stampa "&AMP;" a schermo. Si escapa solo cio' che viene dal modello (nomi, IP,
// note: dati dell'utente) e i valori messi dentro un attributo.
const _esc = s => escapeHTML(String(s == null ? '' : s));

// Trova la VM selezionata. Ritorna null se la selezione e' stantia (host o VM
// cancellati): il dispatcher ripiega sul pannello del progetto invece di
// mostrare una scheda vuota.
export function _selectedVm(){
    const host = nodeById(store.selId);
    if(!host) return null;
    const vm = _nodeVms(host).find(v => v && v.id === store.selVmId);
    return vm ? { host, vm } : null;
}

// Campo di testo/numero: un solo builder per tutta la scheda, cosi' ogni campo
// nasce con gli stessi data-* e non c'e' modo di scordarne uno.
function _f(ref, field, label, value, opts){
    opts = opts || {};
    const attrs = [
        opts.type ? `type="${_esc(opts.type)}"` : '',
        opts.min != null ? `min="${_esc(opts.min)}"` : '',
        opts.max != null ? `max="${_esc(opts.max)}"` : '',
        opts.step != null ? `step="${_esc(opts.step)}"` : '',
        opts.inputmode ? `inputmode="${_esc(opts.inputmode)}"` : '',
    ].filter(Boolean).join(' ');
    return `<div class="prop-group"><label>${label}</label>`
        + `<input ${attrs} value="${_esc(value == null ? '' : value)}" placeholder="${_esc(opts.ph || t('pnl.feat.optional'))}" `
        + `${ref} data-vm-field="${_esc(field)}" data-change="vm-field"></div>`;
}

// Select: stessa grammatica di _f. `pairs` = [valore, etichetta gia' tradotta].
// `extra` porta gli attributi che governano il valore PERSONALIZZATO: le select a
// scala chiusa (criticita', driver, protocollo) dichiarano data-no-manual="1", il
// sistema operativo invece punta al modello con data-mkind/-mnode/-mfield cosi'
// l'harness «Personalizzato…» sa da dove rileggere il valore digitato a mano.
function _sel(ref, field, label, value, pairs, extra){
    const opts = ['<option value="">—</option>'].concat(
        pairs.map(([v, lab]) => `<option value="${_esc(v)}"${String(value || '') === String(v) ? ' selected' : ''}>${lab}</option>`)
    ).join('');
    return `<div class="prop-group"><label>${label}</label>`
        + `<select ${ref} data-vm-field="${_esc(field)}" data-change="vm-field" ${extra || ''}>${opts}</select></div>`;
}

// Riga «Management»: stessa della scheda device (protocollo + URL + apri), ma
// scritta sulla VM. L'URL vuoto NON e' un buco: si costruisce da protocollo+IP
// della PRIMA vNIC con indirizzo, e il campo serve a chi ha una porta, un
// percorso fuori standard o la console su una scheda diversa dalla prima.
function _mgmtRowVm(vm, ref){
    const proto   = vm.mgmtProto || 'https';
    const vmIp    = vmPrimaryIp(vm);
    const autoUrl = _mgmtBuildUrl(proto, vmIp);
    const primary = String(vm.mgmtUrl || '').trim() || autoUrl;
    const def     = _mgmtProtoDef(proto);
    const off     = primary ? '' : 'opacity:.35;pointer-events:none';
    return `<div class="prop-group mgmt-block">
      <label style="display:flex;align-items:center;justify-content:space-between">
        <span>Management</span>
        <a href="${_esc(primary)}" ${ref} data-act="vm-mgmt-open" class="mgmt-open-btn" style="${off}"
           data-tip="${_esc(t('pnl.misc.openOn', { label: def.label, ip: vmIp || '?' }))}">
          <i class="fas fa-external-link-alt" style="font-size:0.65rem;margin-right:3px"></i>${t('pnl.misc.open', { label: def.label })}
        </a>
      </label>
      <div class="mgmt-row-main">
        <select class="mgmt-proto-sel" ${ref} data-vm-field="mgmtProto" data-change="vm-field" data-no-manual="1">${_mgmtProtoOptionsHtml(proto)}</select>
        <input value="${_esc(vm.mgmtUrl || '')}" placeholder="${_esc(autoUrl || 'es. https://192.168.1.1')}"
               ${ref} data-vm-field="mgmtUrl" data-change="vm-field"
               data-tip="${_esc(t('pnl.misc.urlOptionalOverride'))}">
      </div>
    </div>`;
}

// ── Interfacce di rete virtuali (vNIC) ───────────────────────────────
// Una VM può avere più schede: un firewall virtuale ha WAN + LAN + DMZ, un
// server la NIC di produzione e quella di backup. Ogni scheda è una riga
// editabile; l'ordine è quello in cui le hai dichiarate.
//
// ⚠️ Qui NON c'è nulla che assomigli alle «Porte di rete» di un PC: quelle
// generano LED collegabili a un cavo, una vNIC no. Una scheda virtuale si
// innesta su un port-group del vSwitch, il cui uplink è la NIC fisica dell'host
// — già documentata e già cablata. E da quale NIC fisica esca il traffico, con
// gli uplink in teaming, lo decide la policy di bilanciamento: non è sapibile,
// quindi non si dichiara (② no-invenzioni).
//
// Il campo «Port-group / vSwitch» è testo dichiarato ed è ANCHE il punto di
// aggancio di una futura integrazione con le API dell'hypervisor: è il nome che
// vSphere (port group) e Proxmox (bridge) restituiscono per ogni adattatore.
function _nicCardHtml(nic, i, total, ref){
    const r = `${ref} data-vm-nic="${_esc(nic.id)}"`;
    const fld = (field, label, value, opts) => {
        opts = opts || {};
        const attrs = opts.inputmode ? `inputmode="${_esc(opts.inputmode)}"` : '';
        return `<div class="prop-group"><label>${label}</label>`
            + `<input ${attrs} value="${_esc(value == null ? '' : value)}" placeholder="${_esc(opts.ph || '')}" `
            + `${r} data-vm-field="${_esc(field)}" data-change="vm-nic"></div>`;
    };
    // L'ultima scheda non si elimina dalla riga: si svuotano i campi. Un bottone
    // che toglie l'unica interfaccia lascerebbe la VM senza posto dove scrivere
    // un indirizzo.
    const del = total > 1
        ? `<button type="button" class="toolbar-btn vm-row-btn" ${r} data-act="vm-nic-del" `
          + `data-tip="${_esc(t('hv.vmNicRemove'))}" aria-label="${_esc(t('hv.vmNicRemove'))}" `
          + `style="color:var(--fault-color)"><i class="fas fa-trash-alt"></i></button>`
        : '';
    return `<div class="vnic-card">
        <div class="vnic-head">
          <i class="fas fa-ethernet"></i>
          <input class="vnic-name" value="${_esc(nic.name || '')}" placeholder="${_esc(t('hv.vmNicNamePh', { n: i + 1 }))}"
                 ${r} data-vm-field="name" data-change="vm-nic" aria-label="${_esc(t('hv.vmNicName'))}">
          ${del}
        </div>
        <div class="prop-grid2">
          ${fld('ip', t('net.ip'), nic.ip, { ph: '192.168...' })}
          ${fld('vlan', 'VLAN', nic.vlan, { ph: t('pnl.feat.vlanPh'), inputmode: 'numeric' })}
        </div>
        <div class="prop-grid2">
          ${fld('mac', 'MAC', nic.mac, { ph: '00:11:22:33:44:55' })}
          ${fld('portGroup', t('hv.vmNicPortGroup'), nic.portGroup, { ph: t('hv.vmNicPortGroupPh') })}
        </div>
        ${fld('ip6', t('net.ip6'), nic.ip6, { ph: '2001:db8::1' })}
    </div>`;
}

// Sezione «Integrazione»: STESSI campi e STESSE etichette dell'accordion dei
// device (driver, host override, porta, timeout, community o l'intero blocco v3)
// — una VM interrogabile via SNMP e' un host come gli altri, non merita un
// secondo vocabolario. Sotto, la lettura MISURATA resta un blocco separato: il
// primo e' quello che hai deciso, il secondo quello che la VM ha risposto.
function _snmpSectionHtml(vm, ref){
    const cfg  = _vmIntg(vm);
    const drv  = cfg.driver || 'snmp-v2c';
    const isV3 = drv === 'snmp-v3';
    const opt  = (v, lab) => `<option value="${v}"${drv === v ? ' selected' : ''}>${lab}</option>`;
    const cfgField = (field, label, value, o) => {
        o = o || {};
        return `<div class="prop-group"><label>${label}</label>`
            + `<input ${o.type ? `type="${o.type}"` : ''}${o.type === 'password' ? ' autocomplete="new-password"' : ''} `
            + `value="${_esc(value == null ? '' : value)}" placeholder="${_esc(o.ph || t('pnl.feat.optional'))}" `
            + `${ref} data-vm-field="${_esc(field)}" data-change="vm-intg"></div>`;
    };
    const cfgSel = (field, label, value, pairs, def) =>
        `<div class="prop-group"><label>${label}</label>`
        + `<select ${ref} data-vm-field="${_esc(field)}" data-change="vm-intg" data-no-manual="1">`
        + pairs.map(([v, lab]) => `<option value="${_esc(v)}"${String(value || def) === v ? ' selected' : ''}>${_esc(lab)}</option>`).join('')
        + `</select></div>`;

    // Senza indirizzo non c'e' nulla da interrogare: si dice perche', invece di
    // offrire un bottone che fallirebbe.
    if(!String(cfg.host || vmPrimaryIp(vm) || '').trim())
        return _section('fa-plug', t('sec.integration'),
            `<div class="vm-hint"><i class="fas fa-circle-info"></i> ${t('hv.vmSnmpNoIp')}</div>`);

    const seen = vm.snmpSeen;
    const rows = [];
    if(seen){
        const when = (() => { try { return new Date(seen.at).toLocaleString(); } catch(_){ return seen.at || ''; } })();
        const add = (k, v) => { if(v != null && v !== '') rows.push(`<div class="power-live-row"><span>${k}</span><span>${_esc(v)}</span></div>`); };
        add(t('hv.vmSnmpName'), seen.sysName);
        add(t('hv.vmSnmpUptime'), seen.uptime);
        add('vCPU', seen.cpuCores);
        add('RAM (GB)', seen.ramGb);
        add(t('hv.vmDisk'), seen.diskGb);
        // MAC MISURATI, tutti. Il poll non trasporta gli IP delle interfacce,
        // quindi non si puo' sapere quale MAC appartenga a quale vNIC
        // dichiarata: si mostrano e li si copia sulla scheda giusta. Solo il
        // caso senza ambiguita' (una misura, una scheda) viene compilato dal
        // bottone «Usa questi valori».
        const _seenMacs = Array.isArray(seen.macs) ? seen.macs : (seen.mac ? [seen.mac] : []);
        _seenMacs.forEach((m, i) => rows.push(
            `<div class="power-live-row"><span>MAC ${_seenMacs.length > 1 ? i + 1 : ''}</span><span>${_esc(m)}</span></div>`));
        if(_seenMacs.length > 1)
            rows.push(`<div class="power-live-row vm-snmp-descr"><span>${t('hv.vmSnmpMacMulti', { n: _seenMacs.length })}</span></div>`);
        if(seen.sysDescr) rows.push(`<div class="power-live-row vm-snmp-descr"><span>${_esc(seen.sysDescr)}</span></div>`);
        rows.unshift(`<div class="power-live-head"><i class="fas fa-circle-check"></i> ${t('hv.vmSnmpSeenAt', { when: _esc(when) })}</div>`);
    }
    const measured = seen
        ? `<div class="power-live">${rows.join('')}</div>`
          + `<button type="button" class="toolbar-btn" style="width:100%;justify-content:center;margin-top:6px" ${ref} data-act="vm-snmp-apply">`
          + `<i class="fas fa-arrow-down"></i> ${t('hv.vmSnmpApply')}</button>`
        : '';
    const err = vm.snmpError
        ? `<div class="vm-hint vm-hint-warn"><i class="fas fa-triangle-exclamation"></i> ${t('hv.vmSnmpFail', { err: _esc(vm.snmpError) })}</div>`
        : '';

    return _section('fa-plug', t('sec.integration'),
        `<div class="prop-group"><label>Driver</label>`
        + `<select ${ref} data-vm-field="driver" data-change="vm-intg" data-no-manual="1">`
        + opt('snmp-v2c', 'SNMP v2c') + opt('snmp-v1', 'SNMP v1') + opt('snmp-v3', 'SNMP v3') + `</select></div>`
        + cfgField('host', t('f.hostOverride'), cfg.host, { ph: t('pnl.node.useNodeIpPlaceholder') })
        + `<div class="prop-grid2">`
        + cfgField('port', t('intg.udpPort'), cfg.port || 161, { type: 'number' })
        + cfgField('timeout', 'Timeout (s)', cfg.timeout || 3, { type: 'number' })
        + `</div>`
        + (isV3
            ? cfgField('v3user', t('intg.usmUser'), cfg.v3user)
              + `<div class="prop-grid2">`
              + cfgSel('v3authProto', 'Auth', cfg.v3authProto, [['MD5', 'MD5'], ['SHA', 'SHA']], 'SHA')
              + cfgField('v3authPass', t('f.authPass'), cfg.v3authPass, { type: 'password' })
              + `</div><div class="prop-grid2">`
              + cfgSel('v3privProto', 'Priv', cfg.v3privProto, [['DES', 'DES'], ['AES', 'AES']], 'AES')
              + cfgField('v3privPass', t('f.privPass'), cfg.v3privPass, { type: 'password' })
              + `</div>`
              + cfgSel('v3secLevel', 'Security level', cfg.v3secLevel,
                  [['noAuthNoPriv', 'noAuthNoPriv'], ['authNoPriv', 'authNoPriv'], ['authPriv', 'authPriv']], 'authPriv')
              + cfgField('v3context', t('intg.context'), cfg.v3context, { ph: t('pnl.node.v3ContextPlaceholder') })
            : cfgField('community', 'Community', cfg.community, { ph: 'public' }))
        + `<button type="button" class="toolbar-btn primary" style="width:100%;justify-content:center;margin-top:6px" ${ref} data-act="vm-snmp-read">`
        + `<i class="fas fa-satellite-dish"></i> ${t('hv.vmSnmpRead')}</button>`
        + err + measured
        + `<div class="vm-hint"><i class="fas fa-circle-info"></i> ${t('hv.vmSnmpHint')}</div>`);
}

function _section(icon, title, bodyHtml, badgeHtml){
    return `<details class="props-collapsible props-primary" open><summary class="props-collapsible-head">`
        + `<span><i class="fas ${_esc(icon)}"></i> ${title}</span>${badgeHtml || ''}`
        + `<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>`
        + `<div class="props-collapsible-body">${bodyHtml}</div></details>`;
}

export function _renderVmProps(panel){
    const sel = _selectedVm();
    if(!sel){ panel.innerHTML = `<div class="drift-empty" style="padding:12px">${t('hv.vmGone')}</div>`; return; }
    const { host, vm } = sel;
    const hostName = getNodeDisplayName(host) || host.name || host.id;
    const ref = `data-vm-host="${_esc(host.id)}" data-vm-id="${_esc(vm.id)}"`;
    // Tri-stato onesto: acceso / spento / non specificato (assente). Il click
    // cicla non-spec → running → stopped → non-spec (data-vm-next='' → updateVm
    // elimina il campo). Uno stato "acceso" NON si assume da un campo vuoto.
    const _vst = vm.state === 'running' ? 'running' : vm.state === 'stopped' ? 'stopped' : 'unknown';
    const _vnext = _vst === 'unknown' ? 'running' : _vst === 'running' ? 'stopped' : '';
    const _vcls = _vst === 'running' ? 'is-running' : _vst === 'stopped' ? 'is-stopped' : 'is-unknown';
    const _vico = _vst === 'running' ? 'fa-circle-play' : _vst === 'stopped' ? 'fa-circle-stop' : 'fa-circle-question';
    const _vlbl = _vst === 'running' ? t('hv.running') : _vst === 'stopped' ? t('hv.stopped') : t('hv.vmUnknown');

    // Intestazione: lo STATO e' il fatto che si guarda per primo, quindi vive
    // accanto al titolo come chip (verde accesa / rosso spenta / grigio non spec.)
    // — cliccabile per commutare — subito a sinistra del ritorno all'host. Stessa
    // grammatica dei chip del pannello (.lag-chip) e stessi token semantici usati
    // dai LED e dalla riga in lista: --ok-color NON esiste.
    const stateChip = `<button type="button" class="vm-state-chip ${_vcls}" `
        + `${ref} data-act="vm-state" data-vm-next="${_vnext}" `
        + `data-tip="${_esc(t('hv.vmStateToggle'))}" aria-label="${_esc(t('hv.vmState'))}">`
        + `<i class="fas ${_vico}"></i>`
        + `<span>${_vlbl}</span></button>`;
    const back = `<button type="button" class="toolbar-btn" data-act="vm-back" data-tip="${_esc(t('hv.vmBack', { host: hostName }))}" aria-label="${_esc(t('hv.vmBack', { host: hostName }))}"><i class="fas fa-arrow-left"></i></button>`;
    const header = _buildPropsHeader(vm.name || t('hv.vmUnnamed'), t('hv.vmOnHost', { host: hostName }), 'fa-display',
        `<span class="props-toggles vm-head-actions">${stateChip}${back}</span>`);

    // Sistema operativo: la lista copre i casi comuni, ma l'harness
    // «Personalizzato…» del pannello permette di digitarne uno qualsiasi — per
    // questo la select dichiara da dove rileggere il valore (data-mkind vm).
    const osRef = `data-mkind="vm" data-mnode="${_esc(host.id)}:${_esc(vm.id)}" data-mfield="guestOs"`;
    const identity = _section('fa-id-card', t('hv.vmSecIdentity'),
        _f(ref, 'name', t('hv.vmName'), vm.name, { ph: t('hv.vmNamePh') })
        + _f(ref, 'role', t('hv.vmRole'), vm.role, { ph: t('hv.vmRolePh') })
        + _sel(ref, 'guestOs', t('f.os'), vm.guestOs, _VM_GUEST_OS, osRef));

    // Rete & accesso: COME si raggiunge la macchina (il nome con cui si presenta
    // e la console di gestione). Gli INDIRIZZI non stanno piu' qui: vivono sulle
    // singole vNIC, nella fisarmonica «Porte vNIC» sotto — una VM multi-homed ne
    // ha uno per scheda, e tenerne una copia anche qui creerebbe due verita' per
    // lo stesso dato. La riga Management costruisce l'URL dall'indirizzo della
    // prima scheda che ne ha uno.
    const network = _section('fa-link', t('sec.netAccess'),
        _f(ref, 'hostname', 'Hostname', vm.hostname, { ph: 'dc01.local' })
        + _mgmtRowVm(vm, ref));

    // Porte vNIC: l'elenco delle interfacce di rete virtuali. Mostra sempre
    // almeno una scheda — digitare nella prima riga E' il gesto che la crea, cosi'
    // una VM appena aggiunta non costringe a premere «aggiungi» per il caso
    // normale (una sola scheda).
    const nics = vmNics(vm);
    const shown = nics.length ? nics : [{ id: 'nic1' }];
    const vnics = _section('fa-ethernet', t('hv.vmSecNics'),
        shown.map((nic, i) => _nicCardHtml(nic, i, shown.length, ref)).join('')
        + `<button type="button" class="toolbar-btn" style="width:100%;justify-content:center;margin-top:4px" `
        + `${ref} data-act="vm-nic-add"><i class="fas fa-plus"></i> ${t('hv.vmNicAdd')}</button>`
        + `<div class="vm-hint"><i class="fas fa-info-circle"></i> ${t('hv.vmNicsHint')}</div>`,
        shown.length > 1 ? `<span class="props-count-badge">${shown.length}</span>` : '');

    const resources = _section('fa-microchip', t('hv.vmSecResources'),
        `<div class="prop-grid3">`
        + _f(ref, 'vcpu', 'vCPU', vm.vcpu, { type: 'number', min: 1, max: 1024, ph: '—' })
        + _f(ref, 'ramGb', 'RAM (GB)', vm.ramGb, { type: 'number', min: 0, max: 65536, step: 0.5, ph: '—' })
        + _f(ref, 'diskGb', t('hv.vmDisk'), vm.diskGb, { type: 'number', min: 0, max: 1000000, step: 1, ph: '—' })
        + `</div>`);

    // Consegna: i campi che un dossier di consegna deve poter stampare e che
    // nessuna scoperta di rete puo' dedurre — chi la gestisce, com'e' protetta,
    // quanto pesa se si ferma.
    const handover = _section('fa-clipboard-check', t('hv.vmSecHandover'),
        `<div class="prop-grid2">`
        + _f(ref, 'owner', t('hv.vmOwner'), vm.owner, { ph: t('hv.vmOwnerPh') })
        + _sel(ref, 'criticality', t('hv.vmCriticality'), vm.criticality, _VM_CRITICALITY.map(([v, k]) => [v, t(k)]), 'data-no-manual="1"')
        + `</div>`
        + _f(ref, 'backup', t('hv.vmBackup'), vm.backup, { ph: t('hv.vmBackupPh') })
        + `<div class="prop-group"><label>${t('common.notes')}</label>`
        + `<textarea rows="3" placeholder="${_esc(t('hv.vmNotesPh'))}" ${ref} data-vm-field="notes" data-change="vm-field">${_esc(vm.notes || '')}</textarea></div>`);

    // Ordine: chi e' (identita') → quanto pesa (risorse) → come la raggiungi
    // (rete, poi le sue porte vNIC, poi l'integrazione) → chi risponde e come si
    // consegna.
    panel.innerHTML = header + identity + resources + network + vnics + _snmpSectionHtml(vm, ref) + handover;
    // Stesso harness del pannello device: aggiunge «Personalizzato…» alle select
    // che non dichiarano data-no-manual, cosi' il sistema operativo non e' limitato
    // alla lista (una VM puo' ospitare qualsiasi cosa) senza inventare un secondo
    // meccanismo. Le scale chiuse (criticita', driver SNMP, protocollo) ne restano
    // fuori: li' un valore libero produrrebbe solo dati non confrontabili.
    if(typeof _enableManualValueInProps === 'function') _enableManualValueInProps(panel);
}

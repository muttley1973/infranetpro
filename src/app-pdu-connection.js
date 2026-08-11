import { t } from './_bridge.js';
import { escapeHTML } from './app-util.js';
import { store } from './store.js';
import { nodeById, getNodeDisplayName } from './app.js';
import { TYPES } from './app-types.js';
import { pduRackDeviceCandidates } from '../lib/pdu-layout.js';

function _deviceOptionLabel(candidate){
    const node = nodeById(candidate.id);
    const name = node ? (getNodeDisplayName(node) || node.name || node.hostname || candidate.name) : candidate.name;
    return `${name} — ${candidate.rackName}`;
}

function _sameDeviceName(node, value){
    const target = String(value || '').trim().toLowerCase();
    if(!target || !node) return false;
    return [node.id, node.name, node.hostname, getNodeDisplayName(node)]
        .filter(Boolean)
        .some(item => String(item).trim().toLowerCase() === target);
}

export function pduConnectionDeviceSelect({ nodeId, index, connection }){
    const current = connection && typeof connection === 'object' ? connection : {};
    const candidates = pduRackDeviceCandidates(
        store.state,
        TYPES,
        nodeId,
    );
    const selectedById = String(current.deviceId || '').trim();
    const selectedCandidate = candidates.find(candidate => candidate.id === selectedById)
        || candidates.find(candidate => _sameDeviceName(nodeById(candidate.id), current.deviceName));
    const hasCurrent = !!String(current.deviceName || current.deviceId || '').trim();
    const currentValue = selectedCandidate ? selectedCandidate.id : (selectedById || '__current__');
    const currentLabel = current.deviceName || current.deviceId || t('pdu.notSet');
    const sourceLabel = current.manual ? t('pdu.manual') : t('pdu.netbox');
    const fallback = hasCurrent && !selectedCandidate
        ? `<option value="${escapeHTML(currentValue)}" selected>${escapeHTML(currentLabel)} — ${escapeHTML(sourceLabel)}</option>`
        : '';
    const options = [`<option value="" ${hasCurrent ? '' : 'selected'}>${escapeHTML(t('pdu.notSet'))}</option>`]
        .concat(fallback)
        .concat(candidates.map(candidate => `<option value="${escapeHTML(candidate.id)}" ${selectedCandidate && candidate.id === selectedCandidate.id ? 'selected' : ''}>${escapeHTML(_deviceOptionLabel(candidate))}</option>`))
        .join('');
    return `<select class="pdu-connection-device-select${current.manualDevice ? ' ovr' : ''}" aria-label="${escapeHTML(t('pdu.connectionDevice'))}" data-change="pdu-connection-field" data-nid="${escapeHTML(nodeId)}" data-pindex="${index}" data-pfield="deviceId">${options}</select>`;
}

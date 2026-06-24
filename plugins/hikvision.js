'use strict';

const vendorPrefix = '1.3.6.1.4.1.39165';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const deviceType = /\bnvr\b|recorder|dvr/.test(text) ? 'nvr' : 'webcam';
  return {
    vendor: 'Hikvision',
    deviceType,
    family: deviceType === 'nvr' ? 'Network Video Recorder' : 'IP Camera',
    confidence: 94,
    tags: ['video', 'security', 'snmp', deviceType],
    infranet: { deviceType, rackEligible: deviceType === 'nvr', floorEligible: deviceType !== 'nvr', sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

test('rack render: comprime il layout SFP per device ad alta densita', () => {
  const app = loadApp(ROOT);
  const html = run(app.ctx, `(() => {
    state = _buildDefaultState();
    _propsExplicit = true;
    const node = {
      id: 'hd54', type: 'switch', name: 'HD54', rackId: state.currentRack,
      rackU: 1, sizeU: 1, ports: 54,
      frontPanel: {
        baseLayout: 'alternating', separateSfp: true, sfpCount: 12,
        mgmtCount: 1, mgmtPosition: 'left'
      }
    };
    state.nodes.push(node);
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    renderAll();
    const rack = document.getElementById('rack-chassis');
    const device = (rack.children || []).find(item => item.dataset && item.dataset.id === node.id);
    return device ? device.innerHTML : '';
  })()`);

  assert.match(html, /rack-ports-sfp-layout[^>]*dense-xl[^>]*dense-xxl/);
  assert.equal((html.match(/data-pid="hd54-\d+"/g) || []).length, 54);
  assert.match(html, /data-pid="hd54-mgmt1"/);
  assert.equal((html.match(/rack-sfp-side/g) || []).length, 1);
});

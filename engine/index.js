'use strict';

const { SysObjectEngine } = require('./sysobject-engine');
const { OuiEngine } = require('./oui-engine');
const { FusionScorer, DEFAULT_PRIORITY, DEFAULT_DECISION_THRESHOLD } = require('./fusion-scorer');

module.exports = {
  SysObjectEngine,
  OuiEngine,
  FusionScorer,
  FUSION_DEFAULT_PRIORITY: DEFAULT_PRIORITY,
  FUSION_DEFAULT_DECISION_THRESHOLD: DEFAULT_DECISION_THRESHOLD,
};

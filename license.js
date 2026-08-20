const crypto = require('crypto');
const LICENSE_SECRET = 'therapy_license_secret_2025';
const TRIAL_DAYS = 9999;

const TIERS = {
  TRIAL:     { maxClients: 3,        label: 'ניסיון'    },
  START:     { maxClients: 10,       label: 'START'     },
  PRO:       { maxClients: 30,       label: 'PRO'       },
  UNLIMITED: { maxClients: Infinity, label: 'UNLIMITED' },
};
function getMachineId() {
  const os = require('os');
  const raw = `${os.hostname()}-${os.platform()}-${os.arch()}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase();
  return `${hash.slice(0,4)}-${hash.slice(4,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}`;
}
function generateActivationCode(machineId, tier) {
  if (!TIERS[tier] || tier === 'TRIAL') throw new Error('Invalid tier: ' + tier);
  const cleanId = machineId.replace(/[-\s]/g, '').toUpperCase();
  const hash = crypto.createHmac('sha256', LICENSE_SECRET).update(cleanId + '_' + tier + '_2025').digest('hex').slice(0, 15).toUpperCase();
  const prefix = { START: 'S', PRO: 'P', UNLIMITED: 'U' }[tier];
  return (prefix + hash).match(/.{4}/g).join('-');
}
function verifyActivationCode(machineId, code) {
  const clean = code.replace(/[-\s]/g, '').toUpperCase();
  if (clean.length !== 16) return null;
  const tierMap = { S: 'START', P: 'PRO', U: 'UNLIMITED' };
  const tier = tierMap[clean[0]];
  if (!tier) return null;
  const expected = generateActivationCode(machineId, tier).replace(/-/g, '');
  return clean === expected ? tier : null;
}
function generateResetCode(machineId) {
  const cleanId = machineId.replace(/[-\s]/g, '').toUpperCase();
  const today = new Date().toISOString().slice(0, 10);
  return crypto.createHmac('sha256', LICENSE_SECRET + '_reset_' + today).update(cleanId).digest('hex').slice(0, 16).toUpperCase().match(/.{4}/g).join('-');
}
function verifyResetCode(machineId, code) {
  return generateResetCode(machineId).replace(/-/g,'') === code.replace(/[-\s]/g,'').toUpperCase();
}
module.exports = { generateActivationCode, verifyActivationCode, getMachineId, generateResetCode, verifyResetCode, TIERS, TRIAL_DAYS, LICENSE_SECRET };

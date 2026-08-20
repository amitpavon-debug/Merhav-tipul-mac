const { generateActivationCode, getMachineId } = require('./license');

const TIER_LABELS = { START: 'START (עד 10 מטופלים)', PRO: 'PRO (עד 30 מטופלים)', UNLIMITED: 'UNLIMITED (ללא הגבלה)' };

const machineId = process.argv[2];
const tier = (process.argv[3] || '').toUpperCase();

if (!machineId || !tier || !TIER_LABELS[tier]) {
  console.log('\nשימוש: node generate_code.js XXXX-XXXX-XXXX-XXXX TIER');
  console.log('גרסאות זמינות: START | PRO | UNLIMITED');
  console.log('\nדוגמה:');
  console.log('  node generate_code.js F84D-C865-367C-1CB6 START');
  console.log('  node generate_code.js F84D-C865-367C-1CB6 PRO');
  console.log('  node generate_code.js F84D-C865-367C-1CB6 UNLIMITED\n');
  process.exit(1);
}

const code = generateActivationCode(machineId, tier);
console.log(`\n✅ קוד הפעלה — ${TIER_LABELS[tier]}`);
console.log('מחשב:', machineId);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(code);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━\n');

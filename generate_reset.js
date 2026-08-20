const { generateResetCode } = require('./license');
const machineId = process.argv[2];
if (!machineId) { console.log('שימוש: node generate_reset.js XXXX-XXXX-XXXX-XXXX'); process.exit(1); }
const today = new Date().toISOString().slice(0, 10);
console.log(`\n⚠️  קוד איפוס סיסמה — תקף להיום בלבד (${today})`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(generateResetCode(machineId));
console.log('━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('⚠️  האיפוס ימחק את כל הנתונים!\n');

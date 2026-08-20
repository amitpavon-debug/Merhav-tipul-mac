const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { verifyActivationCode, getMachineId, verifyResetCode, TIERS, TRIAL_DAYS, LICENSE_SECRET } = require('./license');

const DATA_DIR = app.getPath('userData');
const DATA_FILE = path.join(DATA_DIR, 'therapy_data.enc');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const LICENSE_FILE = path.join(DATA_DIR, 'license.json');
const BACKUP_FILE = path.join(DATA_DIR, 'therapy_backup_emergency.enc');
const DATA_FILE_OLD = path.join(DATA_DIR, 'therapy_data.json');

let mainWindow, sessionKey = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
    titleBarStyle: 'hiddenInset',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    title: 'מרחב הטיפול',
    backgroundColor: '#0f0e0c',
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
mainWindow.on('blur', () => {
  setTimeout(() => mainWindow.focus(), 100);
});


mainWindow.webContents.on('did-finish-load', () => {
  mainWindow.webContents.setZoomFactor(0.8);
});
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Crypto ───
function hashPassword(pass) { return crypto.createHash('sha256').update(pass + 'therapy_salt_2025').digest('hex'); }
function deriveKey(pass, salt) { return crypto.pbkdf2Sync(pass, salt, 100000, 32, 'sha256'); }
function encryptData(data, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = deriveKey(pass, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([salt, iv, cipher.getAuthTag(), enc]).toString('base64');
}
function decryptData(encoded, pass) {
  const buf = Buffer.from(encoded, 'base64');
  const salt=buf.slice(0,16), iv=buf.slice(16,28), tag=buf.slice(28,44), enc=buf.slice(44);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(pass, salt), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8'));
}

// ─── License ───
function loadLicense() {
  if (!fs.existsSync(LICENSE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf-8')); } catch { return null; }
}
function saveLicense(data) { fs.writeFileSync(LICENSE_FILE, JSON.stringify(data)); }

function getLicenseStatus() {
  const machineId = getMachineId();
  let lic = loadLicense();
  if (!lic) {
    lic = { machineId, tier: 'TRIAL', firstLaunch: Date.now() };
    saveLicense(lic);
  }
  // Record first launch if missing
  if (!lic.firstLaunch) { lic.firstLaunch = Date.now(); saveLicense(lic); }

  const tier = lic.tier || 'TRIAL';
  const info = TIERS[tier] || TIERS.TRIAL;

  // Trial expiry check
  let trialExpired = false, trialDaysLeft = null;
  if (tier === 'TRIAL') {
    const msElapsed = Date.now() - lic.firstLaunch;
    const daysElapsed = Math.floor(msElapsed / (1000 * 60 * 60 * 24));
    trialDaysLeft = Math.max(0, TRIAL_DAYS - daysElapsed);
    trialExpired = trialDaysLeft === 0;
  }

  return {
    tier,
    label: info.label,
    maxClients: info.maxClients === Infinity ? null : info.maxClients,
    machineId,
    trialExpired,
    trialDaysLeft,
  };
}

// ─── Auth ───
ipcMain.handle('auth:hasPassword', () => fs.existsSync(AUTH_FILE) || fs.existsSync(DATA_FILE));
ipcMain.handle('auth:setPassword', (_, pass) => {
  if (fs.existsSync(DATA_FILE)) return false;
  sessionKey = pass;
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ hash: hashPassword(pass) }));
  return true;
});
ipcMain.handle('auth:verify', (_, pass) => {
  if (fs.existsSync(AUTH_FILE)) {
    const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    if (auth.hash !== hashPassword(pass)) return false;
  }
  if (fs.existsSync(DATA_FILE)) {
    try { decryptData(fs.readFileSync(DATA_FILE, 'utf-8'), pass); } catch { return false; }
  }
  if (!fs.existsSync(AUTH_FILE)) fs.writeFileSync(AUTH_FILE, JSON.stringify({ hash: hashPassword(pass) }));
  sessionKey = pass;
  return true;
});
ipcMain.handle('auth:changePassword', (_, { oldPass, newPass }) => {
  if (!fs.existsSync(AUTH_FILE)) return false;
  const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
  if (auth.hash !== hashPassword(oldPass)) return false;
  if (fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, encryptData(decryptData(fs.readFileSync(DATA_FILE,'utf-8'), oldPass), newPass));
  if (fs.existsSync(BACKUP_FILE)) { try { fs.writeFileSync(BACKUP_FILE, encryptData(decryptData(fs.readFileSync(BACKUP_FILE,'utf-8'), oldPass+'_emergency_backup'), newPass+'_emergency_backup')); } catch {} }
  auth.hash = hashPassword(newPass);
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth));
  sessionKey = newPass;
  return true;
});
ipcMain.handle('auth:setBackupPassword', (_, { currentPass, backupPass }) => {
  if (!fs.existsSync(AUTH_FILE)) return false;
  const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
  if (auth.hash !== hashPassword(currentPass)) return false;
  // Save backup of data if exists, otherwise save empty structure
  const data = fs.existsSync(DATA_FILE)
    ? decryptData(fs.readFileSync(DATA_FILE,'utf-8'), currentPass)
    : { clients: [], sessions: [] };
  fs.writeFileSync(BACKUP_FILE, encryptData(data, backupPass+'_emergency_backup'));
  auth.hasBackup = true;
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth));
  return true;
});
ipcMain.handle('auth:hasBackup', () => fs.existsSync(BACKUP_FILE));
ipcMain.handle('auth:recoverWithBackup', (_, { backupPass, newPass }) => {
  if (!fs.existsSync(BACKUP_FILE)) return false;
  try {
    const data = decryptData(fs.readFileSync(BACKUP_FILE,'utf-8'), backupPass+'_emergency_backup');
    fs.writeFileSync(DATA_FILE, encryptData(data, newPass));
    fs.writeFileSync(BACKUP_FILE, encryptData(data, newPass+'_emergency_backup'));
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ hash: hashPassword(newPass), hasBackup: true }));
    sessionKey = newPass;
    return true;
  } catch { return false; }
});
ipcMain.handle('auth:getMachineIdForReset', () => getMachineId());
ipcMain.handle('auth:verifyResetCode', (_, code) => verifyResetCode(getMachineId(), code));
ipcMain.handle('auth:resetWithCode', (_, { code, newPass }) => {
  if (!verifyResetCode(getMachineId(), code)) return false;
  [DATA_FILE, BACKUP_FILE].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ hash: hashPassword(newPass) }));
  sessionKey = newPass;
  return true;
});

// ─── License IPC ───
ipcMain.handle('license:status', () => getLicenseStatus());
ipcMain.handle('license:activate', (_, code) => {
  const tier = verifyActivationCode(getMachineId(), code);
  if (!tier) return false;
  const lic = loadLicense() || { machineId: getMachineId() };
  lic.tier = tier;
  saveLicense(lic);
  return tier;
});

// ─── Data ───
ipcMain.handle('data:load', () => {
  if (!sessionKey) return null;
  if (!fs.existsSync(DATA_FILE) && fs.existsSync(DATA_FILE_OLD)) {
    const old = JSON.parse(fs.readFileSync(DATA_FILE_OLD, 'utf-8'));
    fs.writeFileSync(DATA_FILE, encryptData(old, sessionKey));
    fs.renameSync(DATA_FILE_OLD, DATA_FILE_OLD + '.migrated');
  }
  if (!fs.existsSync(DATA_FILE)) return { clients: [], sessions: [] };
  return decryptData(fs.readFileSync(DATA_FILE, 'utf-8'), sessionKey);
});
ipcMain.handle('data:save', (_, payload) => {
  if (!sessionKey) return false;
  fs.writeFileSync(DATA_FILE, encryptData(payload, sessionKey));
  return true;
});
ipcMain.handle('data:export', async () => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'ייצוא גיבוי מוצפן',
    defaultPath: `מרחב_הטיפול_גיבוי_${new Date().toISOString().split('T')[0]}.therapybak`,
    filters: [{ name: 'Therapy Backup', extensions: ['therapybak'] }],
  });
  if (canceled || !filePath) return { status: 'cancelled' };
  return { status: 'need_password', filePath };
});
ipcMain.handle('data:exportWithPassword', (_, { filePath, password, payload }) => {
  try {
    const encrypted = encryptData(payload, password + '_backup_export');
    fs.writeFileSync(filePath, JSON.stringify({ v: 2, enc: encrypted }));
    return true;
  } catch { return false; }
});
ipcMain.handle('data:import', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'ייבוא גיבוי', filters: [
      { name: 'Therapy Backup', extensions: ['therapybak'] },
      { name: 'JSON', extensions: ['json'] },
    ], properties: ['openFile'],
  });
  if (!filePaths?.[0]) return null;
  const raw = fs.readFileSync(filePaths[0], 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    if (parsed.v === 2 && parsed.enc) return { status: 'need_password', enc: parsed.enc };
    if (parsed.v === 1 && parsed.enc) {
      // Old format — encrypted with session key
      try { return { status: 'ok', data: decryptData(parsed.enc, sessionKey) }; }
      catch { return { status: 'error', msg: 'לא ניתן לפתוח קובץ זה — יוצא ממחשב אחר' }; }
    }
    // Legacy plain JSON
    if (parsed.clients) return { status: 'ok', data: parsed };
    return { status: 'error', msg: 'קובץ לא תקין' };
  } catch { return { status: 'error', msg: 'קובץ לא תקין' }; }
});
ipcMain.handle('data:importWithPassword', (_, { enc, password }) => {
  try {
    const data = decryptData(enc, password + '_backup_export');
    return { status: 'ok', data };
  } catch { return { status: 'error', msg: 'סיסמה שגויה' }; }
});
ipcMain.handle('data:exportExcel', async (_, payload) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'ייצוא ל-Excel', defaultPath: `מרחב_הטיפול_${new Date().toISOString().split('T')[0]}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (!filePath) return false;
  const { clients, sessions } = payload;
  const x = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const strings = [];
  const s = v => { const str=String(v||''); const i=strings.indexOf(str); if(i>=0) return {t:'s',v:i}; strings.push(str); return {t:'s',v:strings.length-1}; };
  const n = v => ({t:'n',v:v||0});
  const months=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  const fmtDate=d=>{ if(!d) return ''; const [y,m,day]=d.split('-'); return `${parseInt(day)} ${months[parseInt(m)-1]} ${y}`; };
  const clientHeaders=['שם מטופל','טלפון','אימייל','גיל','תדירות','מחיר מפגש','מפגשים','סה"כ שולם','חוב פתוח','מפגש אחרון'];
  const sessionHeaders=['מטופל','תאריך','משך (דק)','מחיר','תשלום','נושאים','סיכום','לפגישה הבאה'];
  [...clientHeaders,...sessionHeaders].forEach(h=>s(h));
  const cols=['A','B','C','D','E','F','G','H','I','J'];
  const clientRows=clients.map(c=>{
    const cs=sessions.filter(ss=>ss.clientId===c.id);
    const paid=cs.reduce((a,ss)=>ss.payment==='שולם'?a+(ss.price||0):a,0);
    const debt=cs.reduce((a,ss)=>ss.payment==='לא שולם'?a+(ss.price||0):a,0);
    const last=[...cs].sort((a,b)=>b.date.localeCompare(a.date))[0];
    return [s(`${c.fname} ${c.lname||''}`),s(c.phone||''),s(c.email||''),n(c.age||0),s(c.freq||''),n(c.price||0),n(cs.length),n(paid),n(debt),s(last?fmtDate(last.date):'')];
  });
  const sessionRows=[...sessions].sort((a,b)=>b.date.localeCompare(a.date)).map(ss=>{
    const c=clients.find(c=>c.id===ss.clientId);
    return [s(c?`${c.fname} ${c.lname||''}`:''),s(fmtDate(ss.date)),n(ss.duration||50),n(ss.price||0),s(ss.payment||''),s((ss.tags||[]).join(', ')),s(ss.summary||''),s(ss.nextSession||'')];
  });
  const buildSheet=(headers,rows)=>{
    let xml=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">`;
    headers.forEach((h,i)=>{ const c=s(h); xml+=`<c r="${cols[i]}1" t="s"><v>${c.v}</v></c>`; });
    xml+=`</row>`;
    rows.forEach((row,ri)=>{ xml+=`<row r="${ri+2}">`; row.forEach((cell,ci)=>{ xml+=`<c r="${cols[ci]}${ri+2}" t="${cell.t}"><v>${cell.v}</v></c>`; }); xml+=`</row>`; });
    return xml+`</sheetData></worksheet>`;
  };
  const ssXml=`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(str=>`<si><t xml:space="preserve">${x(str)}</t></si>`).join('')}</sst>`;
  const wbXml=`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="מטופלים" sheetId="1" r:id="rId1"/><sheet name="מפגשים" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const wbRels=`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const cTypes=`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;
  const rootRels=`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const AdmZip=require('adm-zip'); const zip=new AdmZip();
  zip.addFile('[Content_Types].xml',Buffer.from(cTypes,'utf8'));
  zip.addFile('_rels/.rels',Buffer.from(rootRels,'utf8'));
  zip.addFile('xl/workbook.xml',Buffer.from(wbXml,'utf8'));
  zip.addFile('xl/_rels/workbook.xml.rels',Buffer.from(wbRels,'utf8'));
  zip.addFile('xl/sharedStrings.xml',Buffer.from(ssXml,'utf8'));
  zip.addFile('xl/worksheets/sheet1.xml',Buffer.from(buildSheet(clientHeaders,clientRows),'utf8'));
  zip.addFile('xl/worksheets/sheet2.xml',Buffer.from(buildSheet(sessionHeaders,sessionRows),'utf8'));
  zip.writeZip(filePath);
  return true;
});
ipcMain.handle('data:importExcel', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'ייבוא מטופלים מ-Excel', filters: [{ name: 'Excel', extensions: ['xlsx'] }], properties: ['openFile'],
  });
  if (!filePaths?.[0]) return null;
  const AdmZip=require('adm-zip'); const zip=new AdmZip(filePaths[0]);
  const strings=[]; const ssEntry=zip.getEntry('xl/sharedStrings.xml');
  if(ssEntry){ const ssXml=ssEntry.getData().toString('utf8'); (ssXml.match(/<t[^>]*>([^<]*)<\/t>/g)||[]).forEach(m=>strings.push(m.replace(/<\/?t[^>]*>/g,''))); }
  const sheetEntry=zip.getEntry('xl/worksheets/sheet1.xml'); if(!sheetEntry) return {error:'לא נמצא גיליון'};
  const sheetXml=sheetEntry.getData().toString('utf8');
  const rowMatches=sheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g)||[];
  const getVal=cell=>{ const t=cell.match(/t="([^"]+)"/),v=cell.match(/<v>([^<]*)<\/v>/); if(!v) return ''; if(t&&t[1]==='s') return strings[parseInt(v[1])]||''; return v[1]; };
  const clients=[]; rowMatches.forEach((row,ri)=>{
    if(ri===0) return;
    const cells=row.match(/<c[^>]*>[\s\S]*?<\/c>/g)||[]; if(!cells.length) return;
    const vals={}; cells.forEach(cell=>{ const r=cell.match(/r="([A-Z]+)\d+"/); if(r) vals[r[1]]=getVal(cell); });
    const name=(vals['A']||'').trim(); if(!name) return;
    const parts=name.split(' ');
    clients.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2)+ri,createdAt:new Date().toISOString(),fname:parts[0],lname:parts.slice(1).join(' ')||'',phone:vals['B']||'',email:vals['C']||'',age:parseInt(vals['D'])||0,freq:vals['E']||'שבועי',price:parseInt(vals['F'])||0,notes:'',archived:false});
  });
  return clients;
});

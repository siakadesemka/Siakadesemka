/**
 * ============================================================================
 * SISTEM INFORMASI SEKOLAH - BACKEND (Google Apps Script)
 * ============================================================================
 * Backend ini melayani SPA React (index.html) yang di-host terpisah
 * (misalnya di Netlify). Semua komunikasi dilakukan lewat doPost(e) dengan
 * body JSON: { action: "namaAksi", payload: {...} }
 *
 * CARA PAKAI:
 * 1. Buat Google Sheet baru (kosong), lalu buka Extensions > Apps Script.
 * 2. Hapus isi Code.gs bawaan, tempel seluruh isi file ini.
 * 3. Jalankan fungsi setupDatabase() sekali (pilih fungsi ini di dropdown
 *    toolbar, klik Run). Berikan izin akses yang diminta.
 * 4. Deploy > New deployment > Type: Web app.
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Salin URL Web App yang dihasilkan, tempel ke konstanta API_URL di
 *    index.html.
 * ============================================================================
 */

// ============================================================================
// KONFIGURASI
// ============================================================================

const CONFIG = {
  SCHOOL_LAT: 4.390969033108471,      // Ganti dengan koordinat sekolah Anda
  SCHOOL_LNG: 96.04080703278136,      // Ganti dengan koordinat sekolah Anda
  RADIUS_GURU_METER: 500,
  RADIUS_PKL_METER: 100,
  PHOTO_FOLDER_NAME: "SistemSekolah_Dokumentasi", // Folder Google Drive
  TIMEZONE: "GMT+7",

  // Aturan jam absensi guru/pegawai (jam masuk & pulang)
  BATAS_ABSEN_MASUK_NORMAL: "12:00",  // batas akhir absen masuk (Senin-Kamis, Sabtu)
  BATAS_ABSEN_MASUK_JUMAT: "11:00",   // batas akhir absen masuk khusus hari Jumat
  JAM_MASUK_STANDAR: "08:00",         // jam masuk normal, dipakai menghitung keterlambatan
  JAM_MULAI_ABSEN_PULANG: "12:00",    // absen pulang baru bisa dilakukan setelah jam ini

  // Notifikasi WhatsApp (lihat catatan di fungsi kirimWA - pakai layanan gateway pihak ketiga, cth. Fonnte)
  WA_AKTIF: false,                     // ubah ke true setelah token diisi & sudah siap dipakai
  WA_GATEWAY_URL: "https://api.fonnte.com/send",
  WA_TOKEN: "ISI_TOKEN_GATEWAY_WA_ANDA",
  JAM_BATAS_CEK_BELUM_ABSEN: "10:00"  // jam pengecekan siswa yang belum absen (untuk notifikasi ke Guru Wali)
};

const SHEET_NAMES = {
  USERS: "Users_Master",
  ABSEN_GURU: "Absen_Guru",
  ABSEN_SISWA_REGULER: "Absen_Siswa_Reguler",
  JURNAL_ABSEN_PKL: "Jurnal_Absen_PKL_XII",
  JURNAL_MENGAJAR: "Jurnal_Mengajar",
  JURNAL_BIMBINGAN: "Jurnal_Bimbingan",
  JURNAL_7KAIH: "Jurnal_7KAIH",
  QR_SESSIONS: "QR_Sessions", // sesi QR yang dibuat guru untuk absen siswa
  ABSEN_HARIAN_SISWA: "Absen_Harian_Siswa", // absen gerbang harian via QR pribadi siswa
  HARI_LIBUR: "Hari_Libur",
  JURNAL_MGMP: "Jurnal_MGMP"
};

// Definisi header setiap sheet. setupDatabase() akan membuat sheet + header
// ini secara otomatis jika belum ada.
const SHEET_SCHEMAS = {
  Users_Master: [
    "ID", "Nama", "Role_List", "Identitas_NIP_NISN", "Password",
    "Kelas_Diampu", "Mapel_Diampu", "Roster_Mengajar_JSON", "Guru_Wali_Nama",
    "Guru_Pembimbing_PKL", "Pembimbing_Lapangan_PKL", "Tempat_PKL",
    "Lat_PKL", "Long_PKL", "Tanggal_Mulai_PKL", "Tanggal_Selesai_PKL",
    "QR_Token", "No_HP", "No_HP_OrangTua", "CreatedAt"
  ],
  Absen_Guru: [
    "ID", "ID_Guru", "Nama_Guru", "Tanggal", "Jam_Masuk", "Jam_Pulang",
    "Lat", "Long", "Status", "Keterangan", "CreatedAt"
  ],
  Absen_Siswa_Reguler: [
    "ID", "ID_Siswa", "Nama_Siswa", "Kelas", "Tanggal", "Jam",
    "Mapel", "ID_Guru", "Status", "Sumber", "CreatedAt"
  ],
  Jurnal_Absen_PKL_XII: [
    "ID", "ID_Siswa", "Nama_Siswa", "Tanggal", "Jam", "Kegiatan_PKL",
    "Foto_URL", "Lat", "Long", "Jarak_Meter", "Status", "CreatedAt"
  ],
  Jurnal_Mengajar: [
    "ID", "ID_Guru", "Nama_Guru", "Hari", "Tanggal", "Kelas", "Mapel",
    "Jam_Ke", "Pertemuan_Ke", "Tujuan_Pembelajaran", "Materi", "Catatan_Kelas",
    "Kehadiran_Siswa_JSON", "Foto_URL", "CreatedAt"
  ],
  Jurnal_Bimbingan: [
    "ID", "ID_Guru", "Nama_Guru", "ID_Siswa", "Nama_Siswa", "Tanggal",
    "Aspek_Layanan", "Kegiatan", "CreatedAt"
  ],
  Jurnal_7KAIH: [
    "ID", "ID_Siswa", "Nama_Siswa", "Tanggal",
    "Bangun_Pagi_Jam",
    "Shalat_Subuh_Jam", "Shalat_Dzuhur_Jam", "Shalat_Ashar_Jam",
    "Shalat_Maghrib_Jam", "Shalat_Isya_Jam",
    "Olahraga_Kegiatan_JSON",
    "Makan_Pagi_Menu", "Makan_Pagi_Jam",
    "Makan_Siang_Menu", "Makan_Siang_Jam",
    "Makan_Malam_Menu", "Makan_Malam_Jam",
    "Belajar_Kegiatan", "Bermasyarakat_Kegiatan", "Tidur_Jam",
    "CreatedAt"
  ],
  QR_Sessions: [
    "ID", "ID_Guru", "Kelas", "Mapel", "Tanggal", "Jam", "Token",
    "ExpiredAt", "CreatedAt"
  ],
  Absen_Harian_Siswa: [
    "ID", "ID_Siswa", "Nama_Siswa", "Kelas", "Tanggal", "Jam_Masuk", "Jam_Pulang",
    "ID_Guru_Pencatat", "Nama_Guru_Pencatat", "CreatedAt"
  ],
  Hari_Libur: [
    "ID", "Tanggal", "Keterangan", "CreatedAt"
  ],
  Jurnal_MGMP: [
    "ID", "ID_Guru", "Nama_Guru", "Hari", "Tanggal", "Uraian_Kegiatan", "Foto_URL", "CreatedAt"
  ]
};

// ============================================================================
// SETUP DATABASE (Jalankan sekali secara manual dari editor Apps Script)
// ============================================================================

function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_SCHEMAS).forEach(function (sheetName) {
    let sheet = ss.getSheetByName(sheetName);
    const headers = SHEET_SCHEMAS[sheetName];
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight("bold")
        .setBackground("#4F46E5")
        .setFontColor("#FFFFFF");
      sheet.autoResizeColumns(1, headers.length);
    } else {
      // Sheet sudah ada -> pastikan header lengkap (tambahkan kolom baru
      // di akhir jika skema bertambah, tanpa merusak data lama).
      const existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
      const missing = headers.filter(function (h) { return existingHeaders.indexOf(h) === -1; });
      if (existingHeaders.length === 0 || (existingHeaders.length === 1 && existingHeaders[0] === "")) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      } else if (missing.length > 0) {
        const startCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
      }
    }
  });

  // Buat 1 akun Admin default jika sheet Users_Master masih kosong
  const usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
  if (usersSheet.getLastRow() <= 1) {
    usersSheet.appendRow([
      generateId("USR"), "Administrator", "Admin", "admin", "admin123",
      "", "", "", "", "", "", "", "", "", "", "", new Date()
    ]);
  }

  // Siapkan folder Google Drive untuk dokumentasi foto
  getOrCreatePhotoFolder();

  SpreadsheetApp.flush();
  return "Setup database selesai. Sheet dan header sudah siap.";
}

// ============================================================================
// ENTRY POINTS WEB APP
// ============================================================================

function doGet(e) {
  return jsonResponse({ ok: true, message: "Sistem Informasi Sekolah API aktif. Gunakan POST." });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: "Body request tidak valid (harus JSON)." });
  }

  const action = body.action;
  const payload = body.payload || {};

  const routes = {
    login: apiLogin,
    getMasterData: apiGetMasterData,
    saveUser: apiSaveUser,
    deleteUser: apiDeleteUser,

    absenGuru: apiAbsenGuru,
    getRiwayatAbsenGuru: apiGetRiwayatAbsenGuru,

    saveJurnalMengajar: apiSaveJurnalMengajar,
    getJurnalMengajarByGuru: apiGetJurnalMengajarByGuru,
    getStatusAbsenHarianKelas: apiGetStatusAbsenHarianKelas,

    generateQrSession: apiGenerateQrSession,
    absenSiswaViaQr: apiAbsenSiswaViaQr,
    getRekapAbsenSiswa: apiGetRekapAbsenSiswa,

    getInfoPklSiswa: apiGetInfoPklSiswa,
    saveJurnalPkl: apiSaveJurnalPkl,
    absenPkl: apiAbsenPkl,

    saveJurnal7Kaih: apiSaveJurnal7Kaih,
    getJurnal7KaihBySiswa: apiGetJurnal7KaihBySiswa,

    saveJurnalBimbingan: apiSaveJurnalBimbingan,
    getJurnalBimbinganByGuru: apiGetJurnalBimbinganByGuru,

    saveJurnalMgmp: apiSaveJurnalMgmp,
    getJurnalMgmpByGuru: apiGetJurnalMgmpByGuru,

    getKodeQrHarianSiswa: apiGetKodeQrHarianSiswa,

    getRekapKehadiranKelas: apiGetRekapKehadiranKelas,
    getDashboardManajemen: apiGetDashboardManajemen,

    absenHarianViaQr: apiAbsenHarianViaQr,

    saveHariLibur: apiSaveHariLibur,
    getHariLibur: apiGetHariLibur,
    deleteHariLibur: apiDeleteHariLibur,

    getRekapAbsensiGuruBulanan: apiGetRekapAbsensiGuruBulanan,
    getRekapAbsensiSiswaBulanan: apiGetRekapAbsensiSiswaBulanan,

    uploadPhoto: apiUploadPhoto
  };

  const handler = routes[action];
  if (!handler) {
    return jsonResponse({ ok: false, error: "Aksi tidak dikenali: " + action });
  }

  try {
    const result = handler(payload);
    return jsonResponse({ ok: true, data: result });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// UTIL: SHEET HELPERS
// ============================================================================

function getSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error("Sheet '" + name + "' belum ada. Jalankan setupDatabase() dahulu.");
  return sheet;
}

// Membaca seluruh sheet menjadi array of object { Header: value, ... }
function readSheetAsObjects(sheetName) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  // Kolom yang boleh tetap membawa jam lengkap (timestamp), selain itu tanggal diringkas jadi yyyy-MM-dd saja
  const KOLOM_TIMESTAMP_LENGKAP = ["CreatedAt", "ExpiredAt"];
  return values.map(function (row, idx) {
    const obj = { _rowIndex: idx + 2 };
    headers.forEach(function (h, i) {
      let val = row[i];
      if (val instanceof Date && KOLOM_TIMESTAMP_LENGKAP.indexOf(h) === -1) {
        val = formatDateOnly(val);
      }
      obj[h] = val;
    });
    return obj;
  });
}

function appendRowFromObject(sheetName, obj) {
  const sheet = getSheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(function (h) { return (obj[h] !== undefined ? obj[h] : ""); });
  sheet.appendRow(row);
  return obj;
}

function updateRowByField(sheetName, matchField, matchValue, newValues) {
  const sheet = getSheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIndex = headers.indexOf(matchField);
  if (colIndex === -1) throw new Error("Kolom '" + matchField + "' tidak ditemukan di " + sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const values = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(matchValue)) {
      const rowNum = i + 2;
      headers.forEach(function (h, colIdx) {
        if (newValues[h] !== undefined) {
          sheet.getRange(rowNum, colIdx + 1).setValue(newValues[h]);
        }
      });
      return true;
    }
  }
  return false;
}

function deleteRowByField(sheetName, matchField, matchValue) {
  const sheet = getSheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIndex = headers.indexOf(matchField);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const values = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(matchValue)) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

function generateId(prefix) {
  return (prefix || "ID") + "-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000);
}

function formatDateOnly(d) {
  return Utilities.formatDate(new Date(d), CONFIG.TIMEZONE, "yyyy-MM-dd");
}

// Pisahkan Role_List "Guru, Wali Kelas" -> ["Guru", "Wali Kelas"]
function parseRoles(roleListString) {
  if (!roleListString) return [];
  return String(roleListString).split(",").map(function (r) { return r.trim(); }).filter(Boolean);
}

// ============================================================================
// HAVERSINE (JARAK GPS DALAM METER)
// ============================================================================

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // radius bumi (meter)
  const toRad = function (v) { return (v * Math.PI) / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ============================================================================
// FOTO / DRIVE (BASE64 -> FILE, MENGEMBALIKAN URL)
// ============================================================================

function getOrCreatePhotoFolder() {
  const folders = DriveApp.getFoldersByName(CONFIG.PHOTO_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(CONFIG.PHOTO_FOLDER_NAME);
}

// payload: { base64Data, fileName, mimeType }
function apiUploadPhoto(payload) {
  if (!payload.base64Data) throw new Error("Data foto (base64) tidak ada.");
  const folder = getOrCreatePhotoFolder();
  const cleanBase64 = String(payload.base64Data).split(",").pop(); // buang prefix data:image/...;base64,
  const mimeType = payload.mimeType || "image/jpeg";
  const bytes = Utilities.base64Decode(cleanBase64);
  const blob = Utilities.newBlob(bytes, mimeType, payload.fileName || (generateId("FOTO") + ".jpg"));
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: "https://drive.google.com/uc?export=view&id=" + file.getId(), fileId: file.getId() };
}

// ============================================================================
// AUTH & MASTER DATA
// ============================================================================

// payload: { username, password }  -- username dicocokkan ke kolom Identitas_NIP_NISN
function apiLogin(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const user = users.find(function (u) {
    return String(u.Identitas_NIP_NISN) === String(payload.username) &&
           String(u.Password) === String(payload.password);
  });
  if (!user) throw new Error("Username atau password salah.");

  const roles = parseRoles(user.Role_List);
  const safeUser = Object.assign({}, user);
  delete safeUser.Password;
  safeUser.Roles = roles;
  return safeUser;
}

function apiGetMasterData(payload) {
  const scope = payload.scope; // "guru" | "siswa" | "all"
  const users = readSheetAsObjects(SHEET_NAMES.USERS).map(function (u) {
    const safe = Object.assign({}, u);
    delete safe.Password;
    safe.Roles = parseRoles(u.Role_List);
    return safe;
  });
  if (scope === "guru") {
    return users.filter(function (u) { return u.Roles.some(function (r) { return r.toLowerCase().indexOf("guru") !== -1 || r.toLowerCase().indexOf("waka") !== -1; }); });
  }
  if (scope === "siswa") {
    return users.filter(function (u) { return u.Roles.indexOf("Siswa") !== -1; });
  }
  return users;
}

// payload = seluruh field Users_Master; jika ada ID -> update, jika tidak -> insert baru
function apiSaveUser(payload) {
  const rolesArray = Array.isArray(payload.Roles) ? payload.Roles : parseRoles(payload.Role_List);
  const obj = Object.assign({}, payload);
  obj.Role_List = rolesArray.join(", ");
  delete obj.Roles;

  if (rolesArray.indexOf("Siswa") !== -1 && !obj.QR_Token) {
    obj.QR_Token = generateId("QRT");
  }

  if (obj.ID) {
    updateRowByField(SHEET_NAMES.USERS, "ID", obj.ID, obj);
    return obj;
  } else {
    obj.ID = generateId("USR");
    obj.CreatedAt = new Date();
    appendRowFromObject(SHEET_NAMES.USERS, obj);
    return obj;
  }
}

function apiDeleteUser(payload) {
  deleteRowByField(SHEET_NAMES.USERS, "ID", payload.ID);
  return { deleted: payload.ID };
}

// ============================================================================
// MODUL A: ABSEN GURU (GEOFENCING) + JURNAL MENGAJAR
// ============================================================================

// payload: { ID_Guru, Nama_Guru, Lat, Long, tipe: "masuk"|"pulang" }
function timeToMinutes(hhmm) {
  const parts = String(hhmm).split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

// Mengembalikan menit-sekarang (00:00=0) dan hari ISO (1=Senin ... 5=Jumat ... 7=Minggu) di zona waktu sekolah
function getWaktuSekarang() {
  const now = new Date();
  const hhmm = Utilities.formatDate(now, CONFIG.TIMEZONE, "HH:mm").split(":");
  const menit = Number(hhmm[0]) * 60 + Number(hhmm[1]);
  const isoDay = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, "u"));
  return { menit: menit, isoDay: isoDay };
}

function apiAbsenGuru(payload) {
  const jarak = haversineMeters(CONFIG.SCHOOL_LAT, CONFIG.SCHOOL_LNG, payload.Lat, payload.Long);
  if (jarak > CONFIG.RADIUS_GURU_METER) {
    throw new Error("Anda Berada Diluar Radius Sekolah (jarak " + Math.round(jarak) + " m, maksimal " + CONFIG.RADIUS_GURU_METER + " m).");
  }

  const waktu = getWaktuSekarang();
  const isJumat = waktu.isoDay === 5;
  const batasMasuk = timeToMinutes(isJumat ? CONFIG.BATAS_ABSEN_MASUK_JUMAT : CONFIG.BATAS_ABSEN_MASUK_NORMAL);
  const jamStandar = timeToMinutes(CONFIG.JAM_MASUK_STANDAR);
  const batasPulang = timeToMinutes(CONFIG.JAM_MULAI_ABSEN_PULANG);

  const today = formatDateOnly(new Date());
  const now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "HH:mm:ss");

  const existing = readSheetAsObjects(SHEET_NAMES.ABSEN_GURU).find(function (r) {
    return r.ID_Guru === payload.ID_Guru && formatDateOnly(r.Tanggal) === today;
  });

  if (payload.tipe === "pulang") {
    if (waktu.menit < batasPulang) {
      throw new Error("Absen pulang baru bisa dilakukan setelah pukul " + CONFIG.JAM_MULAI_ABSEN_PULANG + ".");
    }
    if (!existing) throw new Error("Anda belum tercatat absen masuk hari ini.");
    updateRowByField(SHEET_NAMES.ABSEN_GURU, "ID", existing.ID, { Jam_Pulang: now });
    return { status: "Absen pulang tercatat", jam: now, telatMenit: 0 };
  }

  if (waktu.menit > batasMasuk) {
    throw new Error("Batas waktu absen masuk sudah lewat (pukul " + (isJumat ? CONFIG.BATAS_ABSEN_MASUK_JUMAT : CONFIG.BATAS_ABSEN_MASUK_NORMAL) + " untuk " + (isJumat ? "hari Jumat" : "hari ini") + ").");
  }
  if (existing) {
    throw new Error("Anda sudah melakukan absen masuk hari ini.");
  }

  const telatMenit = waktu.menit > jamStandar ? (waktu.menit - jamStandar) : 0;

  const obj = {
    ID: generateId("ABG"),
    ID_Guru: payload.ID_Guru,
    Nama_Guru: payload.Nama_Guru,
    Tanggal: today,
    Jam_Masuk: now,
    Jam_Pulang: "",
    Lat: payload.Lat,
    Long: payload.Long,
    Status: "Hadir",
    Keterangan: telatMenit > 0 ? ("Telat " + telatMenit + " menit") : "",
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.ABSEN_GURU, obj);
  return { status: "Absen masuk tercatat", jam: now, telatMenit: telatMenit };
}

function apiGetRiwayatAbsenGuru(payload) {
  return readSheetAsObjects(SHEET_NAMES.ABSEN_GURU)
    .filter(function (r) { return r.ID_Guru === payload.ID_Guru; })
    .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

// payload: seluruh field Jurnal_Mengajar, Kehadiran_Siswa (array) -> disimpan JSON,
// Foto_Base64 (opsional) -> diupload dulu ke Drive
function apiSaveJurnalMengajar(payload) {
  const obj = Object.assign({}, payload);
  obj.ID = generateId("JRM");
  obj.CreatedAt = new Date();
  obj.Kehadiran_Siswa_JSON = JSON.stringify(payload.Kehadiran_Siswa || []);
  delete obj.Kehadiran_Siswa;

  if (payload.Foto_Base64) {
    const uploaded = apiUploadPhoto({ base64Data: payload.Foto_Base64, fileName: "jurnal_" + obj.ID + ".jpg" });
    obj.Foto_URL = uploaded.url;
  }
  delete obj.Foto_Base64;

  appendRowFromObject(SHEET_NAMES.JURNAL_MENGAJAR, obj);

  // Sinkronkan kehadiran siswa ke Absen_Siswa_Reguler berdasarkan checklist guru
  const kehadiran = payload.Kehadiran_Siswa || []; // [{ID_Siswa, Nama_Siswa, Status}]
  kehadiran.forEach(function (k) {
    appendRowFromObject(SHEET_NAMES.ABSEN_SISWA_REGULER, {
      ID: generateId("ABS"),
      ID_Siswa: k.ID_Siswa,
      Nama_Siswa: k.Nama_Siswa,
      Kelas: payload.Kelas,
      Tanggal: payload.Tanggal,
      Jam: payload.Jam_Ke,
      Mapel: payload.Mapel,
      ID_Guru: payload.ID_Guru,
      Status: k.Status,
      Sumber: "Jurnal Mengajar",
      CreatedAt: new Date()
    });
  });

  return obj;
}

function apiGetJurnalMengajarByGuru(payload) {
  return readSheetAsObjects(SHEET_NAMES.JURNAL_MENGAJAR)
    .filter(function (r) { return r.ID_Guru === payload.ID_Guru; })
    .map(function (r) { r.Kehadiran_Siswa = safeParseJson(r.Kehadiran_Siswa_JSON); return r; })
    .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

function safeParseJson(str) {
  try { return JSON.parse(str); } catch (e) { return []; }
}

// payload: { Kelas, Tanggal } -> daftar siswa kelas tsb, dipisah: sudah absen masuk (gerbang QR pribadi)
// dan belum absen masuk pada tanggal tersebut. Dipakai Jurnal Mengajar untuk memilih kehadiran
// tanpa perlu scan QR ulang oleh guru mata pelajaran.
function apiGetStatusAbsenHarianKelas(payload) {
  const tanggalTarget = formatDateOnly(payload.Tanggal);
  const users = readSheetAsObjects(SHEET_NAMES.USERS).filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.Kelas_Diampu === payload.Kelas;
  });
  const absenHarian = readSheetAsObjects(SHEET_NAMES.ABSEN_HARIAN_SISWA).filter(function (r) {
    return formatDateOnly(r.Tanggal) === tanggalTarget && r.Jam_Masuk;
  });
  const absenMap = {};
  absenHarian.forEach(function (r) { absenMap[r.ID_Siswa] = r.Jam_Masuk; });

  const sudahAbsen = [];
  const belumAbsen = [];
  users.forEach(function (u) {
    if (absenMap[u.ID]) {
      sudahAbsen.push({ ID_Siswa: u.ID, Nama: u.Nama, Jam_Masuk: absenMap[u.ID] });
    } else {
      belumAbsen.push({ ID_Siswa: u.ID, Nama: u.Nama });
    }
  });
  return { sudahAbsen: sudahAbsen, belumAbsen: belumAbsen };
}

// ============================================================================
// MODUL B/D: QR CODE ABSEN SISWA REGULER
// ============================================================================

// Guru membuat sesi QR untuk kelas & jam tertentu, siswa scan token ini
function apiGenerateQrSession(payload) {
  const token = generateId("QR");
  const expiredAt = new Date(new Date().getTime() + (payload.durasiMenit || 15) * 60000);
  const obj = {
    ID: generateId("QRS"),
    ID_Guru: payload.ID_Guru,
    Kelas: payload.Kelas,
    Mapel: payload.Mapel,
    Tanggal: formatDateOnly(new Date()),
    Jam: payload.Jam_Ke,
    Token: token,
    ExpiredAt: expiredAt,
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.QR_SESSIONS, obj);
  return obj;
}

// payload: { Token, ID_Siswa, Nama_Siswa, Kelas }
function apiAbsenSiswaViaQr(payload) {
  const sessions = readSheetAsObjects(SHEET_NAMES.QR_SESSIONS);
  const session = sessions.find(function (s) { return s.Token === payload.Token; });
  if (!session) throw new Error("QR Code tidak valid.");
  if (new Date(session.ExpiredAt) < new Date()) throw new Error("QR Code sudah kedaluwarsa.");

  const already = readSheetAsObjects(SHEET_NAMES.ABSEN_SISWA_REGULER).find(function (r) {
    return r.ID_Siswa === payload.ID_Siswa && r.Tanggal === session.Tanggal && r.Jam === session.Jam;
  });
  if (already) throw new Error("Anda sudah absen untuk sesi ini.");

  const obj = {
    ID: generateId("ABS"),
    ID_Siswa: payload.ID_Siswa,
    Nama_Siswa: payload.Nama_Siswa,
    Kelas: session.Kelas,
    Tanggal: session.Tanggal,
    Jam: session.Jam,
    Mapel: session.Mapel,
    ID_Guru: session.ID_Guru,
    Status: "Hadir",
    Sumber: "Scan QR",
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.ABSEN_SISWA_REGULER, obj);
  return { status: "Absen berhasil dicatat via QR" };
}

function apiGetRekapAbsenSiswa(payload) {
  let rows = readSheetAsObjects(SHEET_NAMES.ABSEN_SISWA_REGULER)
    .filter(function (r) { return r.ID_Siswa === payload.ID_Siswa; });
  if (payload.startDate && payload.endDate) {
    rows = rows.filter(function (r) {
      const t = new Date(r.Tanggal).getTime();
      return t >= new Date(payload.startDate).getTime() && t <= new Date(payload.endDate).getTime();
    });
  }
  return rows.sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

// ============================================================================
// MODUL D: SISWA KELAS XII - PKL (GPS + JURNAL HARIAN)
// ============================================================================

function apiGetInfoPklSiswa(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswa = users.find(function (u) { return u.ID === payload.ID_Siswa; });
  if (!siswa) throw new Error("Data siswa tidak ditemukan.");

  const mulai = siswa.Tanggal_Mulai_PKL ? new Date(siswa.Tanggal_Mulai_PKL) : null;
  const selesai = siswa.Tanggal_Selesai_PKL ? new Date(siswa.Tanggal_Selesai_PKL) : null;
  const now = new Date();
  let sisaHari = null;
  if (selesai) {
    sisaHari = Math.max(0, Math.ceil((selesai.getTime() - now.getTime()) / 86400000));
  }

  const jurnalHariIni = readSheetAsObjects(SHEET_NAMES.JURNAL_ABSEN_PKL).find(function (r) {
    return r.ID_Siswa === payload.ID_Siswa && formatDateOnly(r.Tanggal) === formatDateOnly(now);
  });

  const riwayatKehadiran = readSheetAsObjects(SHEET_NAMES.JURNAL_ABSEN_PKL)
    .filter(function (r) { return r.ID_Siswa === payload.ID_Siswa; });

  return {
    Tempat_PKL: siswa.Tempat_PKL,
    Pembimbing_Lapangan_PKL: siswa.Pembimbing_Lapangan_PKL,
    Guru_Wali_Nama: siswa.Guru_Wali_Nama,
    Guru_Pembimbing_PKL: siswa.Guru_Pembimbing_PKL,
    Lat_PKL: siswa.Lat_PKL,
    Long_PKL: siswa.Long_PKL,
    Tanggal_Mulai_PKL: siswa.Tanggal_Mulai_PKL,
    Tanggal_Selesai_PKL: siswa.Tanggal_Selesai_PKL,
    Sisa_Hari_PKL: sisaHari,
    Sudah_Isi_Jurnal_Hari_Ini: !!jurnalHariIni,
    Jumlah_Kehadiran: riwayatKehadiran.filter(function (r) { return r.Status === "Hadir"; }).length,
    Riwayat_Kehadiran: riwayatKehadiran.sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); })
  };
}

// Gerbang: siswa WAJIB isi jurnal dulu sebelum tombol absen terbuka.
// payload: { ID_Siswa, Nama_Siswa, Kegiatan_PKL, Foto_Base64 }
function apiSaveJurnalPkl(payload) {
  const today = formatDateOnly(new Date());
  const already = readSheetAsObjects(SHEET_NAMES.JURNAL_ABSEN_PKL).find(function (r) {
    return r.ID_Siswa === payload.ID_Siswa && formatDateOnly(r.Tanggal) === today;
  });
  if (already) throw new Error("Jurnal PKL hari ini sudah diisi.");

  let fotoUrl = "";
  if (payload.Foto_Base64) {
    fotoUrl = apiUploadPhoto({ base64Data: payload.Foto_Base64, fileName: "pkl_" + payload.ID_Siswa + "_" + today + ".jpg" }).url;
  }

  const obj = {
    ID: generateId("PKL"),
    ID_Siswa: payload.ID_Siswa,
    Nama_Siswa: payload.Nama_Siswa,
    Tanggal: today,
    Jam: "",
    Kegiatan_PKL: payload.Kegiatan_PKL,
    Foto_URL: fotoUrl,
    Lat: "",
    Long: "",
    Jarak_Meter: "",
    Status: "Jurnal Terisi - Menunggu Absen",
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.JURNAL_ABSEN_PKL, obj);
  return obj;
}

// Setelah jurnal terisi, siswa baru boleh absen dengan validasi GPS radius 100m
// payload: { ID_Siswa, Lat, Long }
function apiAbsenPkl(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswa = users.find(function (u) { return u.ID === payload.ID_Siswa; });
  if (!siswa) throw new Error("Data siswa tidak ditemukan.");
  if (!siswa.Lat_PKL || !siswa.Long_PKL) throw new Error("Koordinat lokasi PKL belum diatur oleh Admin.");

  const today = formatDateOnly(new Date());
  const jurnal = readSheetAsObjects(SHEET_NAMES.JURNAL_ABSEN_PKL).find(function (r) {
    return r.ID_Siswa === payload.ID_Siswa && formatDateOnly(r.Tanggal) === today;
  });
  if (!jurnal) throw new Error("Isi Jurnal Harian PKL terlebih dahulu sebelum melakukan absen.");
  if (jurnal.Status === "Hadir") throw new Error("Anda sudah absen PKL hari ini.");

  const jarak = haversineMeters(siswa.Lat_PKL, siswa.Long_PKL, payload.Lat, payload.Long);
  if (jarak > CONFIG.RADIUS_PKL_METER) {
    throw new Error("Anda Berada Diluar Radius Lokasi PKL (jarak " + Math.round(jarak) + " m, maksimal " + CONFIG.RADIUS_PKL_METER + " m).");
  }

  updateRowByField(SHEET_NAMES.JURNAL_ABSEN_PKL, "ID", jurnal.ID, {
    Jam: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "HH:mm:ss"),
    Lat: payload.Lat,
    Long: payload.Long,
    Jarak_Meter: Math.round(jarak),
    Status: "Hadir"
  });
  return { status: "Absen PKL berhasil dicatat", jarak: Math.round(jarak) };
}

// ============================================================================
// MODUL D: JURNAL KARAKTER 7KAIH (SEMUA SISWA)
// ============================================================================

function apiSaveJurnal7Kaih(payload) {
  const today = formatDateOnly(new Date());
  const already = readSheetAsObjects(SHEET_NAMES.JURNAL_7KAIH).find(function (r) {
    return r.ID_Siswa === payload.ID_Siswa && formatDateOnly(r.Tanggal) === today;
  });
  const obj = Object.assign({}, payload);
  obj.Tanggal = today;
  obj.Olahraga_Kegiatan_JSON = JSON.stringify(payload.Olahraga_Kegiatan || []);
  delete obj.Olahraga_Kegiatan;

  if (already) {
    obj.ID = already.ID;
    updateRowByField(SHEET_NAMES.JURNAL_7KAIH, "ID", already.ID, obj);
  } else {
    obj.ID = generateId("KAIH");
    obj.CreatedAt = new Date();
    appendRowFromObject(SHEET_NAMES.JURNAL_7KAIH, obj);
  }
  return obj;
}

function apiGetJurnal7KaihBySiswa(payload) {
  return readSheetAsObjects(SHEET_NAMES.JURNAL_7KAIH)
    .filter(function (r) { return r.ID_Siswa === payload.ID_Siswa; })
    .map(function (r) { r.Olahraga_Kegiatan = safeParseJson(r.Olahraga_Kegiatan_JSON); return r; })
    .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

// ============================================================================
// MODUL E: JURNAL BIMBINGAN (GURU WALI / WALI KELAS) - 11 ASPEK
// ============================================================================

function apiSaveJurnalBimbingan(payload) {
  const obj = Object.assign({}, payload);
  obj.ID = generateId("BMB");
  obj.CreatedAt = new Date();
  appendRowFromObject(SHEET_NAMES.JURNAL_BIMBINGAN, obj);
  return obj;
}

function apiGetJurnalBimbinganByGuru(payload) {
  return readSheetAsObjects(SHEET_NAMES.JURNAL_BIMBINGAN)
    .filter(function (r) { return r.ID_Guru === payload.ID_Guru; })
    .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

// ============================================================================
// MODUL GURU: JURNAL KEGIATAN MGMP
// ============================================================================

// payload: { ID_Guru, Nama_Guru, Hari, Tanggal, Uraian_Kegiatan, Foto_Base64 }
function apiSaveJurnalMgmp(payload) {
  const obj = Object.assign({}, payload);
  obj.ID = generateId("MGMP");
  obj.CreatedAt = new Date();
  if (payload.Foto_Base64) {
    const uploaded = apiUploadPhoto({ base64Data: payload.Foto_Base64, fileName: "mgmp_" + obj.ID + ".jpg" });
    obj.Foto_URL = uploaded.url;
  }
  delete obj.Foto_Base64;
  appendRowFromObject(SHEET_NAMES.JURNAL_MGMP, obj);
  return obj;
}

function apiGetJurnalMgmpByGuru(payload) {
  return readSheetAsObjects(SHEET_NAMES.JURNAL_MGMP)
    .filter(function (r) { return r.ID_Guru === payload.ID_Guru; })
    .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

// ============================================================================
// MODUL B: REKAP KEHADIRAN KELAS (WALI KELAS) - UNTUK CETAK
// ============================================================================

// payload: { Kelas, startDate, endDate }
function apiGetRekapKehadiranKelas(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswaKelas = users.filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.Kelas_Diampu === payload.Kelas;
  });

  const absen = readSheetAsObjects(SHEET_NAMES.ABSEN_SISWA_REGULER).filter(function (r) {
    if (r.Kelas !== payload.Kelas) return false;
    if (payload.startDate && payload.endDate) {
      const t = new Date(r.Tanggal).getTime();
      return t >= new Date(payload.startDate).getTime() && t <= new Date(payload.endDate).getTime();
    }
    return true;
  });

  return siswaKelas.map(function (siswa) {
    const rekapSiswa = absen.filter(function (a) { return a.ID_Siswa === siswa.ID; });
    const hitung = { Hadir: 0, Sakit: 0, Izin: 0, Alfa: 0 };
    rekapSiswa.forEach(function (r) {
      if (hitung[r.Status] !== undefined) hitung[r.Status]++;
    });
    return {
      ID_Siswa: siswa.ID,
      Nama_Siswa: siswa.Nama,
      NISN: siswa.Identitas_NIP_NISN,
      Detail_Harian: rekapSiswa.map(function (r) { return { Tanggal: r.Tanggal, Status: r.Status, Mapel: r.Mapel }; }),
      Hadir: hitung.Hadir,
      Sakit: hitung.Sakit,
      Izin: hitung.Izin,
      Alfa: hitung.Alfa
    };
  });
}

// ============================================================================
// ABSEN HARIAN SISWA VIA QR PRIBADI (discan oleh akun Guru/Tata Usaha)
// ============================================================================
// Catatan: kolom "QR_Token" di Users_Master sekarang berfungsi sebagai SEED
// permanen (dibuat sekali saat data siswa disimpan, tidak pernah berubah).
// Kode QR yang benar-benar ditampilkan & dipindai berubah SETIAP HARI, yaitu
// hasil hash dari (seed + tanggal hari ini). Ini membuat QR tidak bisa
// dipakai ulang di hari lain seandainya difoto/disebar oleh siswa lain.

function md5Hex(str) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

function kodeQrHarian(seed, tanggalStr) {
  return md5Hex(seed + "|" + tanggalStr).substring(0, 10).toUpperCase();
}

// payload: { ID_Siswa } -> kode QR yang berlaku hari ini untuk siswa tsb
function apiGetKodeQrHarianSiswa(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswa = users.find(function (u) { return u.ID === payload.ID_Siswa; });
  if (!siswa || !siswa.QR_Token) throw new Error("Data QR siswa tidak ditemukan.");
  const today = formatDateOnly(new Date());
  return { kode: kodeQrHarian(siswa.QR_Token, today), tanggal: today };
}

// payload: { QR_Token (kode yang discan, bukan seed), ID_Guru, Nama_Guru, tipe: "masuk" | "pulang" }
function apiAbsenHarianViaQr(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const today = formatDateOnly(new Date());
  const siswa = users.find(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.QR_Token && kodeQrHarian(u.QR_Token, today) === String(payload.QR_Token).toUpperCase();
  });
  if (!siswa) throw new Error("QR Code tidak dikenali, bukan milik siswa terdaftar, atau sudah kedaluwarsa (QR berlaku 1 hari).");

  const now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "HH:mm:ss");
  const existing = readSheetAsObjects(SHEET_NAMES.ABSEN_HARIAN_SISWA).find(function (r) {
    return r.ID_Siswa === siswa.ID && formatDateOnly(r.Tanggal) === today;
  });

  if (payload.tipe === "pulang") {
    if (!existing) throw new Error(siswa.Nama + " belum tercatat absen masuk hari ini.");
    if (existing.Jam_Pulang) throw new Error(siswa.Nama + " sudah tercatat absen pulang hari ini.");
    updateRowByField(SHEET_NAMES.ABSEN_HARIAN_SISWA, "ID", existing.ID, { Jam_Pulang: now });
    kirimNotifikasiOrangTua(siswa, "pulang", today, now);
    return { status: "Absen pulang " + siswa.Nama + " tercatat", jam: now, nama: siswa.Nama };
  }

  if (existing) throw new Error(siswa.Nama + " sudah tercatat absen masuk hari ini.");
  const obj = {
    ID: generateId("AHS"),
    ID_Siswa: siswa.ID,
    Nama_Siswa: siswa.Nama,
    Kelas: siswa.Kelas_Diampu,
    Tanggal: today,
    Jam_Masuk: now,
    Jam_Pulang: "",
    ID_Guru_Pencatat: payload.ID_Guru,
    Nama_Guru_Pencatat: payload.Nama_Guru,
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.ABSEN_HARIAN_SISWA, obj);
  kirimNotifikasiOrangTua(siswa, "masuk", today, now);
  return { status: "Absen masuk " + siswa.Nama + " tercatat", jam: now, nama: siswa.Nama };
}

// ============================================================================
// NOTIFIKASI WHATSAPP
// ============================================================================
// CATATAN PENTING: Google Apps Script tidak bisa mengirim WhatsApp secara
// langsung (tidak ada API resmi gratis dari WhatsApp/Meta untuk ini tanpa
// verifikasi bisnis). Solusi paling praktis untuk sekolah di Indonesia adalah
// memakai layanan gateway pihak ketiga yang menghubungkan nomor WhatsApp
// biasa (di-scan sekali via QR) ke sebuah REST API, misalnya Fonnte, Wablas,
// atau Whacenter. Kode di bawah ini sudah disiapkan mengikuti pola Fonnte
// (https://fonnte.com), karena paling umum dipakai & murah untuk kasus
// seperti ini. Langkah setup singkat:
//   1. Daftar & scan QR nomor WhatsApp sekolah/admin di layanan pilihan Anda.
//   2. Salin API Token yang diberikan, isi ke CONFIG.WA_TOKEN.
//   3. Ubah CONFIG.WA_AKTIF menjadi true.
//   4. Kalau memakai gateway lain (bukan Fonnte), sesuaikan format
//      payload di fungsi kirimWA() sesuai dokumentasi gateway tsb.

function kirimWA(nomorTujuan, pesan) {
  if (!CONFIG.WA_AKTIF) return; // belum diaktifkan, lewati diam-diam
  if (!nomorTujuan) return; // nomor HP belum diisi di data siswa/guru
  try {
    UrlFetchApp.fetch(CONFIG.WA_GATEWAY_URL, {
      method: "post",
      headers: { Authorization: CONFIG.WA_TOKEN },
      payload: { target: String(nomorTujuan), message: pesan },
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log("Gagal mengirim WhatsApp ke " + nomorTujuan + ": " + e.message);
  }
}

function formatTanggalPanjangIndo(dateStr) {
  const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const d = new Date(dateStr);
  return d.getDate() + " " + namaBulan[d.getMonth()] + " " + d.getFullYear();
}

function kirimNotifikasiOrangTua(siswa, tipe, tanggal, jam) {
  if (!siswa.No_HP_OrangTua) return;
  const aksi = tipe === "masuk" ? "sudah masuk sekolah" : "sudah pulang sekolah";
  const pesan = "Ananda " + siswa.Nama + " " + aksi + " pada tanggal " + formatTanggalPanjangIndo(tanggal) + ", jam " + jam + ".";
  kirimWA(siswa.No_HP_OrangTua, pesan);
}

// Dipanggil otomatis tiap hari pukul 10:00 lewat trigger (lihat setupTriggerCekAbsen).
// Mengecek siswa yang belum absen masuk, lalu mengirim WA ke masing-masing Guru Wali.
function cekSiswaBelumAbsenPagi() {
  const today = formatDateOnly(new Date());
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswaAll = users.filter(function (u) { return parseRoles(u.Role_List).indexOf("Siswa") !== -1; });
  const sudahSet = {};
  readSheetAsObjects(SHEET_NAMES.ABSEN_HARIAN_SISWA).forEach(function (r) {
    if (formatDateOnly(r.Tanggal) === today && r.Jam_Masuk) sudahSet[r.ID_Siswa] = true;
  });
  const belum = siswaAll.filter(function (s) { return !sudahSet[s.ID]; });
  if (belum.length === 0) return;

  const byGuruWali = {};
  belum.forEach(function (s) {
    const namaWali = s.Guru_Wali_Nama || "(Belum ada Guru Wali)";
    byGuruWali[namaWali] = byGuruWali[namaWali] || [];
    byGuruWali[namaWali].push(s);
  });

  Object.keys(byGuruWali).forEach(function (namaGuruWali) {
    const guru = users.find(function (u) { return u.Nama === namaGuruWali; });
    if (!guru || !guru.No_HP) return;
    const daftar = byGuruWali[namaGuruWali].map(function (s) { return "- " + s.Nama + " (" + s.Kelas_Diampu + ")"; }).join("\n");
    const pesan = "Pemberitahuan SIAKAD ESEMKASA:\nSampai pukul " + CONFIG.JAM_BATAS_CEK_BELUM_ABSEN + " hari ini (" + formatTanggalPanjangIndo(today) + "), siswa perwalian Bapak/Ibu berikut belum tercatat absen masuk:\n" + daftar;
    kirimWA(guru.No_HP, pesan);
  });
}

// Jalankan fungsi ini SEKALI SAJA secara manual dari editor Apps Script
// (pilih di dropdown toolbar, klik Run) untuk memasang jadwal otomatis
// pengecekan siswa belum absen setiap pukul 10:00.
function setupTriggerCekAbsen() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "cekSiswaBelumAbsenPagi") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("cekSiswaBelumAbsenPagi").timeBased().everyDays(1).atHour(10).nearMinute(0).create();
  return "Trigger terpasang: cekSiswaBelumAbsenPagi akan berjalan otomatis setiap hari sekitar pukul 10:00.";
}

// ============================================================================
// KALENDER HARI LIBUR (dikelola Admin, dipakai saat mencetak rekap bulanan)
// ============================================================================

function apiSaveHariLibur(payload) {
  const obj = {
    ID: generateId("LBR"),
    Tanggal: payload.Tanggal,
    Keterangan: payload.Keterangan || "",
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.HARI_LIBUR, obj);
  return obj;
}

// payload: { bulan (1-12), tahun }
function apiGetHariLibur(payload) {
  const all = readSheetAsObjects(SHEET_NAMES.HARI_LIBUR);
  if (!payload.bulan || !payload.tahun) return all;
  return all.filter(function (r) {
    const d = new Date(r.Tanggal);
    return (d.getMonth() + 1) === Number(payload.bulan) && d.getFullYear() === Number(payload.tahun);
  });
}

function apiDeleteHariLibur(payload) {
  deleteRowByField(SHEET_NAMES.HARI_LIBUR, "ID", payload.ID);
  return { deleted: payload.ID };
}

function getJumlahHariDalamBulan(bulan, tahun) {
  return new Date(tahun, bulan, 0).getDate();
}

// true jika tanggal tsb Sabtu/Minggu ATAU ada di daftar Hari_Libur
function isHariLibur(dateObj, liburSet) {
  const day = dateObj.getDay(); // 0=Minggu, 6=Sabtu
  if (day === 0 || day === 6) return true;
  const key = Utilities.formatDate(dateObj, CONFIG.TIMEZONE, "yyyy-MM-dd");
  return liburSet.indexOf(key) !== -1;
}

// Menentukan "Jabatan" tampilan dari daftar role seorang pegawai
function resolveJabatan(roles) {
  if (roles.indexOf("Kepala Sekolah") !== -1) return "Kepala Sekolah";
  if (roles.indexOf("Tata Usaha") !== -1) return "Tata Usaha";
  if (roles.indexOf("Waka Kurikulum") !== -1) return "Waka Kurikulum";
  if (roles.indexOf("Waka Hubmi") !== -1) return "Waka Hubmi";
  if (roles.some(function (r) { return r.toLowerCase().indexOf("guru") !== -1; })) return "Guru";
  return roles.join(", ") || "-";
}

// payload: { bulan, tahun } -> rekap absensi guru & pegawai selama satu bulan penuh
function apiGetRekapAbsensiGuruBulanan(payload) {
  const bulan = Number(payload.bulan);
  const tahun = Number(payload.tahun);
  const jumlahHari = getJumlahHariDalamBulan(bulan, tahun);
  const liburList = apiGetHariLibur({ bulan: bulan, tahun: tahun }).map(function (l) { return formatDateOnly(l.Tanggal); });

  const users = readSheetAsObjects(SHEET_NAMES.USERS).filter(function (u) {
    const roles = parseRoles(u.Role_List);
    return roles.indexOf("Siswa") === -1 && roles.indexOf("Admin") === -1 && roles.length > 0;
  });
  const absenGuru = readSheetAsObjects(SHEET_NAMES.ABSEN_GURU);

  const hariEfektif = [];
  for (let d = 1; d <= jumlahHari; d++) {
    const tgl = new Date(tahun, bulan - 1, d);
    if (!isHariLibur(tgl, liburList)) hariEfektif.push(d);
  }

  const rows = users.map(function (u) {
    const roles = parseRoles(u.Role_List);
    const recAll = absenGuru.filter(function (r) { return r.ID_Guru === u.ID; });
    const hadirSet = {};
    recAll.forEach(function (r) {
      const d = new Date(r.Tanggal);
      if ((d.getMonth() + 1) === bulan && d.getFullYear() === tahun && r.Jam_Masuk) {
        hadirSet[d.getDate()] = true;
      }
    });
    const harian = [];
    let jumlahHadir = 0;
    for (let d = 1; d <= jumlahHari; d++) {
      const tgl = new Date(tahun, bulan - 1, d);
      const libur = isHariLibur(tgl, liburList);
      let status;
      if (libur) { status = "LIBUR"; }
      else if (hadirSet[d]) { status = "IN"; jumlahHadir++; }
      else { status = "X"; }
      harian.push({ tanggal: d, status: status });
    }
    const persentase = hariEfektif.length ? Math.round((jumlahHadir / hariEfektif.length) * 100) : 0;
    return {
      ID: u.ID,
      Nama: u.Nama,
      NIP: u.Identitas_NIP_NISN,
      Jabatan: resolveJabatan(roles),
      Harian: harian,
      Hari_Efektif: hariEfektif.length,
      Jumlah_Hadir: jumlahHadir,
      Persentase: persentase
    };
  });

  rows.sort(function (a, b) {
    if (a.Jabatan === "Kepala Sekolah" && b.Jabatan !== "Kepala Sekolah") return -1;
    if (b.Jabatan === "Kepala Sekolah" && a.Jabatan !== "Kepala Sekolah") return 1;
    return compareNip(a.NIP, b.NIP);
  });

  return { bulan: bulan, tahun: tahun, jumlahHariDalamBulan: jumlahHari, hariEfektif: hariEfektif.length, data: rows };
}

// Mengambil "tahun pengangkatan pegawai" dari NIP format Indonesia (18 digit):
// digit 1-8 = tanggal lahir (YYYYMMDD), digit 9-12 = tahun TMT pengangkatan (YYYY), dst.
// Semakin kecil tahun ini, semakin dulu diangkat, sehingga ditempatkan lebih atas.
function ambilTahunPengangkatan(nip) {
  const digitsOnly = String(nip).replace(/\D/g, "");
  if (digitsOnly.length >= 12) {
    const tahun = Number(digitsOnly.substring(8, 12));
    if (!isNaN(tahun) && tahun > 1900 && tahun < 2100) return tahun;
  }
  return null;
}

// Membandingkan NIP berdasarkan tahun pengangkatan (digit ke-9 s.d. 12); fallback ke urutan NIP penuh jika format tidak dikenali
function compareNip(a, b) {
  const ta = ambilTahunPengangkatan(a);
  const tb = ambilTahunPengangkatan(b);
  if (ta !== null && tb !== null && ta !== tb) return ta - tb;
  const na = Number(String(a).replace(/\D/g, ""));
  const nb = Number(String(b).replace(/\D/g, ""));
  if (!isNaN(na) && !isNaN(nb) && na !== 0 && nb !== 0) return na - nb;
  return String(a).localeCompare(String(b));
}

// payload: { bulan, tahun, kelas (opsional) } -> rekap absensi harian siswa (gerbang QR) selama satu bulan
function apiGetRekapAbsensiSiswaBulanan(payload) {
  const bulan = Number(payload.bulan);
  const tahun = Number(payload.tahun);
  const jumlahHari = getJumlahHariDalamBulan(bulan, tahun);
  const liburList = apiGetHariLibur({ bulan: bulan, tahun: tahun }).map(function (l) { return formatDateOnly(l.Tanggal); });

  let siswaList = readSheetAsObjects(SHEET_NAMES.USERS).filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1;
  });
  if (payload.kelas) siswaList = siswaList.filter(function (s) { return s.Kelas_Diampu === payload.kelas; });

  const absenHarian = readSheetAsObjects(SHEET_NAMES.ABSEN_HARIAN_SISWA);

  const hariEfektif = [];
  for (let d = 1; d <= jumlahHari; d++) {
    const tgl = new Date(tahun, bulan - 1, d);
    if (!isHariLibur(tgl, liburList)) hariEfektif.push(d);
  }

  const rows = siswaList.map(function (s) {
    const recAll = absenHarian.filter(function (r) { return r.ID_Siswa === s.ID; });
    const hadirSet = {};
    recAll.forEach(function (r) {
      const d = new Date(r.Tanggal);
      if ((d.getMonth() + 1) === bulan && d.getFullYear() === tahun && r.Jam_Masuk) {
        hadirSet[d.getDate()] = true;
      }
    });
    const harian = [];
    let jumlahHadir = 0;
    for (let d = 1; d <= jumlahHari; d++) {
      const tgl = new Date(tahun, bulan - 1, d);
      const libur = isHariLibur(tgl, liburList);
      let status;
      if (libur) { status = "LIBUR"; }
      else if (hadirSet[d]) { status = "IN"; jumlahHadir++; }
      else { status = "X"; }
      harian.push({ tanggal: d, status: status });
    }
    const persentase = hariEfektif.length ? Math.round((jumlahHadir / hariEfektif.length) * 100) : 0;
    return {
      ID: s.ID,
      Nama: s.Nama,
      NISN: s.Identitas_NIP_NISN,
      Kelas: s.Kelas_Diampu,
      Harian: harian,
      Hari_Efektif: hariEfektif.length,
      Jumlah_Hadir: jumlahHadir,
      Persentase: persentase
    };
  });

  rows.sort(function (a, b) { return (a.Kelas || "").localeCompare(b.Kelas || "") || a.Nama.localeCompare(b.Nama); });

  return { bulan: bulan, tahun: tahun, jumlahHariDalamBulan: jumlahHari, hariEfektif: hariEfektif.length, data: rows };
}



function apiGetDashboardManajemen(payload) {
  const today = formatDateOnly(new Date());

  const absenGuru = readSheetAsObjects(SHEET_NAMES.ABSEN_GURU).filter(function (r) { return formatDateOnly(r.Tanggal) === today; });
  const jurnalMengajar = readSheetAsObjects(SHEET_NAMES.JURNAL_MENGAJAR).filter(function (r) { return formatDateOnly(r.Tanggal) === today; });
  const absenSiswa = readSheetAsObjects(SHEET_NAMES.ABSEN_SISWA_REGULER).filter(function (r) { return formatDateOnly(r.Tanggal) === today; });
  const absenPkl = readSheetAsObjects(SHEET_NAMES.JURNAL_ABSEN_PKL).filter(function (r) { return formatDateOnly(r.Tanggal) === today; });
  const jurnal7kaih = readSheetAsObjects(SHEET_NAMES.JURNAL_7KAIH).filter(function (r) { return formatDateOnly(r.Tanggal) === today; });

  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const totalGuru = users.filter(function (u) { return parseRoles(u.Role_List).some(function (r) { return r.toLowerCase().indexOf("guru") !== -1; }); }).length;
  const totalSiswaReguler = users.filter(function (u) { return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.Kelas_Diampu && u.Kelas_Diampu.indexOf("XII") === -1; }).length;
  const totalSiswaPkl = users.filter(function (u) { return u.Kelas_Diampu && String(u.Kelas_Diampu).indexOf("XII") !== -1; }).length;

  // Siswa reguler unik yang sudah hadir hari ini (bisa tercatat >1x karena beda jam/mapel)
  const siswaHadirMap = {};
  absenSiswa.forEach(function (r) {
    if (r.Status === "Hadir") {
      siswaHadirMap[r.ID_Siswa] = { Nama: r.Nama_Siswa, Kelas: r.Kelas, Jam_Terakhir: r.Jam, Mapel_Terakhir: r.Mapel };
    }
  });

  return {
    tanggal: today,
    guru: {
      totalGuru: totalGuru,
      sudahAbsen: absenGuru.length,
      sudahJurnal: jurnalMengajar.length,
      persenHadir: totalGuru ? Math.round((absenGuru.length / totalGuru) * 100) : 0,
      listAbsen: absenGuru.map(function (r) { return { Nama: r.Nama_Guru, Jam_Masuk: r.Jam_Masuk, Jam_Pulang: r.Jam_Pulang }; }),
      listJurnal: jurnalMengajar.map(function (r) { return { Nama: r.Nama_Guru, Kelas: r.Kelas, Mapel: r.Mapel, Jam_Ke: r.Jam_Ke }; })
    },
    siswaReguler: {
      total: totalSiswaReguler,
      sudahScan: Object.keys(siswaHadirMap).length,
      persenHadir: totalSiswaReguler ? Math.round((Object.keys(siswaHadirMap).length / totalSiswaReguler) * 100) : 0,
      list: Object.keys(siswaHadirMap).map(function (id) { return siswaHadirMap[id]; })
    },
    siswaPkl: {
      total: totalSiswaPkl,
      sudahAbsen: absenPkl.filter(function (r) { return r.Status === "Hadir"; }).length,
      sudahJurnal: absenPkl.length,
      persenHadir: totalSiswaPkl ? Math.round((absenPkl.filter(function (r) { return r.Status === "Hadir"; }).length / totalSiswaPkl) * 100) : 0,
      detail: absenPkl.map(function (r) { return { Nama: r.Nama_Siswa, Status: r.Status, Jarak: r.Jarak_Meter, Jam: r.Jam }; })
    },
    karakter7kaih: {
      sudahMengisi: jurnal7kaih.length,
      list: jurnal7kaih.map(function (r) { return { Nama: r.Nama_Siswa, Bangun_Pagi_Jam: r.Bangun_Pagi_Jam }; })
    }
  };
}

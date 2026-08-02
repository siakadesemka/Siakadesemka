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
  SCHOOL_LAT: 4.391054,      // Ganti dengan koordinat sekolah Anda
  SCHOOL_LNG: 96.040818,      // Ganti dengan koordinat sekolah Anda
  CABANG_DINAS_LAT: 4.176717348593045,  // Koordinat Cabang Dinas Pendidikan (lokasi alternatif absen guru)
  CABANG_DINAS_LNG: 96.13676851392087,
  RADIUS_GURU_METER: 150,
  RADIUS_PKL_METER: 30,
  PHOTO_FOLDER_NAME: "SistemSekolah_Dokumentasi", // Folder Google Drive
  TIMEZONE: "GMT+7",

  // Aturan jam absensi guru/pegawai (jam masuk & pulang)
  BATAS_ABSEN_MASUK_NORMAL: "12:00",  // batas akhir absen masuk (Senin-Kamis, Sabtu)
  BATAS_ABSEN_MASUK_JUMAT: "11:00",   // batas akhir absen masuk khusus hari Jumat
  JAM_MASUK_STANDAR: "08:00",         // jam masuk normal, dipakai menghitung keterlambatan
  JAM_MULAI_ABSEN_PULANG: "12:00",    // absen pulang baru bisa dilakukan setelah jam ini (Senin-Kamis, Sabtu)
  JAM_MULAI_ABSEN_PULANG_JUMAT: "11:30", // absen pulang baru bisa dilakukan setelah jam ini khusus hari Jumat

  // Notifikasi WhatsApp (lihat catatan di fungsi kirimWA - pakai layanan gateway pihak ketiga, cth. Fonnte)
  WA_AKTIF: false,                     // ubah ke true setelah token diisi & sudah siap dipakai
  WA_GATEWAY_URL: "https://api.fonnte.com/send",
  WA_TOKEN: "ISI_TOKEN_GATEWAY_WA_ANDA",
  JAM_BATAS_CEK_BELUM_ABSEN: "10:00", // jam pengecekan siswa yang belum absen (untuk notifikasi ke Guru Wali)

  POIN_KURANG_KUNJUNGAN_PERPUS: 5, // poin pelanggaran berkurang/bonus otomatis per kunjungan perpustakaan (maks 1x/hari)
  HARI_LITERASI_QURAN: "Jumat",
  POIN_KURANG_LITERASI_QURAN: 5, // poin pelanggaran berkurang/bonus otomatis per kehadiran Literasi Al-Qur'an (maks 1x/hari, hanya hari Jumat)

  NIP_KEPALA_SEKOLAH: "198702062011031002" // NIP Kepala Sekolah, ditampilkan di blok tanda tangan cetak
};

// ============================================================================
// DAFTAR POIN PELANGGARAN SISWA (sumber kebenaran ada di server, tidak boleh
// dipercayakan ke input dari klien, supaya poin tidak bisa dimanipulasi)
// ============================================================================
const DAFTAR_PELANGGARAN = [
  // Kategori Ringan
  { kode: "R01", uraian: "Terlambat masuk sekolah", kategori: "Ringan", poin: 5 },
  { kode: "R02", uraian: "Tidak memakai atribut sekolah lengkap", kategori: "Ringan", poin: 5 },
  { kode: "R03", uraian: "Membuang Sampah Sembarangan", kategori: "Ringan", poin: 5 },
  { kode: "R04", uraian: "Makan/minum saat KBM berlangsung", kategori: "Ringan", poin: 5 },
  { kode: "R05", uraian: "Rambut/penampilan tidak sesuai tata tertib", kategori: "Ringan", poin: 10 },
  // Kategori Sedang
  { kode: "S01", uraian: "Tidak mengerjakan tugas/PR", kategori: "Sedang", poin: 15 },
  { kode: "S02", uraian: "Mengaktifkan/menggunakan HP saat KBM tanpa izin", kategori: "Sedang", poin: 15 },
  { kode: "S03", uraian: "Membolos / keluar lingkungan sekolah tanpa izin", kategori: "Sedang", poin: 25 },
  { kode: "S04", uraian: "Berkata tidak sopan kepada guru/staf", kategori: "Sedang", poin: 25 },
  { kode: "S05", uraian: "Merokok di lingkungan sekolah", kategori: "Sedang", poin: 30 },
  // Kategori Berat
  { kode: "B01", uraian: "Berkelahi dengan sesama siswa", kategori: "Berat", poin: 75 },
  { kode: "B02", uraian: "Membawa/menggunakan rokok elektrik (vape)", kategori: "Berat", poin: 75 },
  { kode: "B03", uraian: "Membawa senjata tajam tanpa keperluan sah", kategori: "Berat", poin: 100 },
  { kode: "B04", uraian: "Mencuri barang milik sekolah/orang lain", kategori: "Berat", poin: 100 },
  { kode: "B05", uraian: "Membawa/menggunakan narkoba atau minuman keras", kategori: "Berat", poin: 100 },
  { kode: "B06", uraian: "Melakukan tindakan asusila", kategori: "Berat", poin: 100 }
];

function cariPelanggaranByKode(kode) {
  return DAFTAR_PELANGGARAN.find(function (p) { return p.kode === kode; }) || null;
}

// Guru_Pembimbing_PKL disimpan sebagai teks dipisah koma (mendukung lebih dari
// satu guru pembimbing untuk satu siswa PKL). Helper ini mem-parsing jadi array
// nama yang sudah di-trim, membuang entri kosong.
// Memecah daftar BEBERAPA nama guru pembimbing PKL (field Guru_Pembimbing_PKL).
// PENTING: nama guru di sekolah ini biasa mengandung koma pada gelarnya sendiri
// (mis. "JAMALI, S. Pd"), jadi field multi-guru TIDAK BISA dipisah pakai koma biasa
// (akan salah memecah "JAMALI, S. Pd" jadi dua: "JAMALI" dan "S. Pd"). Karena itu,
// saat menyimpan lebih dari satu pembimbing, dipisah dengan " | " (lihat frontend
// PilihGuruPembimbingPkl). Untuk data LAMA yang terlanjur tersimpan dipisah koma
// biasa: kalau tidak ada tanda " | " sama sekali, seluruh teks dianggap SATU nama
// utuh (ini benar untuk kasus 1 pembimbing, yang paling umum). Kalau memang ada
// lebih dari satu pembimbing tersimpan format lama, Admin perlu membuka & simpan
// ulang data siswa tsb sekali saja supaya otomatis berpindah ke format baru.
function parseNamaGuruList(str) {
  const s = String(str || "").trim();
  if (!s) return [];
  if (s.indexOf(" | ") !== -1) {
    return s.split(" | ").map(function (x) { return x.trim(); }).filter(Boolean);
  }
  return [s];
}

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
  JURNAL_MGMP: "Jurnal_MGMP",
  POIN_PELANGGARAN: "Poin_Pelanggaran_Siswa",
  ABSEN_PERPUSTAKAAN: "Absen_Perpustakaan",
  ABSEN_LITERASI_QURAN: "Absen_Literasi_Quran",
  DOKUMEN_SEKOLAH: "Dokumen_Sekolah",
  KEHADIRAN_MENGAJAR_GURU: "Kehadiran_Mengajar_Guru",
  TINDAK_LANJUT_SISWA: "Tindak_Lanjut_Siswa",
  TUJUAN_PEMBELAJARAN: "Tujuan_Pembelajaran",
  PENILAIAN_MASTER: "Penilaian_Master",
  NILAI_SISWA: "Nilai_Siswa"
};

// Definisi header setiap sheet. setupDatabase() akan membuat sheet + header
// ini secara otomatis jika belum ada.
const SHEET_SCHEMAS = {
  Users_Master: [
    "ID", "Nama", "Role_List", "Identitas_NIP_NISN", "Password",
    "Kelas_Diampu", "Mapel_Diampu", "Roster_Mengajar_JSON", "Guru_Wali_Nama",
    "Guru_Pembimbing_PKL", "Pembimbing_Lapangan_PKL", "Tempat_PKL",
    "Lat_PKL", "Long_PKL", "Tanggal_Mulai_PKL", "Tanggal_Selesai_PKL",
    "QR_Token", "No_HP", "No_HP_OrangTua", "Kelas_Wali", "Kompetensi_Keahlian",
    "Hari_Piket", "Tempat_Lahir", "Tanggal_Lahir", "Nama_Ayah", "Nama_Ibu",
    "Alamat_Siswa", "CreatedAt"
  ],
  Absen_Guru: [
    "ID", "ID_Guru", "Nama_Guru", "Tanggal", "Jam_Masuk", "Jam_Pulang",
    "Lat", "Long", "Lokasi_Absen", "Status", "Keterangan", "CreatedAt"
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
    "ID", "ID_Guru", "Nama_Guru", "NIP_Guru", "ID_Siswa", "Nama_Siswa", "Tanggal",
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
  ],
  Poin_Pelanggaran_Siswa: [
    "ID", "ID_Siswa", "Nama_Siswa", "Kelas", "Tanggal", "ID_Guru", "Nama_Guru",
    "Kode_Pelanggaran", "Uraian", "Kategori", "Poin", "Tipe", "Keterangan", "CreatedAt"
  ],
  Absen_Perpustakaan: [
    "ID", "ID_Siswa", "Nama_Siswa", "Kelas", "Tanggal", "Jam", "ID_Staff", "Nama_Staff", "CreatedAt"
  ],
  Absen_Literasi_Quran: [
    "ID", "ID_Siswa", "Nama_Siswa", "Kelas", "Tanggal", "Jam", "ID_Guru", "Nama_Guru", "CreatedAt"
  ],
  Dokumen_Sekolah: [
    "ID", "Judul", "Deskripsi", "Kategori", "URL", "ID_Pengunggah", "Nama_Pengunggah", "CreatedAt"
  ],
  // Log per-slot kehadiran mengajar guru (dipakai oleh alur Guru Piket <-> Guru <-> Waka
  // Kurikulum). Satu baris = satu slot jadwal (ID_Guru+Tanggal+Kelas+Mapel+Jam_Ke) yang
  // TIDAK diisi jurnal mengajarnya oleh guru bersangkutan, lalu ditindaklanjuti oleh piket.
  Kehadiran_Mengajar_Guru: [
    "ID", "Tanggal", "Hari", "ID_Guru", "Nama_Guru", "Kelas", "Mapel", "Jam_Ke",
    "Status", "Keterangan", "Diisi_Oleh", "ID_Piket", "Nama_Piket",
    "Diteruskan_Ke_Guru", "CreatedAt"
  ],
  // Riwayat tindak lanjut Wali Kelas terhadap siswa yang poin pelanggarannya mencapai
  // tingkat tertentu (Teguran / Panggilan Orang Tua / SP1 / SP2 / Skorsing dsb).
  Tindak_Lanjut_Siswa: [
    "ID", "ID_Siswa", "Nama_Siswa", "Kelas", "Tanggal", "Total_Poin_Saat_Itu", "Tingkat",
    "Jenis_Tindakan", "Keterangan", "ID_Wali_Kelas", "Nama_Wali_Kelas", "CreatedAt"
  ],
  // Tujuan Pembelajaran (TP) per Kelas+Mapel - dasar acuan yang dipakai guru saat
  // membuat Penilaian Harian maupun Penilaian Tengah Semester.
  Tujuan_Pembelajaran: [
    "ID", "Kelas", "Mapel", "ID_Guru", "Nama_Guru", "Semester", "Tahun_Ajaran",
    "Kode_TP", "Deskripsi_TP", "CreatedAt"
  ],
  // Master satu kegiatan penilaian (Harian / Tengah Semester) untuk Kelas+Mapel
  // tertentu, mengacu ke satu/lebih Tujuan Pembelajaran.
  Penilaian_Master: [
    "ID", "Jenis", "Kelas", "Mapel", "ID_Guru", "Nama_Guru", "Tanggal", "Judul",
    "TP_Terkait_JSON", "Jenis_Nilai", "KKTP", "Semester", "Tahun_Ajaran", "CreatedAt"
  ],
  // Nilai per siswa untuk satu Penilaian_Master (ID_Penilaian)
  Nilai_Siswa: [
    "ID", "ID_Penilaian", "ID_Siswa", "Nama_Siswa", "Kelas", "Nilai", "CreatedAt"
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

  // Beberapa kolom berisi teks bebas yang POLANYA bisa disalahartikan Google
  // Sheets sebagai tanggal (mis. guru mengetik "4/7" untuk Jam Ke lalu
  // otomatis berubah jadi tanggal 4 Juli). Paksa kolom ini selalu berformat
  // teks murni supaya nilai apa pun yang diketik tersimpan apa adanya.
  const KOLOM_PAKSA_TEKS = {
    Jurnal_Mengajar: ["Jam_Ke", "Pertemuan_Ke"]
  };
  Object.keys(KOLOM_PAKSA_TEKS).forEach(function (sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    KOLOM_PAKSA_TEKS[sheetName].forEach(function (kolom) {
      const colIndex = headers.indexOf(kolom);
      if (colIndex === -1) return;
      sheet.getRange(1, colIndex + 1, Math.max(sheet.getMaxRows(), 1000), 1).setNumberFormat("@");
    });
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
    getJurnalMengajarByKelas: apiGetJurnalMengajarByKelas,
    getAbsensiMapelByGuru: apiGetAbsensiMapelByGuru,
    getAkunSiswaUntukCetak: apiGetAkunSiswaUntukCetak,
    getSiswaUntukCetakKartu: apiGetSiswaUntukCetakKartu,
    getStatusAbsenHarianKelas: apiGetStatusAbsenHarianKelas,

    generateQrSession: apiGenerateQrSession,
    absenSiswaViaQr: apiAbsenSiswaViaQr,
    getRekapAbsenSiswa: apiGetRekapAbsenSiswa,

    getInfoPklSiswa: apiGetInfoPklSiswa,
    saveJurnalPkl: apiSaveJurnalPkl,
    absenPkl: apiAbsenPkl,
    getJurnalPklMonitoring: apiGetJurnalPklMonitoring,
    getRekapKehadiranPkl: apiGetRekapKehadiranPkl,
    getDokumenSekolah: apiGetDokumenSekolah,
    saveDokumenSekolah: apiSaveDokumenSekolah,
    deleteDokumenSekolah: apiDeleteDokumenSekolah,

    saveJurnal7Kaih: apiSaveJurnal7Kaih,
    getJurnal7KaihBySiswa: apiGetJurnal7KaihBySiswa,

    saveJurnalBimbingan: apiSaveJurnalBimbingan,
    getJurnalBimbinganByGuru: apiGetJurnalBimbinganByGuru,
    getJurnalBimbinganSemua: apiGetJurnalBimbinganSemua,

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
    getRekapKehadiranPerKelas: apiGetRekapKehadiranPerKelas,

    absenPerpustakaan: apiAbsenPerpustakaan,
    absenLiterasiQuran: apiAbsenLiterasiQuran,

    getDaftarPelanggaran: apiGetDaftarPelanggaran,
    savePelanggaranSiswa: apiSavePelanggaranSiswa,
    getPoinPelanggaranSiswa: apiGetPoinPelanggaranSiswa,
    getPoinPelanggaranKelas: apiGetPoinPelanggaranKelas,
    getPoinPelanggaranSemua: apiGetPoinPelanggaranSemua,

    getJurnal7KaihSemuaSiswa: apiGetJurnal7KaihSemuaSiswa,
    getJurnal7KaihByGuruWali: apiGetJurnal7KaihByGuruWali,
    getSiswaKompetensiKeahlian: apiGetSiswaKompetensiKeahlian,

    uploadPhoto: apiUploadPhoto,

    changePassword: apiChangePassword,

    getJadwalMengajarHarian: apiGetJadwalMengajarHarian,
    teruskanPesanPiket: apiTeruskanPesanPiket,
    isiKeteranganPiket: apiIsiKeteranganPiket,
    getNotifikasiPiketGuru: apiGetNotifikasiPiketGuru,
    isiKeteranganGuruSendiri: apiIsiKeteranganGuruSendiri,
    getRekapKehadiranMengajarHarian: apiGetRekapKehadiranMengajarHarian,

    saveTindakLanjut: apiSaveTindakLanjut,
    getRiwayatTindakLanjut: apiGetRiwayatTindakLanjut,
    getHariLiburDalamRentang: apiGetHariLiburDalamRentang,

    getTujuanPembelajaranDariJurnal: apiGetTujuanPembelajaranDariJurnal,
    savePenilaian: apiSavePenilaian,
    getPenilaianList: apiGetPenilaianList,
    deletePenilaian: apiDeletePenilaian,
    getNilaiPenilaian: apiGetNilaiPenilaian,
    saveNilaiSiswaBulk: apiSaveNilaiSiswaBulk,
    getRekapNilaiMapel: apiGetRekapNilaiMapel,
    getNilaiSiswaSendiri: apiGetNilaiSiswaSendiri
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
      // Hanya format sebagai tanggal jika kolom ini MEMANG kolom tanggal
      // (namanya "Tanggal" atau mengandung "Tanggal"/"CreatedAt"/"ExpiredAt").
      // Kolom teks bebas (mis. Jam_Ke) yang kebetulan ke-parse Sheets sebagai
      // Date TIDAK diformat ulang di sini supaya tidak makin menyesatkan.
      const isKolomTanggal = h === "Tanggal" || h.indexOf("Tanggal") !== -1 || KOLOM_TIMESTAMP_LENGKAP.indexOf(h) !== -1;
      if (val instanceof Date) {
        if (isKolomTanggal && KOLOM_TIMESTAMP_LENGKAP.indexOf(h) === -1) {
          val = formatDateOnly(val);
        } else if (!isKolomTanggal) {
          // Kolom bukan-tanggal tapi nilainya Date (data lama yang sudah
          // terlanjur salah format) -> tampilkan apa adanya sebagai teks
          // singkat, bukan yyyy-MM-dd penuh, sebagai penanda ada anomali.
          val = Utilities.formatDate(val, CONFIG.TIMEZONE, "d/M");
        }
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
  // Endpoint "uc?export=view" sering gagal tampil sebagai <img> (Google
  // menampilkan halaman peringatan/scan alih-alih file mentah). Endpoint
  // "thumbnail" jauh lebih andal untuk hotlink gambar langsung di <img src>.
  return { url: "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w1600", fileId: file.getId() };
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
  // Dipakai frontend untuk menampilkan menu "Monitoring Jurnal PKL" hanya jika
  // guru ybs memang ditunjuk sebagai pembimbing PKL untuk minimal 1 siswa.
  safeUser.Is_Pembimbing_PKL = users.some(function (u) {
    return parseNamaGuruList(u.Guru_Pembimbing_PKL).indexOf(user.Nama) !== -1;
  });
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

// payload: { Kelas (opsional) } -> daftar akun siswa (Nama, NISN/username,
// Password, Kelas) LENGKAP dengan password (khusus dipakai Admin untuk cetak
// kartu akun + QR massal). TIDAK dipakai di endpoint lain manapun karena
// password ditampilkan apa adanya.
function apiGetAkunSiswaUntukCetak(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  let siswa = users.filter(function (u) { return parseRoles(u.Role_List).indexOf("Siswa") !== -1; });
  if (payload && payload.Kelas) {
    siswa = siswa.filter(function (u) { return u.Kelas_Diampu === payload.Kelas; });
  }
  return siswa
    .map(function (u) {
      return {
        ID: u.ID,
        Nama: u.Nama,
        Username: u.Identitas_NIP_NISN,
        Password: u.Password,
        Kelas: u.Kelas_Diampu
      };
    })
    .sort(function (a, b) { return (a.Kelas || "").localeCompare(b.Kelas || "") || a.Nama.localeCompare(b.Nama); });
}

// payload: { Kelas (opsional) } -> daftar siswa LENGKAP (Nama, NISN, Kelas,
// TTL, Alamat, Foto) TANPA password, khusus dipakai Admin untuk mencetak
// Kartu Pelajar + Kartu Perpustakaan secara massal (timbal balik dalam satu
// file). Berbeda dari apiGetAkunSiswaUntukCetak yang menyertakan password.
function apiGetSiswaUntukCetakKartu(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  let siswa = users.filter(function (u) { return parseRoles(u.Role_List).indexOf("Siswa") !== -1; });
  if (payload && payload.Kelas) {
    siswa = siswa.filter(function (u) { return u.Kelas_Diampu === payload.Kelas; });
  }
  return siswa
    .map(function (u) {
      return {
        ID: u.ID,
        Nama: u.Nama,
        Identitas_NIP_NISN: u.Identitas_NIP_NISN,
        Kelas_Diampu: u.Kelas_Diampu,
        Kompetensi_Keahlian: u.Kompetensi_Keahlian,
        Tempat_Lahir: u.Tempat_Lahir,
        Tanggal_Lahir: u.Tanggal_Lahir,
        Alamat_Siswa: u.Alamat_Siswa,
        Foto_URL: u.Foto_URL || ""
      };
    })
    .sort(function (a, b) { return (a.Kelas_Diampu || "").localeCompare(b.Kelas_Diampu || "") || a.Nama.localeCompare(b.Nama); });
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

// payload: { ID, oldPassword, newPassword } -> dipakai tombol "Ganti Password" pada
// akun masing-masing role. Password baru langsung tersimpan di Users_Master (sumber
// data utama yang dipegang Admin), berlaku untuk login berikutnya.
function apiChangePassword(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const user = users.find(function (u) { return u.ID === payload.ID; });
  if (!user) throw new Error("Akun tidak ditemukan.");
  if (String(user.Password) !== String(payload.oldPassword)) {
    throw new Error("Password lama yang Anda masukkan salah.");
  }
  const newPassword = String(payload.newPassword || "").trim();
  if (newPassword.length < 4) {
    throw new Error("Password baru minimal 4 karakter.");
  }
  updateRowByField(SHEET_NAMES.USERS, "ID", user.ID, { Password: newPassword });
  return { status: "Password berhasil diganti." };
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
  const jarakSekolah = haversineMeters(CONFIG.SCHOOL_LAT, CONFIG.SCHOOL_LNG, payload.Lat, payload.Long);
  const jarakCabangDinas = haversineMeters(CONFIG.CABANG_DINAS_LAT, CONFIG.CABANG_DINAS_LNG, payload.Lat, payload.Long);
  const diSekolah = jarakSekolah <= CONFIG.RADIUS_GURU_METER;
  const diCabangDinas = jarakCabangDinas <= CONFIG.RADIUS_GURU_METER;
  if (!diSekolah && !diCabangDinas) {
    throw new Error("Anda Berada Diluar Radius Sekolah maupun Cabang Dinas Pendidikan (jarak ke sekolah " + Math.round(jarakSekolah) + " m, jarak ke Cabang Dinas Pendidikan " + Math.round(jarakCabangDinas) + " m, maksimal " + CONFIG.RADIUS_GURU_METER + " m).");
  }
  const lokasiAbsen = diSekolah && jarakSekolah <= jarakCabangDinas ? "Sekolah" : "Cabang Dinas Pendidikan";
  const jarak = diSekolah && jarakSekolah <= jarakCabangDinas ? jarakSekolah : jarakCabangDinas;

  const waktu = getWaktuSekarang();
  const isJumat = waktu.isoDay === 5;
  const batasMasuk = timeToMinutes(isJumat ? CONFIG.BATAS_ABSEN_MASUK_JUMAT : CONFIG.BATAS_ABSEN_MASUK_NORMAL);
  const jamStandar = timeToMinutes(CONFIG.JAM_MASUK_STANDAR);
  const batasPulang = timeToMinutes(isJumat ? CONFIG.JAM_MULAI_ABSEN_PULANG_JUMAT : CONFIG.JAM_MULAI_ABSEN_PULANG);

  const today = formatDateOnly(new Date());
  const now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "HH:mm:ss");

  const existing = readSheetAsObjects(SHEET_NAMES.ABSEN_GURU).find(function (r) {
    return r.ID_Guru === payload.ID_Guru && formatDateOnly(r.Tanggal) === today;
  });

  if (payload.tipe === "pulang") {
    if (waktu.menit < batasPulang) {
      throw new Error("Absen pulang baru bisa dilakukan setelah pukul " + (isJumat ? CONFIG.JAM_MULAI_ABSEN_PULANG_JUMAT : CONFIG.JAM_MULAI_ABSEN_PULANG) + (isJumat ? " (hari Jumat)" : "") + ".");
    }
    if (!existing) throw new Error("Anda belum tercatat absen masuk hari ini.");
    updateRowByField(SHEET_NAMES.ABSEN_GURU, "ID", existing.ID, { Jam_Pulang: now });
    return { status: "Absen pulang tercatat (" + lokasiAbsen + ")", jam: now, telatMenit: 0, lokasiAbsen: lokasiAbsen };
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
    Lokasi_Absen: lokasiAbsen,
    Status: "Hadir",
    Keterangan: telatMenit > 0 ? ("Telat " + telatMenit + " menit") : "",
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.ABSEN_GURU, obj);
  return { status: "Absen masuk tercatat (" + lokasiAbsen + ")", jam: now, telatMenit: telatMenit, lokasiAbsen: lokasiAbsen };
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

// payload: { Kelas, startDate (opsional), endDate (opsional) } -> SELURUH
// Jurnal Mengajar dari SEMUA guru mata pelajaran untuk satu kelas, digabung
// jadi satu kumpulan data supaya Wali Kelas bisa mencetaknya dalam satu file.
function apiGetJurnalMengajarByKelas(payload) {
  let rows = readSheetAsObjects(SHEET_NAMES.JURNAL_MENGAJAR)
    .filter(function (r) { return r.Kelas === payload.Kelas; });
  if (payload.startDate && payload.endDate) {
    const startT = new Date(payload.startDate).getTime();
    const endT = new Date(payload.endDate).getTime();
    rows = rows.filter(function (r) {
      const t = new Date(r.Tanggal).getTime();
      return t >= startT && t <= endT;
    });
  }
  return rows
    .map(function (r) { r.Kehadiran_Siswa = safeParseJson(r.Kehadiran_Siswa_JSON); return r; })
    .sort(function (a, b) { return new Date(a.Tanggal) - new Date(b.Tanggal) || String(a.Jam_Ke).localeCompare(String(b.Jam_Ke)); });
}

function apiGetJurnalMengajarByGuru(payload) {
  return readSheetAsObjects(SHEET_NAMES.JURNAL_MENGAJAR)
    .filter(function (r) { return r.ID_Guru === payload.ID_Guru; })
    .map(function (r) { r.Kehadiran_Siswa = safeParseJson(r.Kehadiran_Siswa_JSON); return r; })
    .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

// payload: { ID_Guru, Kelas, Mapel } -> rekap absensi siswa untuk SATU mata
// pelajaran & kelas yang diampu guru ybs (diambil dari Absen_Siswa_Reguler
// yang tersinkron otomatis setiap guru mengisi Jurnal Mengajar). Dipakai
// untuk cetak absensi per mata pelajaran di menu "Riwayat & Cetak Jurnal".
function apiGetAbsensiMapelByGuru(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswaKelas = users.filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.Kelas_Diampu === payload.Kelas;
  });
  const siswaMap = {};
  siswaKelas.forEach(function (s) { siswaMap[s.ID] = s; });

  const absen = readSheetAsObjects(SHEET_NAMES.ABSEN_SISWA_REGULER).filter(function (r) {
    return r.ID_Guru === payload.ID_Guru && r.Mapel === payload.Mapel && r.Kelas === payload.Kelas;
  });

  const tanggalUnik = Array.from(new Set(absen.map(function (r) { return formatDateOnly(r.Tanggal); })))
    .sort(function (a, b) { return new Date(a) - new Date(b); });

  const rekap = siswaKelas.map(function (s) {
    const riwayat = absen.filter(function (r) { return r.ID_Siswa === s.ID; });
    return {
      ID_Siswa: s.ID,
      Nama: s.Nama,
      NISN: s.Identitas_NIP_NISN,
      Hadir: riwayat.filter(function (r) { return r.Status === "Hadir"; }).length,
      Sakit: riwayat.filter(function (r) { return r.Status === "Sakit"; }).length,
      Izin: riwayat.filter(function (r) { return r.Status === "Izin"; }).length,
      Alfa: riwayat.filter(function (r) { return r.Status === "Alfa"; }).length,
      Detail: riwayat.map(function (r) { return { Tanggal: formatDateOnly(r.Tanggal), Status: r.Status }; })
    };
  }).sort(function (a, b) { return a.Nama.localeCompare(b.Nama); });

  return {
    Kelas: payload.Kelas,
    Mapel: payload.Mapel,
    Jumlah_Pertemuan: tanggalUnik.length,
    Tanggal_Pertemuan: tanggalUnik,
    Rekap: rekap
  };
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
    Sudah_Absen_Hari_Ini: !!(jurnalHariIni && jurnalHariIni.Status === "Hadir"),
    Sudah_Isi_Jurnal_Hari_Ini: !!(jurnalHariIni && String(jurnalHariIni.Kegiatan_PKL || "").trim()),
    Jumlah_Kehadiran: riwayatKehadiran.filter(function (r) { return r.Status === "Hadir"; }).length,
    Riwayat_Kehadiran: riwayatKehadiran.sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); })
  };
}

// Siswa PKL sekarang WAJIB ABSEN DULU (validasi GPS radius) sebelum bisa mengisi
// Jurnal Harian PKL - urutannya dibalik dari sebelumnya (jurnal dulu baru absen).
// Saat absen berhasil, kirim notifikasi WA ke ORANG TUA dan ke GURU PEMBIMBING PKL
// bahwa siswa sudah hadir/masuk PKL hari ini.
// payload: { ID_Siswa, Nama_Siswa, Lat, Long }
function apiAbsenPkl(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswa = users.find(function (u) { return u.ID === payload.ID_Siswa; });
  if (!siswa) throw new Error("Data siswa tidak ditemukan.");
  if (!siswa.Lat_PKL || !siswa.Long_PKL) throw new Error("Koordinat lokasi PKL belum diatur oleh Admin.");

  const today = formatDateOnly(new Date());
  const existing = readSheetAsObjects(SHEET_NAMES.JURNAL_ABSEN_PKL).find(function (r) {
    return r.ID_Siswa === payload.ID_Siswa && formatDateOnly(r.Tanggal) === today;
  });
  if (existing && existing.Status === "Hadir") throw new Error("Anda sudah absen PKL hari ini.");

  const jarak = haversineMeters(siswa.Lat_PKL, siswa.Long_PKL, payload.Lat, payload.Long);
  if (jarak > CONFIG.RADIUS_PKL_METER) {
    throw new Error("Anda Berada Diluar Radius Lokasi PKL (jarak " + Math.round(jarak) + " m, maksimal " + CONFIG.RADIUS_PKL_METER + " m).");
  }
  const jam = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "HH:mm:ss");

  if (existing) {
    updateRowByField(SHEET_NAMES.JURNAL_ABSEN_PKL, "ID", existing.ID, {
      Jam: jam,
      Lat: payload.Lat,
      Long: payload.Long,
      Jarak_Meter: Math.round(jarak),
      Status: "Hadir"
    });
  } else {
    appendRowFromObject(SHEET_NAMES.JURNAL_ABSEN_PKL, {
      ID: generateId("PKL"),
      ID_Siswa: payload.ID_Siswa,
      Nama_Siswa: payload.Nama_Siswa || siswa.Nama,
      Tanggal: today,
      Jam: jam,
      Kegiatan_PKL: "",
      Foto_URL: "",
      Lat: payload.Lat,
      Long: payload.Long,
      Jarak_Meter: Math.round(jarak),
      Status: "Hadir",
      CreatedAt: new Date()
    });
  }

  kirimNotifikasiPklMasuk(siswa, today, jam);
  return { status: "Absen PKL berhasil dicatat", jarak: Math.round(jarak) };
}

// Mengisi Jurnal Harian PKL - HANYA BOLEH setelah siswa absen hari ini (Status
// "Hadir" pada baris hari ini). Mengisi kolom Kegiatan_PKL & Foto pada baris YANG
// SAMA dengan hasil absen (bukan membuat baris baru).
// payload: { ID_Siswa, Nama_Siswa, Kegiatan_PKL, Foto_Base64 }
function apiSaveJurnalPkl(payload) {
  const today = formatDateOnly(new Date());
  const jurnal = readSheetAsObjects(SHEET_NAMES.JURNAL_ABSEN_PKL).find(function (r) {
    return r.ID_Siswa === payload.ID_Siswa && formatDateOnly(r.Tanggal) === today;
  });
  if (!jurnal || jurnal.Status !== "Hadir") {
    throw new Error("Silakan lakukan Absen PKL terlebih dahulu sebelum mengisi Jurnal Harian.");
  }
  if (String(jurnal.Kegiatan_PKL || "").trim()) {
    throw new Error("Jurnal PKL hari ini sudah diisi.");
  }

  let fotoUrl = "";
  if (payload.Foto_Base64) {
    fotoUrl = apiUploadPhoto({ base64Data: payload.Foto_Base64, fileName: "pkl_" + payload.ID_Siswa + "_" + today + ".jpg" }).url;
  }

  updateRowByField(SHEET_NAMES.JURNAL_ABSEN_PKL, "ID", jurnal.ID, {
    Kegiatan_PKL: payload.Kegiatan_PKL,
    Foto_URL: fotoUrl
  });
  return { status: "Jurnal harian PKL tersimpan." };
}

// ============================================================================
// MONITORING JURNAL PKL BERJENJANG
// (Guru Pembimbing PKL -> siswa bimbingannya saja | Waka Hubmi -> semua siswa
//  PKL | Ketua Kompetensi Keahlian -> hanya kompetensi keahliannya sendiri)
// ============================================================================

// Menentukan cakupan siswa kelas XII (PKL) sesuai payload filter:
// { ID_Guru (opsional, guru pembimbing PKL tsb) } dan/atau { Kompetensi (opsional) }
function resolveSiswaPklScope(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  let siswaXII = users.filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && String(u.Kelas_Diampu || "").indexOf("XII") !== -1;
  });

  let namaGuruPembimbing = null;
  if (payload && payload.ID_Guru) {
    const guru = users.find(function (u) { return u.ID === payload.ID_Guru; });
    if (!guru) throw new Error("Data guru tidak ditemukan.");
    namaGuruPembimbing = guru.Nama;
    siswaXII = siswaXII.filter(function (s) { return parseNamaGuruList(s.Guru_Pembimbing_PKL).indexOf(namaGuruPembimbing) !== -1; });
  }
  if (payload && payload.Kompetensi) {
    siswaXII = siswaXII.filter(function (s) { return String(s.Kelas_Diampu || "").indexOf(payload.Kompetensi) !== -1; });
  }
  return { siswaXII: siswaXII, namaGuruPembimbing: namaGuruPembimbing };
}

// payload: { ID_Guru (opsional), Kompetensi (opsional) } -> seluruh isian
// Jurnal Harian PKL siswa dalam cakupan tsb (dipakai untuk monitoring, read-only)
function apiGetJurnalPklMonitoring(payload) {
  const scope = resolveSiswaPklScope(payload || {});
  const siswaMap = {};
  scope.siswaXII.forEach(function (s) { siswaMap[s.ID] = s; });

  const jurnal = readSheetAsObjects(SHEET_NAMES.JURNAL_ABSEN_PKL)
    .filter(function (r) { return siswaMap[r.ID_Siswa]; })
    .map(function (r) {
      const s = siswaMap[r.ID_Siswa];
      r.Kelas = s.Kelas_Diampu;
      r.Tempat_PKL = s.Tempat_PKL;
      r.Guru_Pembimbing_PKL = s.Guru_Pembimbing_PKL;
      return r;
    })
    .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });

  return {
    Daftar_Siswa: scope.siswaXII.map(function (s) {
      return { ID: s.ID, Nama: s.Nama, Kelas: s.Kelas_Diampu, Tempat_PKL: s.Tempat_PKL, Guru_Pembimbing_PKL: s.Guru_Pembimbing_PKL };
    }),
    Jurnal: jurnal
  };
}

// payload: { ID_Guru (opsional), Kompetensi (opsional), startDate, endDate (opsional) }
// -> rekap kehadiran PKL per siswa dalam cakupan tsb, untuk dicetak dalam bentuk tabel
function apiGetRekapKehadiranPkl(payload) {
  const scope = resolveSiswaPklScope(payload || {});
  const semuaJurnal = readSheetAsObjects(SHEET_NAMES.JURNAL_ABSEN_PKL);

  const rows = scope.siswaXII.map(function (siswa) {
    let riwayat = semuaJurnal.filter(function (r) { return r.ID_Siswa === siswa.ID; });
    if (payload && payload.startDate && payload.endDate) {
      const startT = new Date(payload.startDate).getTime();
      const endT = new Date(payload.endDate).getTime();
      riwayat = riwayat.filter(function (r) {
        const t = new Date(r.Tanggal).getTime();
        return t >= startT && t <= endT;
      });
    }
    riwayat = riwayat.sort(function (a, b) { return new Date(a.Tanggal) - new Date(b.Tanggal); });
    return {
      ID_Siswa: siswa.ID,
      Nama_Siswa: siswa.Nama,
      NISN: siswa.Identitas_NIP_NISN,
      Kelas: siswa.Kelas_Diampu,
      Tempat_PKL: siswa.Tempat_PKL,
      Guru_Pembimbing_PKL: siswa.Guru_Pembimbing_PKL,
      Jumlah_Hadir: riwayat.filter(function (r) { return r.Status === "Hadir"; }).length,
      Jumlah_Jurnal_Terisi: riwayat.filter(function (r) { return String(r.Kegiatan_PKL || "").trim(); }).length,
      Detail_Harian: riwayat.map(function (r) { return { Tanggal: r.Tanggal, Jam: r.Jam, Status: r.Status, Kegiatan_PKL: r.Kegiatan_PKL }; })
    };
  });

  rows.sort(function (a, b) { return (a.Kelas || "").localeCompare(b.Kelas || "") || a.Nama_Siswa.localeCompare(b.Nama_Siswa); });
  return { namaGuruPembimbing: scope.namaGuruPembimbing, data: rows };
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

// Guru wali/wali kelas HANYA boleh mengisi jurnal bimbingan untuk siswa yang
// benar-benar menjadi bimbingannya (Guru_Wali_Nama siswa = nama guru tsb, atau
// siswa berada di Kelas_Wali guru tsb). Validasi dilakukan di server supaya
// data yang tampil di preview Kepala Sekolah/Waka Kurikulum/Waka Kesiswaan/
// Pengawas selalu konsisten antara nama siswa dan guru walinya.
function apiSaveJurnalBimbingan(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const guru = users.find(function (u) { return u.ID === payload.ID_Guru; });
  if (!guru) throw new Error("Data guru tidak ditemukan.");
  const siswa = users.find(function (u) { return u.ID === payload.ID_Siswa; });
  if (!siswa) throw new Error("Data siswa tidak ditemukan.");

  const kelasWaliGuru = (guru.Kelas_Wali || "").trim();
  const isWaliSiswaIni = siswa.Guru_Wali_Nama === guru.Nama || (kelasWaliGuru && siswa.Kelas_Diampu === kelasWaliGuru);
  if (!isWaliSiswaIni) {
    throw new Error("Siswa ini bukan bimbingan Anda. Jurnal bimbingan hanya bisa diisi untuk siswa yang guru walinya adalah Anda.");
  }

  const obj = Object.assign({}, payload);
  obj.ID = generateId("BMB");
  obj.Nama_Guru = guru.Nama;
  obj.Nama_Siswa = siswa.Nama;
  obj.NIP_Guru = guru.Identitas_NIP_NISN;
  obj.CreatedAt = new Date();
  appendRowFromObject(SHEET_NAMES.JURNAL_BIMBINGAN, obj);
  return obj;
}

function apiGetJurnalBimbinganByGuru(payload) {
  return readSheetAsObjects(SHEET_NAMES.JURNAL_BIMBINGAN)
    .filter(function (r) { return r.ID_Guru === payload.ID_Guru; })
    .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

// Seluruh jurnal bimbingan dari SEMUA guru wali/wali kelas (read-only), dipakai untuk
// tampilan preview tabel di akun Kepala Sekolah, Waka Kurikulum, dan Pengawas Sekolah.
// payload: { ID_Guru (opsional, untuk filter satu guru wali saja) }
function apiGetJurnalBimbinganSemua(payload) {
  let rows = readSheetAsObjects(SHEET_NAMES.JURNAL_BIMBINGAN);
  if (payload && payload.ID_Guru) {
    rows = rows.filter(function (r) { return r.ID_Guru === payload.ID_Guru; });
  }
  return rows.sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
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

// Menyusun daftar tanggal efektif (bukan Sabtu/Minggu & bukan Hari_Libur) di
// antara startDate..endDate (inklusif), dipakai untuk rekap kehadiran berbasis
// scan gerbang yang butuh rentang tanggal bebas (bukan hanya satu bulan penuh).
function enumerateHariEfektifRange(startDateStr, endDateStr, liburSet) {
  const hasil = [];
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    const cur = new Date(d);
    if (!isHariLibur(cur, liburSet)) {
      hasil.push(Utilities.formatDate(cur, CONFIG.TIMEZONE, "yyyy-MM-dd"));
    }
  }
  return hasil;
}

// payload: { Kelas, startDate, endDate } -> REKAP KEHADIRAN KELAS (Wali Kelas / Waka
// Kesiswaan). SUMBER UTAMA kehadiran = scan QR di gerbang (Absen_Harian_Siswa), BUKAN
// checklist guru mapel per jam pelajaran - supaya "Hadir" benar-benar berarti siswa
// datang ke sekolah. Data Sakit/Izin dari jurnal guru mapel tetap dipakai sebagai
// PELENGKAP alasan ketidakhadiran (hanya pada hari siswa memang tidak scan gerbang),
// tidak pernah menggantikan status Hadir dari gerbang. Rekap PER MATA PELAJARAN
// (apiGetAbsensiMapelByGuru / apiGetRekapAbsenSiswa) TIDAK diubah dan tetap berbasis
// checklist guru di kelas, sesuai kebutuhannya masing-masing.
function apiGetRekapKehadiranKelas(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswaKelas = users.filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.Kelas_Diampu === payload.Kelas;
  });

  const startDate = payload.startDate || formatDateOnly(new Date());
  const endDate = payload.endDate || formatDateOnly(new Date());
  const liburList = readSheetAsObjects(SHEET_NAMES.HARI_LIBUR).map(function (l) { return formatDateOnly(l.Tanggal); });
  const hariEfektif = enumerateHariEfektifRange(startDate, endDate, liburList);

  const absenGerbang = readSheetAsObjects(SHEET_NAMES.ABSEN_HARIAN_SISWA);
  const absenMapel = readSheetAsObjects(SHEET_NAMES.ABSEN_SISWA_REGULER);

  return siswaKelas.map(function (siswa) {
    const hadirSet = {};
    absenGerbang.forEach(function (r) {
      if (r.ID_Siswa === siswa.ID && r.Jam_Masuk) hadirSet[formatDateOnly(r.Tanggal)] = true;
    });
    // Alasan Sakit/Izin (jika pernah dicatat guru mapel pada hari tsb) - hanya dipakai
    // sebagai keterangan pelengkap untuk hari siswa TIDAK tercatat scan gerbang.
    const alasanMap = {};
    absenMapel.forEach(function (r) {
      if (r.ID_Siswa === siswa.ID && (r.Status === "Sakit" || r.Status === "Izin")) {
        alasanMap[formatDateOnly(r.Tanggal)] = r.Status;
      }
    });

    const hitung = { Hadir: 0, Sakit: 0, Izin: 0, Alfa: 0 };
    const detailHarian = hariEfektif.map(function (tgl) {
      let status;
      if (hadirSet[tgl]) { status = "Hadir"; }
      else if (alasanMap[tgl]) { status = alasanMap[tgl]; }
      else { status = "Alfa"; }
      hitung[status]++;
      return { Tanggal: tgl, Status: status };
    });

    return {
      ID_Siswa: siswa.ID,
      Nama_Siswa: siswa.Nama,
      NISN: siswa.Identitas_NIP_NISN,
      Detail_Harian: detailHarian,
      Hadir: hitung.Hadir,
      Sakit: hitung.Sakit,
      Izin: hitung.Izin,
      Alfa: hitung.Alfa
    };
  });
}

// ============================================================================
// MODUL POIN PELANGGARAN SISWA (Guru Piket)
// ============================================================================

function apiGetDaftarPelanggaran() {
  return DAFTAR_PELANGGARAN;
}

// payload: { ID_Siswa, Nama_Siswa, Kelas, ID_Guru, Nama_Guru, Kode_Pelanggaran, Keterangan (opsional) }
// Guru piket memilih pelanggaran dari daftar tetap - poin & uraian DIAMBIL DARI
// SERVER (bukan dari klien), supaya tidak bisa dimanipulasi.
function apiSavePelanggaranSiswa(payload) {
  const guru = readSheetAsObjects(SHEET_NAMES.USERS).find(function (u) { return u.ID === payload.ID_Guru; });
  if (!guru) throw new Error("Data guru tidak ditemukan.");
  const today = formatDateOnly(new Date());
  const isoDay = Number(Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "u")); // 1=Senin...7=Minggu
  const namaHari = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"][isoDay];
  const hariPiket = (guru.Hari_Piket || "").split(",").map(function (h) { return h.trim(); }).filter(Boolean);
  if (hariPiket.indexOf(namaHari) === -1) {
    throw new Error("Anda bukan guru piket pada hari " + namaHari + ", tidak dapat menginput pelanggaran.");
  }

  const item = cariPelanggaranByKode(payload.Kode_Pelanggaran);
  if (!item) throw new Error("Kode pelanggaran tidak valid.");

  const obj = {
    ID: generateId("PP"),
    ID_Siswa: payload.ID_Siswa,
    Nama_Siswa: payload.Nama_Siswa,
    Kelas: payload.Kelas,
    Tanggal: today,
    ID_Guru: payload.ID_Guru,
    Nama_Guru: payload.Nama_Guru,
    Kode_Pelanggaran: item.kode,
    Uraian: item.uraian,
    Kategori: item.kategori,
    Poin: item.poin,
    Tipe: "Tambah",
    Keterangan: payload.Keterangan || "",
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.POIN_PELANGGARAN, obj);
  return obj;
}

function hitungTotalPoin(catatan) {
  return catatan.reduce(function (total, r) {
    const mengurangi = (r.Tipe === "Kurang" || r.Tipe === "Bonus");
    return total + (mengurangi ? -Number(r.Poin || 0) : Number(r.Poin || 0));
  }, 0);
}

// Ambang batas tingkat pelanggaran & rekomendasi tindak lanjut standar SMK, dipakai
// Wali Kelas untuk menentukan langkah pembinaan sesuai akumulasi poin siswa. Admin
// bisa menyesuaikan angka ambang batas ini langsung di kode jika kebijakan sekolah
// berbeda.
const AMBANG_TINDAK_LANJUT = [
  { min: 100, Tingkat: "Sangat Berat", Rekomendasi: "Skorsing / Dikembalikan ke Orang Tua (Rapat Dewan Guru)" },
  { min: 75, Tingkat: "Berat", Rekomendasi: "Surat Peringatan 2 (SP2) & Perjanjian Tertulis Bermaterai" },
  { min: 50, Tingkat: "Sedang", Rekomendasi: "Pemanggilan Orang Tua & Surat Peringatan 1 (SP1)" },
  { min: 25, Tingkat: "Ringan", Rekomendasi: "Teguran / Peringatan Lisan oleh Wali Kelas" },
  { min: 0, Tingkat: "Aman", Rekomendasi: "Belum perlu tindak lanjut khusus" }
];
function tentukanTingkatPelanggaran(totalPoin) {
  const cocok = AMBANG_TINDAK_LANJUT.find(function (a) { return totalPoin >= a.min; });
  return cocok || AMBANG_TINDAK_LANJUT[AMBANG_TINDAK_LANJUT.length - 1];
}

// payload: { ID_Siswa } -> riwayat pelanggaran + total poin siswa tsb (dipakai di akun siswa, wali kelas, guru wali)
function apiGetPoinPelanggaranSiswa(payload) {
  const catatan = readSheetAsObjects(SHEET_NAMES.POIN_PELANGGARAN)
    .filter(function (r) { return r.ID_Siswa === payload.ID_Siswa; })
    .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
  return { totalPoin: hitungTotalPoin(catatan), riwayat: catatan };
}

// payload: { Kelas } -> rekap poin seluruh siswa satu kelas (dipakai Wali Kelas), lengkap
// dengan Tingkat & Rekomendasi tindak lanjut sesuai akumulasi poin.
function apiGetPoinPelanggaranKelas(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS).filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.Kelas_Diampu === payload.Kelas;
  });
  const semuaCatatan = readSheetAsObjects(SHEET_NAMES.POIN_PELANGGARAN);
  const semuaTindakLanjut = readSheetAsObjects(SHEET_NAMES.TINDAK_LANJUT_SISWA);
  return users.map(function (s) {
    const catatan = semuaCatatan.filter(function (r) { return r.ID_Siswa === s.ID; })
      .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
    const totalPoin = hitungTotalPoin(catatan);
    const tingkat = tentukanTingkatPelanggaran(totalPoin);
    const riwayatTindakLanjut = semuaTindakLanjut.filter(function (t) { return t.ID_Siswa === s.ID; })
      .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
    return {
      ID_Siswa: s.ID,
      Nama_Siswa: s.Nama,
      totalPoin: totalPoin,
      riwayat: catatan,
      Tingkat: tingkat.Tingkat,
      Rekomendasi: tingkat.Rekomendasi,
      JumlahTindakLanjut: riwayatTindakLanjut.length,
      TindakLanjutTerakhir: riwayatTindakLanjut[0] || null
    };
  }).sort(function (a, b) { return b.totalPoin - a.totalPoin; });
}

// Rekap poin seluruh siswa se-sekolah (dipakai Waka Kesiswaan), opsional filter Kelas
function apiGetPoinPelanggaranSemua(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS).filter(function (u) {
    if (parseRoles(u.Role_List).indexOf("Siswa") === -1) return false;
    if (payload && payload.Kelas) return u.Kelas_Diampu === payload.Kelas;
    return true;
  });
  const semuaCatatan = readSheetAsObjects(SHEET_NAMES.POIN_PELANGGARAN);
  return users.map(function (s) {
    const catatan = semuaCatatan.filter(function (r) { return r.ID_Siswa === s.ID; });
    return { ID_Siswa: s.ID, Nama_Siswa: s.Nama, Kelas: s.Kelas_Diampu, totalPoin: hitungTotalPoin(catatan), jumlahPelanggaran: catatan.filter(function (r) { return r.Tipe === "Tambah"; }).length };
  }).sort(function (a, b) { return b.totalPoin - a.totalPoin; });
}

// payload: { ID_Siswa, Nama_Siswa, Kelas, Jenis_Tindakan, Keterangan, ID_Wali_Kelas,
// Nama_Wali_Kelas } -> Wali Kelas mencatat tindak lanjut yang diambil terhadap siswa
// (mis. Teguran, Panggilan Orang Tua, SP1/SP2, Skorsing), Total_Poin_Saat_Itu & Tingkat
// dihitung otomatis dari poin siswa saat tindakan dicatat.
function apiSaveTindakLanjut(payload) {
  const catatan = readSheetAsObjects(SHEET_NAMES.POIN_PELANGGARAN)
    .filter(function (r) { return r.ID_Siswa === payload.ID_Siswa; });
  const totalPoin = hitungTotalPoin(catatan);
  const tingkat = tentukanTingkatPelanggaran(totalPoin);
  const obj = {
    ID: generateId("TDL"),
    ID_Siswa: payload.ID_Siswa,
    Nama_Siswa: payload.Nama_Siswa,
    Kelas: payload.Kelas,
    Tanggal: formatDateOnly(new Date()),
    Total_Poin_Saat_Itu: totalPoin,
    Tingkat: tingkat.Tingkat,
    Jenis_Tindakan: payload.Jenis_Tindakan,
    Keterangan: payload.Keterangan || "",
    ID_Wali_Kelas: payload.ID_Wali_Kelas,
    Nama_Wali_Kelas: payload.Nama_Wali_Kelas,
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.TINDAK_LANJUT_SISWA, obj);
  return { status: "Tindak lanjut '" + payload.Jenis_Tindakan + "' untuk " + payload.Nama_Siswa + " tersimpan." };
}

// payload: { ID_Siswa } -> riwayat tindak lanjut seorang siswa (dipakai Wali Kelas untuk cetak/lihat riwayat)
function apiGetRiwayatTindakLanjut(payload) {
  return readSheetAsObjects(SHEET_NAMES.TINDAK_LANJUT_SISWA)
    .filter(function (r) { return r.ID_Siswa === payload.ID_Siswa; })
    .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

// ============================================================================
// MODUL WAKA KESISWAAN: JURNAL 7KAIH SEMUA SISWA
// ============================================================================

// payload: { Kelas (opsional, kosongkan untuk semua kelas) }
function apiGetJurnal7KaihSemuaSiswa(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS).filter(function (u) {
    if (parseRoles(u.Role_List).indexOf("Siswa") === -1) return false;
    if (payload && payload.Kelas) return u.Kelas_Diampu === payload.Kelas;
    return true;
  });
  const userMap = {};
  users.forEach(function (u) { userMap[u.ID] = u; });

  return readSheetAsObjects(SHEET_NAMES.JURNAL_7KAIH)
    .filter(function (r) { return userMap[r.ID_Siswa]; })
    .map(function (r) {
      r.Kelas = userMap[r.ID_Siswa].Kelas_Diampu;
      r.Olahraga_Kegiatan = safeParseJson(r.Olahraga_Kegiatan_JSON);
      return r;
    })
    .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

// payload: { ID_Guru } -> Jurnal 7KAIH seluruh siswa yang Guru_Wali_Nama-nya
// adalah guru wali tsb (dipakai di akun Guru Wali). Data dipilah lengkap per
// 7 kebiasaan agar bisa ditampilkan sebagai tabel dan diunduh.
function apiGetJurnal7KaihByGuruWali(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const guru = users.find(function (u) { return u.ID === payload.ID_Guru; });
  if (!guru) throw new Error("Data guru tidak ditemukan.");

  const siswaBimbingan = users.filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.Guru_Wali_Nama === guru.Nama;
  });
  const siswaMap = {};
  siswaBimbingan.forEach(function (s) { siswaMap[s.ID] = s; });

  const rows = readSheetAsObjects(SHEET_NAMES.JURNAL_7KAIH)
    .filter(function (r) { return siswaMap[r.ID_Siswa]; })
    .map(function (r) {
      r.Kelas = siswaMap[r.ID_Siswa].Kelas_Diampu;
      r.Olahraga_Kegiatan = safeParseJson(r.Olahraga_Kegiatan_JSON);
      return r;
    })
    .sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });

  return {
    Nama_Guru_Wali: guru.Nama,
    Daftar_Siswa: siswaBimbingan.map(function (s) { return { ID: s.ID, Nama: s.Nama, Kelas: s.Kelas_Diampu }; }),
    Jurnal: rows
  };
}

// ============================================================================
// MODUL KEPALA KOMPETENSI KEAHLIAN (BD / ATU)
// ============================================================================

// payload: { Kompetensi: "BD" | "ATU" } -> data siswa dipilah per kelas, termasuk info PKL untuk kelas XII
function apiGetSiswaKompetensiKeahlian(payload) {
  const kode = payload.Kompetensi;
  const users = readSheetAsObjects(SHEET_NAMES.USERS).filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && String(u.Kelas_Diampu || "").indexOf(kode) !== -1;
  });

  const perKelas = {};
  users.forEach(function (s) {
    const kelas = s.Kelas_Diampu || "(Tanpa Kelas)";
    perKelas[kelas] = perKelas[kelas] || [];
    perKelas[kelas].push({
      ID: s.ID,
      Nama: s.Nama,
      NISN: s.Identitas_NIP_NISN,
      Kelas: s.Kelas_Diampu,
      Guru_Wali_Nama: s.Guru_Wali_Nama,
      isPkl: String(s.Kelas_Diampu || "").indexOf("XII") !== -1,
      Tempat_PKL: s.Tempat_PKL,
      Pembimbing_Lapangan_PKL: s.Pembimbing_Lapangan_PKL,
      Guru_Pembimbing_PKL: s.Guru_Pembimbing_PKL,
      Tanggal_Mulai_PKL: s.Tanggal_Mulai_PKL,
      Tanggal_Selesai_PKL: s.Tanggal_Selesai_PKL
    });
  });

  return Object.keys(perKelas).sort().map(function (kelas) {
    return { Kelas: kelas, Siswa: perKelas[kelas] };
  });
}

// ============================================================================
// DOKUMEN SEKOLAH (link dokumen diunggah oleh Admin, bisa dilihat/diunduh
// oleh Guru, Kepala Sekolah, Pengawas Sekolah, dan Tata Usaha)
// ============================================================================

function apiGetDokumenSekolah() {
  return readSheetAsObjects(SHEET_NAMES.DOKUMEN_SEKOLAH)
    .sort(function (a, b) { return new Date(b.CreatedAt) - new Date(a.CreatedAt); });
}

// payload = { ID (opsional, isi jika edit), Judul, Deskripsi, Kategori, URL, ID_Admin, Nama_Admin }
function apiSaveDokumenSekolah(payload) {
  const obj = Object.assign({}, payload);
  obj.ID_Pengunggah = payload.ID_Admin || payload.ID_Pengunggah;
  obj.Nama_Pengunggah = payload.Nama_Admin || payload.Nama_Pengunggah;
  delete obj.ID_Admin;
  delete obj.Nama_Admin;
  if (obj.ID) {
    updateRowByField(SHEET_NAMES.DOKUMEN_SEKOLAH, "ID", obj.ID, obj);
    return obj;
  }
  obj.ID = generateId("DOK");
  obj.CreatedAt = new Date();
  appendRowFromObject(SHEET_NAMES.DOKUMEN_SEKOLAH, obj);
  return obj;
}

function apiDeleteDokumenSekolah(payload) {
  deleteRowByField(SHEET_NAMES.DOKUMEN_SEKOLAH, "ID", payload.ID);
  return { status: "Dokumen dihapus." };
}

// ============================================================================
// ============================================================================
// Catatan: kolom "QR_Token" di Users_Master adalah kode QR TETAP milik siswa
// (dibuat sekali saat data siswa disimpan, tidak pernah berubah). QR yang
// sama ini juga dipakai untuk absensi kunjungan Perpustakaan (lihat
// apiAbsenPerpustakaan di bawah), sehingga siswa cukup punya satu kartu QR
// untuk semua keperluan.

// payload: { ID_Siswa } -> kode QR tetap milik siswa tsb
function apiGetKodeQrHarianSiswa(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswa = users.find(function (u) { return u.ID === payload.ID_Siswa; });
  if (!siswa || !siswa.QR_Token) throw new Error("Data QR siswa tidak ditemukan.");
  return { kode: siswa.QR_Token };
}

// payload: { QR_Token, ID_Guru, Nama_Guru, tipe: "masuk" | "pulang" }
function apiAbsenHarianViaQr(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswa = users.find(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.QR_Token && u.QR_Token === payload.QR_Token;
  });
  if (!siswa) throw new Error("QR Code tidak dikenali atau bukan milik siswa terdaftar.");

  const today = formatDateOnly(new Date());
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
// MODUL PERPUSTAKAAN: SCAN QR SISWA UNTUK KUNJUNGAN PERPUSTAKAAN
// ============================================================================
// Memakai QR pribadi siswa yang sama (QR_Token) - dipindai oleh akun
// Kepala Perpustakaan / Staf Perpustakaan. Setiap kunjungan pertama di hari
// itu otomatis MEMBERI APRESIASI POIN (lihat prosesApresiasiPoin di bawah).

// Logika bersama: dipakai oleh kunjungan Perpustakaan MAUPUN Literasi Al-Qur'an.
// Jika siswa SEDANG punya poin pelanggaran (total > 0), poin ini dipakai
// sebagai PENGURANGAN pelanggaran (Tipe "Kurang"). Jika siswa tidak sedang
// punya pelanggaran (total <= 0, catatan bersih), poin ini dicatat sebagai
// BONUS (Tipe "Bonus") - keduanya sama-sama membuat rekam jejak siswa makin baik.
function prosesApresiasiPoin(siswa, uraian, jumlahPoin, idPencatat, namaPencatat, tanggal) {
  if (jumlahPoin <= 0) return { tipe: null };
  const catatanSaatIni = readSheetAsObjects(SHEET_NAMES.POIN_PELANGGARAN).filter(function (r) { return r.ID_Siswa === siswa.ID; });
  const totalSaatIni = hitungTotalPoin(catatanSaatIni);
  const tipe = totalSaatIni > 0 ? "Kurang" : "Bonus";
  appendRowFromObject(SHEET_NAMES.POIN_PELANGGARAN, {
    ID: generateId("PP"),
    ID_Siswa: siswa.ID,
    Nama_Siswa: siswa.Nama,
    Kelas: siswa.Kelas_Diampu,
    Tanggal: tanggal,
    ID_Guru: idPencatat,
    Nama_Guru: namaPencatat,
    Kode_Pelanggaran: "",
    Uraian: uraian,
    Kategori: "-",
    Poin: jumlahPoin,
    Tipe: tipe,
    Keterangan: tipe === "Kurang" ? "Pengurangan poin pelanggaran otomatis" : "Bonus otomatis (tidak ada pelanggaran aktif)",
    CreatedAt: new Date()
  });
  return { tipe: tipe };
}

// payload: { QR_Token, ID_Staff, Nama_Staff }
function apiAbsenPerpustakaan(payload) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswa = users.find(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.QR_Token && u.QR_Token === payload.QR_Token;
  });
  if (!siswa) throw new Error("QR Code tidak dikenali atau bukan milik siswa terdaftar.");

  const today = formatDateOnly(new Date());
  const now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "HH:mm:ss");
  const sudahHariIni = readSheetAsObjects(SHEET_NAMES.ABSEN_PERPUSTAKAAN).find(function (r) {
    return r.ID_Siswa === siswa.ID && formatDateOnly(r.Tanggal) === today;
  });

  appendRowFromObject(SHEET_NAMES.ABSEN_PERPUSTAKAAN, {
    ID: generateId("PERPUS"),
    ID_Siswa: siswa.ID,
    Nama_Siswa: siswa.Nama,
    Kelas: siswa.Kelas_Diampu,
    Tanggal: today,
    Jam: now,
    ID_Staff: payload.ID_Staff,
    Nama_Staff: payload.Nama_Staff,
    CreatedAt: new Date()
  });

  let hasilPoin = { tipe: null };
  if (!sudahHariIni) {
    hasilPoin = prosesApresiasiPoin(siswa, "Kunjungan Perpustakaan", CONFIG.POIN_KURANG_KUNJUNGAN_PERPUS, payload.ID_Staff, payload.Nama_Staff, today);
  }

  return { status: "Kunjungan " + siswa.Nama + " tercatat", jam: now, nama: siswa.Nama, tipePoin: hasilPoin.tipe };
}

// ============================================================================
// MODUL LITERASI AL-QUR'AN (SETIAP HARI JUMAT)
// ============================================================================
// Memakai QR pribadi siswa yang sama, dipindai oleh Guru saat kegiatan
// Literasi Al-Qur'an setiap hari Jumat. Sama seperti kunjungan Perpustakaan:
// poin dipakai sebagai pengurangan pelanggaran, atau Bonus jika siswa tidak
// sedang punya pelanggaran aktif.

// payload: { QR_Token, ID_Guru, Nama_Guru }
function apiAbsenLiterasiQuran(payload) {
  const isoDay = Number(Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "u"));
  const namaHari = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"][isoDay];
  if (namaHari !== CONFIG.HARI_LITERASI_QURAN) {
    throw new Error("Absensi Literasi Al-Qur'an hanya berlaku pada hari " + CONFIG.HARI_LITERASI_QURAN + ".");
  }

  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswa = users.find(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.QR_Token && u.QR_Token === payload.QR_Token;
  });
  if (!siswa) throw new Error("QR Code tidak dikenali atau bukan milik siswa terdaftar.");

  const today = formatDateOnly(new Date());
  const now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "HH:mm:ss");
  const sudahHariIni = readSheetAsObjects(SHEET_NAMES.ABSEN_LITERASI_QURAN).find(function (r) {
    return r.ID_Siswa === siswa.ID && formatDateOnly(r.Tanggal) === today;
  });
  if (sudahHariIni) throw new Error(siswa.Nama + " sudah tercatat mengikuti Literasi Al-Qur'an hari ini.");

  appendRowFromObject(SHEET_NAMES.ABSEN_LITERASI_QURAN, {
    ID: generateId("LITQ"),
    ID_Siswa: siswa.ID,
    Nama_Siswa: siswa.Nama,
    Kelas: siswa.Kelas_Diampu,
    Tanggal: today,
    Jam: now,
    ID_Guru: payload.ID_Guru,
    Nama_Guru: payload.Nama_Guru,
    CreatedAt: new Date()
  });

  const hasilPoin = prosesApresiasiPoin(siswa, "Kehadiran Literasi Al-Qur'an", CONFIG.POIN_KURANG_LITERASI_QURAN, payload.ID_Guru, payload.Nama_Guru, today);

  return { status: "Kehadiran Literasi Al-Qur'an " + siswa.Nama + " tercatat", jam: now, nama: siswa.Nama, tipePoin: hasilPoin.tipe };
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

// Dikirim saat siswa PKL berhasil absen masuk - ke ORANG TUA siswa DAN ke Guru
// Pembimbing PKL siswa tsb, supaya keduanya tahu siswa sudah hadir di lokasi PKL.
function kirimNotifikasiPklMasuk(siswa, tanggal, jam) {
  const pesanOrtu = "Ananda " + siswa.Nama + " sudah hadir/masuk PKL di " + (siswa.Tempat_PKL || "tempat PKL") + " pada tanggal " + formatTanggalPanjangIndo(tanggal) + ", jam " + jam + ".";
  kirimWA(siswa.No_HP_OrangTua, pesanOrtu);

  if (siswa.Guru_Pembimbing_PKL) {
    const guruList = parseNamaGuruList(siswa.Guru_Pembimbing_PKL);
    const users = readSheetAsObjects(SHEET_NAMES.USERS);
    guruList.forEach(function (namaGuru) {
      const guru = users.find(function (u) { return u.Nama === namaGuru; });
      if (!guru || !guru.No_HP) return;
      const pesanGuru = "Siswa bimbingan PKL Bapak/Ibu, " + siswa.Nama + " (" + siswa.Kelas_Diampu + "), sudah hadir/masuk PKL di " + (siswa.Tempat_PKL || "tempat PKL") + " pada tanggal " + formatTanggalPanjangIndo(tanggal) + ", jam " + jam + ".";
      kirimWA(guru.No_HP, pesanGuru);
    });
  }
}

// Dipanggil otomatis tiap hari pukul 10:00 lewat trigger (lihat setupTriggerCekAbsen).
// Mengecek siswa yang belum absen masuk, lalu mengirim WA LANGSUNG ke ORANG TUA
// masing-masing siswa (BUKAN ke Guru Wali - pesan terusan WA cukup untuk orang tua saja).
function cekSiswaBelumAbsenPagi() {
  const today = formatDateOnly(new Date());
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const siswaAll = users.filter(function (u) { return parseRoles(u.Role_List).indexOf("Siswa") !== -1; });
  const sudahSet = {};
  readSheetAsObjects(SHEET_NAMES.ABSEN_HARIAN_SISWA).forEach(function (r) {
    if (formatDateOnly(r.Tanggal) === today && r.Jam_Masuk) sudahSet[r.ID_Siswa] = true;
  });
  const belum = siswaAll.filter(function (s) { return !sudahSet[s.ID]; });
  belum.forEach(function (s) {
    if (!s.No_HP_OrangTua) return;
    const pesan = "Pemberitahuan SIAKAD ESEMKASA:\nSampai pukul " + CONFIG.JAM_BATAS_CEK_BELUM_ABSEN + " hari ini (" + formatTanggalPanjangIndo(today) + "), ananda " + s.Nama + " (Kelas " + s.Kelas_Diampu + ") belum tercatat absen masuk sekolah. Mohon dikonfirmasi kehadirannya.";
    kirimWA(s.No_HP_OrangTua, pesan);
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
  const tanggalNormal = formatDateOnly(payload.Tanggal);
  const sudahAda = readSheetAsObjects(SHEET_NAMES.HARI_LIBUR).some(function (r) {
    return formatDateOnly(r.Tanggal) === tanggalNormal;
  });
  if (sudahAda) {
    throw new Error("Tanggal " + tanggalNormal + " sudah terdaftar sebagai hari libur. Periksa kembali daftar di bawah supaya tidak dobel.");
  }
  const obj = {
    ID: generateId("LBR"),
    Tanggal: tanggalNormal,
    Keterangan: payload.Keterangan || "",
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.HARI_LIBUR, obj);
  return obj;
}

// payload: { bulan (1-12), tahun }
function apiGetHariLibur(payload) {
  const all = readSheetAsObjects(SHEET_NAMES.HARI_LIBUR);
  const hasil = (!payload.bulan || !payload.tahun) ? all : all.filter(function (r) {
    const d = new Date(r.Tanggal);
    return (d.getMonth() + 1) === Number(payload.bulan) && d.getFullYear() === Number(payload.tahun);
  });
  return hasil.sort(function (a, b) { return new Date(a.Tanggal) - new Date(b.Tanggal); });
}

function apiDeleteHariLibur(payload) {
  deleteRowByField(SHEET_NAMES.HARI_LIBUR, "ID", payload.ID);
  return { deleted: payload.ID };
}

// payload: { startDate, endDate } -> daftar hari libur (di luar Sabtu/Minggu) yang
// TERDAFTAR dalam rentang tanggal tsb, terurut. Dipakai di tampilan rekap kehadiran
// (Wali Kelas/Waka Kesiswaan) supaya bisa dicek silang: kalau ada hari yang seharusnya
// libur tapi belum terdaftar di sini, rekap kehadiran akan salah menganggapnya hari
// efektif - jadi mudah ketahuan & Admin bisa segera melengkapi data Hari_Libur.
function apiGetHariLiburDalamRentang(payload) {
  const startDate = payload.startDate || formatDateOnly(new Date());
  const endDate = payload.endDate || formatDateOnly(new Date());
  return readSheetAsObjects(SHEET_NAMES.HARI_LIBUR).filter(function (r) {
    const t = formatDateOnly(r.Tanggal);
    return t >= startDate && t <= endDate;
  }).sort(function (a, b) { return new Date(a.Tanggal) - new Date(b.Tanggal); });
}

function getJumlahHariDalamBulan(bulan, tahun) {
  return new Date(tahun, bulan, 0).getDate();
}

// true jika tanggal tsb Sabtu/Minggu ATAU ada di daftar Hari_Libur
// Menentukan apakah sebuah tanggal adalah hari libur. Sekolah ini masuk 6 hari
// (Senin-Sabtu), jadi HANYA hari Minggu yang otomatis libur - Sabtu TETAP dianggap
// hari efektif/masuk kecuali memang didaftarkan sebagai hari libur oleh Admin
// (mis. libur nasional/semester yang kebetulan jatuh di hari Sabtu).
function isHariLibur(dateObj, liburSet) {
  const day = dateObj.getDay(); // 0=Minggu, 6=Sabtu
  if (day === 0) return true;
  const key = Utilities.formatDate(dateObj, CONFIG.TIMEZONE, "yyyy-MM-dd");
  return liburSet.indexOf(key) !== -1;
}

// Menentukan "Jabatan" tampilan dari daftar role seorang pegawai
function resolveJabatan(roles) {
  if (roles.indexOf("Kepala Sekolah") !== -1) return "Kepala Sekolah";
  if (roles.indexOf("Pengawas Sekolah") !== -1) return "Pengawas Sekolah";
  if (roles.indexOf("Tata Usaha") !== -1) return "Tata Usaha";
  if (roles.indexOf("Waka Kurikulum") !== -1) return "Waka Kurikulum";
  if (roles.indexOf("Waka Hubmi") !== -1) return "Waka Hubmi";
  if (roles.indexOf("Waka Kesiswaan") !== -1) return "Waka Kesiswaan";
  if (roles.indexOf("Waka Sarpras") !== -1) return "Waka Sarpras";
  if (roles.indexOf("Kepala Kompetensi Keahlian") !== -1) return "Kepala Kompetensi Keahlian";
  if (roles.indexOf("Kepala Perpustakaan") !== -1) return "Kepala Perpustakaan";
  if (roles.indexOf("Staf Perpustakaan") !== -1) return "Staf Perpustakaan";
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
    if (roles.length === 0) return false;
    if (roles.indexOf("Siswa") !== -1) return false;
    // Akun Admin MURNI (hanya punya role Admin, tanpa role lain) dikecualikan dari rekap.
    // Kalau akun itu juga punya role lain (mis. Admin + Guru), tetap dimasukkan.
    if (roles.length === 1 && roles[0] === "Admin") return false;
    // Pengawas Sekolah hanya memantau (bukan pegawai sekolah), tidak pernah masuk rekap absensi kehadiran.
    if (roles.indexOf("Pengawas Sekolah") !== -1) return false;
    return true;
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

// payload: { bulan, tahun } -> rekap kehadiran siswa DIPILAH PER KELAS, tiap
// kelas menampilkan siswa yang paling banyak hadir & paling banyak tidak
// hadir. Dipakai bersama oleh Kepala Sekolah, Waka Kurikulum, dan Waka Kesiswaan.
function apiGetRekapKehadiranPerKelas(payload) {
  const rekap = apiGetRekapAbsensiSiswaBulanan({ bulan: payload.bulan, tahun: payload.tahun });
  const perKelas = {};
  rekap.data.forEach(function (s) {
    const kelas = s.Kelas || "(Tanpa Kelas)";
    perKelas[kelas] = perKelas[kelas] || [];
    perKelas[kelas].push(s);
  });

  const kelasList = Object.keys(perKelas).sort().map(function (kelas) {
    const siswa = perKelas[kelas].slice().sort(function (a, b) { return b.Persentase - a.Persentase; });
    const totalPersen = siswa.reduce(function (sum, s) { return sum + s.Persentase; }, 0);
    return {
      Kelas: kelas,
      Jumlah_Siswa: siswa.length,
      Rata_Rata_Persentase: siswa.length ? Math.round(totalPersen / siswa.length) : 0,
      Siswa_Paling_Hadir: siswa.length ? siswa[0] : null,
      Siswa_Paling_Tidak_Hadir: siswa.length ? siswa[siswa.length - 1] : null,
      Siswa: siswa
    };
  });

  return { bulan: rekap.bulan, tahun: rekap.tahun, hariEfektif: rekap.hariEfektif, kelasList: kelasList };
}



// ============================================================================
// MODUL ALUR JURNAL MENGAJAR - GURU PIKET <-> GURU <-> WAKA KURIKULUM
// Guru piket memantau slot jadwal (dari Roster_Mengajar_JSON tiap guru) yang belum
// diisi Jurnal Mengajar-nya pada hari berjalan. Piket bisa (a) meneruskan pesan supaya
// guru bersangkutan mengisi keterangan sendiri di akunnya, atau (b) mengisi langsung
// keterangan "Tidak Mengajar" / "Digantikan Piket". Hasilnya muncul di akun guru terkait
// dan direkap Waka Kurikulum per tanggal.
// ============================================================================

// Mengubah nama hari Indonesia dari sebuah tanggal (yyyy-MM-dd atau Date)
function namaHariDariTanggal(tanggalStr) {
  const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const d = new Date(tanggalStr);
  return HARI[d.getDay()];
}

// Mengelompokkan slot roster satu hari (per guru) yang Kelas & Mapel-nya sama dan
// Jam_Ke-nya berurutan (mis. jam ke 1 & 2 mapel/kelas yang sama) menjadi SATU slot
// bertanda "1-2" - supaya tampilannya sama persis dengan cara guru menulis Jam_Ke di
// Jurnal Mengajar (guru mengetik bebas, mis. "1-2"), sehingga piket tidak melihat 2
// baris terpisah untuk 1 pertemuan yang sama.
function kelompokkanRosterPerHari(roster, hari) {
  const terurut = (roster || []).filter(function (r) { return r.Hari === hari; }).slice().sort(function (a, b) {
    return Number(a.JamKe) - Number(b.JamKe);
  });
  const hasil = [];
  terurut.forEach(function (r) {
    const jamNum = Number(r.JamKe);
    const last = hasil[hasil.length - 1];
    if (last && last.Kelas === r.Kelas && last.Mapel === r.Mapel && jamNum === last._jamAkhir + 1) {
      last._jamAkhir = jamNum;
      last.Jam_Ke = last._jamAwal === last._jamAkhir ? String(last._jamAwal) : (last._jamAwal + "-" + last._jamAkhir);
    } else {
      hasil.push({ Kelas: r.Kelas, Mapel: r.Mapel, _jamAwal: jamNum, _jamAkhir: jamNum, Jam_Ke: String(jamNum) });
    }
  });
  return hasil;
}

// payload: { Tanggal } -> seluruh slot jadwal mengajar SEMUA guru pada tanggal tsb,
// ditandai mana yang sudah mengisi Jurnal Mengajar dan mana yang sudah
// ditindaklanjuti piket (diteruskan / diisi keterangan). Dipakai oleh akun Guru Piket.
// PENTING: kecocokan "sudah mengisi jurnal" dicek berdasarkan ID_Guru+Kelas+Mapel+
// Tanggal SAJA (bukan Jam_Ke persis), karena Jam_Ke pada Jurnal Mengajar diketik
// bebas oleh guru (mis. "1-2") sehingga tidak selalu identik dgn Jam_Ke per-slot di
// roster. Ini membuat status "sudah mengisi" selalu sinkron dengan jurnal guru.
function apiGetJadwalMengajarHarian(payload) {
  const tanggal = payload.Tanggal || formatDateOnly(new Date());
  const hari = namaHariDariTanggal(tanggal);

  const users = readSheetAsObjects(SHEET_NAMES.USERS).filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Guru") !== -1 || parseRoles(u.Role_List).indexOf("Tata Usaha") !== -1;
  });

  const jurnalHariItu = readSheetAsObjects(SHEET_NAMES.JURNAL_MENGAJAR).filter(function (r) {
    return formatDateOnly(r.Tanggal) === tanggal;
  });
  const keteranganHariItu = readSheetAsObjects(SHEET_NAMES.KEHADIRAN_MENGAJAR_GURU).filter(function (r) {
    return formatDateOnly(r.Tanggal) === tanggal;
  });

  const slotList = [];
  users.forEach(function (u) {
    const roster = safeParseJson(u.Roster_Mengajar_JSON);
    const kelompok = kelompokkanRosterPerHari(roster, hari);
    kelompok.forEach(function (grp) {
      const sudahJurnal = jurnalHariItu.some(function (j) {
        return j.ID_Guru === u.ID && j.Kelas === grp.Kelas && j.Mapel === grp.Mapel;
      });
      const keterangan = keteranganHariItu.find(function (k) {
        return k.ID_Guru === u.ID && k.Kelas === grp.Kelas && k.Mapel === grp.Mapel;
      });
      slotList.push({
        ID_Guru: u.ID,
        Nama_Guru: u.Nama,
        Kelas: grp.Kelas,
        Mapel: grp.Mapel,
        Jam_Ke: grp.Jam_Ke,
        Tanggal: tanggal,
        Hari: hari,
        SudahMengisiJurnal: sudahJurnal,
        Keterangan: keterangan ? {
          ID: keterangan.ID,
          Status: keterangan.Status,
          Catatan: keterangan.Keterangan,
          Diisi_Oleh: keterangan.Diisi_Oleh,
          Diteruskan_Ke_Guru: keterangan.Diteruskan_Ke_Guru
        } : null
      });
    });
  });

  slotList.sort(function (a, b) {
    return String(a.Jam_Ke).localeCompare(String(b.Jam_Ke), undefined, { numeric: true }) || a.Nama_Guru.localeCompare(b.Nama_Guru);
  });

  return { Tanggal: tanggal, Hari: hari, Slot: slotList };
}

// Memastikan pengguna yang mengirim aksi (ID_Piket) BENAR piket pada hari (Hari)
// yang bersangkutan - supaya guru lain (yang bukan piket hari itu) tidak bisa ikut
// meneruskan pesan atau mengisi keterangan atas nama guru lain.
function pastikanSedangPiket(idPiket, hari) {
  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const piket = users.find(function (u) { return u.ID === idPiket; });
  if (!piket) throw new Error("Akun piket tidak ditemukan.");
  const hariPiket = parseRoles(piket.Hari_Piket); // format sama "A, B" -> ["A","B"]
  if (hariPiket.indexOf(hari) === -1) {
    throw new Error("Anda bukan guru piket pada hari " + hari + ", tidak dapat menindaklanjuti jurnal guru lain.");
  }
}

// payload: { ID_Guru, Nama_Guru, Kelas, Mapel, Jam_Ke, Tanggal, Hari, ID_Piket, Nama_Piket }
// -> piket MENERUSKAN pesan ke akun guru bersangkutan supaya guru sendiri yang mengisi
// keterangan (tidak langsung memutuskan status atas nama guru tsb).
function apiTeruskanPesanPiket(payload) {
  const hari = payload.Hari || namaHariDariTanggal(payload.Tanggal);
  pastikanSedangPiket(payload.ID_Piket, hari);
  const obj = {
    ID: generateId("KMG"),
    Tanggal: payload.Tanggal,
    Hari: hari,
    ID_Guru: payload.ID_Guru,
    Nama_Guru: payload.Nama_Guru,
    Kelas: payload.Kelas,
    Mapel: payload.Mapel,
    Jam_Ke: payload.Jam_Ke,
    Status: "",
    Keterangan: "",
    Diisi_Oleh: "Piket",
    ID_Piket: payload.ID_Piket,
    Nama_Piket: payload.Nama_Piket,
    Diteruskan_Ke_Guru: "Ya",
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.KEHADIRAN_MENGAJAR_GURU, obj);
  return { status: "Pesan diteruskan ke akun " + payload.Nama_Guru + ", menunggu guru mengisi keterangan." };
}

// payload: { ID_Guru, Nama_Guru, Kelas, Mapel, Jam_Ke, Tanggal, Hari, Status, Keterangan,
// ID_Piket, Nama_Piket } -> piket LANGSUNG mengisi keterangan ("Tidak Mengajar" atau
// "Digantikan Piket") atas nama guru bersangkutan, tercatat sebagai diisi oleh piket.
function apiIsiKeteranganPiket(payload) {
  if (["Tidak Mengajar", "Digantikan Piket"].indexOf(payload.Status) === -1) {
    throw new Error("Status harus 'Tidak Mengajar' atau 'Digantikan Piket'.");
  }
  const hari = payload.Hari || namaHariDariTanggal(payload.Tanggal);
  pastikanSedangPiket(payload.ID_Piket, hari);
  const obj = {
    ID: generateId("KMG"),
    Tanggal: payload.Tanggal,
    Hari: hari,
    ID_Guru: payload.ID_Guru,
    Nama_Guru: payload.Nama_Guru,
    Kelas: payload.Kelas,
    Mapel: payload.Mapel,
    Jam_Ke: payload.Jam_Ke,
    Status: payload.Status,
    Keterangan: payload.Keterangan || "",
    Diisi_Oleh: "Piket",
    ID_Piket: payload.ID_Piket,
    Nama_Piket: payload.Nama_Piket,
    Diteruskan_Ke_Guru: "",
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.KEHADIRAN_MENGAJAR_GURU, obj);
  return { status: "Keterangan '" + payload.Status + "' untuk " + payload.Nama_Guru + " tersimpan." };
}

// payload: { ID_Guru } -> daftar pesan yang DITERUSKAN piket ke guru ybs dan BELUM
// "selesai" - baik karena guru belum isi keterangan sendiri, MAUPUN belum mengisi
// jurnal mengajar untuk Kelas+Mapel+Tanggal tsb. Begitu guru mengisi jurnal mengajar
// (lewat menu Isi Jurnal Mengajar seperti biasa), notifikasi ini otomatis hilang
// dengan sendirinya tanpa perlu tindakan tambahan.
function apiGetNotifikasiPiketGuru(payload) {
  const pending = readSheetAsObjects(SHEET_NAMES.KEHADIRAN_MENGAJAR_GURU)
    .filter(function (r) {
      return r.ID_Guru === payload.ID_Guru && r.Diteruskan_Ke_Guru === "Ya" && !r.Status;
    });
  if (pending.length === 0) return [];
  const jurnalGuru = readSheetAsObjects(SHEET_NAMES.JURNAL_MENGAJAR).filter(function (j) {
    return j.ID_Guru === payload.ID_Guru;
  });
  return pending.filter(function (p) {
    const sudahIsiJurnal = jurnalGuru.some(function (j) {
      return formatDateOnly(j.Tanggal) === formatDateOnly(p.Tanggal) && j.Kelas === p.Kelas && j.Mapel === p.Mapel;
    });
    return !sudahIsiJurnal;
  }).sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

// payload: { ID (baris Kehadiran_Mengajar_Guru), Status, Keterangan } -> guru mengisi
// sendiri keterangan atas pesan yang diteruskan piket kepadanya.
function apiIsiKeteranganGuruSendiri(payload) {
  if (["Tidak Mengajar", "Digantikan Piket"].indexOf(payload.Status) === -1) {
    throw new Error("Status harus 'Tidak Mengajar' atau 'Digantikan Piket'.");
  }
  updateRowByField(SHEET_NAMES.KEHADIRAN_MENGAJAR_GURU, "ID", payload.ID, {
    Status: payload.Status,
    Keterangan: payload.Keterangan || "",
    Diisi_Oleh: "Guru"
  });
  return { status: "Keterangan tersimpan." };
}

// payload: { Tanggal } -> REKAP untuk Waka Kurikulum: tabel seluruh guru pada tanggal
// tsb, lengkap kelas/jam ke/mapel, dipilah "Guru Masuk" (sudah isi jurnal) dan
// "Guru Tidak Masuk" (belum isi jurnal, dengan status & keterangan hasil tindak lanjut
// piket jika sudah ada).
function apiGetRekapKehadiranMengajarHarian(payload) {
  const jadwal = apiGetJadwalMengajarHarian(payload);
  const masuk = [];
  const tidakMasuk = [];
  jadwal.Slot.forEach(function (s) {
    if (s.SudahMengisiJurnal) {
      masuk.push(s);
    } else {
      tidakMasuk.push(s);
    }
  });
  return { Tanggal: jadwal.Tanggal, Hari: jadwal.Hari, GuruMasuk: masuk, GuruTidakMasuk: tidakMasuk };
}

// ============================================================================
// MODUL PENILAIAN: PENILAIAN HARIAN & TENGAH SEMESTER
// Tujuan Pembelajaran TIDAK dikelola terpisah - diambil langsung dari kolom
// Tujuan_Pembelajaran yang sudah diisi guru di Jurnal Mengajar (Kelas+Mapel+guru
// yang sama), supaya datanya selalu sama/sinkron antara Jurnal Mengajar dan
// Penilaian, dan guru bisa memilih lebih dari satu TP sekaligus saat membuat
// kegiatan penilaian.
// ============================================================================

// payload: { Kelas, Mapel, ID_Guru } -> daftar Tujuan Pembelajaran UNIK yang pernah
// diisi guru ybs di Jurnal Mengajar untuk Kelas+Mapel tsb, terurut dari yang paling
// baru dipakai.
function apiGetTujuanPembelajaranDariJurnal(payload) {
  const entri = readSheetAsObjects(SHEET_NAMES.JURNAL_MENGAJAR).filter(function (r) {
    return r.ID_Guru === payload.ID_Guru && r.Kelas === payload.Kelas && r.Mapel === payload.Mapel && String(r.Tujuan_Pembelajaran || "").trim();
  });
  const peta = {}; // teks TP -> tanggal terakhir dipakai
  entri.forEach(function (r) {
    const teks = String(r.Tujuan_Pembelajaran).trim();
    const tgl = new Date(r.Tanggal);
    if (!peta[teks] || tgl > peta[teks]) peta[teks] = tgl;
  });
  return Object.keys(peta)
    .map(function (teks) { return { Tujuan_Pembelajaran: teks, Tanggal_Terakhir: formatDateOnly(peta[teks]) }; })
    .sort(function (a, b) { return new Date(b.Tanggal_Terakhir) - new Date(a.Tanggal_Terakhir); });
}

// 4 tingkat kriteria kualitatif (dipakai sebagai alternatif nilai angka), sesuai
// urutan capaian dari yang paling rendah ke paling tinggi.
const KRITERIA_PENILAIAN = ["Belum Berkembang", "Layak", "Cakap", "Mahir"];
function ordinalKriteria(label) {
  return KRITERIA_PENILAIAN.indexOf(String(label || "").trim());
}

// payload: { Jenis ("Harian"/"Tengah Semester"), Kelas, Mapel, ID_Guru, Nama_Guru,
// Tanggal, Judul, TP_Terkait (array teks Tujuan Pembelajaran, bisa lebih dari satu),
// Jenis_Nilai ("Angka"/"Kriteria"), KKTP (angka jika Jenis_Nilai=Angka, salah satu
// KRITERIA_PENILAIAN jika Jenis_Nilai=Kriteria), Semester, Tahun_Ajaran }
function apiSavePenilaian(payload) {
  if (["Harian", "Tengah Semester"].indexOf(payload.Jenis) === -1) {
    throw new Error("Jenis penilaian harus 'Harian' atau 'Tengah Semester'.");
  }
  const jenisNilai = payload.Jenis_Nilai === "Kriteria" ? "Kriteria" : "Angka";
  const kktp = jenisNilai === "Kriteria"
    ? (KRITERIA_PENILAIAN.indexOf(payload.KKTP) !== -1 ? payload.KKTP : "Cakap")
    : (payload.KKTP || 70);
  const obj = {
    ID: generateId("PNL"),
    Jenis: payload.Jenis,
    Kelas: payload.Kelas,
    Mapel: payload.Mapel,
    ID_Guru: payload.ID_Guru,
    Nama_Guru: payload.Nama_Guru,
    Tanggal: payload.Tanggal,
    Judul: payload.Judul,
    TP_Terkait_JSON: JSON.stringify(payload.TP_Terkait || []),
    Jenis_Nilai: jenisNilai,
    KKTP: kktp,
    Semester: payload.Semester,
    Tahun_Ajaran: payload.Tahun_Ajaran,
    CreatedAt: new Date()
  };
  appendRowFromObject(SHEET_NAMES.PENILAIAN_MASTER, obj);
  return obj;
}

// payload: { Kelas, Mapel, Jenis (opsional) } -> daftar kegiatan penilaian, lengkap
// jumlah siswa yang sudah dinilai dari total siswa kelas tsb.
function apiGetPenilaianList(payload) {
  let list = readSheetAsObjects(SHEET_NAMES.PENILAIAN_MASTER)
    .filter(function (r) { return r.Kelas === payload.Kelas && r.Mapel === payload.Mapel; });
  if (payload.Jenis) list = list.filter(function (r) { return r.Jenis === payload.Jenis; });
  const semuaNilai = readSheetAsObjects(SHEET_NAMES.NILAI_SISWA);
  const jumlahSiswaKelas = readSheetAsObjects(SHEET_NAMES.USERS).filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.Kelas_Diampu === payload.Kelas;
  }).length;
  return list.map(function (p) {
    const nilaiTerkait = semuaNilai.filter(function (n) { return n.ID_Penilaian === p.ID; });
    return {
      ID: p.ID,
      Jenis: p.Jenis,
      Tanggal: p.Tanggal,
      Judul: p.Judul,
      TP_Terkait: safeParseJson(p.TP_Terkait_JSON),
      Jenis_Nilai: p.Jenis_Nilai || "Angka",
      KKTP: p.KKTP,
      Semester: p.Semester,
      Tahun_Ajaran: p.Tahun_Ajaran,
      JumlahSudahDinilai: nilaiTerkait.length,
      JumlahSiswaKelas: jumlahSiswaKelas
    };
  }).sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

// Menghapus satu kegiatan penilaian beserta seluruh nilai siswa yang menyertainya.
function apiDeletePenilaian(payload) {
  const semuaNilai = readSheetAsObjects(SHEET_NAMES.NILAI_SISWA).filter(function (n) { return n.ID_Penilaian === payload.ID; });
  semuaNilai.forEach(function (n) { deleteRowByField(SHEET_NAMES.NILAI_SISWA, "ID", n.ID); });
  deleteRowByField(SHEET_NAMES.PENILAIAN_MASTER, "ID", payload.ID);
  return { deleted: payload.ID };
}

// payload: { ID_Penilaian, Kelas } -> nilai seluruh siswa satu kelas untuk satu
// kegiatan penilaian (siswa yang belum dinilai tetap muncul dengan Nilai null).
// Nilai dikembalikan APA ADANYA (angka atau teks kriteria), tidak dipaksa Number(),
// supaya mendukung kedua Jenis_Nilai.
function apiGetNilaiPenilaian(payload) {
  const siswaKelas = readSheetAsObjects(SHEET_NAMES.USERS).filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.Kelas_Diampu === payload.Kelas;
  }).sort(function (a, b) { return String(a.Nama).localeCompare(String(b.Nama)); });
  const nilaiTerkait = readSheetAsObjects(SHEET_NAMES.NILAI_SISWA).filter(function (n) { return n.ID_Penilaian === payload.ID_Penilaian; });
  return siswaKelas.map(function (s) {
    const n = nilaiTerkait.find(function (x) { return x.ID_Siswa === s.ID; });
    return { ID_Siswa: s.ID, Nama_Siswa: s.Nama, Nilai: n ? n.Nilai : null };
  });
}

// payload: { ID_Penilaian, Kelas, Nilai: [{ID_Siswa,Nama_Siswa,Nilai}] } -> menimpa
// (overwrite) seluruh nilai kegiatan penilaian tsb sesuai isian guru saat itu. Nilai
// disimpan APA ADANYA (angka ATAU salah satu teks KRITERIA_PENILAIAN).
function apiSaveNilaiSiswaBulk(payload) {
  const existing = readSheetAsObjects(SHEET_NAMES.NILAI_SISWA).filter(function (n) { return n.ID_Penilaian === payload.ID_Penilaian; });
  existing.forEach(function (n) { deleteRowByField(SHEET_NAMES.NILAI_SISWA, "ID", n.ID); });
  (payload.Nilai || []).forEach(function (item) {
    if (item.Nilai === null || item.Nilai === "" || item.Nilai === undefined) return; // lewati siswa yang belum diisi
    appendRowFromObject(SHEET_NAMES.NILAI_SISWA, {
      ID: generateId("NLS"),
      ID_Penilaian: payload.ID_Penilaian,
      ID_Siswa: item.ID_Siswa,
      Nama_Siswa: item.Nama_Siswa,
      Kelas: payload.Kelas,
      Nilai: item.Nilai,
      CreatedAt: new Date()
    });
  });
  return { status: "Nilai tersimpan." };
}

// payload: { Kelas, Mapel, Jenis } -> rekap pivot: setiap siswa x setiap kegiatan
// penilaian (kolom), lengkap rata-rata keseluruhan (HANYA dari kolom bertipe Angka;
// kolom Kriteria ditampilkan apa adanya tanpa ikut dirata-rata). Dipakai guru untuk
// melihat/mencetak rekap nilai satu kelas sekaligus.
function apiGetRekapNilaiMapel(payload) {
  const siswaKelas = readSheetAsObjects(SHEET_NAMES.USERS).filter(function (u) {
    return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.Kelas_Diampu === payload.Kelas;
  }).sort(function (a, b) { return String(a.Nama).localeCompare(String(b.Nama)); });
  let daftarPenilaian = readSheetAsObjects(SHEET_NAMES.PENILAIAN_MASTER)
    .filter(function (r) { return r.Kelas === payload.Kelas && r.Mapel === payload.Mapel; });
  if (payload.Jenis) daftarPenilaian = daftarPenilaian.filter(function (r) { return r.Jenis === payload.Jenis; });
  daftarPenilaian.sort(function (a, b) { return new Date(a.Tanggal) - new Date(b.Tanggal); });
  const semuaNilai = readSheetAsObjects(SHEET_NAMES.NILAI_SISWA);

  const kolom = daftarPenilaian.map(function (p) { return { ID: p.ID, Judul: p.Judul, Tanggal: p.Tanggal, KKTP: p.KKTP, Jenis_Nilai: p.Jenis_Nilai || "Angka" }; });
  const baris = siswaKelas.map(function (s) {
    const nilaiPerKolom = kolom.map(function (k) {
      const n = semuaNilai.find(function (x) { return x.ID_Penilaian === k.ID && x.ID_Siswa === s.ID; });
      return n ? n.Nilai : null;
    });
    const terisiAngka = kolom
      .map(function (k, i) { return k.Jenis_Nilai === "Angka" ? nilaiPerKolom[i] : null; })
      .filter(function (v) { return v !== null; })
      .map(Number);
    const rataRata = terisiAngka.length ? Math.round(terisiAngka.reduce(function (a, b) { return a + b; }, 0) / terisiAngka.length * 10) / 10 : null;
    return { ID_Siswa: s.ID, Nama_Siswa: s.Nama, Nilai: nilaiPerKolom, RataRata: rataRata };
  });
  return { Kolom: kolom, Baris: baris };
}

// payload: { ID_Siswa } -> rekap nilai seorang siswa di semua mapel (dipakai akun Siswa)
function apiGetNilaiSiswaSendiri(payload) {
  const nilaiSiswa = readSheetAsObjects(SHEET_NAMES.NILAI_SISWA).filter(function (n) { return n.ID_Siswa === payload.ID_Siswa; });
  const semuaPenilaian = readSheetAsObjects(SHEET_NAMES.PENILAIAN_MASTER);
  return nilaiSiswa.map(function (n) {
    const p = semuaPenilaian.find(function (x) { return x.ID === n.ID_Penilaian; });
    if (!p) return null;
    const jenisNilai = p.Jenis_Nilai || "Angka";
    const tuntas = jenisNilai === "Kriteria"
      ? ordinalKriteria(n.Nilai) >= ordinalKriteria(p.KKTP)
      : Number(n.Nilai) >= Number(p.KKTP);
    return {
      Mapel: p.Mapel, Jenis: p.Jenis, Judul: p.Judul, Tanggal: p.Tanggal,
      Jenis_Nilai: jenisNilai, Nilai: n.Nilai, KKTP: p.KKTP, Tuntas: tuntas
    };
  }).filter(Boolean).sort(function (a, b) { return new Date(b.Tanggal) - new Date(a.Tanggal); });
}

function apiGetDashboardManajemen(payload) {
  const today = formatDateOnly(new Date());

  const absenGuru = readSheetAsObjects(SHEET_NAMES.ABSEN_GURU).filter(function (r) { return formatDateOnly(r.Tanggal) === today; });
  const jurnalMengajar = readSheetAsObjects(SHEET_NAMES.JURNAL_MENGAJAR).filter(function (r) { return formatDateOnly(r.Tanggal) === today; });
  // Kehadiran siswa reguler pada dashboard eksekutif memakai scan gerbang (Absen_Harian_Siswa),
  // BUKAN checklist guru mapel, supaya konsisten dengan definisi "kehadiran ke sekolah".
  const absenSiswaGerbang = readSheetAsObjects(SHEET_NAMES.ABSEN_HARIAN_SISWA).filter(function (r) { return formatDateOnly(r.Tanggal) === today && r.Jam_Masuk; });
  const absenPkl = readSheetAsObjects(SHEET_NAMES.JURNAL_ABSEN_PKL).filter(function (r) { return formatDateOnly(r.Tanggal) === today; });
  const jurnal7kaih = readSheetAsObjects(SHEET_NAMES.JURNAL_7KAIH).filter(function (r) { return formatDateOnly(r.Tanggal) === today; });

  const users = readSheetAsObjects(SHEET_NAMES.USERS);
  const totalGuru = users.filter(function (u) { return parseRoles(u.Role_List).some(function (r) { return r.toLowerCase().indexOf("guru") !== -1; }); }).length;
  const totalSiswaReguler = users.filter(function (u) { return parseRoles(u.Role_List).indexOf("Siswa") !== -1 && u.Kelas_Diampu && u.Kelas_Diampu.indexOf("XII") === -1; }).length;
  const totalSiswaPkl = users.filter(function (u) { return u.Kelas_Diampu && String(u.Kelas_Diampu).indexOf("XII") !== -1; }).length;

  // Siswa reguler unik yang sudah scan masuk di gerbang hari ini
  const siswaHadirMap = {};
  absenSiswaGerbang.forEach(function (r) {
    siswaHadirMap[r.ID_Siswa] = { Nama: r.Nama_Siswa, Kelas: r.Kelas, Jam_Terakhir: r.Jam_Masuk, Mapel_Terakhir: "Scan Gerbang" };
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

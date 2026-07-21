# Panduan Setup - SIAKAD ESEMKASA

## 1. Backend (Code.gs)
1. Buka https://sheets.google.com → buat Spreadsheet baru (kosong).
2. Menu **Extensions → Apps Script**. Hapus isi default, tempel seluruh isi **Code.gs**.
3. Sesuaikan `CONFIG.SCHOOL_LAT` / `SCHOOL_LNG` dengan koordinat sekolah.
4. Jalankan fungsi **setupDatabase** sekali dari toolbar (▶️), berikan izin akses.
   - Ini membuat semua sheet (termasuk yang baru: `Absen_Harian_Siswa` dan `Hari_Libur`), header, dan akun admin default `admin` / `admin123`.
5. **Deploy → New deployment → Web app**. Execute as: **Me**. Who has access: **Anyone**. Salin URL Web App-nya.
6. Setiap mengubah Code.gs, buat deployment baru (atau kelola versi via "Manage deployments") agar perubahan aktif.

## 2. Frontend (index.html)
Buka **index.html**, cari baris `const API_URL = "GANTI_DENGAN_URL_WEB_APP_ANDA";` dan ganti dengan URL Web App dari langkah di atas.

## 3. Hosting & Instalasi sebagai Aplikasi (PWA)
Aplikasi ini sekarang terdiri dari **beberapa file** (bukan cuma satu index.html), karena sudah bisa dipasang seperti aplikasi native di HP/Laptop:
```
index.html
manifest.json
sw.js
icons/
  icon-32.png
  icon-96.png
  icon-180.png
  icon-192.png
  icon-512.png
```
**Semua file & folder ini harus diupload bersamaan** (jangan hanya index.html saja), supaya ikon, manifest, dan service worker-nya ikut terbaca.

1. Buka https://app.netlify.com → **Add new site → Deploy manually**.
2. Drag & drop **seluruh folder** (bukan file satu-satu) berisi kelima item di atas.
3. Netlify akan memberi URL publik, misal `https://siakad-esemkasa.netlify.app`.

**Cara pasang di HP (Android/Chrome):** buka URL tersebut → menu titik tiga → "Tambahkan ke Layar Utama" / "Install app".
**Cara pasang di HP (iPhone/Safari):** buka URL → tombol Share → "Add to Home Screen".
**Cara pasang di Laptop (Chrome/Edge):** buka URL → klik ikon "Install" di ujung kanan address bar.

## 4. Fitur Baru yang Perlu Diketahui

### QR Absensi Pribadi Siswa (Gerbang Masuk/Pulang)
- Setiap akun siswa otomatis mendapat QR Code pribadi yang tetap (tidak berubah tiap hari), tampil di menu **Beranda Siswa** / **Beranda PKL**.
- Guru piket membuka menu **Scan Absensi Siswa** (tersedia di semua akun ber-role Guru), pilih tombol **Absen Masuk** atau **Absen Pulang**, lalu scan QR siswa. Data tersimpan di sheet `Absen_Harian_Siswa` dan menjadi sumber data **Rekap Absensi Siswa Bulanan**.
- QR ini terpisah dari fitur "Absen (Scan QR)" milik siswa sendiri (yang tetap ada, untuk scan QR sesi per-mapel yang ditampilkan guru saat jurnal mengajar).

### Hari Libur & Cetak Rekap Bulanan (Menu Admin)
- Menu **Hari Libur**: tambahkan tanggal libur nasional/khusus. Sabtu & Minggu otomatis dihitung libur tanpa perlu diinput.
- Menu **Cetak Rekap Absensi Guru** dan **Cetak Rekap Absensi Siswa**: pilih bulan & tahun, klik **Tampilkan**, lalu **Cetak** (otomatis dalam orientasi kertas landscape agar kolom tanggal 1-31 muat). Format tabel: No, Nama (NIP/NISN di bawahnya), Jabatan/Kelas, kolom tanggal (In / X / kosong untuk libur), Hari Efektif, Jumlah Hadir, Persentase.
- Rekap Guru bersumber dari data **Absensi Guru** (geofencing masuk/pulang). Rekap Siswa bersumber dari data **QR Absensi Pribadi** (gerbang masuk/pulang) di atas.

### Guru Wali vs Guru Pembimbing PKL (Kelas XII)
Dua peran ini sekarang jelas terpisah di form Data Siswa:
- **Guru Wali**: berlaku untuk semua siswa, dipakai untuk Jurnal Bimbingan Karakter.
- **Guru Pembimbing PKL**: hanya untuk siswa kelas XII, guru sekolah yang membimbing PKL (berbeda dari Guru Wali).

### Roster Mengajar Guru
Sekarang berupa jadwal terstruktur (bukan teks bebas): Admin menambahkan baris jadwal berisi **Hari, Kelas, Mapel, dan Jam Ke (pilihan 1-9)** langsung dari dropdown. Guru melihat hasilnya sebagai tabel rapi di menu **Beranda Guru**.

### Dashboard Kepala Sekolah / Waka Kurikulum / Waka Hubmi
Sekarang tampil sebagai kartu-kartu (card) yang langsung menampilkan nama-nama secara live (bukan cuma angka) — misalnya kartu "Siswa Hadir (Scan QR)" langsung memuat daftar nama siswa yang sudah hadir hari itu, begitu juga guru yang absen, guru yang mengisi jurnal, dan siswa PKL.

### Logo & Identitas
Nama aplikasi: **SIAKAD ESEMKASA**. Logo memakai lambang resmi SMK Negeri 1 Woyla (file `icons/icon-*.png`), tampil di halaman login, sidebar, favicon, dan ikon aplikasi saat diinstal. Jika logo sekolah berubah di kemudian hari, cukup ganti kelima file di folder `icons/` dengan ukuran yang sama (32, 96, 180, 192, 512 px persegi) — tidak perlu mengubah kode.

### Kepala Sekolah juga bisa absen
Akun dengan role **Kepala Sekolah** sekarang punya menu **Absensi Saya** (selain Dashboard Eksekutif), memakai mekanisme geofencing yang sama seperti Guru/Tata Usaha.

### Jam Real-Time & Tombol Kembali
- Setelah login, jam berjalan (format Jam:Menit:Detik) tampil di kanan atas untuk semua role, memakai waktu perangkat pengguna.
- Setiap membuka menu dari sidebar, tombol **← Kembali** muncul di kiri atas untuk kembali ke menu sebelumnya.

### Aturan Jam Absensi Guru/Pegawai
- **Absen Masuk**: hanya bisa sampai pukul **12:00** (Senin-Kamis & Sabtu) atau **11:00** (khusus Jumat). Setelah lewat waktu itu, tombol Absen Masuk otomatis terkunci.
- **Telat**: jika absen masuk dilakukan setelah pukul **08:00**, sistem otomatis menghitung keterlambatan dan menampilkan notifikasi "Anda Telat ... Menit".
- **Absen Pulang**: hanya bisa dilakukan **setelah pukul 12:00**; sebelum itu tombol terkunci.
- Semua jam absensi (masuk & pulang, guru maupun siswa) dicatat dalam format **Jam:Menit:Detik**.
- Aturan jam ini berlaku untuk semua pengguna yang memakai fitur "Absensi Guru/Pegawai" (Guru, Tata Usaha, dan Kepala Sekolah), karena memakai satu mekanisme absensi yang sama.

### Rekap Bulanan: Urutan & Cetak Satu Halaman
- **Rekap Absensi Guru** otomatis diurutkan: **Kepala Sekolah** paling atas, lalu Guru/Tendik lainnya diurutkan berdasarkan **NIP** (semakin kecil/lebih awal, semakin atas — mencerminkan pengangkatan lebih dulu).
- **Rekap Absensi Siswa** diurutkan per Kelas lalu Nama.
- Tombol cetak akan otomatis mengatur kertas ke **landscape** dan menyesuaikan skala tabel agar **muat dalam satu halaman**. Untuk data yang sangat banyak (puluhan pegawai/siswa dengan bulan 31 hari), tulisan bisa menjadi sangat kecil — ini adalah upaya terbaik ("best effort") untuk memuat semuanya di satu halaman; jika perlu dibaca dengan nyaman, gunakan zoom PDF setelah dicetak/disimpan.
- Kolom tanda tangan **Kepala Sekolah** tetap tercetak di bagian bawah tabel.

### Dashboard Monitoring dengan Persentase & Warna Elegan
Kartu-kartu di Dashboard Eksekutif (Kepala Sekolah/Waka Kurikulum/Waka Hubmi) sekarang memakai header bergradasi warna penuh (bukan cuma aksen di sisi), dan langsung menampilkan **persentase kehadiran** — untuk Guru, Siswa reguler, maupun Siswa PKL — beserta daftar nama secara live di bawahnya.


## 5. Login pertama kali
- Username: `admin`
- Password: `admin123`
- Segera ganti setelah login, lalu isi Data Guru & Pegawai dan Data Siswa di menu Admin.

## Catatan
- Role baru **Tata Usaha** ditambahkan (memakai fitur absensi geofencing yang sama seperti Guru).
- Foto dokumentasi tetap disimpan ke Google Drive (folder `SistemSekolah_Dokumentasi`), URL-nya saja yang disimpan ke Sheets.
- Karena JSX sudah dikompilasi terlebih dahulu (bukan ditranspile di browser), tidak ada lagi ketergantungan ke `@babel/standalone` di CDN.

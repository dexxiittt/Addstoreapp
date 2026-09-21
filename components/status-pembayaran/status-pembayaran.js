/* ============================================================
   GLOBAL VARIABLES & INITIALIZATION
   ============================================================ */
window.rawInvoice = "";
window.rawPackageId = "";

window.onload = async function() {
  // STEP 1: Load data awal dari LocalStorage
  loadFromLocalStorage();

  // STEP 2: Sinkronisasi data dari OpenSheet (Google Sheet)
  await loadFromSheet();
};

/* ============================================================
   CORE FUNCTIONS (LOCAL STORAGE & SHEET FETCHING)
   ============================================================ */
function checkIsExpired() {
  const params = new URLSearchParams(window.location.search);
  const invoice = params.get("invoice") || localStorage.getItem("invoiceID");
  
  if (!invoice) return false;

  const invDigits = invoice.replace("INV", "").trim();
  if (invDigits.length < 12) return false; 

  const year = parseInt(invDigits.substring(0, 4));
  const month = parseInt(invDigits.substring(4, 6)) - 1;
  const date = parseInt(invDigits.substring(6, 8));
  const hour = parseInt(invDigits.substring(8, 10));
  const minute = parseInt(invDigits.substring(10, 12));

  const createdAtTime = new Date(year, month, date, hour, minute, 0).getTime();
  const now = new Date().getTime();
  const oneHour = 60 * 60 * 1000;

  return (now - createdAtTime) > oneHour;
}

function loadFromLocalStorage() {
  const localData = JSON.parse(localStorage.getItem("paymentData"));
  if (!localData) return false;

  window.rawPackageId = localData.packageId || localData.package_id || "";
   
  renderCustomer(localData.nama, localData.telepon, localData.email);

  const matches = (localData.paketHarga || "").match(/Rp\s?[\d\.]+/g);
  const hargaLama = matches ? matches[0].replace("Rp ", "") : "0";

  const hargaHtml = `
    <div class="price-old">Rp ${hargaLama}</div>
    <div class="price-final">${localData.total}</div>
  `;

  renderProduct(
    localData.image,
    localData.paket,
    localData.paketDetail,
    hargaHtml,
    localData.diskon,
    localData.hemat,
    localData.total
  );

  // Tampilan awal sebelum sheet ter-fetch
  renderStatus(false, false, false, localData.status || "pending", null);

  const params = new URLSearchParams(window.location.search);
  const invoice = params.get("invoice") || localStorage.getItem("invoiceID");
  
  const now = new Date();
  const formattedTime = now.toLocaleString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  })
  .replace(",", "")
  .replace("pukul", "")
  .trim();

  renderInvoice(invoice, formattedTime);
  return true;
}

/* ============================================================
   POIN 1: loadFromSheet() - Menghasilkan 3 Boolean Alur
   ============================================================ */
async function loadFromSheet() {
  try {
    const params = new URLSearchParams(window.location.search);
    const invoiceID = params.get("invoice");

    if (!invoiceID) {
      showToast("Invoice tidak ditemukan ❌", "fa-circle-xmark");
      return;
    }

    const cleanInvoiceID = String(invoiceID).replace("INV", "").trim();

    // 1. FETCH TIPS GLOBAL
    const tipsRes = await fetch("https://opensheet.elk.sh/1JtmaN7ASwvnQzoOKPqVA3Uy85fcNfcLTArYOyQZRV08/statustips_payment");
    const tipsData = await tipsRes.json();
    const globalTips = tipsData[0];

    // 2. FETCH STATUS_PAYMENT
    const statusRes = await fetch("https://opensheet.elk.sh/1JtmaN7ASwvnQzoOKPqVA3Uy85fcNfcLTArYOyQZRV08/status_payment");
    const statusData = await statusRes.json();
    const statusRow = statusData.find(x => String(x.invoice || "").replace("INV", "").trim() === cleanInvoiceID);

    // 3. FETCH PAYMENT_ID
    const res = await fetch("https://opensheet.elk.sh/1JtmaN7ASwvnQzoOKPqVA3Uy85fcNfcLTArYOyQZRV08/payment_id");
    const data = await res.json();
    const found = data.find(x => String(x.invoice || "").replace("INV", "").trim() === cleanInvoiceID);

    // --- LOGIKA EVALUASI 3 BOOLEAN ---
    
    // STEP 2 Condition: Kolom invoice terisi di status_payment DAN payment_id
    const isPaymentFilled = Boolean(
      statusRow?.invoice &&
      found?.invoice
    );

    // STEP 3 Condition: status = success di kedua sheet, package_id & informasi_pelanggan terisi
    const isAdminVerified = Boolean(
      isPaymentFilled &&
      String(statusRow?.status || "").trim().toLowerCase() === "success" &&
      String(found?.status || "").trim().toLowerCase() === "success" &&
      String(found?.package_id || "").trim() !== "" &&
      String(found?.informasi_pelanggan || "").trim() !== ""
    );

    // STEP 4 Condition: proses = done pada sheet status_payment
    const processStatus = String(statusRow?.proses || "").trim().toLowerCase();
    const isProcessDone = Boolean(
      isAdminVerified &&
      processStatus === "done"
    );

    // Process render detail produk jika data di payment_id ketemu
    if (found) {
      const info = (found.informasi_pelanggan || "").split("|");
      window.rawInvoice = found.invoice;
      window.rawPackageId = found.package_id || window.rawPackageId || "";

      const resProduk = await fetch("https://opensheet.elk.sh/1JtmaN7ASwvnQzoOKPqVA3Uy85fcNfcLTArYOyQZRV08/PACKAGE_DETAIL");
      const produk = await resProduk.json();

      const detail = produk.find(p => String(p.package_id).trim() === String(found.package_id).trim());
      if (detail) {
        if (info.length >= 3) {
          renderCustomer(info[0], info[1], info[2]);
        }

        function rp(x) { return "Rp " + x.toLocaleString("id-ID"); }

        const harga = Number(String(detail.price || "0").replace(/[^\d]/g, "")) || 0;
        const sheetFinalPrice = Number(String(detail.final_price || "0").replace(/[^\d]/g, "")) || 0;
        
        let discountPercent = 0;
        if (detail.discount) {
          discountPercent = parseFloat(String(detail.discount).replace("%", "").replace(",", ".").trim()) || 0;
        }
        
        const total = sheetFinalPrice > 0 
          ? sheetFinalPrice 
          : (discountPercent > 0 ? Math.round(harga - (harga * discountPercent / 100)) : harga);
          
        const hemat = harga - total;
        const diskonPersenRaw = harga > 0 ? ((harga - total) / harga * 100) : 0;
        const hitungDiskonDinamis = parseFloat(diskonPersenRaw.toFixed(2));

        const diskonTeks = discountPercent > 0 
          ? "-" + String(detail.discount).trim() 
          : (hitungDiskonDinamis > 0 ? "-" + hitungDiskonDinamis + "%" : "0%");

        const fullSubtitle = (detail.subtitle && detail.duration) 
          ? `${detail.subtitle} • ${detail.duration}` 
          : (detail.subtitle || detail.duration || "");

        const hargaHtml = `
          <div class="price-old">${rp(harga)}</div>
          <div class="price-final">${rp(total)}</div>
        `;

        renderProduct(detail.image_url, detail.title, fullSubtitle, hargaHtml, diskonTeks, rp(hemat), rp(total));
      }
    }

    // Pass ketiga boolean ke renderStatus()
    renderStatus(isPaymentFilled, isAdminVerified, isProcessDone, processStatus, globalTips);

    const waktu = new Date().toLocaleString("id-ID", {
      day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).replace(",", "").replace("pukul", "").trim();

    renderInvoice(found ? found.invoice : cleanInvoiceID, waktu);

  } catch (err) {
    console.warn("Gagal sinkronisasi dengan Google Sheet:", err);
  }
}

/* ============================================================
   UI RENDERING FUNCTIONS
   ============================================================ */
function renderCustomer(nama, wa, email) {
  document.getElementById("nama").innerText = nama || "-";
  document.getElementById("wa").innerText = wa || "-";
  document.getElementById("email").innerText = email || "-";
}

function renderProduct(image, title, subtitle, hargaHtml, diskon, hemat, total) {
  const img = document.getElementById("productImage");
  if (img) {
    if (image) {
      img.src = image;
      if (document.getElementById("productImageBox")) {
        document.getElementById("productImageBox").style.display = "block";
      }
    } else {
      if (document.getElementById("productImageBox")) {
        document.getElementById("productImageBox").style.display = "none";
      }
    }
  }

  document.getElementById("paket").innerText = title || "-";
  document.getElementById("paketDetail").innerText = subtitle || "-";
  document.getElementById("harga").innerHTML = hargaHtml || "-";
  document.getElementById("diskon").innerText = diskon || "-";
  document.getElementById("hemat").innerText = hemat || "-";
  document.getElementById("total").innerText = total || "-";
  document.getElementById("total2").innerText = total || "-";
  document.getElementById("total3").innerText = total || "-";
}

/* ============================================================
   POIN 2: renderStatus() - Mengontrol Banner UI & Timeline
   ============================================================ */
function renderStatus(isPaymentFilled, isAdminVerified, isProcessDone, processStatus, tipsObj) {
  // 1. Cek Expired jika belum terverifikasi admin
  if (!isAdminVerified && checkIsExpired()) {
    setExpiredUI(tipsObj?.tips_expired);
    return;
  }

  // 2. Kontrol timeline menggunakan ketiga boolean
  updateProgress(isPaymentFilled, isAdminVerified, isProcessDone, processStatus);

  // 3. Kontrol Banner UI Utama
  if (isProcessDone) {
    setSuccessUI("done", tipsObj?.tips_proses);
    localStorage.removeItem("invoiceID");
    localStorage.removeItem("invoiceCreatedAt");
  } else if (isAdminVerified) {
    setSuccessUI("process", tipsObj?.tips_success);
  } else if (isPaymentFilled) {
    // Langsung ubah UI ke mode Success "payment"
    setSuccessUI("payment", tipsObj?.tips_pending);
  } else {
    setPendingUI(tipsObj?.tips_pending);
  }
}

function renderInvoice(invoice, time) {
  window.rawInvoice = invoice;
  document.getElementById("invoice").innerText = "INV" + invoice;
  document.getElementById("time").innerText = time;
}

function getStatusElements() {
  return {
    invoiceBox: document.getElementById("invoiceBox"),
    statusBox: document.getElementById("statusBox"),
    statusBadgeIcon: document.getElementById("statusBadgeIcon"),
    statusBadgeText: document.getElementById("statusBadgeText"),
    statusTitle: document.getElementById("statusTitle"),
    statusDescription: document.getElementById("statusDescription"),
    statusTipText: document.getElementById("statusTipText"),
    statusIconFa: document.getElementById("statusIconFa"),
  };
}

/* ============================================================
   STATUS UI THEMES & FUNCTIONS (UPGRADED VERSION)
   ============================================================ */
function renderStatus(isPaymentFilled, isAdminVerified, isProcessDone, processStatus, tipsObj) {
  // 1. Cek Expired jika belum terverifikasi admin
  if (!isAdminVerified && checkIsExpired()) {
    setExpiredUI(tipsObj?.tips_expired);
    return;
  }

  // 2. Kontrol timeline menggunakan ketiga boolean
  updateProgress(isPaymentFilled, isAdminVerified, isProcessDone, processStatus);

  // 3. Kontrol Banner UI Utama
  if (isProcessDone) {
    setSuccessUI("done", tipsObj?.tips_proses);
    localStorage.removeItem("invoiceID");
    localStorage.removeItem("invoiceCreatedAt");
  } else if (isAdminVerified) {
    setSuccessUI("process", tipsObj?.tips_success);
  } else if (isPaymentFilled) {
    // Pembayaran masuk -> Langsung ubah UI ke Success "payment"
    setSuccessUI("payment", tipsObj?.tips_pending);
  } else {
    setPendingUI(tipsObj?.tips_pending);
  }
}

function setPendingUI(tipsText) {
  const ui = getStatusElements();

  ui.invoiceBox.classList.remove("status-success", "status-expired");
  ui.statusBox.classList.remove("status-success", "status-expired");
  ui.invoiceBox.classList.add("status-pending");
  ui.statusBox.classList.add("status-pending");

  ui.statusBadgeText.innerText = "Menunggu Pembayaran";
  ui.statusTitle.innerText = "Menunggu Pembayaran";
  ui.statusDescription.innerText = "Silakan lakukan pembayaran sesuai nominal yang tertera pada invoice.";
  ui.statusTipText.innerHTML = generateTipsHtml(tipsText, "Pastikan nominal pembayaran sesuai agar proses verifikasi oleh admin berjalan lebih cepat.");
  ui.statusBadgeIcon.className = "fa-solid fa-stopwatch";
  ui.statusIconFa.className = "fa-solid fa-hourglass-half";

  // Reset Section Header & Support Card Ke Mode WhatsApp Normal
  const supportSectionTitle = document.getElementById("supportSectionTitle");
  const supportSectionIcon = document.getElementById("supportSectionIcon");
  if (supportSectionTitle) supportSectionTitle.innerText = "Hubungi Admin";
  if (supportSectionIcon) {
    supportSectionIcon.className = "section-icon icon-green";
    supportSectionIcon.innerHTML = '<i class="fa-brands fa-whatsapp"></i>';
  }

  const waBox = document.querySelector(".wa-box");
  if (waBox) waBox.classList.remove("expired");

  const supportIconFa = document.getElementById("supportIconFa");
  if (supportIconFa) supportIconFa.className = "fa-brands fa-whatsapp";

  document.getElementById("supportTitle").innerText = "Hubungi Admin";
  document.getElementById("supportDescription").innerHTML = "Sudah melakukan pembayaran tetapi status masih <b>Pending</b>? Kirim bukti pembayaran ke admin agar proses verifikasi dapat segera dilakukan.";

  const waBtn = document.getElementById("waButton");
  if (waBtn) {
    waBtn.setAttribute("onclick", "chatAdmin()");
    waBtn.style.backgroundColor = ""; 
    waBtn.style.cursor = "pointer";
  }
  document.getElementById("waButtonText").innerText = "Chat Admin Sekarang";
  document.getElementById("waButtonIcon").className = "fa-brands fa-whatsapp";
}

function setSuccessUI(proses, tipsText) {
  const ui = getStatusElements();

  // Reset warna tema ke hijau (Success)
  ui.invoiceBox.classList.remove("status-pending", "status-expired");
  ui.statusBox.classList.remove("status-pending", "status-expired");
  ui.invoiceBox.classList.add("status-success");
  ui.statusBox.classList.add("status-success");

  // Icon & Theme yang seragam
  ui.statusBadgeIcon.className = "fa-solid fa-check";
  ui.statusIconFa.className = "fa-solid fa-check";

  // Reset Section Header & Support Card Ke Mode WhatsApp Normal
  const supportSectionTitle = document.getElementById("supportSectionTitle");
  const supportSectionIcon = document.getElementById("supportSectionIcon");
  if (supportSectionTitle) supportSectionTitle.innerText = "Hubungi Admin";
  if (supportSectionIcon) {
    supportSectionIcon.className = "section-icon icon-green";
    supportSectionIcon.innerHTML = '<i class="fa-brands fa-whatsapp"></i>';
  }

  const waBox = document.querySelector(".wa-box");
  if (waBox) waBox.classList.remove("expired");

  const supportIconFa = document.getElementById("supportIconFa");
  if (supportIconFa) supportIconFa.className = "fa-brands fa-whatsapp";

  const waBtn = document.getElementById("waButton");
  if (waBtn) {
    waBtn.setAttribute("onclick", "chatAdmin()");
    waBtn.style.backgroundColor = ""; 
    waBtn.style.cursor = "pointer";
  }
  document.getElementById("waButtonText").innerText = "Hubungi Admin";
  document.getElementById("waButtonIcon").className = "fa-brands fa-whatsapp";

  switch (proses) {
    case "payment":
      ui.statusBadgeText.innerText = "Pembayaran Berhasil";
      ui.statusTitle.innerText = "Pembayaran Berhasil";
      ui.statusDescription.innerText = "Pembayaran berhasil diterima dan sedang dalam proses verifikasi oleh admin.";
      ui.statusTipText.innerHTML = generateTipsHtml(tipsText, "Pembayaran berhasil diterima! Pesanan kamu sedang diverifikasi oleh admin.");
      document.getElementById("supportTitle").innerText = "Verifikasi Admin";
      document.getElementById("supportDescription").innerHTML = "Pembayaran telah berhasil diterima. Kirim pesan ke admin jika memerlukan bantuan selama proses verifikasi.";
      break;

    case "process":
      ui.statusBadgeText.innerText = "Pesanan Diproses";
      ui.statusTitle.innerText = "Pesanan Diproses";
      ui.statusDescription.innerText = "Pembayaran telah berhasil diverifikasi dan pesanan kamu sedang diproses oleh admin.";
      ui.statusTipText.innerHTML = generateTipsHtml(tipsText, "Pesanan sedang diproses oleh admin. Terima kasih telah melakukan pembayaran.");
      document.getElementById("supportTitle").innerText = "Pesanan Sedang Diproses";
      document.getElementById("supportDescription").innerHTML = "Pembayaran telah berhasil diverifikasi. Pesanan kamu sedang diproses oleh admin.";
      break;

    case "done":
      ui.statusBadgeText.innerText = "Pesanan Selesai";
      ui.statusTitle.innerText = "Pesanan Selesai";
      ui.statusDescription.innerText = "Pesanan telah selesai diproses oleh Admin. Terima kasih sudah membeli di Addstoreapp.";
      ui.statusTipText.innerHTML = generateTipsHtml(tipsText, "Pesanan telah selesai diproses. Terima kasih telah berbelanja!");
      document.getElementById("supportTitle").innerText = "Pesanan Selesai ✨";
      document.getElementById("supportDescription").innerHTML = "Pesanan kamu telah selesai diproses full oleh admin. Terima kasih telah berbelanja di <b>Addstoreapp</b>.";
      break;
  }
}

function setExpiredUI(tipsText) {
  const ui = getStatusElements();

  ui.invoiceBox.classList.remove("status-pending", "status-success");
  ui.statusBox.classList.remove("status-pending", "status-success"); 
  ui.invoiceBox.classList.add("status-expired");
  ui.statusBox.classList.add("status-expired"); 

  ui.statusBadgeText.innerText = "Invoice Kedaluwarsa"; 
  ui.statusTitle.innerText = "Waktu Pembayaran Habis"; 
  ui.statusDescription.innerText = "Maaf, batas waktu pembayaran 1 jam telah habis. Invoice ini sudah tidak berlaku lagi."; 
  ui.statusTipText.innerHTML = generateTipsHtml(tipsText, "Silakan melakukan generate ulang invoice melalui tombol di bawah untuk memperbarui pesanan."); 
  ui.statusBadgeIcon.className = "fa-solid fa-xmark";
  ui.statusIconFa.className = "fa-solid fa-bell-slash"; 

  // Timeline Step Icons
  const orderIcon = document.querySelector("#stepOrder i");
  const paymentIcon = document.querySelector("#stepPayment i");
  if (orderIcon) orderIcon.className = "fa-solid fa-xmark";
  if (paymentIcon) paymentIcon.className = "fa-solid fa-xmark";

  const orderBg = document.querySelector("#stepOrder .floating-icon");
  const paymentBg = document.querySelector("#stepPayment .floating-icon");
  if (orderBg) orderBg.className = "floating-icon icon-solid-red";
  if (paymentBg) paymentBg.className = "floating-icon icon-solid-red";

  const stepOrder = document.getElementById("stepOrder"); 
  const stepPayment = document.getElementById("stepPayment");

  if (stepOrder && !document.getElementById("expiredTextOrder")) {
    const textRedOrder = document.createElement("div");
    textRedOrder.id = "expiredTextOrder";
    textRedOrder.classList.add("expired-text-timeline");
    textRedOrder.innerText = "sesi kadaluarsa";
    stepOrder.appendChild(textRedOrder);
  }

  if (stepPayment && !document.getElementById("expiredTextPayment")) {
    const textRedPayment = document.createElement("div");
    textRedPayment.id = "expiredTextPayment";
    textRedPayment.classList.add("expired-text-timeline"); 
    textRedPayment.innerText = "sesi kadaluarsa";
    stepPayment.appendChild(textRedPayment);
  }

  // --- EXPIRED UI UPGRADES ---

  // 1. Header Section Title & Icon (Atas Card)
  const supportSectionTitle = document.getElementById("supportSectionTitle");
  const supportSectionIcon = document.getElementById("supportSectionIcon");
  if (supportSectionTitle) supportSectionTitle.innerText = "Invoice Kedaluwarsa";
  if (supportSectionIcon) {
    supportSectionIcon.className = "section-icon icon-red";
    supportSectionIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
  }

  // 2. Tambah class .expired ke Support Card (.wa-box) untuk mentrigger CSS Merah
  const waBox = document.querySelector(".wa-box");
  if (waBox) waBox.classList.add("expired");

  // 3. Icon & Teks Dalam Support Card
  const supportIconFa = document.getElementById("supportIconFa");
  if (supportIconFa) supportIconFa.className = "fa-solid fa-circle-exclamation";

  document.getElementById("supportTitle").innerText = "Invoice Kedaluwarsa"; 
  document.getElementById("supportDescription").innerHTML = "Untuk melanjutkan pembelian paket, silakan klik tombol di bawah ini untuk membuat invoice baru."; 

  // 4. Action Button (Generate Ulang Invoice)
  const waBtn = document.getElementById("waButton") || document.querySelector(".support-action a"); 
  if (waBtn) { 
    waBtn.href = "javascript:void(0);";
    waBtn.setAttribute("onclick", "generateUlangInvoice()");
    waBtn.style.cursor = "pointer"; 

    document.getElementById("waButtonText").innerText = "Generate Ulang Invoice Baru ⚡";
    document.getElementById("waButtonIcon").className = "fa-solid fa-rotate-right"; 
  }
}

function generateUlangInvoice() {
  localStorage.removeItem("invoiceID");
  localStorage.removeItem("invoiceCreatedAt");
  window.location.href = "pembayaran-qr.html"; 
}

function setCancelUI() { /* TODO */ }
function setRefundUI() { /* TODO */ }

/* ============================================================
   POIN 3: updateProgress() - Evaluasi Timeline Berdasarkan Boolean
   ============================================================ */
function updateProgress(isPaymentFilled, isAdminVerified, isProcessDone, processStatus) {
  const expiredTextOrder = document.getElementById("expiredTextOrder");
  const expiredTextPayment = document.getElementById("expiredTextPayment");
  if (expiredTextOrder) expiredTextOrder.remove();
  if (expiredTextPayment) expiredTextPayment.remove();

  // STEP 1: Pesanan Dibuat (Selalu Completed / Centang Ungu)
  document.getElementById("stepOrder").className = "progress-item completed";
  document.querySelector("#stepOrder i").className = "fa-solid fa-check";
  document.querySelector("#stepOrder .floating-icon").className = "floating-icon icon-purple";

  // STEP 2: Menunggu Pembayaran (Centang Ungu jika Invoice Terisi di kedua sheet)
  if (isPaymentFilled) {
    document.getElementById("stepPayment").className = "progress-item completed";
    document.querySelector("#stepPayment i").className = "fa-solid fa-check";
    document.querySelector("#stepPayment .floating-icon").className = "floating-icon icon-purple";
  } else {
    document.getElementById("stepPayment").className = "progress-item current";
    document.querySelector("#stepPayment i").className = "fa-solid fa-hourglass-half";
    document.querySelector("#stepPayment .floating-icon").className = "floating-icon icon-gold";
  }

  // STEP 3: Verifikasi Admin (Centang Ungu jika Admin Terverifikasi)
  if (isAdminVerified) {
    document.getElementById("stepVerification").className = "progress-item completed";
    document.querySelector("#stepVerification i").className = "fa-solid fa-check";
    document.querySelector("#stepVerification .floating-icon").className = "floating-icon icon-purple";
  } else if (isPaymentFilled) {
    document.getElementById("stepVerification").className = "progress-item current";
    document.querySelector("#stepVerification i").className = "fa-solid fa-hourglass-half";
    document.querySelector("#stepVerification .floating-icon").className = "floating-icon icon-gold";
  } else {
    document.getElementById("stepVerification").className = "progress-item";
    document.querySelector("#stepVerification i").className = "fa-solid fa-hourglass-half";
    document.querySelector("#stepVerification .floating-icon").className = "floating-icon";
  }

  // STEP 4: Pesanan Diproses (Centang Ungu jika proses = done)
  if (isProcessDone) {
    document.getElementById("stepProcess").className = "progress-item completed";
    document.querySelector("#stepProcess i").className = "fa-solid fa-check";
    document.querySelector("#stepProcess .floating-icon").className = "floating-icon icon-purple";
  } else if (isAdminVerified) {
    document.getElementById("stepProcess").className = "progress-item current";
    document.querySelector("#stepProcess i").className = "fa-solid fa-box-open";
    document.querySelector("#stepProcess .floating-icon").className = "floating-icon icon-green";
  } else {
    document.getElementById("stepProcess").className = "progress-item";
    document.querySelector("#stepProcess i").className = "fa-solid fa-box-open";
    document.querySelector("#stepProcess .floating-icon").className = "floating-icon";
  }
}

/* ============================================================
   UTILITIES (CLIPBOARD COPY & TOAST)
   ============================================================ */
function copyInvoice() {
  navigator.clipboard.writeText(window.rawInvoice);
  showCopyToast();
}

function showCopyToast() {
  const toast = document.getElementById("copyToast");
  if (toast) {
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 2000);
  }
}

function showToast(message, iconClass = "fa-circle-check") {
  const toast = document.getElementById("customDynamicToast");
  const msgEl = document.getElementById("toastMessage");
  const iconEl = document.getElementById("toastIcon");

  if (!toast || !msgEl || !iconEl) return;

  msgEl.innerText = message;
  iconEl.className = `fa-solid ${iconClass}`;
  iconEl.style.color = iconClass.includes("check") ? "#4ade80" : "#f87171";

  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

function generateTipsHtml(tipsText, defaultText) {
  let items = [];

  if (!tipsText) {
    items = [defaultText];
  } else {
    items = tipsText
      .split("|")
      .map(tip => tip.trim())
      .filter(tip => tip.length > 0);
  }

  if (items.length <= 1) {
    return `
      <div class="status-tip-item">
        <i class="fa-solid fa-circle"></i>
        <span>${items[0] || defaultText}</span>
      </div>`;
  }

  const firstItemHtml = `
    <div class="status-tip-item">
      <i class="fa-solid fa-circle"></i>
      <span>${items[0]}</span>
    </div>`;

  const remainingItemsHtml = items
    .slice(1)
    .map(
      tip => `
    <div class="status-tip-item">
      <i class="fa-solid fa-circle"></i>
      <span>${tip}</span>
    </div>`
    )
    .join("");

  return `
    ${firstItemHtml}
    <div class="extra-tips-container" id="extraTipsContainer" style="display: none;">
      ${remainingItemsHtml}
    </div>
    <button type="button" class="toggle-tips-btn" onclick="toggleTips(this)">
      <span>Selengkapnya...</span> <i class="fa-solid fa-chevron-down"></i>
    </button>
  `;
}

function toggleTips(btn) {
  const container = document.getElementById("extraTipsContainer");
  if (!container) return;

  const isHidden = container.style.display === "none";
  const label = btn.querySelector("span");
  const icon = btn.querySelector("i");

  if (isHidden) {
    container.style.display = "block";
    if (label) label.innerText = "Sembunyikan";
    if (icon) icon.className = "fa-solid fa-chevron-up";
  } else {
    container.style.display = "none";
    if (label) label.innerText = "Selengkapnya...";
    if (icon) icon.className = "fa-solid fa-chevron-down";
  }
}

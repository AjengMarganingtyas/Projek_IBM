/**
 * script.js — Product Intelligence & Customer Voice Dashboard
 * ============================================================
 * Sumber data: data.json (600 baris ulasan e-commerce sintetis)
 * 
 * Alur kerja:
 *  1. Muat data.json
 *  2. Populasi dropdown filter dari nilai unik dataset
 *  3. Render KPI, grafik, insights, dan tabel ulasan
 *  4. Setiap perubahan filter → recalculate semua komponen
 */

"use strict";

// ============================================================
// KONSTANTA & STATE GLOBAL
// ============================================================

/** Warna sentimen yang konsisten di seluruh dashboard */
const SENTIMENT_COLORS = {
  Positive: { bg: "rgba(34, 197, 94, 0.8)",  border: "#16a34a" },
  Neutral:  { bg: "rgba(245, 158, 11, 0.8)",  border: "#d97706" },
  Negative: { bg: "rgba(239, 68, 68, 0.8)",   border: "#dc2626" },
};

/** Palet warna untuk produk/kategori */
const PRODUCT_COLORS = [
  "#6366f1","#3b82f6","#06b6d4","#10b981","#f59e0b",
  "#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316"
];

const PAGE_SIZE = 15; // Jumlah baris per halaman di tabel ulasan

let allData    = [];   // Seluruh data dari data.json (tidak pernah diubah)
let filtered   = [];   // Data setelah filter aktif diterapkan
let currentPage = 1;  // Halaman aktif di tabel ulasan

/** Referensi instance Chart.js (untuk destroy sebelum re-render) */
const charts = {};

// ============================================================
// UTILITAS
// ============================================================

/**
 * Format angka sebagai Rupiah, contoh: 1234567 → "Rp 1.234.567"
 * @param {number} n
 * @returns {string}
 */
function formatRupiah(n) {
  if (n == null || isNaN(n)) return "—";
  return "Rp " + n.toLocaleString("id-ID");
}

/**
 * Format angka singkat: 1.250.000 → "Rp 1,25 Jt"
 * @param {number} n
 * @returns {string}
 */
function formatRupiahShort(n) {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1_000_000_000) return "Rp " + (n / 1_000_000_000).toFixed(2) + " M";
  if (n >= 1_000_000)     return "Rp " + (n / 1_000_000).toFixed(2) + " Jt";
  if (n >= 1_000)         return "Rp " + (n / 1_000).toFixed(1) + " Rb";
  return "Rp " + n;
}

/**
 * Hasilkan bintang HTML berdasarkan rating 1–5
 * @param {number} rating
 * @returns {string}
 */
function starsHtml(rating) {
  let html = '<span class="star-rating">';
  for (let i = 1; i <= 5; i++) {
    html += i <= rating ? "★" : '<span class="star-empty">★</span>';
  }
  return html + "</span>";
}

/**
 * Escape karakter HTML untuk mencegah XSS pada review_text
 * @param {string} s
 * @returns {string}
 */
function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Kembalikan kelas badge CSS berdasarkan sentimen
 * @param {string} s
 * @returns {string}
 */
function sentimentBadgeClass(s) {
  if (s === "Positive") return "badge badge-positive";
  if (s === "Negative") return "badge badge-negative";
  return "badge badge-neutral";
}

/**
 * Kembalikan kelas badge untuk status pesanan
 * @param {string} s
 * @returns {string}
 */
function statusBadgeClass(s) {
  if (s === "Delivered")  return "badge status-delivered";
  if (s === "Processing") return "badge status-processing";
  if (s === "Cancelled")  return "badge status-cancelled";
  return "badge";
}

/**
 * Format tanggal dari "YYYY-MM-DD" ke "DD MMM YYYY"
 * @param {string} d
 * @returns {string}
 */
function formatDate(d) {
  if (!d) return "—";
  const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const [y, m, day] = d.split("-");
  return `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`;
}

/**
 * Hitung rata-rata dari array angka
 * @param {number[]} arr
 * @returns {number}
 */
function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Destroy chart jika sudah ada agar tidak terjadi double canvas
 * @param {string} id
 */
function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

// ============================================================
// LOAD DATA
// ============================================================

/**
 * Muat data.json dan mulai inisialisasi dashboard.
 * Menggunakan fetch() → kompatibel dengan Live Server.
 */
async function loadData() {
  // Tampilkan loading
  const overlay = document.createElement("div");
  overlay.id = "loadingOverlay";
  overlay.textContent = "⏳ Memuat data...";
  document.body.appendChild(overlay);

  try {
    const resp = await fetch("data.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    allData = await resp.json();

    // Pastikan tipe data numerik benar (jaga-jaga jika JSON diparse sebagai string)
    allData = allData.map(row => ({
      ...row,
      unit_price_idr:  Number(row.unit_price_idr)  || 0,
      quantity:        Number(row.quantity)         || 0,
      total_amount_idr:Number(row.total_amount_idr) || 0,
      rating:          Number(row.rating)           || 0,
    }));

    initFilters();
    applyFilters();

    // Tampilkan info tanggal data terakhir
    const dates = allData.map(r => r.purchase_date).sort();
    document.getElementById("lastUpdated").textContent =
      `Data: ${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`;

  } catch (err) {
    overlay.textContent = "❌ Gagal memuat data.json. Pastikan Live Server aktif.";
    console.error(err);
    return;
  } finally {
    document.body.removeChild(overlay);
  }
}

// ============================================================
// FILTER INITIALIZATION
// ============================================================

/**
 * Populasi dropdown filter dari nilai unik pada dataset.
 * Dipanggil sekali setelah data dimuat.
 */
function initFilters() {
  // Helper: isi select dengan sorted unique values
  function populateSelect(elId, values) {
    const el = document.getElementById(elId);
    values.sort().forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });
  }

  const categories = [...new Set(allData.map(r => r.category))];
  const products   = [...new Set(allData.map(r => r.product_name))];
  const regions    = [...new Set(allData.map(r => r.region))];

  populateSelect("filterCategory", categories);
  populateSelect("filterProduct",  products);
  populateSelect("filterRegion",   regions);

  // Tentukan min/max tanggal dari dataset untuk date picker
  const dates = allData.map(r => r.purchase_date).sort();
  document.getElementById("filterDateFrom").min = dates[0];
  document.getElementById("filterDateFrom").max = dates[dates.length - 1];
  document.getElementById("filterDateTo").min   = dates[0];
  document.getElementById("filterDateTo").max   = dates[dates.length - 1];

  // Event listeners
  ["filterCategory","filterProduct","filterRegion","filterSentiment","filterStatus",
   "filterDateFrom","filterDateTo","searchText","sortReviews"
  ].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
      currentPage = 1;
      applyFilters();
    });
  });

  // Input event untuk search (real-time)
  document.getElementById("searchText").addEventListener("input", () => {
    currentPage = 1;
    applyFilters();
  });

  // Reset Filter
  document.getElementById("btnResetFilter").addEventListener("click", resetFilters);

  // Pagination buttons
  document.getElementById("btnPrevPage").addEventListener("click", () => {
    if (currentPage > 1) { currentPage--; renderReviewTable(); }
  });
  document.getElementById("btnNextPage").addEventListener("click", () => {
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    if (currentPage < totalPages) { currentPage++; renderReviewTable(); }
  });
}

/**
 * Reset semua filter ke keadaan awal
 */
function resetFilters() {
  ["filterCategory","filterProduct","filterRegion","filterSentiment","filterStatus"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("filterDateFrom").value = "";
  document.getElementById("filterDateTo").value   = "";
  document.getElementById("searchText").value     = "";
  document.getElementById("sortReviews").value    = "date_desc";
  currentPage = 1;
  applyFilters();
}

// ============================================================
// FILTER LOGIC
// ============================================================

/**
 * Terapkan semua filter aktif → update filtered[] → render ulang semua komponen
 */
function applyFilters() {
  const cat      = document.getElementById("filterCategory").value;
  const prod     = document.getElementById("filterProduct").value;
  const region   = document.getElementById("filterRegion").value;
  const sent     = document.getElementById("filterSentiment").value;
  const status   = document.getElementById("filterStatus").value;
  const dateFrom = document.getElementById("filterDateFrom").value;
  const dateTo   = document.getElementById("filterDateTo").value;
  const search   = document.getElementById("searchText").value.trim().toLowerCase();

  filtered = allData.filter(row => {
    if (cat      && row.category     !== cat)      return false;
    if (prod     && row.product_name !== prod)     return false;
    if (region   && row.region       !== region)   return false;
    if (sent     && row.sentiment    !== sent)     return false;
    if (status   && row.order_status !== status)   return false;
    if (dateFrom && row.purchase_date < dateFrom)  return false;
    if (dateTo   && row.purchase_date > dateTo)    return false;
    if (search) {
      const haystack = [
        row.review_text, row.review_topic, row.product_name,
        row.customer_name, row.region
      ].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  // Update filter summary
  const total = filtered.length;
  document.getElementById("filterSummary").textContent =
    `Menampilkan ${total.toLocaleString("id-ID")} dari ${allData.length} ulasan`;

  // Render semua komponen
  renderKPI();
  renderSalesTrend();
  renderSentimentPie();
  renderProductRevenue();
  renderProductRating();
  renderTopics();
  renderRegionSentiment();
  renderRatingDist();
  renderOrderStatus();
  renderInsights();
  renderReviewTable();
}

// ============================================================
// KPI CARDS
// ============================================================

/**
 * Hitung dan tampilkan kartu KPI berdasarkan data yang difilter.
 * 
 * Definisi metrik:
 * - Total Ulasan: jumlah baris dalam filtered[]
 * - Total Transaksi (Delivered): sum(total_amount_idr) untuk order_status === "Delivered"
 * - Rata-rata Rating: mean(rating) dari semua baris filtered
 * - Distribusi sentimen: count per nilai sentiment label
 */
function renderKPI() {
  const n = filtered.length;

  // Total transaksi hanya dari pesanan Delivered (bukan Processing/Cancelled)
  const totalRevenue = filtered
    .filter(r => r.order_status === "Delivered")
    .reduce((s, r) => s + r.total_amount_idr, 0);

  const avgRating = n > 0 ? avg(filtered.map(r => r.rating)) : 0;

  const positiveCount = filtered.filter(r => r.sentiment === "Positive").length;
  const neutralCount  = filtered.filter(r => r.sentiment === "Neutral").length;
  const negativeCount = filtered.filter(r => r.sentiment === "Negative").length;

  document.getElementById("kpiTotalReviews").textContent = n.toLocaleString("id-ID");
  document.getElementById("kpiTotalRevenue").textContent = formatRupiahShort(totalRevenue);
  document.getElementById("kpiAvgRating").textContent    = n > 0 ? avgRating.toFixed(2) + " ★" : "—";
  document.getElementById("kpiPositive").textContent     = positiveCount > 0
    ? `${positiveCount} (${((positiveCount/n)*100).toFixed(1)}%)`  : "0";
  document.getElementById("kpiNeutral").textContent      = neutralCount > 0
    ? `${neutralCount} (${((neutralCount/n)*100).toFixed(1)}%)`   : "0";
  document.getElementById("kpiNegative").textContent     = negativeCount > 0
    ? `${negativeCount} (${((negativeCount/n)*100).toFixed(1)}%)` : "0";
}

// ============================================================
// CHART: SALES TREND
// ============================================================

/**
 * Grafik tren nilai transaksi bulanan.
 * Hanya pesanan berstatus "Delivered" yang dihitung sebagai transaksi berhasil.
 * Kunci urutan: YYYY-MM
 */
function renderSalesTrend() {
  destroyChart("salesTrend");
  const ctx = document.getElementById("chartSalesTrend").getContext("2d");

  // Agregasi: total_amount_idr per bulan (Delivered saja)
  const monthMap = {};
  filtered
    .filter(r => r.order_status === "Delivered")
    .forEach(r => {
      const key = r.purchase_date.slice(0, 7); // "YYYY-MM"
      monthMap[key] = (monthMap[key] || 0) + r.total_amount_idr;
    });

  const sortedKeys = Object.keys(monthMap).sort();
  const labels = sortedKeys.map(k => {
    const [y, m] = k.split("-");
    const monthNames = ["","Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
    return `${monthNames[parseInt(m)]} ${y}`;
  });
  const values = sortedKeys.map(k => monthMap[k]);

  if (!sortedKeys.length) {
    showNoData("chartSalesTrend");
    return;
  }

  charts.salesTrend = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Nilai Transaksi (Delivered)",
        data: values,
        fill: true,
        backgroundColor: "rgba(99, 102, 241, 0.12)",
        borderColor: "#6366f1",
        borderWidth: 2.5,
        pointRadius: 4,
        pointBackgroundColor: "#6366f1",
        tension: 0.35,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => " " + formatRupiah(ctx.parsed.y)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: v => formatRupiahShort(v),
            font: { size: 10 }
          },
          grid: { color: "rgba(0,0,0,0.05)" }
        },
        x: {
          ticks: { font: { size: 10 } },
          grid: { display: false }
        }
      }
    }
  });
}

// ============================================================
// CHART: SENTIMENT PIE
// ============================================================

function renderSentimentPie() {
  destroyChart("sentimentPie");
  const ctx = document.getElementById("chartSentimentPie").getContext("2d");

  const counts = {
    Positive: filtered.filter(r => r.sentiment === "Positive").length,
    Neutral:  filtered.filter(r => r.sentiment === "Neutral").length,
    Negative: filtered.filter(r => r.sentiment === "Negative").length,
  };

  if (!filtered.length) { showNoData("chartSentimentPie"); return; }

  charts.sentimentPie = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: [
          SENTIMENT_COLORS.Positive.bg,
          SENTIMENT_COLORS.Neutral.bg,
          SENTIMENT_COLORS.Negative.bg,
        ],
        borderColor: [
          SENTIMENT_COLORS.Positive.border,
          SENTIMENT_COLORS.Neutral.border,
          SENTIMENT_COLORS.Negative.border,
        ],
        borderWidth: 2,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { font: { size: 11 }, padding: 16, boxWidth: 14 }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const val = ctx.parsed;
              const total = filtered.length;
              return ` ${ctx.label}: ${val} (${((val/total)*100).toFixed(1)}%)`;
            }
          }
        }
      }
    }
  });
}

// ============================================================
// CHART: PRODUCT REVENUE BAR
// ============================================================

/**
 * Total nilai transaksi (Delivered) per produk.
 */
function renderProductRevenue() {
  destroyChart("productRevenue");
  const ctx = document.getElementById("chartProductRevenue").getContext("2d");

  const map = {};
  filtered
    .filter(r => r.order_status === "Delivered")
    .forEach(r => {
      map[r.product_name] = (map[r.product_name] || 0) + r.total_amount_idr;
    });

  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(e => e[0]);
  const values = sorted.map(e => e[1]);

  if (!sorted.length) { showNoData("chartProductRevenue"); return; }

  charts.productRevenue = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Total Transaksi (Delivered)",
        data: values,
        backgroundColor: labels.map((_, i) => PRODUCT_COLORS[i % PRODUCT_COLORS.length] + "cc"),
        borderColor:     labels.map((_, i) => PRODUCT_COLORS[i % PRODUCT_COLORS.length]),
        borderWidth: 1.5,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => " " + formatRupiah(ctx.parsed.y)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => formatRupiahShort(v), font: { size: 10 } },
          grid: { color: "rgba(0,0,0,0.05)" }
        },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } }
      }
    }
  });
}

// ============================================================
// CHART: AVG RATING PER PRODUCT
// ============================================================

function renderProductRating() {
  destroyChart("productRating");
  const ctx = document.getElementById("chartProductRating").getContext("2d");

  const map = {}; // { product: [ratings] }
  filtered.forEach(r => {
    if (!map[r.product_name]) map[r.product_name] = [];
    map[r.product_name].push(r.rating);
  });

  const sorted = Object.entries(map)
    .map(([name, ratings]) => ({ name, avg: avg(ratings), count: ratings.length }))
    .sort((a, b) => b.avg - a.avg);

  if (!sorted.length) { showNoData("chartProductRating"); return; }

  charts.productRating = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map(e => e.name),
      datasets: [{
        label: "Rata-rata Rating",
        data: sorted.map(e => parseFloat(e.avg.toFixed(2))),
        backgroundColor: sorted.map((_, i) => PRODUCT_COLORS[i % PRODUCT_COLORS.length] + "cc"),
        borderColor:     sorted.map((_, i) => PRODUCT_COLORS[i % PRODUCT_COLORS.length]),
        borderWidth: 1.5,
        borderRadius: 6,
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` Rating: ${ctx.parsed.x.toFixed(2)} (${sorted[ctx.dataIndex]?.count || 0} ulasan)`
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          max: 5,
          ticks: { font: { size: 10 } },
          grid: { color: "rgba(0,0,0,0.05)" }
        },
        y: { ticks: { font: { size: 10 } }, grid: { display: false } }
      }
    }
  });
}

// ============================================================
// CHART: TOP REVIEW TOPICS
// ============================================================

function renderTopics() {
  destroyChart("topics");
  const ctx = document.getElementById("chartTopics").getContext("2d");

  const map = {};
  filtered.forEach(r => {
    map[r.review_topic] = (map[r.review_topic] || 0) + 1;
  });

  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (!sorted.length) { showNoData("chartTopics"); return; }

  // Warna berdasarkan sentimen dominan per topik
  const topicSentColor = sorted.map(([topic]) => {
    const rows = filtered.filter(r => r.review_topic === topic);
    const pos = rows.filter(r => r.sentiment === "Positive").length;
    const neg = rows.filter(r => r.sentiment === "Negative").length;
    const neu = rows.filter(r => r.sentiment === "Neutral").length;
    if (pos >= neg && pos >= neu) return SENTIMENT_COLORS.Positive.bg;
    if (neg >= pos && neg >= neu) return SENTIMENT_COLORS.Negative.bg;
    return SENTIMENT_COLORS.Neutral.bg;
  });

  charts.topics = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map(e => e[0]),
      datasets: [{
        label: "Jumlah Ulasan",
        data: sorted.map(e => e[1]),
        backgroundColor: topicSentColor,
        borderRadius: 6,
        borderWidth: 0,
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.x} ulasan`
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { font: { size: 10 } },
          grid: { color: "rgba(0,0,0,0.05)" }
        },
        y: { ticks: { font: { size: 10 } }, grid: { display: false } }
      }
    }
  });
}

// ============================================================
// CHART: REGION SENTIMENT (Stacked Bar)
// ============================================================

function renderRegionSentiment() {
  destroyChart("regionSentiment");
  const ctx = document.getElementById("chartRegionSentiment").getContext("2d");

  const regions = [...new Set(filtered.map(r => r.region))].sort();
  const sentiments = ["Positive", "Neutral", "Negative"];

  if (!regions.length) { showNoData("chartRegionSentiment"); return; }

  const datasets = sentiments.map(s => ({
    label: s,
    data: regions.map(reg =>
      filtered.filter(r => r.region === reg && r.sentiment === s).length
    ),
    backgroundColor: SENTIMENT_COLORS[s].bg,
    borderColor: SENTIMENT_COLORS[s].border,
    borderWidth: 1,
    borderRadius: 4,
  }));

  charts.regionSentiment = new Chart(ctx, {
    type: "bar",
    data: { labels: regions, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { font: { size: 10 }, boxWidth: 12, padding: 12 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} ulasan`
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: { font: { size: 10 } },
          grid: { display: false }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { font: { size: 10 }, stepSize: 5 },
          grid: { color: "rgba(0,0,0,0.05)" }
        }
      }
    }
  });
}

// ============================================================
// CHART: RATING DISTRIBUTION
// ============================================================

function renderRatingDist() {
  destroyChart("ratingDist");
  const ctx = document.getElementById("chartRatingDist").getContext("2d");

  const counts = [1,2,3,4,5].map(r =>
    filtered.filter(row => row.rating === r).length
  );

  if (!filtered.length) { showNoData("chartRatingDist"); return; }

  charts.ratingDist = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["★1","★2","★3","★4","★5"],
      datasets: [{
        label: "Jumlah Ulasan",
        data: counts,
        backgroundColor: [
          "#ef444499","#f97316aa","#f59e0baa","#84cc16aa","#22c55eaa"
        ],
        borderColor: ["#dc2626","#ea580c","#d97706","#65a30d","#16a34a"],
        borderWidth: 1.5,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} ulasan` } }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { font: { size: 10 }, stepSize: 10 },
          grid: { color: "rgba(0,0,0,0.05)" }
        },
        x: { ticks: { font: { size: 12 } }, grid: { display: false } }
      }
    }
  });
}

// ============================================================
// CHART: ORDER STATUS DONUT
// ============================================================

function renderOrderStatus() {
  destroyChart("orderStatus");
  const ctx = document.getElementById("chartOrderStatus").getContext("2d");

  const statusCounts = {
    Delivered:  filtered.filter(r => r.order_status === "Delivered").length,
    Processing: filtered.filter(r => r.order_status === "Processing").length,
    Cancelled:  filtered.filter(r => r.order_status === "Cancelled").length,
  };

  if (!filtered.length) { showNoData("chartOrderStatus"); return; }

  charts.orderStatus = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(statusCounts),
      datasets: [{
        data: Object.values(statusCounts),
        backgroundColor: [
          "rgba(14,165,233,0.8)",
          "rgba(245,158,11,0.8)",
          "rgba(239,68,68,0.8)"
        ],
        borderColor: ["#0284c7","#d97706","#dc2626"],
        borderWidth: 2,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { font: { size: 11 }, padding: 14, boxWidth: 14 }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const val = ctx.parsed;
              const total = filtered.length;
              return ` ${ctx.label}: ${val} (${((val/total)*100).toFixed(1)}%)`;
            }
          }
        }
      }
    }
  });
}

// ============================================================
// INSIGHTS
// ============================================================

/**
 * Hitung dan tampilkan insight bisnis berdasarkan data yang difilter.
 * Setiap insight ditelusuri langsung dari kalkulasi dataset.
 */
function renderInsights() {
  const container = document.getElementById("insightsContainer");
  container.innerHTML = "";

  if (!filtered.length) {
    container.innerHTML = `<p class="text-gray-400 text-sm col-span-3">Tidak ada data untuk menghasilkan insight.</p>`;
    return;
  }

  const insights = [];
  const n = filtered.length;

  // --- 1. Produk dengan rata-rata rating tertinggi ---
  const ratingByProd = {};
  filtered.forEach(r => {
    if (!ratingByProd[r.product_name]) ratingByProd[r.product_name] = [];
    ratingByProd[r.product_name].push(r.rating);
  });
  const sortedByRating = Object.entries(ratingByProd)
    .map(([name, ratings]) => ({ name, avg: avg(ratings), count: ratings.length }))
    .filter(e => e.count >= 5) // minimal 5 ulasan agar representatif
    .sort((a, b) => b.avg - a.avg);

  if (sortedByRating.length) {
    const top = sortedByRating[0];
    const bot = sortedByRating[sortedByRating.length - 1];
    insights.push({
      icon: "⭐",
      title: "Produk Rating Tertinggi",
      text: `<strong>${escHtml(top.name)}</strong> memiliki rata-rata rating <strong>${top.avg.toFixed(2)}</strong> dari ${top.count} ulasan (filter aktif).`
    });
    if (sortedByRating.length > 1) {
      insights.push({
        icon: "⚠️",
        title: "Produk Perlu Perhatian",
        text: `<strong>${escHtml(bot.name)}</strong> memiliki rata-rata rating terendah: <strong>${bot.avg.toFixed(2)}</strong> dari ${bot.count} ulasan. Pertimbangkan evaluasi produk.`
      });
    }
  }

  // --- 2. Topik keluhan paling sering ---
  const negReviews = filtered.filter(r => r.sentiment === "Negative");
  if (negReviews.length) {
    const topicMap = {};
    negReviews.forEach(r => {
      topicMap[r.review_topic] = (topicMap[r.review_topic] || 0) + 1;
    });
    const topNeg = Object.entries(topicMap).sort((a, b) => b[1] - a[1])[0];
    insights.push({
      icon: "🔴",
      title: "Keluhan Dominan",
      text: `Topik keluhan terbanyak (sentimen negatif): <strong>${escHtml(topNeg[0])}</strong> — muncul <strong>${topNeg[1]}</strong> kali. Layak menjadi prioritas perbaikan.`
    });
  }

  // --- 3. Rasio sentimen positif ---
  const posRatio = filtered.filter(r => r.sentiment === "Positive").length / n;
  const negRatio = filtered.filter(r => r.sentiment === "Negative").length / n;
  if (posRatio >= 0.5) {
    insights.push({
      icon: "✅",
      title: "Mayoritas Ulasan Positif",
      text: `<strong>${(posRatio * 100).toFixed(1)}%</strong> ulasan bersifat positif dari data yang difilter. Pengalaman pelanggan secara umum baik.`
    });
  } else if (negRatio > posRatio) {
    insights.push({
      icon: "❗",
      title: "Ulasan Negatif Lebih Banyak",
      text: `<strong>${(negRatio * 100).toFixed(1)}%</strong> ulasan bersifat negatif dalam filter ini. Perlu tindakan segera untuk meningkatkan kepuasan.`
    });
  }

  // --- 4. Wilayah dengan kepuasan tertinggi (avg rating) ---
  const ratingByRegion = {};
  filtered.forEach(r => {
    if (!ratingByRegion[r.region]) ratingByRegion[r.region] = [];
    ratingByRegion[r.region].push(r.rating);
  });
  const sortedRegion = Object.entries(ratingByRegion)
    .map(([reg, arr]) => ({ reg, avg: avg(arr), count: arr.length }))
    .filter(e => e.count >= 3)
    .sort((a, b) => b.avg - a.avg);

  if (sortedRegion.length) {
    const topReg = sortedRegion[0];
    insights.push({
      icon: "📍",
      title: "Wilayah Kepuasan Tertinggi",
      text: `Wilayah <strong>${escHtml(topReg.reg)}</strong> memiliki rata-rata rating tertinggi: <strong>${topReg.avg.toFixed(2)}</strong> dari ${topReg.count} ulasan.`
    });
  }

  // --- 5. Pesanan Cancelled ---
  const cancelledCount = filtered.filter(r => r.order_status === "Cancelled").length;
  if (cancelledCount > 0) {
    const cancelRate = (cancelledCount / n * 100).toFixed(1);
    insights.push({
      icon: "🚫",
      title: "Persentase Pesanan Dibatalkan",
      text: `<strong>${cancelledCount}</strong> pesanan berstatus Cancelled (<strong>${cancelRate}%</strong>). Transaksi ini tidak dihitung dalam total nilai penjualan.`
    });
  }

  // --- 6. Topik positif teratas ---
  const posReviews = filtered.filter(r => r.sentiment === "Positive");
  if (posReviews.length) {
    const topicMapPos = {};
    posReviews.forEach(r => {
      topicMapPos[r.review_topic] = (topicMapPos[r.review_topic] || 0) + 1;
    });
    const topPos = Object.entries(topicMapPos).sort((a, b) => b[1] - a[1])[0];
    insights.push({
      icon: "💚",
      title: "Aspek Paling Dipuji",
      text: `Topik yang paling sering mendapat ulasan positif: <strong>${escHtml(topPos[0])}</strong> (<strong>${topPos[1]}</strong> ulasan). Pertahankan keunggulan ini.`
    });
  }

  // Render insight cards
  insights.forEach(({ icon, title, text }) => {
    const card = document.createElement("div");
    card.className = "insight-card";
    card.innerHTML = `
      <span class="insight-icon">${icon}</span>
      <strong>${escHtml(title)}</strong>
      <p>${text}</p>
    `;
    container.appendChild(card);
  });
}

// ============================================================
// REVIEW TABLE
// ============================================================

/**
 * Render tabel ulasan pelanggan dengan pagination.
 * Pengurutan berdasarkan pilihan di dropdown sortReviews.
 */
function renderReviewTable() {
  const sortVal = document.getElementById("sortReviews").value;

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    switch (sortVal) {
      case "date_desc":   return b.purchase_date.localeCompare(a.purchase_date);
      case "date_asc":    return a.purchase_date.localeCompare(b.purchase_date);
      case "rating_desc": return b.rating - a.rating;
      case "rating_asc":  return a.rating - b.rating;
      default:            return 0;
    }
  });

  const total      = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = sorted.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById("reviewTableBody");
  tbody.innerHTML = "";

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-gray-400 py-8 text-sm">
      Tidak ada ulasan yang sesuai filter.
    </td></tr>`;
  } else {
    page.forEach(row => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">
          <div>${escHtml(row.product_name)}</div>
          <div class="text-[10px] text-gray-400">${escHtml(row.product_id)}</div>
        </td>
        <td class="px-3 py-2.5 text-gray-500 whitespace-nowrap">${escHtml(row.category)}</td>
        <td class="px-3 py-2.5 text-gray-500 whitespace-nowrap">${escHtml(row.region)}</td>
        <td class="px-3 py-2.5 whitespace-nowrap">
          ${starsHtml(row.rating)}
          <span class="ml-1 text-gray-500">${row.rating}</span>
        </td>
        <td class="px-3 py-2.5 whitespace-nowrap">
          <span class="${sentimentBadgeClass(row.sentiment)}">${escHtml(row.sentiment)}</span>
        </td>
        <td class="px-3 py-2.5 text-gray-600 whitespace-nowrap">${escHtml(row.review_topic)}</td>
        <td class="px-3 py-2.5 text-gray-700 max-w-xs">
          <span title="${escHtml(row.review_text)}">${escHtml(row.review_text)}</span>
        </td>
        <td class="px-3 py-2.5 text-gray-400 whitespace-nowrap text-[11px]">${formatDate(row.purchase_date)}</td>
        <td class="px-3 py-2.5 whitespace-nowrap">
          <span class="${statusBadgeClass(row.order_status)}">${escHtml(row.order_status)}</span>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Pagination info
  document.getElementById("paginationInfo").textContent =
    total > 0
      ? `Menampilkan ${start + 1}–${Math.min(start + PAGE_SIZE, total)} dari ${total.toLocaleString("id-ID")} ulasan`
      : "Tidak ada ulasan";

  document.getElementById("pageIndicator").textContent =
    `Hal. ${currentPage} / ${totalPages}`;

  document.getElementById("btnPrevPage").disabled = currentPage <= 1;
  document.getElementById("btnNextPage").disabled = currentPage >= totalPages;
}

// ============================================================
// HELPER: No Data Placeholder
// ============================================================

/**
 * Tampilkan teks "Tidak ada data" di atas canvas jika filtered[] kosong
 * @param {string} canvasId
 */
function showNoData(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  // Gunakan dimensi parent jika canvas belum dirender
  const w = canvas.offsetWidth  || canvas.width  || 300;
  const h = canvas.offsetHeight || canvas.height || 180;
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.font = "13px Segoe UI, sans-serif";
  ctx.fillStyle = "#9ca3af";
  ctx.textAlign = "center";
  ctx.fillText("Tidak ada data sesuai filter", w / 2, h / 2);
}

// ============================================================
// ENTRY POINT
// ============================================================
loadData();

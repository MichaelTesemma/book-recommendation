/* ===================================================================
   BookTaste — Frontend Logic
   =================================================================== */

// --- State ---
let allBooks = [];                // Full book list from API
let ratings = {};                 // { book_id: rating (1-5) }
let tasteChart = null;            // Chart.js radar instance
let recChart = null;              // Chart.js bar instance

const DIMENSIONS = [
  "pacing",
  "character_depth",
  "plot_complexity",
  "prose_quality",
  "philosophical_depth",
  "emotional_intensity",
  "humor",
  "action",
];

const DIM_LABELS = {
  pacing: "Pacing",
  character_depth: "Character Depth",
  plot_complexity: "Plot Complexity",
  prose_quality: "Prose Quality",
  philosophical_depth: "Philosophical Depth",
  emotional_intensity: "Emotional Intensity",
  humor: "Humor",
  action: "Action",
};

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  loadRatings();
  fetchBooks();
  setupNavigation();
  setupModal();
  setupAddBookModal();
  setupRecommendations();
});

// --- Local Storage ---
function loadRatings() {
  try {
    const saved = localStorage.getItem("booktaste_ratings");
    if (saved) ratings = JSON.parse(saved);
  } catch (_) {
    ratings = {};
  }
}

function saveRatings() {
  localStorage.setItem("booktaste_ratings", JSON.stringify(ratings));
}

// --- API ---
async function fetchBooks() {
  try {
    const res = await fetch("/books");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allBooks = await res.json();
    renderLibrary();
    renderTaste();
  } catch (err) {
    console.error("Failed to fetch books:", err);
    document.getElementById("library-grid").innerHTML =
      '<p style="color:#6e6e73;grid-column:1/-1;text-align:center;">Failed to load books. Make sure the server is running.</p>';
  }
}

async function fetchRecommendations() {
  const likedBooks = Object.entries(ratings).map(([book_id, rating]) => ({
    book_id: parseInt(book_id),
    rating,
  }));

  if (likedBooks.length === 0) return [];

  const res = await fetch("/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ liked_books: likedBooks }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.recommendations || [];
}

// --- Navigation ---
function setupNavigation() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${tab}`).classList.add("active");

      if (tab === "taste") renderTaste();
      if (tab === "recommendations") updateRecState();
    });
  });
}

// --- Library ---
function renderLibrary() {
  const grid = document.getElementById("library-grid");
  grid.innerHTML = "";

  allBooks.forEach((book) => {
    const card = document.createElement("div");
    card.className = "book-card" + (ratings[book.id] ? " rated" : "");
    card.innerHTML = `
      <span class="book-card-badge">Rated ${ratings[book.id] || 0}/5</span>
      <div class="book-card-header">
        <h3>${escapeHtml(book.title)}</h3>
      </div>
      <div class="book-card-rating">
        ${[1, 2, 3, 4, 5]
          .map(
            (i) =>
              `<span class="mini-star${ratings[book.id] && i <= ratings[book.id] ? " filled" : ""}">★</span>`
          )
          .join("")}
      </div>
      <p class="book-card-desc">${escapeHtml(book.description)}</p>
    `;
    card.addEventListener("click", () => openModal(book));
    grid.appendChild(card);
  });
}

// --- Modal ---
function setupModal() {
  const modal = document.getElementById("modal");
  const close = document.getElementById("modal-close");
  const backdrop = document.getElementById("modal-backdrop");

  close.addEventListener("click", closeModal);
  backdrop.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  document.querySelectorAll("#modal-stars .star").forEach((star) => {
    star.addEventListener("click", () => {
      const value = parseInt(star.dataset.value);
      rateBook(value);
    });
  });
}

let currentModalBook = null;

function openModal(book) {
  currentModalBook = book;
  const modal = document.getElementById("modal");
  document.getElementById("modal-title").textContent = book.title;
  document.getElementById("modal-desc").textContent = book.description;

  // Update stars
  const currentRating = ratings[book.id] || 0;
  document.querySelectorAll("#modal-stars .star").forEach((star) => {
    const val = parseInt(star.dataset.value);
    star.classList.toggle("filled", val <= currentRating);
  });

  modal.classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
  currentModalBook = null;
}

function rateBook(value) {
  if (!currentModalBook) return;

  if (ratings[currentModalBook.id] === value) {
    // Clicking the same rating removes it
    delete ratings[currentModalBook.id];
  } else {
    ratings[currentModalBook.id] = value;
  }

  saveRatings();

  // Update modal stars
  const currentRating = ratings[currentModalBook.id] || 0;
  document.querySelectorAll("#modal-stars .star").forEach((star) => {
    const val = parseInt(star.dataset.value);
    star.classList.toggle("filled", val <= currentRating);
  });

  // Re-render library
  renderLibrary();
}

// --- Add Book Modal ---
function setupAddBookModal() {
  const modal = document.getElementById("add-modal");
  const close = document.getElementById("add-modal-close");
  const backdrop = document.getElementById("add-modal-backdrop");
  const form = document.getElementById("add-book-form");
  const status = document.getElementById("add-book-status");

  // Open
  document.getElementById("btn-add-book").addEventListener("click", () => {
    form.reset();
    status.classList.add("hidden");
    status.textContent = "";
    modal.classList.remove("hidden");
  });

  // Close handlers
  close.addEventListener("click", hideAddModal);
  backdrop.addEventListener("click", hideAddModal);
  document.getElementById("add-book-cancel").addEventListener("click", hideAddModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      hideAddModal();
    }
  });

  // Submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("add-book-title").value.trim();
    const desc = document.getElementById("add-book-desc").value.trim();

    if (!title || !desc) return;

    const submitBtn = document.getElementById("add-book-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Adding...";

    try {
      await addBook(title, desc);
      status.textContent = "✓ Book added successfully!";
      status.className = "success";
      status.classList.remove("hidden");
      form.reset();

      // Close after short delay
      setTimeout(hideAddModal, 1200);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = "error";
      status.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Add Book";
    }
  });
}

async function addBook(title, description) {
  const res = await fetch("/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to add book");
  }

  const data = await res.json();

  // Add to local book list
  allBooks.push({ id: data.id, title, description });
  renderLibrary();
}

function hideAddModal() {
  document.getElementById("add-modal").classList.add("hidden");
  document.getElementById("add-book-status").classList.add("hidden");
}

// --- Taste Tab ---
function renderTaste() {
  const ratedEntries = Object.entries(ratings);
  const emptyEl = document.getElementById("taste-empty");
  const listEl = document.getElementById("rated-list");

  if (ratedEntries.length === 0) {
    emptyEl.classList.remove("hidden");
    listEl.innerHTML = "";
    if (tasteChart) {
      tasteChart.destroy();
      tasteChart = null;
    }
    return;
  }

  emptyEl.classList.add("hidden");

  // Build taste vector
  const ratedBookIds = ratedEntries.map(([id]) => parseInt(id));
  const ratedBooks = allBooks.filter((b) => ratedBookIds.includes(b.id));

  // Compute weighted average for display
  let totalWeight = 0;
  const tasteVector = new Array(DIMENSIONS.length).fill(0);

  // We need to fetch features — approximate from the rated books' features
  // Since we don't expose features via API, we'll compute taste on the fly
  // For now, show the rated books list and compute taste from the recommend endpoint
  listEl.innerHTML = ratedEntries
    .map(([bookId, rating]) => {
      const book = allBooks.find((b) => b.id === parseInt(bookId));
      if (!book) return "";
      return `
        <div class="rated-item">
          <span class="rated-item-title">${escapeHtml(book.title)}</span>
          <span class="rated-item-stars">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</span>
          <button class="rated-item-remove" data-id="${bookId}" title="Remove">×</button>
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll(".rated-item-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      delete ratings[btn.dataset.id];
      saveRatings();
      renderLibrary();
      renderTaste();
    });
  });

  // Fetch taste vector from the backend via a lightweight recommend call
  fetchTasteVector();
}

async function fetchTasteVector() {
  const likedBooks = Object.entries(ratings).map(([book_id, rating]) => ({
    book_id: parseInt(book_id),
    rating,
  }));

  if (likedBooks.length === 0) return;

  try {
    // We need the actual taste vector — let's get it via a side-channel
    // Since the API doesn't expose taste directly, we compute it locally
    // by fetching book features. For simplicity, we'll show a "coming soon"
    // or derive it from recommendations.
    //
    // Better approach: fetch book features from the db via a new endpoint.
    // For now, render a bar chart of the taste computed from a recommend call.
    const res = await fetch("/taste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ liked_books: likedBooks }),
    });

    if (res.ok) {
      const data = await res.json();
      renderTasteRadar(data.taste_vector);
    } else {
      // Fallback: don't render radar
      renderTasteRadar(null);
    }
  } catch (_) {
    renderTasteRadar(null);
  }
}

function renderTasteRadar(vector) {
  const ctx = document.getElementById("taste-radar");
  if (!ctx) return;

  if (tasteChart) {
    tasteChart.destroy();
    tasteChart = null;
  }

  if (!vector) {
    // Hide the chart container
    return;
  }

  tasteChart = new Chart(ctx, {
    type: "radar",
    data: {
      labels: DIMENSIONS.map((d) => DIM_LABELS[d]),
      datasets: [
        {
          label: "Your Taste",
          data: vector.map((v) => Math.round(v * 100) / 100),
          backgroundColor: "rgba(79, 70, 229, 0.15)",
          borderColor: "rgba(79, 70, 229, 0.8)",
          borderWidth: 2,
          pointBackgroundColor: "rgba(79, 70, 229, 1)",
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        r: {
          min: 0,
          max: 1,
          ticks: {
            stepSize: 0.2,
            backdropColor: "transparent",
            font: { size: 10 },
          },
          grid: { color: "rgba(0, 0, 0, 0.06)" },
          pointLabels: {
            font: { size: 11, weight: "500" },
            color: "#1d1d1f",
          },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

// --- Recommendations ---
function setupRecommendations() {
  document.getElementById("btn-recommend").addEventListener("click", async () => {
    const btn = document.getElementById("btn-recommend");
    const loading = document.getElementById("rec-loading");
    const empty = document.getElementById("rec-empty");
    const results = document.getElementById("rec-results");

    const likedCount = Object.keys(ratings).length;
    if (likedCount === 0) {
      alert("Rate at least one book in the Library first.");
      return;
    }

    btn.disabled = true;
    loading.classList.remove("hidden");
    empty.classList.add("hidden");
    results.innerHTML = "";

    try {
      const recs = await fetchRecommendations();
      renderRecommendations(recs);
    } catch (err) {
      console.error("Failed to get recommendations:", err);
      results.innerHTML =
        '<p style="color:#ef4444;text-align:center;">Something went wrong. Try again.</p>';
    } finally {
      btn.disabled = false;
      loading.classList.add("hidden");
    }
  });
}

function updateRecState() {
  const empty = document.getElementById("rec-empty");
  const results = document.getElementById("rec-results");
  const chartSection = document.getElementById("rec-chart-section");

  if (Object.keys(ratings).length === 0) {
    empty.classList.remove("hidden");
    results.innerHTML = "";
    chartSection.classList.add("hidden");
  } else {
    empty.classList.add("hidden");
  }
}

function renderRecommendations(recs) {
  const results = document.getElementById("rec-results");
  const empty = document.getElementById("rec-empty");
  const chartSection = document.getElementById("rec-chart-section");

  if (!recs || recs.length === 0) {
    empty.classList.remove("hidden");
    results.innerHTML = "";
    chartSection.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  const maxScore = Math.max(...recs.map((r) => r.score));

  results.innerHTML = recs
    .map(
      (rec, i) => `
      <div class="rec-card">
        <div class="rec-rank">${i + 1}</div>
        <div class="rec-info">
          <div class="rec-title">${escapeHtml(rec.title)}</div>
          <div class="rec-bar-wrap">
            <div class="rec-bar" style="width: ${(rec.score / maxScore) * 100}%"></div>
          </div>
        </div>
        <div class="rec-score">${Math.round(rec.score * 100)}%</div>
      </div>
    `
    )
    .join("");

  // Render bar chart
  renderRecChart(recs);
}

function renderRecChart(recs) {
  const ctx = document.getElementById("rec-chart");
  if (!ctx) return;

  const chartSection = document.getElementById("rec-chart-section");
  chartSection.classList.remove("hidden");

  if (recChart) {
    recChart.destroy();
    recChart = null;
  }

  const titles = recs.map((r) => {
    const parts = r.title.split(" ");
    return parts.length > 3 ? parts.slice(0, 3).join(" ") + "…" : r.title;
  });

  recChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: titles,
      datasets: [
        {
          label: "Similarity",
          data: recs.map((r) => Math.round(r.score * 100)),
          backgroundColor: "rgba(79, 70, 229, 0.7)",
          borderColor: "rgba(79, 70, 229, 1)",
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      indexAxis: "y",
      scales: {
        x: {
          min: 0,
          max: 100,
          ticks: {
            callback: (v) => v + "%",
            font: { size: 11 },
          },
          grid: { color: "rgba(0, 0, 0, 0.04)" },
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 11, weight: "500" } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Similarity: ${ctx.raw}%`,
          },
        },
      },
    },
  });
}

// --- Utility ---
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

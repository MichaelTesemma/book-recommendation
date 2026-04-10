/* ===================================================================
   BookTaste — Frontend Logic
   =================================================================== */

// --- State ---
let allBooks = [];                // Full book list from API
let likedBooks = new Set();       // Set of book_ids the user likes
let tasteChart = null;            // Chart.js radar instance
let recChart = null;              // Chart.js bar instance
let searchTimeout = null;         // Debounce timer for search

const DIMENSIONS = [
  "pacing",
  "character_depth",
  "plot_complexity",
  "prose_quality",
  "philosophical_depth",
  "emotional_intensity",
  "humor",
  "action",
  "worldbuilding",
  "ending_satisfaction",
  "darkness_violence",
  "romance_presence",
  "mystery_puzzle",
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
  worldbuilding: "Worldbuilding",
  ending_satisfaction: "Ending Satisfaction",
  darkness_violence: "Darkness / Violence",
  romance_presence: "Romance Presence",
  mystery_puzzle: "Mystery / Puzzle",
};

const GENRE_META = {
  "Literary Fiction & Classics": { icon: "📖", color: "#6366f1" },
  "Fantasy & Science Fiction": { icon: "🧙", color: "#8b5cf6" },
  "Romance": { icon: "💕", color: "#ec4899" },
  "Crime, Thriller & Mystery": { icon: "🔍", color: "#f59e0b" },
  "Young Adult": { icon: "🌟", color: "#10b981" },
  "Horror": { icon: "👻", color: "#dc2626" },
  "Non-Fiction": { icon: "📚", color: "#0ea5e9" },
  "Historical Fiction": { icon: "🏛️", color: "#a855f7" },
};

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  loadRatings();
  fetchBooks();
  setupNavigation();
  setupAddBookModal();
  setupRecommendations();
  setupSearch();
});

// --- Local Storage ---
function loadRatings() {
  try {
    const saved = localStorage.getItem("booktaste_liked");
    if (saved) likedBooks = new Set(JSON.parse(saved));
  } catch (_) {
    likedBooks = new Set();
  }
}

function saveRatings() {
  localStorage.setItem("booktaste_liked", JSON.stringify([...likedBooks]));
}

// --- API ---
async function fetchBooks() {
  try {
    const res = await fetch("/books");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allBooks = await res.json();
    renderLibrary(allBooks);
    renderTaste();
  } catch (err) {
    console.error("Failed to fetch books:", err);
    document.getElementById("library-grid").innerHTML =
      '<p style="color:#6e6e73;grid-column:1/-1;text-align:center;">Failed to load books. Make sure the server is running.</p>';
  }
}

async function fetchRecommendations() {
  if (likedBooks.size === 0) return [];

  const likedArr = [...likedBooks].map((id) => ({ book_id: id, rating: 5 }));

  const res = await fetch("/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ liked_books: likedArr }),
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

      if (tab === "library") {
        // Clear search when returning to library
        const searchInput = document.getElementById("book-search");
        if (searchInput && searchInput.value.trim()) {
          searchInput.value = "";
          clearSearch();
        }
      }
      if (tab === "taste") renderTaste();
      if (tab === "recommendations") updateRecState();
    });
  });
}

// --- Library ---
function renderLibrary(books) {
  const grid = document.getElementById("library-grid");
  grid.innerHTML = "";

  const displayBooks = books || allBooks;

  if (displayBooks.length === 0) {
    grid.innerHTML = '<p class="no-results">No books found.</p>';
    return;
  }

  // If books is provided (search results), render flat
  if (books) {
    grid.className = "book-grid";
    books.forEach((book) => {
      const isLiked = likedBooks.has(book.id);
      const card = createBookCard(book, isLiked);
      grid.appendChild(card);
    });
    return;
  }

  // Group by genre
  const byGenre = {};
  allBooks.forEach((book) => {
    const g = book.genre || "Other";
    if (!byGenre[g]) byGenre[g] = [];
    byGenre[g].push(book);
  });

  // Sort genres: by count descending, then alphabetically
  const sortedGenres = Object.keys(byGenre).sort((a, b) => {
    if (byGenre[b].length !== byGenre[a].length) return byGenre[b].length - byGenre[a].length;
    return a.localeCompare(b);
  });

  grid.className = "book-grid book-grid-grouped";

  sortedGenres.forEach((genre) => {
    const meta = GENRE_META[genre] || { icon: "📕", color: "#6e6e73" };
    const genreSection = document.createElement("div");
    genreSection.className = "genre-section";

    const genreHeader = document.createElement("div");
    genreHeader.className = "genre-header";
    const count = byGenre[genre].length;
    genreHeader.innerHTML = `
      <span class="genre-icon">${meta.icon}</span>
      <h3>${escapeHtml(genre)}</h3>
      <span class="genre-count">${count} book${count !== 1 ? "s" : ""}</span>
      <span class="genre-chevron">▾</span>
    `;
    genreHeader.style.borderLeftColor = meta.color;

    const genreGrid = document.createElement("div");
    genreGrid.className = "genre-books-grid";

    byGenre[genre].forEach((book) => {
      const isLiked = likedBooks.has(book.id);
      genreGrid.appendChild(createBookCard(book, isLiked));
    });

    genreSection.appendChild(genreHeader);
    genreSection.appendChild(genreGrid);
    grid.appendChild(genreSection);

    // Toggle collapse
    genreHeader.addEventListener("click", () => {
      const collapsed = genreSection.classList.toggle("collapsed");
      genreHeader.querySelector(".genre-chevron").textContent = collapsed ? "▸" : "▾";
    });
  });
}

function createBookCard(book, isLiked) {
  const card = document.createElement("div");
  card.className = "book-card" + (isLiked ? " rated" : "");
  const meta = GENRE_META[book.genre] || { color: "#6e6e73" };
  card.innerHTML = `
    <div class="book-card-genre" style="background:${meta.color}20;color:${meta.color}">${escapeHtml(book.genre || "")}</div>
    <div class="book-card-header">
      <h3>${escapeHtml(book.title)}</h3>
      <span class="book-card-like">${isLiked ? "✓" : ""}</span>
    </div>
    <p class="book-card-desc">${escapeHtml(book.description || "")}</p>
  `;
  card.addEventListener("click", () => toggleLike(book.id));
  return card;
}

function toggleLike(bookId) {
  if (likedBooks.has(bookId)) {
    likedBooks.delete(bookId);
  } else {
    likedBooks.add(bookId);
  }
  saveRatings();
  renderLibrary(getCurrentDisplayBooks());
}

// --- Search ---
function getCurrentDisplayBooks() {
  const query = document.getElementById("book-search").value.trim();
  return query ? [] : allBooks;  // if searching, we already rendered results
}

function setupSearch() {
  const input = document.getElementById("book-search");
  if (!input) return;

  input.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const query = input.value.trim();
      if (query.length === 0) {
        clearSearch();
        return;
      }
      searchBooks(query);
    }, 300);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      clearSearch();
    }
  });
}

async function searchBooks(query) {
  const statusEl = document.getElementById("search-status");
  statusEl.classList.remove("hidden");
  statusEl.textContent = `Searching for "${query}"...`;

  try {
    const res = await fetch(`/search?q=${encodeURIComponent(query)}&limit=50`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const results = await res.json();

    statusEl.textContent = `${results.length} result${results.length !== 1 ? "s" : ""} found`;
    renderLibrary(results);
  } catch (err) {
    console.error("Search failed:", err);
    statusEl.textContent = "Search failed. Try again.";
  }
}

function clearSearch() {
  const statusEl = document.getElementById("search-status");
  statusEl.classList.add("hidden");
  statusEl.textContent = "";
  renderLibrary(allBooks);
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
  renderLibrary(allBooks);
}

function hideAddModal() {
  document.getElementById("add-modal").classList.add("hidden");
  document.getElementById("add-book-status").classList.add("hidden");
}

// --- Taste Tab ---
function renderTaste() {
  const emptyEl = document.getElementById("taste-empty");
  const listEl = document.getElementById("rated-list");

  // Guard: books not loaded yet
  if (allBooks.length === 0) {
    return;
  }

  if (likedBooks.size === 0) {
    emptyEl.classList.remove("hidden");
    listEl.innerHTML = "";
    if (tasteChart) {
      tasteChart.destroy();
      tasteChart = null;
    }
    return;
  }

  emptyEl.classList.add("hidden");

  const likedArr = [...likedBooks];
  const likedBooksData = allBooks.filter((b) => likedBooks.has(b.id));

  listEl.innerHTML = likedBooksData
    .map((book) => {
      return `
        <div class="rated-item">
          <span class="rated-item-title">${escapeHtml(book.title)}</span>
          <button class="rated-item-remove" data-id="${book.id}" title="Remove">×</button>
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll(".rated-item-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      likedBooks.delete(parseInt(btn.dataset.id));
      saveRatings();
      renderLibrary(allBooks);
      renderTaste();
    });
  });

  fetchTasteVector();
}

async function fetchTasteVector() {
  if (likedBooks.size === 0) return;

  const likedArr = [...likedBooks].map((id) => ({ book_id: id, rating: 5 }));

  try {
    const res = await fetch("/taste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ liked_books: likedArr }),
    });

    if (res.ok) {
      const data = await res.json();
      renderTasteRadar(data.taste_vector);
    } else {
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

    if (likedBooks.size === 0) {
      alert("Like at least one book in the Library first.");
      return;
    }

    btn.disabled = true;
    loading.classList.remove("hidden");
    empty.classList.add("hidden");
    results.innerHTML = "";

    try {
      // Fetch taste vector first for comparison
      const tasteVector = await fetchTasteVectorForRecs();
      const recs = await fetchRecommendations();
      renderRecommendations(recs, tasteVector);
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

  if (likedBooks.size === 0) {
    empty.classList.remove("hidden");
    results.innerHTML = "";
    chartSection.classList.add("hidden");
  } else {
    empty.classList.add("hidden");
  }
}

async function fetchTasteVectorForRecs() {
  if (likedBooks.size === 0) return null;
  const likedArr = [...likedBooks].map((id) => ({ book_id: id, rating: 5 }));
  try {
    const res = await fetch("/taste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ liked_books: likedArr }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.taste_vector;
    }
  } catch (_) {}
  return null;
}

function computeFeatureExplanation(bookFeatures, tasteVector) {
  if (!bookFeatures || !tasteVector) return [];
  const explanations = [];
  for (let i = 0; i < DIMENSIONS.length; i++) {
    const dim = DIMENSIONS[i];
    const userVal = tasteVector[i];
    const bookVal = bookFeatures[dim];
    if (userVal == null || bookVal == null) continue;
    // Only highlight dimensions where both user and book are notably aligned (>= 0.55)
    // or notably low together (<= 0.35)
    const match = userVal >= 0.55 && bookVal >= 0.55
               || userVal <= 0.35 && bookVal <= 0.35;
    if (match) {
      const label = DIM_LABELS[dim] || dim;
      const direction = userVal >= 0.55 ? "high" : "low";
      explanations.push({ dim: label, direction, userVal, bookVal, strength: Math.abs(userVal - bookVal) });
    }
  }
  // Sort by closest match (smallest difference = strongest alignment)
  explanations.sort((a, b) => a.strength - b.strength);
  return explanations.slice(0, 4); // top 4 matches
}

function renderRecommendations(recs, tasteVector) {
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
    .map((rec, i) => {
      const explanations = computeFeatureExplanation(rec.features, tasteVector);
      const explanationHTML = explanations.length > 0
        ? `<div class="rec-explanation">
             <span class="rec-explanation-label">Matches your taste in:</span>
             ${explanations.map(e =>
               `<span class="rec-tag ${e.direction}">${e.dim}</span>`
             ).join("")}
           </div>`
        : "";

      const book = allBooks.find(b => b.id === rec.book_id);
      const genreBadge = book && book.genre
        ? `<span class="rec-genre-badge" style="background:${GENRE_META[book.genre]?.color || '#6e6e73'}20;color:${GENRE_META[book.genre]?.color || '#6e6e73'}">${escapeHtml(book.genre)}</span>`
        : "";

      return `
      <div class="rec-card">
        <div class="rec-rank">${i + 1}</div>
        <div class="rec-info">
          <div class="rec-title">${escapeHtml(rec.title)}</div>
          ${genreBadge}
          <div class="rec-bar-wrap">
            <div class="rec-bar" style="width: ${(rec.score / maxScore) * 100}%"></div>
          </div>
          ${explanationHTML}
        </div>
        <div class="rec-score">${Math.round(rec.score * 100)}%</div>
      </div>
    `;
    })
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

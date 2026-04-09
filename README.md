# BookTaste — Book Recommendation Engine

A minimal content-based book recommendation engine with a visual dashboard. Books are represented as 8-dimensional feature vectors. You rate books you've read, and the system recommends similar books you might enjoy.

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Initialize: load seed data and build the model
python app.py init

# 3. Start the server
python app.py serve
```

Open **http://localhost:8000** in your browser to use the dashboard.

## Dashboard

The web interface has three tabs:

| Tab | What it does |
|-----|-------------|
| **Library** | Browse all 15 books. Click any book to rate it 1–5 stars. |
| **Your Taste** | See your reading preferences as a radar chart across 8 literary dimensions. |
| **Recommendations** | Click "Generate Recommendations" to get personalized picks with similarity scores and a bar chart. |

Your ratings are saved locally in the browser (localStorage) so they persist across sessions.

## API Endpoints

### GET /
Serves the dashboard frontend.

### GET /health
Check if the server is running.

### GET /books
List all available books.

### POST /taste
Get the computed user taste vector (for the radar chart).

```bash
curl -X POST http://localhost:8000/taste \
  -H "Content-Type: application/json" \
  -d '{"liked_books":[{"book_id":1,"rating":5},{"book_id":5,"rating":4}]}'
```

### POST /recommend
Get book recommendations based on your ratings.

```bash
curl -X POST http://localhost:8000/recommend \
  -H "Content-Type: application/json" \
  -d '{"liked_books":[{"book_id":1,"rating":5},{"book_id":5,"rating":4}]}'
```

## How It Works

1. **Feature Vectors**: Each book is represented as an 8-dimensional vector (pacing, character depth, plot complexity, prose quality, philosophical depth, emotional intensity, humor, action).

2. **User Taste**: When you rate books, the system computes a weighted average of their feature vectors — your personal "taste profile."

3. **k-NN Matching**: Using cosine similarity, the engine finds books closest to your taste profile, excluding ones you've already rated.

4. **Seed Data**: The engine ships with 15 well-known books and pre-computed feature vectors. That can be used to test the system.

## Architecture

```
app.py            — Backend: FastAPI server, SQLite, k-NN model
static/
  index.html      — Dashboard layout
  styles.css      — Modern, responsive styling
  app.js          — Frontend logic + Chart.js visualizations
data/
  seeds.json      — 15 books with pre-computed 8D features
  books.db        — SQLite database (created on init)
```

## Extending

To add more books, edit `data/seeds.json` and re-run `python app.py init`. The seed loading is idempotent — it skips books already in the database.

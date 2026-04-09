"""
Book Recommendation Engine — Minimal Single-File Implementation.

Usage:
    python app.py init      # Load seed data and build k-NN model
    python app.py serve     # Start FastAPI server on port 8000
"""

import argparse
import json
import logging
import os
import sqlite3
import subprocess
import sys

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sklearn.neighbors import NearestNeighbors

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "books.db")
SEEDS_PATH = os.path.join(BASE_DIR, "data", "seeds.json")

FEATURE_DIMS = [
    "pacing",
    "character_depth",
    "plot_complexity",
    "prose_quality",
    "philosophical_depth",
    "emotional_intensity",
    "humor",
    "action",
]


def _validate_features(raw: dict) -> dict[str, float]:
    """Validate that all 8 dimensions exist and values are clamped to [0,1]."""
    missing = [d for d in FEATURE_DIMS if d not in raw]
    if missing:
        raise ValueError(f"Missing dimensions: {', '.join(missing)}")
    validated = {}
    for dim in FEATURE_DIMS:
        val = raw[dim]
        if not isinstance(val, (int, float)):
            raise ValueError(f"{dim} must be a number, got {type(val).__name__}")
        if val != val:  # NaN check
            raise ValueError(f"{dim} is NaN")
        validated[dim] = max(0.0, min(1.0, float(val)))
    return validated

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    """Return a connection to the SQLite database."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def create_tables(conn: sqlite3.Connection) -> None:
    """Create the raw books and feature tables if they don't exist."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS books_raw (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS book_features (
            book_id INTEGER PRIMARY KEY,
            pacing REAL,
            character_depth REAL,
            plot_complexity REAL,
            prose_quality REAL,
            philosophical_depth REAL,
            emotional_intensity REAL,
            humor REAL,
            action REAL,
            FOREIGN KEY (book_id) REFERENCES books_raw(id)
        )
    """)
    conn.commit()


def load_seeds(conn: sqlite3.Connection) -> None:
    """Load seed data from data/seeds.json (idempotent)."""
    with open(SEEDS_PATH, "r") as f:
        seeds = json.load(f)

    for book in seeds:
        # Skip if already loaded
        existing = conn.execute(
            "SELECT id FROM books_raw WHERE id = ?", (book["id"],)
        ).fetchone()
        if existing:
            continue

        conn.execute(
            "INSERT INTO books_raw (id, title, description) VALUES (?, ?, ?)",
            (book["id"], book["title"], book["description"]),
        )

        feats = book["features"]
        conn.execute(
            """INSERT INTO book_features (book_id, pacing, character_depth,
               plot_complexity, prose_quality, philosophical_depth,
               emotional_intensity, humor, action)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                book["id"],
                feats["pacing"],
                feats["character_depth"],
                feats["plot_complexity"],
                feats["prose_quality"],
                feats["philosophical_depth"],
                feats["emotional_intensity"],
                feats["humor"],
                feats["action"],
            ),
        )

    conn.commit()
    print(f"Seed data loaded. {len(seeds)} books available.")


# ---------------------------------------------------------------------------
# k-NN model
# ---------------------------------------------------------------------------

class RecommendationModel:
    """Wraps a scikit-learn NearestNeighbors model with cosine metric."""

    def __init__(self) -> None:
        self.model = NearestNeighbors(n_neighbors=10, metric="cosine")
        self.book_ids: list[int] = []
        self.book_titles: list[str] = []
        self.is_fitted = False

    def fit(self, conn: sqlite3.Connection) -> None:
        """Load all feature vectors from the database and fit the model."""
        rows = conn.execute(
            "SELECT bf.*, br.title FROM book_features bf "
            "JOIN books_raw br ON br.id = bf.book_id"
        ).fetchall()

        if not rows:
            raise RuntimeError(
                "No feature data found. Run 'python app.py init' first."
            )

        vectors = []
        for row in rows:
            vec = [row[dim] for dim in FEATURE_DIMS]
            vectors.append(vec)
            self.book_ids.append(row["book_id"])
            self.book_titles.append(row["title"])

        X = np.array(vectors)
        self.model.fit(X)
        self.is_fitted = True
        print(f"Model fitted with {len(self.book_ids)} books.")

    def recommend(
        self,
        user_vector: np.ndarray,
        exclude_ids: set[int],
        top_n: int = 5,
    ) -> list[dict]:
        """Return top_n recommendations excluding already-liked books."""
        if not self.is_fitted:
            raise RuntimeError("Model not fitted yet.")

        # Query a bounded batch — re-query if too many are excluded
        results = []
        remaining_excludes = set(exclude_ids)
        offset = 0
        batch_size = min(top_n * 10, len(self.book_ids))

        while len(results) < top_n and offset < len(self.book_ids):
            distances, indices = self.model.kneighbors(
                user_vector.reshape(1, -1),
                n_neighbors=min(batch_size + len(results), len(self.book_ids)),
            )

            for dist, idx in zip(distances[0], indices[0]):
                book_id = self.book_ids[idx]
                if book_id in remaining_excludes:
                    continue
                score = round(max(0.0, 1.0 - dist), 4)
                results.append({"title": self.book_titles[idx], "score": score})
                if len(results) >= top_n:
                    break

            offset += batch_size

        return results


# ---------------------------------------------------------------------------
# User taste vector
# ---------------------------------------------------------------------------

def compute_user_taste(
    conn: sqlite3.Connection,
    liked_books: list[dict],
) -> np.ndarray:
    """Compute weighted-average taste vector from rated books.

    Each entry in liked_books is {"book_id": int, "rating": int}.
    """
    vectors = []
    weights = []

    for entry in liked_books:
        row = conn.execute(
            "SELECT * FROM book_features WHERE book_id = ?",
            (entry["book_id"],),
        ).fetchone()
        if row is None:
            continue
        vec = [row[dim] for dim in FEATURE_DIMS]
        vectors.append(vec)
        weights.append(entry["rating"])

    if not vectors:
        raise ValueError("No valid book IDs found in liked_books.")

    X = np.array(vectors)
    w = np.array(weights, dtype=float)
    # Weighted average across each feature dimension
    taste = np.average(X, weights=w, axis=0)
    return taste


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

def build_fastapi_app(model: RecommendationModel):
    """Create and return a FastAPI application with routes."""
    app = FastAPI(title="Book Recommendation Engine")

    # --- Serve static files ---
    static_dir = os.path.join(BASE_DIR, "static")
    if os.path.isdir(static_dir):
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

    # --- Routes ---

    @app.get("/")
    def index():
        index_path = os.path.join(BASE_DIR, "static", "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return {"error": "Frontend not available"}

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/books")
    def list_books():
        conn = get_db()
        rows = conn.execute("SELECT id, title, description FROM books_raw").fetchall()
        conn.close()
        return [{"id": r["id"], "title": r["title"], "description": r["description"]} for r in rows]

    class LikedBook(BaseModel):
        book_id: int
        rating: int  # 1-5

    class RecommendRequest(BaseModel):
        liked_books: list[LikedBook]

    class RecommendResponse(BaseModel):
        recommendations: list[dict]

    class TasteResponse(BaseModel):
        taste_vector: list[float]

    class AddBookRequest(BaseModel):
        title: str = Field(..., min_length=1, max_length=500)
        description: str = Field(default="", max_length=10000)

    class UpdateFeaturesRequest(BaseModel):
        features: dict[str, float]

    @app.post("/taste", response_model=TasteResponse)
    def taste(req: RecommendRequest):
        """Return the user's taste vector (for the radar chart)."""
        if not req.liked_books:
            raise HTTPException(status_code=400, detail="liked_books cannot be empty")
        conn = get_db()
        try:
            vector = compute_user_taste(conn, [b.model_dump() for b in req.liked_books])
            return {"taste_vector": vector.tolist()}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        finally:
            conn.close()

    @app.post("/books", status_code=201)
    def add_book(req: AddBookRequest):
        """Add a new book with auto-generated features (uniform 0.5 default)."""
        conn = get_db()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO books_raw (title, description) VALUES (?, ?)",
                (req.title, req.description),
            )
            new_id = cursor.lastrowid

            # Default features — uniform 0.5 (neutral)
            conn.execute(
                """INSERT INTO book_features
                   (book_id, pacing, character_depth, plot_complexity, prose_quality,
                    philosophical_depth, emotional_intensity, humor, action)
                   VALUES (?, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5)""",
                (new_id,),
            )
            conn.commit()

            # Re-fit the model with the new book
            model.fit(conn)

            return {"id": new_id, "title": req.title}
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            conn.close()

    @app.post("/books/{book_id}/features")
    def update_features(book_id: int, req: UpdateFeaturesRequest):
        """Update a book's feature vector (after manual adjustment)."""
        conn = get_db()
        try:
            existing = conn.execute(
                "SELECT book_id FROM book_features WHERE book_id = ?", (book_id,)
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Book not found")

            # Validate all 8 dimensions are present and in [0,1]
            try:
                features = _validate_features(req.features)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))

            conn.execute(
                """UPDATE book_features SET
                   pacing=?, character_depth=?, plot_complexity=?, prose_quality=?,
                   philosophical_depth=?, emotional_intensity=?, humor=?, action=?
                   WHERE book_id=?""",
                (
                    features["pacing"], features["character_depth"],
                    features["plot_complexity"], features["prose_quality"],
                    features["philosophical_depth"], features["emotional_intensity"],
                    features["humor"], features["action"],
                    book_id,
                ),
            )
            conn.commit()

            # Re-fit the model
            model.fit(conn)

            return {"status": "ok"}
        except HTTPException:
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            conn.close()

    @app.get("/books/{book_id}")
    def get_book(book_id: int):
        """Get a single book with its features."""
        conn = get_db()
        try:
            book = conn.execute(
                "SELECT id, title, description FROM books_raw WHERE id = ?", (book_id,)
            ).fetchone()
            if not book:
                raise HTTPException(status_code=404, detail="Book not found")

            feats = conn.execute(
                "SELECT * FROM book_features WHERE book_id = ?", (book_id,)
            ).fetchone()

            return {
                "id": book["id"],
                "title": book["title"],
                "description": book["description"],
                "features": {dim: feats[dim] for dim in FEATURE_DIMS} if feats else None,
            }
        except HTTPException:
            raise
        finally:
            conn.close()

    @app.post("/rebuild")
    def rebuild_model():
        """Rebuild the k-NN model (after adding/updating books)."""
        try:
            conn = get_db()
            try:
                model.fit(conn)
                return {"status": "ok", "books": len(model.book_ids)}
            finally:
                conn.close()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/recommend", response_model=RecommendResponse)
    def recommend(req: RecommendRequest):
        if not req.liked_books:
            raise HTTPException(status_code=400, detail="liked_books cannot be empty")

        conn = get_db()
        try:
            # Build user taste vector
            user_vector = compute_user_taste(conn, [b.model_dump() for b in req.liked_books])

            # Books to exclude (already rated)
            exclude_ids = {b.book_id for b in req.liked_books}

            # Get recommendations
            recs = model.recommend(user_vector, exclude_ids, top_n=5)
            return {"recommendations": recs}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        finally:
            conn.close()

    return app


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def cmd_init() -> None:
    """Initialize database and build the model."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    try:
        create_tables(conn)
        load_seeds(conn)

        # Build and persist model info by fitting once
        model = RecommendationModel()
        model.fit(conn)
        print("Initialization complete. Run 'python app.py serve' to start the server.")
    finally:
        conn.close()


def cmd_serve() -> None:
    """Start the FastAPI server."""
    # Model is fitted at module import time via _shared_model.
    # No need to pre-fit here — uvicorn's import handles it.
    print("Starting server on http://localhost:8000")
    print("Dashboard: http://localhost:8000")
    print("Endpoints:")
    print("  GET  /health")
    print("  GET  /books")
    print("  POST /taste")
    print("  POST /recommend")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app:app",
            "--host",
            "0.0.0.0",
            "--port",
            "8000",
            "--reload",
        ],
        cwd=BASE_DIR,
    )


# ---------------------------------------------------------------------------
# Module-level app instance (used by uvicorn when serving)
# ---------------------------------------------------------------------------
_shared_model: RecommendationModel | None = None
_app_instance: FastAPI | None = None


def _get_or_create_app() -> FastAPI:
    """Lazily create the FastAPI app with a fitted model."""
    global _shared_model, _app_instance

    if _app_instance is not None:
        return _app_instance

    # Ensure model is fitted
    if _shared_model is None or not _shared_model.is_fitted:
        conn = get_db()
        try:
            _shared_model = RecommendationModel()
            _shared_model.fit(conn)
        except Exception:
            raise RuntimeError(
                "Model could not be fitted. Run 'python app.py init' first."
            )
        finally:
            conn.close()

    _app_instance = build_fastapi_app(_shared_model)
    return _app_instance


# Create app eagerly if possible (db already initialized), otherwise defer
if os.path.exists(DB_PATH):
    try:
        conn = get_db()
        _shared_model = RecommendationModel()
        _shared_model.fit(conn)
        conn.close()
        _app_instance = build_fastapi_app(_shared_model)
    except Exception as e:
        logger.warning("Could not pre-load model at startup: %s", e)
        logger.warning("App will be created lazily on first request.")

app: FastAPI = None  # type: ignore[assignment]  # overwritten below


def _finalise_app() -> FastAPI:
    """Return the app, creating it lazily if needed."""
    global app
    a = _get_or_create_app()
    app = a
    return a


# Ensure uvicorn has something to import (will be None if db not initialized)
try:
    app = _finalise_app()  # type: ignore[assignment]
except RuntimeError:
    app = None  # type: ignore[assignment]  # Will be created lazily by uvicorn


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Book Recommendation Engine")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("init", help="Load seed data and build model")
    subparsers.add_parser("serve", help="Start FastAPI server")

    args = parser.parse_args()

    if args.command == "init":
        cmd_init()
    elif args.command == "serve":
        cmd_serve()

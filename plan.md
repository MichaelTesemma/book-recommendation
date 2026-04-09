# 📚 Book Recommendation Engine (POC) — Full Implementation Guide

## 🧠 System Overview

You are building a proof-of-concept backend application for a **book recommendation engine**.

### Tech Stack

* Backend: FastAPI → https://fastapi.tiangolo.com/
* Database: SQLite → https://www.sqlite.org/docs.html
* Machine Learning: scikit-learn (k-NN) → https://scikit-learn.org/stable/modules/generated/sklearn.neighbors.NearestNeighbors.html
* NLP: textstat + TextBlob
* LLM: API-based (OpenAI or local via Ollama)

---

## 🎯 Core Concept

* Each book is represented as an **8-dimensional feature vector**
* Users select books and rate them
* The system computes a **user taste vector**
* Recommendations are generated using **cosine similarity via k-NN**

### Feature Dimensions (0–1 scale)

1. pacing (slow → fast)
2. character_depth
3. plot_complexity
4. prose_quality
5. philosophical_depth
6. emotional_intensity
7. humor
8. action

---

## 🔁 Full Pipeline

1. Ingest book data
2. Clean and store in SQLite
3. Generate feature vectors (LLM)
4. Enhance vectors (NLP)
5. Build k-NN model
6. Compute user taste vector
7. Serve recommendations via API

---

# 📚 Data Ingestion

## Data Sources

Use one or more:

* Open Library
  API: https://openlibrary.org/developers/api
  Example: https://openlibrary.org/search.json?q=fiction

* Project Gutenberg
  Download texts: https://www.gutenberg.org/browse/scores/top

* Kaggle datasets (recommended):
  https://www.kaggle.com/datasets
  Search: “books dataset”, “goodreads dataset”

---

## Data Format

Each book must contain:

* id
* title
* description

---

## Processing Steps

1. Normalize text:

   * Convert to lowercase
   * Remove extra whitespace

2. Store in SQLite

### Table: `books_raw`

* id (primary key)
* title (text)
* description (text)

3. Ensure:

* No duplicates
* Idempotent runs (safe to re-run)

---

# 🤖 LLM Feature Extraction

## LLM Options

* OpenAI API
  Docs: https://platform.openai.com/docs

* Ollama
  Docs: https://ollama.com/

---

## Goal

Convert each book description into:

```json
{
  "pacing": float,
  "character_depth": float,
  "plot_complexity": float,
  "prose_quality": float,
  "philosophical_depth": float,
  "emotional_intensity": float,
  "humor": float,
  "action": float
}
```

---

## Requirements

* Values must be between **0 and 1**
* Return **ONLY valid JSON**
* No extra text

---

## Process

1. Send description to LLM
2. Run **3 times per book**
3. Average results

---

## Storage

### Table: `book_features`

* book_id
* pacing
* character_depth
* plot_complexity
* prose_quality
* philosophical_depth
* emotional_intensity
* humor
* action

---

## Constraints

* Skip already processed books
* Cache results
* Retry failed responses
* Validate JSON strictly

---

# 🧠 NLP Enhancement

## Libraries

* textstat → https://pypi.org/project/textstat/
* TextBlob → https://textblob.readthedocs.io/en/dev/

---

## Extract Signals

* Readability score
* Sentiment polarity
* Action-related keyword frequency

---

## Mapping

* Readability → prose_quality
* Sentiment → emotional_intensity
* Keywords → action

---

## Combine

Final value:

```
final = (0.7 × LLM) + (0.3 × NLP)
```

---

## Constraints

* Normalize values to [0,1]
* Deterministic outputs
* Update database in place

---

# 🧮 k-NN Model

## Documentation

https://scikit-learn.org/stable/modules/generated/sklearn.neighbors.NearestNeighbors.html

---

## Steps

1. Load all feature vectors from SQLite

2. Represent each book as an 8D vector

3. Initialize k-NN:

   * metric = cosine

4. Fit model

---

## Capabilities

* Find nearest neighbors
* Return top N results
* Exclude specific book IDs

---

## Constraints

* Model runs in memory
* Rebuild on server startup
* Ensure fast queries

---

# 👤 User Taste Vector

## Input

List of:

* book_id
* rating (1–5)

---

## Process

1. Fetch feature vectors
2. Compute weighted average:

   * weight = rating

Reference:
https://numpy.org/doc/stable/reference/generated/numpy.average.html

---

## Output

* Single 8D vector

---

## Constraints

* Handle empty input
* Validate IDs
* Normalize output

---

# 🔍 Recommendation Engine

## Process

1. Use k-NN model
2. Query nearest books
3. Exclude already seen books

---

## Enhancements

* Add small randomness (exploration)
* Prevent overly similar duplicates

Reference:
https://en.wikipedia.org/wiki/Cosine_similarity

---

## Output

Top 5 books:

* title
* similarity score

---

## Constraints

* No duplicates
* Stable but slightly varied results

---

# 🌐 FastAPI Server

## Documentation

* FastAPI: https://fastapi.tiangolo.com/tutorial/
* Uvicorn: https://www.uvicorn.org/

---

## Endpoint

### POST `/recommend`

### Input

```json
{
  "liked_books": [
    {"book_id": 1, "rating": 5}
  ]
}
```

---

## Process

1. Validate input
2. Compute user vector
3. Query recommendation engine

---

## Output

```json
{
  "recommendations": [
    {"title": "Book Name", "score": 0.87}
  ]
}
```

---

## Constraints

* Fast response time
* Clear error handling
* Clean structure

---

# 🔁 Pipeline Runner

## Goal

Run full system step-by-step.

---

## Steps

1. Data ingestion
2. LLM feature extraction
3. NLP enhancement
4. Build k-NN model
5. Start FastAPI server

---

## Optional CLI

Use argparse:
https://docs.python.org/3/library/argparse.html

---

## Requirements

* Run steps independently
* Skip completed steps
* Log progress clearly
* Keep orchestration simple

---

# 🔥 Final System Summary

You now have:

* A full **data pipeline (raw → features → vectors)**
* A **hybrid feature extraction system (LLM + NLP)**
* A **k-NN recommendation engine**
* A **FastAPI backend for serving recommendations**

---

## 🧭 What This Actually Is

This is not just a recommender.

It is:

> A system that models **reader taste as a structured, multi-dimensional vector space**

---

## 🚀 Next Steps (Optional but Powerful)

* Add evaluation metrics (precision, diversity, novelty)
* Introduce embeddings alongside features
* Add feedback loop to update user taste over time
* Expand to movies, anime, or other media

---

## ✅ Outcome

If implemented correctly, this system will:

* Produce meaningful recommendations
* Be easy to extend
* Serve as a strong foundation for a production system

# NomadicML Geovisualizer 🌍

A geospatial analysis tool built for **NomadicML**.

It transforms raw batch metadata into a map-ready, "Mini-Geoguessr" experience so you can inspect spatial context and jump straight into the right moment in video.

**Live Demo:** [https://nomadicml-geovis.onrender.com/](https://nomadicml-geovis.onrender.com/)

---

## 🚀 Key Features

* **Interactive Map:** Plots event start/end points and paths color-coded by severity.
* **Instant Video Jumps:** Signed URLs deep-link the player to the exact timestamp.
* **AI Search:** Embed events once per batch and fuzzy-search by text query.
* **Custom Layers:** Toggle Light, Dark, and Satellite basemaps.

---

## 🛠️ Tech Stack

* **Backend:** Python, FastAPI
* **Geospatial:** Folium, Leaflet.js
* **Frontend:** HTML5, TailwindCSS
* **Embedding:** sentence-transformers (`all-MiniLM-L6-v2`)
* **SDK:** NomadicML

---

## ⚙️ Local Setup

1.  **Clone the repository**
    ```bash
    git clone https://github.com/GauravUp28/nomadicml-geovis.git
    cd nomadicml-geovis
    ```

2.  **Install Dependencies**
    ```bash
    pip install -r requirements.txt
    ```

3.  **Configure Environment**
    Create a `.env` file in the root directory and add your API key:
    ```env
    NOMADIC_API_KEY=your_api_key_here
    ```

4.  **Run the Server**
    ```bash
    python server.py
    ```

5.  **Access the App**
    Open your browser at `http://localhost:8000`

---

## 📡 API Endpoints (local)

- `POST /api/visualize` — body `{ "batchId": "...", "filter": "all" | "<label fragment>" }` → GeoJSON FeatureCollection.
- `POST /api/ai-search` — body `{ "batchId": "...", "query": "<text>" }` → `{ matching_ids: [...] }`.
- `POST /api/video-url` — body `{ "videoId": "<id>" }` → `{ url: "<signed-url>" }`.

---

## 🧪 Test Data

To test the visualization, use nomadicML Batch IDs containing GPS overlay data:

* `1a4feb58-093c-42b8-bc75-f0d1f4a2ab61`

If you don’t have API access, switch the UI data source to **Mock (CSV)** to load `nomadic_data_5_csv.csv` locally (AI search still works after the data loads).

---

## 🔮 Roadmap & Future Improvements

* **Filtering:** Add UI controls to filter events by Label (e.g., "Vehicle Stopping") or Severity.
* **Playback Sync:** Implement bi-directional syncing to animate the map marker location in real-time as the video plays.
* **Search History:** Cache recently used Batch IDs for quicker access.

---

## 🔗 Keep This Repo Separate (Recommended)

If you want Geovis to live in its own GitHub repository but still be used inside the NomadicML codebase, treat it as a dependency rather than moving the code:

1. **Git submodule (pin a commit/tag):**
   - Add Geovis as a submodule inside NomadicML.
   - Build `nomadic-client` during the NomadicML build/CI step and serve the generated `nomadic-client/dist`.

2. **Git subtree (vendor but keep history):**
   - Pull Geovis into NomadicML via subtree while keeping this repo as the upstream source of truth.

Either approach keeps this project clean and deployable on its own, without special deep-link or cross-repo fetch workarounds.

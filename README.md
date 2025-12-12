# NomadicML Geovisualizer 🌍

A geospatial analysis tool built for the **NomadicML**. 

This application visualizes driving events (anomalies, violations, stops) from the NomadicML SDK on an interactive map. It transforms raw metadata into a visual "Mini-Geoguessr" style interface, allowing users to inspect the spatial context of edge cases with instant video verification.

**Live Demo:** [https://nomadicml-geovis.onrender.com/](https://nomadicml-geovis.onrender.com/)

---

## 🚀 Key Features

* **Interactive Map:** Plots event Start and End points using Folium.
* **Contextual Paths:** Draws travel paths for moving events, color-coded by severity (🔵 Low, 🟠 Medium, 🔴 High).
* **Video Verification:** Clicking a marker fetches a signed video URL and deep-links the player to the exact timestamp of the event.
* **Custom Layers:** Toggle between **Light**, **Dark**, and **Satellite** views for better environmental analysis.
* **Search by Batch:** dynamic loading of data via NomadicML Batch IDs.

---

## 🛠️ Tech Stack

* **Backend:** Python, FastAPI
* **Geospatial:** Folium, Leaflet.js
* **Frontend:** HTML5, TailwindCSS
* **Deployment:** Render
* **SDK:** NomadicML

---

## ⚙️ Local Setup

1.  **Clone the repository**
    ```bash
    git clone [https://github.com/GauravUp28/nomadicml-geovis.git](https://github.com/GauravUp28/nomadicml-geovis.git)
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
    Open your browser and navigate to `http://localhost:8000`

---

## 🧪 Test Data

To test the visualization, use nomadicML Batch IDs containing GPS overlay data:

* `1a4feb58-093c-42b8-bc75-f0d1f4a2ab61`

---

## 🔮 Roadmap & Future Improvements

* **Filtering:** Add UI controls to filter events by Label (e.g., "Vehicle Stopping") or Severity.
* **Playback Sync:** Implement bi-directional syncing to animate the map marker location in real-time as the video plays.
* **Search History:** Cache recently used Batch IDs for quicker access.
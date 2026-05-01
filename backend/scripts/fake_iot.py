"""Generate fake IoT readings for the Comparou Ta Barato demo.

The goal is to simulate supermarket signals that are easy to explain:
queue pressure, shelf availability, refrigeration and energy usage.
"""

from __future__ import annotations

import json
import random
import unicodedata
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STORE_PATHS = [ROOT / "stores.json", ROOT / "stores" / "stores.json"]
OUT_PATH = ROOT / "data" / "iot_readings.json"

STORE_REGIONS = {
    "delanana": "Itapira",
    "geoli": "Itapira",
    "antonelli": "Itapira",
    "savegnago": "Campinas",
    "pao de acucar": "Campinas",
    "crema": "Americana",
    "pague menos": "Americana",
    "sao vicente": "Americana",
}

AMERICANA_IOT_STORES = [
    { "name": "Crema", "lat": -22.7362, "lng": -47.3337 },
    { "name": "Pague Menos", "lat": -22.7451, "lng": -47.3278 },
    { "name": "São Vicente", "lat": -22.7398, "lng": -47.3371 },
]


def normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    without_accents = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return without_accents.lower()


def stores_for_iot(stores: list[dict]) -> list[dict]:
    all_stores = list(stores)
    seen = {normalize_name(store.get("name", "")) for store in all_stores}
    for store in AMERICANA_IOT_STORES:
        key = normalize_name(store["name"])
        if key not in seen:
            all_stores.append(store)
            seen.add(key)
    return all_stores


def classify_status(queue_minutes: int, stock_alerts: int, freezer_celsius: float) -> str:
    if queue_minutes >= 11 or stock_alerts >= 6 or freezer_celsius >= 8.0:
        return "critical"
    if queue_minutes >= 7 or stock_alerts >= 3 or freezer_celsius >= 6.5:
        return "attention"
    return "ok"


def reading_for_store(store: dict, generated_at: str) -> dict:
    seed = f"{generated_at[:13]}:{store['name']}"
    rng = random.Random(seed)

    queue_minutes = rng.randint(1, 12)
    stock_alerts = rng.randint(0, 6)
    freezer_celsius = round(rng.uniform(1.8, 8.2), 1)
    foot_traffic = rng.randint(12, 96)
    energy_kw = round(rng.uniform(8.0, 32.0), 1)

    normalized = normalize_name(store["name"])
    region = STORE_REGIONS.get(normalized) or "Campinas"

    return {
        "store": store["name"],
        "region": region,
        "lat": store["lat"],
        "lng": store["lng"],
        "queueMinutes": queue_minutes,
        "stockAlerts": stock_alerts,
        "freezerCelsius": freezer_celsius,
        "footTraffic": foot_traffic,
        "energyKw": energy_kw,
        "status": classify_status(queue_minutes, stock_alerts, freezer_celsius),
    }


def main() -> None:
    stores_path = next((path for path in STORE_PATHS if path.exists()), None)
    if stores_path is None:
        raise FileNotFoundError("No stores file found.")

    stores = stores_for_iot(json.loads(stores_path.read_text(encoding="utf-8")))
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    payload = {
        "generatedAt": generated_at,
        "source": "scripts/fake_iot.py",
        "readings": [reading_for_store(store, generated_at) for store in stores],
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Generated {len(payload['readings'])} fake IoT readings at {OUT_PATH}")


if __name__ == "__main__":
    main()

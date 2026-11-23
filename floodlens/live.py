"""Local-area feeds. No synthetic fallback; upstream failures remain visible."""
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from threading import Lock
from urllib.parse import urlencode
from urllib.request import Request, urlopen

LAT, LON, RADIUS_KM = 13.73, 100.78, 10
BANGKOK = timezone(timedelta(hours=7))
THAIWATER = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/'
FORECAST = 'https://api.open-meteo.com/v1/forecast?' + urlencode({
    'latitude': LAT, 'longitude': LON, 'hourly': 'precipitation,precipitation_probability',
    'timezone': 'Asia/Bangkok', 'forecast_days': 3, 'timeformat': 'unixtime',
})


def fetch_json(url):
    req = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'FloodLens/1.0'})
    with urlopen(req, timeout=15) as response:
        return json.load(response)


def number(value, minimum=None, maximum=None):
    try:
        value = float(value)
        if not math.isfinite(value) or (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
            return None
        return value
    except (ValueError, TypeError):
        return None


def distance(lat, lon):
    a, b = math.radians(lat - LAT), math.radians(lon - LON)
    h = math.sin(a / 2) ** 2 + math.cos(math.radians(LAT)) * math.cos(math.radians(lat)) * math.sin(b / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(h)))


def normalize_stations(payload, kind):
    # ThaiWater website feeds are not a versioned developer API. Fail on schema drift.
    group = payload.get('waterlevel_data' if kind == 'water' else 'rainfall_data')
    if group is None:
        group = payload
    records = group.get('data') if isinstance(group, dict) else group
    if not isinstance(records, list):
        raise ValueError('Unexpected ThaiWater response schema')
    rows, rejected = [], 0
    now = datetime.now(BANGKOK)
    for raw in records:
        try:
            station = raw['station']
            lat = number(station.get('tele_station_lat'), -90, 90)
            lon = number(station.get('tele_station_long'), -180, 180)
            if lat is None or lon is None:
                rejected += 1
                continue
            km = distance(lat, lon)
            if km > RADIUS_KM:
                continue
            field = 'waterlevel_msl' if kind == 'water' else 'rain_24h'
            value = number(raw.get(field), 0 if kind == 'rain' else None)
            if value is None:
                rejected += 1
                continue
            stamp = datetime.fromisoformat(raw['waterlevel_datetime' if kind == 'water' else 'rainfall_datetime'])
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=BANGKOK)
            age = (now - stamp).total_seconds()
            name = station.get('tele_station_name', {})
            name = name.get('th') or name.get('en') if isinstance(name, dict) else name
            rows.append({'station_id': str(station.get('id', station.get('tele_station_oldcode', name))),
                         'name': name, 'latitude': lat, 'longitude': lon,
                         'distance_km': round(km, 2), 'timestamp': stamp.isoformat(),
                         'value': value, 'unit': 'm MSL' if kind == 'water' else 'mm / 24h',
                         'stale': age > 3 * 3600 or age < -900,
                         'source': 'ThaiWater', 'kind': 'observation'})
        except (KeyError, TypeError, ValueError, AttributeError):
            rejected += 1
    return {'rows': sorted(rows, key=lambda r: r['distance_km']), 'rejected': rejected}


def normalize_forecast(payload):
    hourly = payload['hourly']
    stamps, amounts, probabilities = (hourly[k] for k in ('time', 'precipitation', 'precipitation_probability'))
    if not (len(stamps) == len(amounts) == len(probabilities)):
        raise ValueError('Mismatched forecast series')
    units = payload['hourly_units']
    if units['precipitation'] != 'mm' or units['precipitation_probability'] != '%':
        raise ValueError('Unexpected forecast units')
    now = time.time()
    rows = []
    for stamp, amount, probability in zip(stamps, amounts, probabilities):
        if stamp < now:
            continue
        rows.append({'timestamp': datetime.fromtimestamp(stamp, BANGKOK).isoformat(),
                     'precipitation_mm': number(amount, 0),
                     'probability_pct': number(probability, 0, 100)})
    return {'rows': rows, 'kind': 'forecast', 'source': 'Open-Meteo',
            'grid_latitude': payload.get('latitude'), 'grid_longitude': payload.get('longitude')}


class LiveService:
    def __init__(self, fetch=fetch_json):
        self.fetch = fetch
        self.cache = {}
        self.lock = Lock()

    def feed(self, name, url, normalize):
        now = time.monotonic()
        cached = self.cache.get(name)
        if cached and now - cached[0] < 300:
            return cached[1]
        try:
            data = normalize(self.fetch(url))
            result = dict(data, status='ok' if data['rows'] else 'empty',
                          fetched_at=datetime.now(BANGKOK).isoformat(), url=url)
        except Exception as exc:
            # Never report cached observations as a successful fresh fetch.
            result = {'status': 'error', 'rows': [], 'url': url,
                      'error': f'{type(exc).__name__}: {exc}', 'fetched_at': None}
        self.cache[name] = (now, result)
        return result

    def get(self):
        with self.lock:
            with ThreadPoolExecutor(max_workers=3) as pool:
                jobs = {
                    'forecast': pool.submit(self.feed, 'forecast', FORECAST, normalize_forecast),
                    'water': pool.submit(self.feed, 'water', THAIWATER + 'waterlevel_load', lambda p: normalize_stations(p, 'water')),
                    'rain': pool.submit(self.feed, 'rain', THAIWATER + 'rain_24h', lambda p: normalize_stations(p, 'rain')),
                }
                return {'area': {'name': 'KMITL / Lat Krabang vicinity', 'latitude': LAT,
                                 'longitude': LON, 'radius_km': RADIUS_KM},
                        'feeds': {name: job.result() for name, job in jobs.items()}}

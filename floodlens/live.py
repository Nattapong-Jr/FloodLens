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
REGIONAL_RADIUS_KM = 150
WEATHER_POINTS = [
    {'id': 'kmitl', 'name': 'KMITL / Lat Krabang', 'latitude': LAT, 'longitude': LON},
    {'id': 'pathum', 'name': 'Pathum Thani', 'latitude': 14.02, 'longitude': 100.53},
    {'id': 'ayutthaya', 'name': 'Ayutthaya', 'latitude': 14.35, 'longitude': 100.57},
    {'id': 'chachoengsao', 'name': 'Chachoengsao', 'latitude': 13.69, 'longitude': 101.08},
    {'id': 'bangkok', 'name': 'Central Bangkok', 'latitude': 13.75, 'longitude': 100.50},
]
BANGKOK = timezone(timedelta(hours=7))
THAIWATER = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/'
FORECAST = 'https://api.open-meteo.com/v1/forecast?' + urlencode({
    'latitude': ','.join(str(p['latitude']) for p in WEATHER_POINTS),
    'longitude': ','.join(str(p['longitude']) for p in WEATHER_POINTS),
    'hourly': 'precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    'wind_speed_unit': 'kmh',
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


def label(value):
    return (value.get('th') or value.get('en')) if isinstance(value, dict) else value


def normalize_stations(payload, kind, radius_km=RADIUS_KM):
    # ThaiWater website feeds are not a versioned developer API. Fail on schema drift.
    if kind not in ('water', 'rain', 'flow'):
        raise ValueError('Unsupported station feed')
    group = payload.get('waterlevel_data' if kind == 'water' else 'rainfall_data')
    if group is None:
        group = payload
    records = group.get('data') if isinstance(group, dict) else group
    if not isinstance(records, list):
        raise ValueError('Unexpected ThaiWater response schema')
    if isinstance(group, dict) and group.get('result', 'OK') != 'OK':
        raise ValueError('ThaiWater reported an unsuccessful result')
    rows, rejected = [], 0
    now = datetime.now(BANGKOK)
    for raw in records:
        try:
            station = raw['station']
            prefix = 'flow' if kind == 'flow' else 'tele_station'
            lat = number(station.get(prefix + '_lat'), -90, 90)
            lon = number(station.get(prefix + ('_long')), -180, 180)
            if lat is None or lon is None:
                rejected += 1
                continue
            km = distance(lat, lon)
            if km > radius_km:
                continue
            field = {'water': 'waterlevel_msl', 'rain': 'rain_24h', 'flow': 'flow_value'}[kind]
            value = number(raw.get(field), 0 if kind == 'rain' else None)
            if value is None:
                rejected += 1
                continue
            stamp = datetime.fromisoformat(raw[{'water': 'waterlevel_datetime', 'rain': 'rainfall_datetime', 'flow': 'flow_datetime'}[kind]])
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=BANGKOK)
            age = (now - stamp).total_seconds()
            name = label(station.get(prefix + '_name', {}))
            geocode = raw.get('geocode') or {}
            rows.append({'station_id': str(station.get('id', station.get('tele_station_oldcode', name))),
                         'name': name, 'latitude': lat, 'longitude': lon,
                         'distance_km': round(km, 2), 'timestamp': stamp.isoformat(),
                         'value': value, 'unit': {'water': 'm MSL', 'rain': 'mm / 24h', 'flow': 'm3/s'}[kind],
                         'station_code': station.get(prefix + '_oldcode'),
                         'river': raw.get('river_name'),
                         'basin': label((raw.get('basin') or {}).get('basin_name')),
                         'province': label(geocode.get('province_name')),
                         'district': label(geocode.get('amphoe_name')),
                         'agency': label((raw.get('agency') or {}).get('agency_name')),
                         'discharge_m3s': number(raw.get('discharge')) if kind == 'water' else None,
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
    optional = {'wind_speed_10m': ('wind_speed_kmh', 'km/h', 0, None),
                'wind_direction_10m': ('wind_from_deg', '°', 0, 360),
                'wind_gusts_10m': ('wind_gusts_kmh', 'km/h', 0, None)}
    for field, (_, unit, _, _) in optional.items():
        if field in hourly and (units.get(field) != unit or len(hourly[field]) != len(stamps)):
            raise ValueError('Unexpected wind series or units: ' + field)
    for i, (stamp, amount, probability) in enumerate(zip(stamps, amounts, probabilities)):
        if stamp < now:
            continue
        row = {'timestamp': datetime.fromtimestamp(stamp, BANGKOK).isoformat(),
                     'precipitation_mm': number(amount, 0),
                     'probability_pct': number(probability, 0, 100)}
        for field, (target, _, minimum, maximum) in optional.items():
            row[target] = number(hourly[field][i], minimum, maximum) if field in hourly else None
        row['wind_to_deg'] = (row['wind_from_deg'] + 180) % 360 if row['wind_from_deg'] is not None else None
        rows.append(row)
    return {'rows': rows, 'kind': 'forecast', 'source': 'Open-Meteo',
            'grid_latitude': payload.get('latitude'), 'grid_longitude': payload.get('longitude')}


def normalize_weather(payload):
    if not isinstance(payload, list):
        return normalize_forecast(payload)
    if len(payload) != len(WEATHER_POINTS):
        raise ValueError('Unexpected number of weather locations')
    locations = [dict(normalize_forecast(p), **point) for p, point in zip(payload, WEATHER_POINTS)]
    return dict(locations[0], locations=locations)


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

    def get(self, scope='local'):
        if scope not in ('local', 'regional'):
            raise ValueError('scope must be local or regional')
        with self.lock:
            with ThreadPoolExecutor(max_workers=4) as pool:
                jobs = {
                    'forecast': pool.submit(self.feed, 'forecast', FORECAST, normalize_weather),
                    **{name: pool.submit(self.feed, name, THAIWATER + endpoint,
                                        lambda p, k=name: normalize_stations(p, k, REGIONAL_RADIUS_KM))
                       for name, endpoint in [('water', 'waterlevel_load'), ('rain', 'rain_24h'), ('flow', 'flow')]},
                }
                feeds = {name: job.result() for name, job in jobs.items()}
                if scope == 'local':
                    for name in ('water', 'rain', 'flow'):
                        feed = feeds[name]
                        rows = [r for r in feed['rows'] if r['distance_km'] <= RADIUS_KM]
                        feeds[name] = dict(feed, rows=rows, status=('ok' if rows else 'empty') if feed['status'] != 'error' else 'error')
                return {'area': {'name': 'KMITL / Lat Krabang vicinity', 'latitude': LAT,
                                 'longitude': LON, 'scope': scope,
                                 'radius_km': RADIUS_KM if scope == 'local' else REGIONAL_RADIUS_KM},
                        'feeds': feeds}

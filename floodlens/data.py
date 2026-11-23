import csv
import math
from datetime import datetime

FIELDS = ['timestamp', 'station_id', 'rain_mm', 'water_level_m', 'source', 'is_demo']


def load_csv(path):
    """Reject ambiguous/invalid records; preserve missing values as None."""
    rows, issues, seen = [], [], set()
    with open(path, encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != FIELDS:
            raise ValueError('CSV columns must be: ' + ','.join(FIELDS))
        for line, raw in enumerate(reader, 2):
            try:
                stamp = datetime.fromisoformat(raw['timestamp'])
                if stamp.utcoffset() is None:
                    raise ValueError('timestamp requires timezone, e.g. +07:00')
                station = raw['station_id'].strip()
                if not station or not raw['source'].strip():
                    raise ValueError('station_id and source are required')
                if raw['is_demo'] not in ('true', 'false'):
                    raise ValueError('is_demo must be true or false')
                key = (stamp, station)
                if key in seen:
                    raise ValueError('duplicate timestamp/station')
                record = dict(raw, timestamp=stamp.isoformat(), station_id=station)
                for field in ('rain_mm', 'water_level_m'):
                    value = None if raw[field].strip() == '' else float(raw[field])
                    if value is not None and not math.isfinite(value):
                        raise ValueError(field + ' must be finite')
                    if field == 'rain_mm' and value is not None and value < 0:
                        raise ValueError('rain_mm cannot be negative')
                    record[field] = value
                seen.add(key)
                rows.append(record)
                for field in ('rain_mm', 'water_level_m'):
                    if record[field] is None:
                        issues.append({'line': line, 'message': field + ' missing; retained as null'})
            except (ValueError, TypeError, KeyError) as exc:
                issues.append({'line': line, 'message': str(exc) + '; row rejected'})
    rows.sort(key=lambda row: datetime.fromisoformat(row['timestamp']))
    return rows, issues

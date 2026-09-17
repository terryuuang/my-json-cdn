#!/usr/bin/env python3
"""Publish numeric daily MND reports. No inferred coordinates or missing-as-zero counts."""
import argparse
from datetime import date, datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

BASE = 'https://www.mnd.gov.tw/'
OUTPUT = Path(__file__).resolve().parents[1] / 'data/mnd_activity.json'


def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': 'APEINTEL-Atlas-public-data/0.6.8'}), timeout=30) as response:
        return response.read().decode('utf-8')


class ReportParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.parts = []
        self.images = []
        self.published = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'div' and 'maincontent' in attrs.get('class', '').split():
            self.depth = 1
        elif self.depth:
            if tag == 'div':
                self.depth += 1
            if tag in ('p', 'br'):
                self.parts.append(' ')
            if tag == 'img' and attrs.get('src'):
                url = urljoin(BASE, attrs['src'])
                if urlparse(url).scheme == 'https' and urlparse(url).hostname == 'www.mnd.gov.tw':
                    self.images.append(url)

    def handle_endtag(self, tag):
        if tag == 'div' and self.depth:
            self.depth -= 1

    def handle_data(self, value):
        if self.depth:
            self.parts.append(value)


def parse_report(html, url):
    parser = ReportParser()
    parser.feed(html)
    text = re.sub(r'\s+', ' ', ''.join(parser.parts)).strip()
    dates = re.findall(r'(\d{2,3})年(\d{1,2})月(\d{1,2})日', text)
    if len(dates) < 2:
        raise ValueError(f'Missing observation dates: {url}')
    start, end = [date(int(y) + 1911, int(m), int(d)).isoformat() for y, m, d in dates[:2]]

    def number(pattern):
        match = re.search(pattern, text)
        return int(match[1].replace(',', '')) if match else None

    aircraft = number(r'共機\s*([\d,]+)架')
    vessels = number(r'共艦\s*([\d,]+)艘')
    if aircraft is None and '未偵獲共機' in text:
        aircraft = 0
    if vessels is None and '未偵獲共艦' in text:
        vessels = 0
    if aircraft is None or vessels is None:
        raise ValueError(f'Missing aircraft or vessel total: {url}')
    crossings = number(r'[（(][^）)]*(?:逾越|越過|進入)[^）)]*?([\d,]+)架')
    if crossings is not None and crossings > aircraft:
        raise ValueError(f'Inconsistent aircraft totals: {url}')
    return {
        'date': end, 'periodStart': start, 'periodEnd': end,
        'aircraft': aircraft, 'vessels': vessels,
        'officialShips': number(r'公務船\s*([\d,]+)艘'),
        'reportedAreaAircraft': crossings,
        'sourceUrl': url, 'imageUrl': parser.images[0] if parser.images else None,
    }


def update(pages=2, refresh_all=False):
    previous = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {'reports': []}
    reports = {row['date']: row for row in previous['reports']}
    urls = []
    for page in range(1, pages + 1):
        html = fetch(f'{BASE}news/plaactlist/{page}')
        urls.extend(urljoin(BASE, path) for path in re.findall(r'href="(news/plaact/\d+)"', html))
        time.sleep(.3)
    urls = list(dict.fromkeys(urls))
    if not urls:
        raise ValueError('No daily report links; previous data preserved')
    known = {row['sourceUrl'] for row in reports.values()}
    fetched_dates = set()
    # Recheck the three latest reports for corrections; retain up to 90 records.
    for index, url in enumerate(urls):
        if not refresh_all and index >= 3 and url in known:
            continue
        row = parse_report(fetch(url), url)
        if row['date'] not in fetched_dates:
            reports[row['date']] = row
            fetched_dates.add(row['date'])
        time.sleep(.3)
    payload = {
        'source': '中華民國國防部', 'sourceUrl': BASE + 'news/plaactlist',
        'checkedAt': datetime.now(timezone.utc).isoformat(),
        'timezone': 'Asia/Taipei',
        'periodNote': '各報告前一日 06:00 至當日 06:00（臺灣時間）；數字為通報架次／艘次，非獨立機艦數或即時位置。',
        'reports': sorted(reports.values(), key=lambda row: row['date'], reverse=True)[:90],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(OUTPUT)
    print(f"Saved {len(payload['reports'])} reports; latest {payload['reports'][0]['date']}")


if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--pages', type=int, default=2)
    args.add_argument('--refresh-all', action='store_true')
    options = args.parse_args()
    update(options.pages, options.refresh_all)

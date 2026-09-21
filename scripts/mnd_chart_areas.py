#!/usr/bin/env python3
"""Vectorise the red activity outlines on MND's daily chart into lon/lat rings.

Why this is possible at all: the official chart is drawn in Web Mercator with a
1-degree graticule, so pixels map to coordinates exactly — the same basis
`static/js/mnd_overlay.js` uses to place the raster image. Measured on the
official 720x1040 originals (identical on every day sampled):

    117E at x=124, 123E at x=612.5  ->  81.4167 px/degree
    29N  at y=181, 21N  at y=901    ->  every other parallel within 0.4 px of
                                        the Mercator prediction

Anything that depends on those numbers lives here, in `mnd_overlay.js` and in
the `clip-path` in `osint_data.css`; change one and you must change them all.

The extraction itself is deliberately conservative:
  * only red ink inside the graticule frame is considered
  * outlines broken by the black ADIZ/median lines are reconnected by a 2 px
    dilation, then the enclosed area is filled and eroded back
  * components spanning under 28 px are dropped. Measured across ten charts,
    the circled item numbers are consistently 22-23 px while the smallest real
    activity box is 29 px, so the gap is comfortable
  * a chart whose size is not 720x1040 is refused outright — the pixel basis
    would no longer hold and a plausible-looking wrong polygon is worse than
    no polygon

Pillow and numpy are optional: `extract_areas` returns None when they are
missing, so the numeric report pipeline keeps working without them.
"""
from collections import deque
import io
import math

TEMPLATE = (720, 1040)
X_117E, X_123E = 124.0, 612.5
Y_29N, Y_21N = 181.0, 901.0
PX_PER_DEGREE = (X_123E - X_117E) / 6.0
DILATE = 2
MIN_SPAN_PX = 28
MIN_AREA_PX = 300
SIMPLIFY_PX = 2.0


def _mercator_y(latitude):
    return math.log(math.tan(math.pi / 4 + math.radians(latitude) / 2))


_PX_PER_MERCATOR = (Y_21N - Y_29N) / (_mercator_y(29) - _mercator_y(21))


def pixel_to_lnglat(x, y):
    longitude = 117 + (x - X_117E) / PX_PER_DEGREE
    mercator = _mercator_y(29) - (y - Y_29N) / _PX_PER_MERCATOR
    latitude = math.degrees(2 * math.atan(math.exp(mercator)) - math.pi / 2)
    return round(longitude, 4), round(latitude, 4)


def _red_mask(pixels, numpy):
    red = pixels[:, :, 0].astype(int)
    green = pixels[:, :, 1].astype(int)
    blue = pixels[:, :, 2].astype(int)
    mask = (red > 110) & (red - green > 45) & (red - blue > 45)
    frame = numpy.zeros_like(mask)
    frame[int(Y_29N):int(Y_21N) + 1, int(X_117E):int(X_123E) + 1] = True
    return mask & frame


def _grow(mask, radius, numpy, shrink=False):
    out = mask.copy()
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            shifted = numpy.roll(numpy.roll(mask, dy, 0), dx, 1)
            out = out & shifted if shrink else out | shifted
    return out


def _components(mask, numpy):
    height, width = mask.shape
    seen = numpy.zeros_like(mask)
    groups = []
    for start_y, start_x in zip(*numpy.nonzero(mask)):
        if seen[start_y, start_x]:
            continue
        queue = deque([(start_y, start_x)])
        seen[start_y, start_x] = True
        points = []
        while queue:
            y, x = queue.popleft()
            points.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        groups.append(points)
    return groups


def _fill(outline, numpy):
    """Flood the background in from the border; whatever it cannot reach is inside."""
    height, width = outline.shape
    outside = numpy.zeros_like(outline)
    queue = deque()
    for x in range(width):
        for y in (0, height - 1):
            if not outline[y, x] and not outside[y, x]:
                outside[y, x] = True
                queue.append((y, x))
    for y in range(height):
        for x in (0, width - 1):
            if not outline[y, x] and not outside[y, x]:
                outside[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < height and 0 <= nx < width and not outline[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True
                queue.append((ny, nx))
    return ~outside


def _trace(mask, numpy):
    """Moore-neighbour boundary tracing, clockwise from the top-left pixel."""
    ys, xs = numpy.nonzero(mask)
    top = ys.min()
    start = (int(top), int(xs[ys == top].min()))
    neighbours = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    height, width = mask.shape
    contour = [start]
    current, backtrack = start, 6
    for _ in range(200000):
        for step in range(8):
            dy, dx = neighbours[(backtrack + 1 + step) % 8]
            ny, nx = current[0] + dy, current[1] + dx
            if 0 <= ny < height and 0 <= nx < width and mask[ny, nx]:
                backtrack = (backtrack + 1 + step + 4) % 8
                current = (ny, nx)
                contour.append(current)
                break
        else:
            break
        if current == start and len(contour) > 2:
            break
    return contour


def _simplify(points, epsilon):
    if len(points) < 3:
        return points

    def distance(point, first, last):
        if first == last:
            return math.hypot(point[0] - first[0], point[1] - first[1])
        length = (last[0] - first[0]) ** 2 + (last[1] - first[1]) ** 2
        t = ((point[0] - first[0]) * (last[0] - first[0]) +
             (point[1] - first[1]) * (last[1] - first[1])) / length
        t = max(0.0, min(1.0, t))
        return math.hypot(point[0] - (first[0] + t * (last[0] - first[0])),
                          point[1] - (first[1] + t * (last[1] - first[1])))

    first, last = points[0], points[-1]
    index, farthest = 0, 0.0
    for i in range(1, len(points) - 1):
        d = distance(points[i], first, last)
        if d > farthest:
            farthest, index = d, i
    if farthest <= epsilon:
        return [first, last]
    return _simplify(points[:index + 1], epsilon)[:-1] + _simplify(points[index:], epsilon)


def extract_areas(image_bytes):
    """Return a list of lon/lat rings, or None when extraction is not possible."""
    try:
        from PIL import Image
        import numpy
    except ImportError:
        return None
    try:
        image = Image.open(io.BytesIO(image_bytes))
        if image.size != TEMPLATE:
            return None
        pixels = numpy.array(image.convert('RGB'))
    except Exception:
        return None

    mask = _red_mask(pixels, numpy)
    grown = _grow(mask, DILATE, numpy)
    rings = []
    for points in _components(grown, numpy):
        ys = [p[0] for p in points]
        xs = [p[1] for p in points]
        if max(max(xs) - min(xs), max(ys) - min(ys)) < MIN_SPAN_PX:
            continue
        y0, y1 = min(ys) - 2, max(ys) + 3
        x0, x1 = min(xs) - 2, max(xs) + 3
        local = numpy.zeros((y1 - y0, x1 - x0), dtype=bool)
        for y, x in points:
            local[y - y0, x - x0] = True
        filled = _grow(_fill(local, numpy), DILATE, numpy, shrink=True)
        if filled.sum() < MIN_AREA_PX:
            continue
        contour = _trace(filled, numpy)
        ring = _simplify([(x + x0, y + y0) for y, x in contour], SIMPLIFY_PX)
        if len(ring) < 4:
            continue
        rings.append([list(pixel_to_lnglat(x, y)) for x, y in ring])
    return rings

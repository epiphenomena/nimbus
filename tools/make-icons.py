# Rasterizes the app icon (a rain cloud) to PNG without PIL; 4x4 supersampled.
# Keep in step with icons/icon.svg.   python3 tools/make-icons.py
import math, struct, zlib

BG = (0x10, 0x14, 0x18); CLOUD = (0xd3, 0xdb, 0xe4); RAIN = (0x5b, 0x9e, 0xe6)
CIRCLES = [(190, 270, 55), (268, 222, 82), (348, 260, 65)]
RECT = (190, 248, 348, 325)
DROPS = [((205, 368), (188, 420)), ((268, 368), (251, 420)), ((331, 368), (314, 420))]
DROP_R = 10

def seg_dist(x, y, a, b):
    (ax, ay), (bx, by) = a, b
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - ax - t * dx, y - ay - t * dy)

def color(x, y, r):
    cx = min(max(x, r), 512 - r); cy = min(max(y, r), 512 - r)
    if (x - cx) ** 2 + (y - cy) ** 2 > r * r: return None
    if any((x - a) ** 2 + (y - b) ** 2 <= c * c for a, b, c in CIRCLES) or (RECT[0] <= x <= RECT[2] and RECT[1] <= y <= RECT[3]):
        return CLOUD
    if any(seg_dist(x, y, a, b) <= DROP_R for a, b in DROPS): return RAIN
    return BG

def png(path, size, maskable=False):
    s = size / 512
    r = 0 if maskable else 112
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]; n = 0
            for sy in range(4):
                for sx in range(4):
                    c = color((px + (sx + .5) / 4) / s, (py + (sy + .5) / 4) / s, r)
                    if c: acc = [a + b for a, b in zip(acc, c)]; n += 1
            row += bytes(a // n if n else 0 for a in acc) + bytes([round(255 * n / 16)])
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

png('icons/icon-192.png', 192)
png('icons/icon-512.png', 512)
png('icons/icon-maskable-512.png', 512, maskable=True)

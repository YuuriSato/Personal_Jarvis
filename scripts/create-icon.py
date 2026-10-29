"""Generate the original geometric J mark as a Windows icon using only the stdlib."""
import math
from pathlib import Path
import struct
import zlib

size = 256
lines = [(148, 75, 148, 157), (148, 157, 137, 177), (137, 177, 112, 184),
         (112, 184, 88, 171), (88, 171, 82, 156), (117, 75, 168, 75)]


def distance(x, y, line):
    ax, ay, bx, by = line
    dx, dy = bx-ax, by-ay
    t = max(0, min(1, ((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)))
    return math.hypot(x-ax-t*dx, y-ay-t*dy)


data = bytearray()
for y in range(size):
    data.append(0)
    for x in range(size):
        radius = math.hypot(x-128, y-128)
        alpha = int(max(0, min(1, 120-radius))*255)
        glow = max(0, 1-abs(radius-106)/8)*.5
        ring = 101 < radius < 104 or 111 < radius < 113
        mark = min(distance(x, y, line) for line in lines)
        bright = max(0, min(1, 6-mark))
        intensity = max(bright, 0.75 if ring else glow*.25)
        data.extend((int(3+35*intensity), int(12+202*intensity), int(23+210*intensity), alpha))


def chunk(kind, value):
    return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind+value))


png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(data)) + chunk(b'IEND', b'')
root = Path(__file__).resolve().parents[1] / 'assets'
root.mkdir(exist_ok=True)
(root / 'icon.png').write_bytes(png)
ico = struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(png), 22) + png
(root / 'icon.ico').write_bytes(ico)

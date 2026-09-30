# -*- coding: utf-8 -*-
"""Generate tray.png / icon.png / icon.ico with pure stdlib (zlib + struct)."""
import struct
import zlib
from pathlib import Path

INDIGO = (83, 74, 183)
WHITE = (255, 255, 255)

PROJECT = Path(r"D:\text\electron-vue3-app")


def make_canvas(size, bg):
    return [[bg for _ in range(size)] for _ in range(size)]


def draw_e(px, size):
    """Draw a blocky letter E centered on the canvas."""
    scale = size // 32
    def rect(x0, y0, x1, y1):
        for y in range(y0 * scale, y1 * scale):
            for x in range(x0 * scale, x1 * scale):
                px[y][x] = WHITE

    # 32px design grid: E occupies x 6..26, y 4..28
    rect(6, 4, 13, 28)   # vertical bar
    rect(6, 4, 26, 11)   # top bar
    rect(6, 14, 24, 21)  # middle bar
    rect(6, 21, 26, 28)  # bottom bar


def write_png(path, px):
    size = len(px)
    raw = b"".join(
        b"\x00" + b"".join(bytes(channel) for channel in row) for row in px
    )

    def chunk(tag, data):
        payload = tag + data
        return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)
    print(f"wrote {path} ({len(png)} bytes)")


def write_ico(path, png_path):
    data = png_path.read_bytes()
    # 256px -> width/height byte = 0
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(data), 22)
    path.write_bytes(header + entry + data)
    print(f"wrote {path} ({22 + len(data)} bytes)")


def main():
    (PROJECT / "src" / "main" / "assets").mkdir(parents=True, exist_ok=True)

    out32 = make_canvas(32, INDIGO)
    draw_e(out32, 32)
    write_png(PROJECT / "src" / "main" / "assets" / "tray.png", out32)

    out256 = make_canvas(256, INDIGO)
    draw_e(out256, 256)
    icon_png = PROJECT / "build" / "icon.png"
    icon_png.parent.mkdir(parents=True, exist_ok=True)
    write_png(icon_png, out256)
    write_ico(PROJECT / "build" / "icon.ico", icon_png)


if __name__ == "__main__":
    main()

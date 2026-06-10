#!/usr/bin/env python3
"""
Optimizaciya foto rabot Andrey dlya veba.
- Konvertiruet HEIC -> JPEG
- Umen'shaet do max 1200px po dlinnoy storone
- Szimayet quality=80, progressive, optimize
"""

import os
import sys
from PIL import Image
from pillow_heif import register_heif_opener

register_heif_opener()

SOURCE_DIR = "from-andrey"
OUTPUT_DIR = "web"
MAX_SIZE = 1200
JPEG_QUALITY = 80

os.makedirs(OUTPUT_DIR, exist_ok=True)

files = sorted(os.listdir(SOURCE_DIR))
images = [f for f in files if f.lower().endswith((".jpg", ".jpeg", ".png", ".heic", ".webp"))]

print("Naydeno izobrazheniy: {}".format(len(images)))

ok_count = 0
err_count = 0

for fname in images:
    src_path = os.path.join(SOURCE_DIR, fname)
    name, _ = os.path.splitext(fname)
    out_name = "{}.jpg".format(name)
    out_path = os.path.join(OUTPUT_DIR, out_name)

    try:
        with Image.open(src_path) as img:
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            elif img.mode != "RGB":
                img = img.convert("RGB")

            img.thumbnail((MAX_SIZE, MAX_SIZE), Image.LANCZOS)

            img.save(
                out_path,
                format="JPEG",
                quality=JPEG_QUALITY,
                optimize=True,
                progressive=True
            )

        orig_size = os.path.getsize(src_path)
        new_size = os.path.getsize(out_path)
        reduction = (1 - new_size / orig_size) * 100
        print("[OK] {:40s} -> {:40s} {:7.1f} KB -> {:7.1f} KB ({:.0f}% men'she)".format(
            fname, out_name, orig_size/1024, new_size/1024, reduction))
        ok_count += 1

    except Exception as e:
        print("[ERR] {}: {}".format(fname, e))
        err_count += 1

print("\nGOTovo! Optimizirovanno: {}, Oshibok: {}. Papka: '{}'".format(ok_count, err_count, OUTPUT_DIR))

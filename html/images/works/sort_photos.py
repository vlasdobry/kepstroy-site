import os
import shutil

base_dir = os.path.dirname(os.path.abspath(__file__))
web_dir = os.path.join(base_dir, "web")

classifications = {
    "septiki": [
        "16393B64-C4CE-4750-AE05-0072A3FA82A0.jpg",
        "B2EC705D-2BAD-49BE-857C-E1B1434E151E.jpg",
        "B4CBCDC6-8B6E-40BB-A134-922385222AD3.jpg",
        "C13BE1F9-9DD6-4898-A553-45CF0F0A30B1.jpg",
        "D1B617F7-953E-4971-8891-EBF873073FE8.jpg",
        "FDDD9AC6-C12A-4926-B13D-CF411D414573.jpg",
        "IMG_0009.jpg",
        "IMG_0030.jpg",
        "IMG_0031.jpg",
        "IMG_0033.jpg",
        "IMG_0225.jpg",
        "IMG_0232.jpg",
        "IMG_0251.jpg",
        "IMG_0289.jpg",
        "IMG_0310.jpg",
        "IMG_0378.jpg",
        "IMG_0449.jpg",
        "IMG_1030.jpg",
        "IMG_1031.jpg",
        "IMG_1082.jpg",
        "IMG_5501.jpg",
        "IMG_5503.jpg",
        "IMG_0224.jpg",
    ],
    "kanalizaciya": [
        "4BBF0F31-79A2-4D30-B1ED-FA7383655503.jpg",
        "IMG_0084.jpg",
        "IMG_0223.jpg",
        "IMG_0246.jpg",
        "IMG_0303.jpg",
        "IMG_0408.jpg",
        "IMG_0422.jpg",
        "IMG_0432.jpg",
        "IMG_0447.jpg",
        "IMG_0450.jpg",
        "IMG_0451.jpg",
        "IMG_1187.jpg",
        "IMG_1188.jpg",
    ],
    "vodosnabzhenie": [
        "2CB88526-8E8C-4EB0-94D4-54843C418591.jpg",
        "483B0FF6-D7CE-42B8-B079-E58E22704853.jpg",
        "55CADBEC-22AB-47D0-9DAE-B337408D78D2.jpg",
        "A88D3ABD-4285-44B7-808E-B6D0A823FB45.jpg",
        "IMG_0083.jpg",
        "IMG_0086.jpg",
        "IMG_0087.jpg",
        "IMG_0231.jpg",
        "IMG_0340.jpg",
        "IMG_0407.jpg",
        "IMG_1036.jpg",
        "IMG_1039.jpg",
        "IMG_1053.jpg",
        "IMG_1069.jpg",
        "IMG_1130.jpg",
        "IMG_1230.jpg",
        "IMG_1231.jpg",
        "IMG_1235.jpg",
        "IMG_1280.jpg",
        "IMG_1282.jpg",
        "IMG_0336.jpg",
    ],
    "obshchie": [
        "98ED833F-6E38-4524-9F3A-F0547C5DAB6A.jpg",
        "IMG_0019.jpg",
        "IMG_0128.jpg",
        "IMG_0287.jpg",
        "IMG_0333.jpg",
        "IMG_0334.jpg",
        "IMG_0348.jpg",
        "IMG_0410.jpg",
        "IMG_0452.jpg",
        "IMG_0454.jpg",
        "IMG_1013 (2).jpg",
        "IMG_1085.jpg",
    ],
}

# Validate all classified files exist in web/
web_files = set(os.listdir(web_dir))
classified = set()
for cat, files in classifications.items():
    classified.update(files)

missing = classified - web_files
extra = web_files - classified

if missing:
    print("Missing files in web/:")
    for f in sorted(missing):
        print(f"  {f}")
if extra:
    print("Unclassified files in web/:")
    for f in sorted(extra):
        print(f"  {f}")

if missing or extra:
    print("\nFix classifications before proceeding.")
    exit(1)

# Move files
for category, files in classifications.items():
    dest_dir = os.path.join(base_dir, category)
    os.makedirs(dest_dir, exist_ok=True)
    for fname in files:
        src = os.path.join(web_dir, fname)
        dst = os.path.join(dest_dir, fname)
        shutil.move(src, dst)
        print(f"Moved: {fname} -> {category}/")

# Check if web/ is empty
remaining = os.listdir(web_dir)
if remaining:
    print(f"\nWarning: {len(remaining)} files remain in web/")
    for f in remaining:
        print(f"  {f}")
else:
    print("\nAll files sorted. web/ is empty.")

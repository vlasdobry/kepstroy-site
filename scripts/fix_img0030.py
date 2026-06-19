import os

base = r"D:\razrabotka-proektov-vs-code\krym-zemraboty\kepstroy-site\html"
count = 0
for root, dirs, files in os.walk(base):
    for f in files:
        if f.endswith(".html"):
            path = os.path.join(root, f)
            with open(path, "r", encoding="utf-8") as fh:
                content = fh.read()
            if "IMG_0030" in content:
                new_content = content.replace("IMG_0030", "IMG_0031")
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(new_content)
                rel = os.path.relpath(path, base)
                print(f"Fixed IMG_0030: {rel}")
                count += 1
print(f"\nTotal files fixed: {count}")

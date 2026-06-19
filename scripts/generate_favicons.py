import os
from PIL import Image

def generate_favicons():
    icon_path = r"D:\razrabotka-proektov-vs-code\krym-zemraboty\kepstroy-site\html\images\logo-icon.png"
    fav_dir = r"D:\razrabotka-proektov-vs-code\krym-zemraboty\kepstroy-site\html\images\favicon"
    
    if not os.path.exists(icon_path):
        print(f"Error: logo-icon.png not found at {icon_path}")
        return
        
    os.makedirs(fav_dir, exist_ok=True)
    img = Image.open(icon_path)
    
    # 1. favicon-16x16.png
    img.resize((16, 16), Image.Resampling.LANCZOS).save(os.path.join(fav_dir, "favicon-16x16.png"), "PNG")
    print("Saved favicon-16x16.png")
    
    # 2. favicon-32x32.png
    img.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(fav_dir, "favicon-32x32.png"), "PNG")
    print("Saved favicon-32x32.png")
    
    # 3. apple-touch-icon.png (180x180)
    img.resize((180, 180), Image.Resampling.LANCZOS).save(os.path.join(fav_dir, "apple-touch-icon.png"), "PNG")
    print("Saved apple-touch-icon.png")
    
    # 4. android-chrome-192x192.png
    img.resize((192, 192), Image.Resampling.LANCZOS).save(os.path.join(fav_dir, "android-chrome-192x192.png"), "PNG")
    print("Saved android-chrome-192x192.png")
    
    # 5. android-chrome-512x512.png
    img.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(fav_dir, "android-chrome-512x512.png"), "PNG")
    print("Saved android-chrome-512x512.png")
    
    # 6. favicon.ico (multi-size: 16x16, 32x32, 48x48)
    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    ico_imgs = [img.resize(size, Image.Resampling.LANCZOS) for size in ico_sizes]
    ico_imgs[0].save(os.path.join(fav_dir, "favicon.ico"), format="ICO", sizes=ico_sizes, append_images=ico_imgs[1:])
    print("Saved favicon.ico")

if __name__ == "__main__":
    generate_favicons()

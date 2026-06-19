import os
from PIL import Image

def crop_logo():
    img_path = r"C:\Users\user\.gemini\antigravity-cli\brain\40dfab13-de61-4add-9202-ae077ba9e215\kepstroy_logo_v4_1781883053766.jpg"
    out_dir = r"D:\razrabotka-proektov-vs-code\krym-zemraboty\kepstroy-site\html\images"
    
    if not os.path.exists(img_path):
        print(f"Error: Source image not found at {img_path}")
        return
        
    os.makedirs(out_dir, exist_ok=True)
    
    # Открываем изображение
    img = Image.open(img_path).convert("RGBA")
    width, height = img.size
    print(f"Source image loaded: {width}x{height}")
    
    # Находим границы эмблемы (в левой половине изображения)
    # Ищем пиксели, которые не являются белыми (белый: R>250, G>250, B>250)
    min_x, min_y = width, height
    max_x, max_y = 0, 0
    
    for y in range(height):
        for x in range(int(width * 0.33)): # только левая треть, чтобы не захватить текст
            r, g, b, a = img.getpixel((x, y))
            # Если пиксель не белый
            if r < 245 or g < 245 or b < 245:
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
                
    print(f"Detected emblem bounds: X:({min_x}..{max_x}), Y:({min_y}..{max_y})")
    
    # Делаем вырезаемый квадрат с небольшим отступом (padding)
    padding = 20
    emblem_w = max_x - min_x
    emblem_h = max_y - min_y
    
    # Центрируем квадрат вокруг эмблемы
    size = max(emblem_w, emblem_h) + padding * 2
    center_x = (min_x + max_x) // 2
    center_y = (min_y + max_y) // 2
    
    crop_x1 = max(0, center_x - size // 2)
    crop_y1 = max(0, center_y - size // 2)
    crop_x2 = min(width, crop_x1 + size)
    crop_y2 = min(height, crop_y1 + size)
    
    # Вырезаем эмблему
    emblem = img.crop((crop_x1, crop_y1, crop_x2, crop_y2))
    
    # Делаем белый фон прозрачным
    datas = emblem.getdata()
    newData = []
    for item in datas:
        # Если пиксель белый или очень близкий к белому, делаем его прозрачным
        if item[0] > 248 and item[1] > 248 and item[2] > 248:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)
    emblem.putdata(newData)
    
    # Сохраняем эмблему
    emblem_path = os.path.join(out_dir, "logo-icon.png")
    emblem.save(emblem_path, "PNG")
    print(f"Saved cropped emblem to {emblem_path}")
    
    # Сохраняем полное изображение (тоже делаем белый фон прозрачным)
    full_datas = img.getdata()
    newFullData = []
    for item in full_datas:
        if item[0] > 248 and item[1] > 248 and item[2] > 248:
            newFullData.append((255, 255, 255, 0))
        else:
            newFullData.append(item)
    img.putdata(newFullData)
    
    full_path = os.path.join(out_dir, "logo-full.png")
    img.save(full_path, "PNG")
    print(f"Saved full transparent logo to {full_path}")

if __name__ == "__main__":
    crop_logo()

import os
import re

def update_favicon_versions():
    base_dir = r"D:\razrabotka-proektov-vs-code\krym-zemraboty\kepstroy-site"
    html_dir = os.path.join(base_dir, "html")
    generators_dir = os.path.join(base_dir, "generators")
    
    # Регулярные выражения для поиска путей к фавиконам
    patterns = [
        (re.compile(r'href="([^"]*images/favicon/favicon\.ico)(?:\?v=\d+)??"'), r'href="\1?v=2"'),
        (re.compile(r'href="([^"]*images/favicon/favicon\.svg)(?:\?v=\d+)??"'), r'href="\1?v=2"'),
        (re.compile(r'href="([^"]*images/favicon/favicon-32x32\.png)(?:\?v=\d+)??"'), r'href="\1?v=2"'),
        (re.compile(r'href="([^"]*images/favicon/apple-touch-icon\.png)(?:\?v=\d+)??"'), r'href="\1?v=2"'),
    ]
    
    # Собираем все HTML файлы
    files_to_update = []
    
    # В папке html/
    for root, dirs, files in os.walk(html_dir):
        for file in files:
            if file.endswith(".html"):
                files_to_update.append(os.path.join(root, file))
                
    # В папке generators/
    for root, dirs, files in os.walk(generators_dir):
        for file in files:
            if file.endswith(".html"):
                files_to_update.append(os.path.join(root, file))
                
    print(f"Found {len(files_to_update)} HTML files to scan.")
    
    updated_count = 0
    for filepath in files_to_update:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
            
        new_content = content
        for pattern, replacement in patterns:
            new_content = pattern.sub(replacement, new_content)
            
        if new_content != content:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(new_content)
            relative_path = os.path.relpath(filepath, base_dir)
            print(f"Updated: {relative_path}")
            updated_count += 1
            
    print(f"Successfully updated favicon versions in {updated_count} files.")

if __name__ == "__main__":
    update_favicon_versions()

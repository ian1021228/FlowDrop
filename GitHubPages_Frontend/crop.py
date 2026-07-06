from PIL import Image
import os

img_path = '/Users/ianw/Desktop/程式/Flowdrop/Gemini_Generated_Image_x9ahkox9ahkox9ah.png'
out_dir = '/Users/ianw/.gemini/antigravity/scratch/AntigravityFlyDrop/public/assets'
os.makedirs(out_dir, exist_ok=True)

img = Image.open(img_path)
width, height = img.size

# Logo
logo = img.crop((100, 100, 1100, 350))
logo.save(os.path.join(out_dir, 'logo.png'))

# PWA Icon (approx top middle)
icon_512 = img.crop((1430, 90, 1750, 410))
icon_512 = icon_512.resize((512, 512))
icon_512.save(os.path.join(out_dir, 'icon-512.png'))

icon_192 = icon_512.resize((192, 192))
icon_192.save(os.path.join(out_dir, 'icon-192.png'))

# Favicon
favicon = icon_512.resize((32, 32))
favicon.save(os.path.join(out_dir, 'favicon.png'))

# Radar
radar = img.crop((1430, 520, 1780, 870))
radar.save(os.path.join(out_dir, 'radar.png'))

# Hero Visual
hero = img.crop((100, 450, 1350, 1200))
hero.save(os.path.join(out_dir, 'hero.png'))

print("Done cropping.")

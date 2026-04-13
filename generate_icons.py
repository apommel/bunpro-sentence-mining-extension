#!/usr/bin/env python3
"""Generate PNG icons for the extension."""
import os

# SVG template for the 文 icon
def make_svg(size):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#4f8ef7"/>
      <stop offset="100%" style="stop-color:#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="{size}" height="{size}" rx="{size*0.22:.1f}" fill="url(#g)"/>
  <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
        font-family="serif" font-weight="bold" fill="white"
        font-size="{size*0.58:.1f}">文</text>
</svg>"""

os.makedirs("icons", exist_ok=True)

for sz in [16, 48, 128]:
    svg = make_svg(sz)
    with open(f"icons/icon{sz}.svg", "w") as f:
        f.write(svg)
    print(f"Written icons/icon{sz}.svg")

# Try to convert with svg-convert or inkscape
for sz in [16, 48, 128]:
    svg_path = f"icons/icon{sz}.svg"
    png_path = f"icons/icon{sz}.png"
    
    # Try rsvg-convert
    ret = os.system(f"rsvg-convert -w {sz} -h {sz} {svg_path} -o {png_path} 2>/dev/null")
    if ret == 0:
        print(f"Generated PNG: {png_path} via rsvg-convert")
        continue
    
    # Try inkscape
    ret = os.system(f"inkscape --export-png={png_path} -w {sz} -h {sz} {svg_path} 2>/dev/null")
    if ret == 0:
        print(f"Generated PNG: {png_path} via inkscape")
        continue

    print(f"Could not convert {svg_path} to PNG")

print("Done.")

import json
from PIL import Image, ImageDraw

COLOR_HEX = {
    "Red": "#ba2828", "Blue": "#386b94", "Gold": "#cc9e33",
    "Green": "#296b47", "Purple": "#73529e", "Orange": "#d18040",
}

with open("src/data/generated-boards.json") as f:
    definitions = json.load(f)

for player_count, definition in definitions.items():
    img = Image.open(f"public/boards/board_{player_count}p.jpg").convert("RGB")
    w, h = img.size
    draw = ImageDraw.Draw(img)

    track = definition["trackWaypoints"]
    n = len(track)
    for i, (x, y) in enumerate(track):
        px, py = x * w, y * h
        # color gradient along path order: blue (start) -> red (end), so you can see direction/order
        t = i / max(n - 1, 1)
        fill = (int(255 * t), 40, int(255 * (1 - t)))
        draw.ellipse([px - 5, py - 5, px + 5, py + 5], fill=fill, outline="black")
        nx, ny = track[(i + 1) % n]
        draw.line([px, py, nx * w, ny * h], fill=fill, width=1)
    # mark the very first point distinctly
    sx, sy = track[0][0] * w, track[0][1] * h
    draw.ellipse([sx - 10, sy - 10, sx + 10, sy + 10], outline="lime", width=3)

    for lane in definition["playerLanes"]:
        color = COLOR_HEX[lane["color"]]
        for x, y in lane["yardWaypoints"]:
            px, py = x * w, y * h
            draw.ellipse([px - 10, py - 10, px + 10, py + 10], fill=color, outline="white", width=2)
        for x, y in lane["homeCorridorWaypoints"]:
            px, py = x * w, y * h
            draw.ellipse([px - 6, py - 6, px + 6, py + 6], fill=color, outline="black")

    img.resize((700, 700)).save(f"scripts/debug_{player_count}p.png")

print("done")

# Art pipeline

## Source files (`art/source/`)

From the team's "สำหรับ Dev" folder (original file names had odd extensions such as `.203Z`; they are real PNG/JPEG files):

| File | Original | Used as |
|---|---|---|
| `cover/background.jpg` | `หน้าปกเกม/พื้นหลังไม่มีปุ่ม` | Cover background → `public/assets/ui/cover-bg.png` (400×239 native) |
| `cover/cover-reference.jpg` | `หน้าปกเกม/หน้าปกเกมโดยร่วม` | Reference for button positions only |
| `cover/btn-start-1..3.png` | `ปุ่มเริ่ม/1..3` | START button (idle / hover / pressed) |
| `cover/btn-settings-1..3.png` | `ปุ่มตั้งค่า/1..3` | SETTINGS button |
| `cover/btn-howto-1..3.png` | `ปุ่ม How to play_/1..3` | HOW TO PLAY folder (closed → open) |
| `characters/student-frame-1..2.png` | previous `public/assets/character-left/right.png` | Two walk frames; recoloured into 6 characters |

`py tools/build_assets.py` finds the pixel grid in each export, samples one colour per art pixel and writes the small sprites into `public/assets/` together with `manifest.json`. The browser scales them up with `image-rendering: pixelated`, so they stay crisp at any size.

## Procreate (`art/procreate/`)

`pixel-brushes.brushlibrary` (newer) and `pixel-brushes-v1.brushlibrary` (older copy) are the team's Procreate pixel brushes. They are drawing tools for the artists, not game assets. Canvas sizes from the design document:

- 32×32 or 48×48 px: floor tiles, ground, walls, other props
- 50×50 or 64×64 px: characters, trees
- 400×240 px: backgrounds (the cover background is exactly this size)

New art drawn at these sizes can be exported at any scale; re-run the build script to regenerate the game sprites.

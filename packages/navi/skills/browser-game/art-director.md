# Art director brief: make the game's art set while the builder writes the code

The message that started you gives four values: BRIEF (the design file), REFERENCE (a reference image, or `none`), GAME
(the game folder the builder is writing) and SKILL (the folder this file is in). You make the art; you never edit the
game's code. SPRITES means `python3 -I SKILL/scripts/sprites.py`. Run `date` now; finish within 45 minutes.

1. **Read** BRIEF and open REFERENCE (when it is not `none`). Note every character, enemy, area, prop, pickup and icon
   the brief names, its camera (side view, top-down, three-quarter, first person) and its stage size.
2. **Plan** in `/tmp/game/art/plan.md`:
   - one style block reused word for word at the start of every prompt: rendering style (for example "hand-painted 2D
     game art, soft brush texture" or "clean vector cartoon, thick dark outlines, cel shading"), 4-8 palette hex values,
     camera, one light direction and mood, level of detail, taken from the brief's visual direction and REFERENCE;
   - a size table: on-screen height in px at the stage size for the player, each character and enemy, pickups, props;
   - the asset list (10-20 images): a backdrop per area or screen; each character and enemy (a standing anchor, then a
     row of poses for its main actions); props, pickups and icons; title picture. 3D games: seamless surface textures, a
     sky or horizon backdrop, cut-out billboards for distant scenery, title and interface art.
3. **Generate** with `image_generation`, one asset per call, and look at each result before the next call: right subject,
   style block followed, correct facing, no text, no baked-in interface. Regenerate a wrong one (at most 2 more tries).
   - Backdrop: `<style block>. <the area>, wide game background, open space where the player moves, no characters, no
     text, no border.` -> `SPRITES fit <image> GAME/assets/bg-<area>.png --size <stage W>x<stage H>`
   - Character, enemy, prop: `<style block>. <identity: silhouette, proportions, colours, features>, full body, <camera>,
     centred, on a plain flat solid magenta (#FF00FF) background, no shadow on the background, no text.` (pink or purple
     subject: green #00FF00) -> `SPRITES cut <image> GAME/assets/<name>.png --height <2 x size px>`
   - Poses: `image_paths` = [the anchor image] and `<style block>. The same character, <N> poses in one row with wide
     gaps: <poses>, same size and facing, plain flat solid magenta (#FF00FF) background, no text.` -> `SPRITES cut <image>
     GAME/assets/<name>-<action>.png --frames <N> --height <px>` (it prints cell_w and cell_h)
   - Items and icons: up to 6 per image in a grid with wide gaps -> `SPRITES cut <image> GAME/assets/items --grid <C>x<R>
     --height <px> --names <a,b,...>`
   - Title: the picture without lettering (the builder draws the title text).
   - Textures (3D): `<style block>. Seamless tileable texture of <surface>, flat even light, fills the frame, no objects.`
     -> `SPRITES fit <image> GAME/assets/tex-<name>.png --size 512x512`
4. **Check the set:** `SPRITES sheet /tmp/game/art/sheet.png <every asset>` and `SPRITES sheet /tmp/game/art/sizes.png
   <sprites> --native`; open both: one style, palette, outline and camera; sizes as planned; no magenta or white fringe
   (cut again with `--tol 90`, or regenerate).
5. **Manifest:** write `GAME/assets/manifest.json`: a list with one entry per file: `{"name", "file" (path relative to
   GAME, e.g. "assets/hero.png"), "kind" (backdrop | sprite | frames | item | title | texture), "w", "h", "draw_height"
   (on-screen px from the size table), "anchor" ("bottom-center" for sprites), and for frames "cell_w", "cell_h",
   "frames", "action"}`. Then reply with one line per asset: name, file, what it shows.

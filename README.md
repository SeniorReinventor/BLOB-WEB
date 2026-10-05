# Self-recursing semantic system

A voxel blob that breathes, takes in streams of data, and settles step by step into a striped cube. The cube then becomes one block of the next cycle.

## Run

ES modules don't load from `file://`, so serve the folder:

```sh
python3 -m http.server 8123
```

Then open http://127.0.0.1:8123. There's no build step or install. three.js r186 is vendored in `vendor/three/`, and only the two web fonts load from Google Fonts. If they can't load, it falls back to system fonts.

## Controls

- Click or tap: draw a data stream from the pointer into the form
- Drag: turn the form
- `F` or the Stream data button: open a stream from the screen edge
- `Space`: pause, `R`: restart
- `?at=30` starts 30 seconds into the cycle; add `&freeze` to hold that frame

## Where things live

| File | What it does |
| --- | --- |
| `src/sim.js` | Timeline (waves, holds, formed, recursion, melt), data streams and their packets, ripples, and the `shapeAt(L)` curve that maps learning → shape |
| `src/field.js` | ~30k instanced cubes; the vertex shader evaluates the blob's SDF per cube |
| `src/blocks.js` | Free-moving cubes: the data streams, and the block that carries the form into the next cycle |
| `src/shadow.js` | Dithered floor shadow |
| `src/palette.js` | The yellow → red ramp shared by shaders and the HUD |
| `src/hud.js` | Stage text, 48-signal meter |

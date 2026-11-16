# enzo_voxel

![Enzo's day: a yellow biplane over the islands](docs/enzo.png)

**Enzo's day** is a pixel-art flying game. You fly a 1920s biplane over Lake Como–style islands with villas, forests, docks, classic yachts, fish and whales. You can land as a man in a boater hat, walk around, and take a sailboat out.

Everything is drawn by a small software renderer in the browser, with no 3D engine. The ground and clouds are drawn on the graphics card (WebGL2) when the browser allows it, and on the CPU otherwise.

## Run

```
npm install
npm run dev
```

To draw everything on the CPU instead, add `?cpu` to the address, for example `http://localhost:5173/?cpu`.

## Play

| Key | Flying | On foot | In a boat |
| --- | --- | --- | --- |
| W / S | Dive / climb | Walk | Sail / stop |
| A / D | Turn | Turn | Turn |
| Shift or hold click | Throttle and smoke | | |
| Click | Barrel roll | | |
| B | Drop bombs | | |
| V | Become the man | Back to the plane | Back to the plane |
| E | | Board the nearest boat | Step ashore |
| Space | Overhead, chase, cockpit | Overhead or first person | Isometric or first person |

How it all works is in [GAME.md](GAME.md).

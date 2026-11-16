# Enzo

Notes for picking this project up later. The flight, the islands, and the pixel look started as a remix of https://remix.ui8.ai/fly (Forge share, remix enabled), which flew a fighter jet. Here it became Enzo: a 1920s biplane (yellow wings, blue fuselage, radial engine) over Lake Como–style islands, with houses, bombs, a person, boats, docks, sea life, and wind added. The code still calls the plane "the jet" (`jets`, `drawJet`, `jet-model.ts`, `FighterJetScene`).

There is no 3D engine and no polygon mesh. One software renderer paints a low-resolution buffer. The page scales that buffer with `image-rendering: pixelated`.

## Run

```
npm install
npm run dev
npm run build
```

Vite 7, React 19, Tailwind 4. Entry is `src/main.jsx`. It mounts `FighterJetScene` with the saved demo values (speed 74, seed 7, land 0.33, overhead view). The page title is "Enzo". `src/index.css` only makes the page fill the window on `#2468b4`.

React StrictMode runs the canvas effect twice. `FighterJetScene` must call `scene.resize` when `scene.width` / `scene.height` do not match the buffer, not only when the canvas element changes size. The frame is copied with `image.data.set(bytes)` rather than sharing the buffer.

## Files

| File | What it is |
| --- | --- |
| `src/main.jsx` | Mounts the scene with the demo parameters. |
| `src/FighterJetScene.jsx` | Keys, pointer, touch buttons, hint text, the animation loop. |
| `src/lib/scene.ts` | World, simulation, sprite-stack renderer, villas, yachts, fish and whales, person, bombs. |
| `src/lib/jet-model.ts` | The biplane, built in code by `decodeJet()` as 14 slices of 44 across × 34 along. Palette families: body (blue), accent (yellow wings), metal, and fixed colours. |
| `src/lib/cockpit.ts` | The open biplane cockpit, painted once as three depth layers, then shifted each frame with the pilot’s head. Gauges, propeller and stick are drawn live. |
| `src/lib/flame-layer.ts` | WebGL canvas over the pixels for jet afterburners. The biplane has no flames, so it now draws nothing. |
| `src/lib/log.ts` | `Log` ring buffer. The page exposes it as `gameLog`. |

`createScene(initial)` in `scene.ts` owns almost all game state. The React component reads `scene.onFoot`, `scene.aboard`, `scene.footView`, and `scene.view`, and calls the methods at the bottom of `createScene`.

## How a frame is drawn

`step(dt)` moves the world. `render()` draws it. Order inside `render`:

1. `updateView` — camera pose.
2. `drawWorld` — ground columns and clouds, near pixels win.
3. `drawSky` — skipped in a flat overhead view.
4. Trails, smoke, bombs, fish and whales, boats, the walking figure, jets far to near, blast sparks.
5. If the view is rolled (cockpit, or a barrel roll), all of that was drawn on a square sheet and is then rotated into the frame. The cockpit layers go on last.
6. `flames` is returned for the WebGL overlay. Its count is always 0 now.

The ground is a height map. Each cell is a stack of pixels: the side color fills the column, the top color caps it. Clouds are a second stack at a fixed altitude. The plane is the same idea: horizontal slices from the wheels to the top of the fin, rotated to yaw, pitch, and roll.

Depth is a z-buffer of “how far along the view axis,” not a GPU buffer. A pixel that is already nearer is left alone.

Projection, used everywhere (`project` and the jet slices):

- `scale = vS / (1 + vQ * depth)`
- screen x = `vCx + scale * across`
- screen y = `vCy - scale * (height + vTan * depth)`

`vQ = 0` is an orthographic overhead view (no perspective). `vC` is how much of the chase camera is blended in, `vK` how much of the cockpit. Both at 0 is the flat map. `drawSky` returns immediately in that case, which is why the overhead picture is only land, water, and clouds.

The buffer is small. `pixelSize` (3 in `main.jsx`) divides the window into that many CSS pixels per game pixel.

## Views

Three flight views, cycled with Space while flying. `viewTarget` 0 overhead, 1 chase, 2 cockpit. The camera eases between them (`transition`, default 1.4).

- Overhead: `vQ = 0`, `vS = 1`, camera above the jet, heading up the screen. No horizon.
- Chase: behind and above, distance from `chaseDistance`, look-down angle from `chaseAngle`, jet size on screen from `chaseSize`. The camera yaws a little late. It will not sit inside a hill, and it stays under the cloud layer while the jet is low and above it when the jet is high.
- Cockpit: at the pilot’s eyes, `COCKPIT_EYE` above the model, looking `COCKPIT_LOOK` (64) ahead. The world is drawn on the roll sheet. Head sway moves the cockpit layers by different amounts. See "Propeller, smoke, bumps, cockpit".

While walking, Space does not change the jet’s view. It toggles the person between a close overhead camera and first person. See the person section.

Click (pointer down and up in under 0.2s) barrel-rolls the plane. Holding the pointer, or Shift, opens the throttle and trails display smoke. A roll does not happen on foot.

## Controls

`FighterJetScene` keeps the keys that are down and calls `setKeys`, `setWalk`, `setBomb`.

| Key | Flying | On foot, walking | On foot, in a boat |
| --- | --- | --- | --- |
| W / Up | Dive | Walk forward | Start sailing. Stays on after release. |
| S / Down | Climb | Walk back | Stop. Stays stopped. |
| A / Left, D / Right | Turn | Turn | Turn, sailing or not |
| Shift | Throttle and smoke | — | — |
| B or F | Drop bombs while held | — | — |
| V | Become the person | Back to the jet | Back to the jet. The boat stays as it is. |
| E | — | Board the nearest boat within 48 | Step ashore if land is within 28 |
| Space | Next flight view | Overhead ↔ first person | Isometric aerial ↔ first person |
| Click | Roll if short, throttle if held | — | — |
| Pointer | Steers until a key is used | Ignored | Ignored |

Pitch is inverted only for the jet, and only in `sendKeys`: Up subtracts from climb, Down adds. Walking uses the same keys with the natural sign (Up adds to move). Do not reuse the flight sign for the person.

On a coarse pointer, or `touchControls="on"`, on-screen buttons cover View, Boost, and Bomb. There is no on-screen Walk or Board button. Ctrl is not a game key. B is the bomb key.

Hint text at the bottom follows the mode. While sailing it says W starts, S stops, and that downwind is faster.

## Parameters

`DEFAULT_PARAMS` in `scene.ts` is the fallback. `main.jsx` overrides many of them. `setParams` copies the next object. Changing `seed` or `land` rebuilds the world after 0.2s and, for a new seed, moves the jet to the new spawn. A rebuild clears bombs and, if the player is on foot, puts them on the nearest standable ground and off any boat.

| Param | In the demo | Meaning |
| --- | --- | --- |
| `speed` | 74 | Plane cruise before wind and throttle, world units per second. |
| `boost` | 1.8 | Speed multiplier at full throttle. Clamped 1–4. |
| `agility` | 1.25 | Max yaw rate, rad/s. |
| `bank` | 52 | How far the jet rolls in a turn. |
| `altitude` | 110 | Height the jet is steered toward. |
| `ceiling` | 300 | Highest it may go. |
| `clearance` | 7 | How far above the ground ahead it stays. |
| `wingmen` | 0 | Extra jets in formation. |
| `followPointer` | true | Pointer steers when the keys are not. |
| `stunts` | true | Allows the autopilot’s occasional stunts and the click-roll. |
| `jetScale` | 0.6 | Model scale. |
| `spread` | 1 | Vertical gap between jet slices. |
| `intro` | false | Spawn fly-in. Off in the demo, so play starts immediately. |
| `view` | `top` | `top`, `chase`, or `cockpit`. |
| `transition` | 1.4 | How fast the camera blends between flight views. |
| `cameraFollow` | 0.6 | How tightly the chase point follows the jet. |
| `chaseDistance` | 2.6 | Chase camera distance, in jet lengths. |
| `chaseAngle` | 12 | Chase look-down, degrees. |
| `chaseSize` | 0.19 | How large the jet is in the chase frame. |
| `timeOfDay` | `day` | `day`, `sunset`, `night`. Recolors sky, sun, terrain grades. |
| `land` | 0.33 | Fraction of the map above water. |
| `clouds` | 0.45 | How many of the generated cloud clusters are visible. |
| `seed` | 7 | World seed, including wind direction. |
| `shadow` | true | Jet shadow on the ground. |
| `flameStyle`, `afterburner` | `realistic`, 1 | Left from the jet. The biplane has no flames, so they change nothing. |
| `trails` | true | Wingtip trails. |
| `bodyColor`, `accentColor`, `canopyColor` | `#3254a0`, `#f6c022`, `#9ca2ac` | Recolor the plane's palette families: fuselage blue, wing yellow, metal (cowling, struts, engine). |

`pixelSize`, `showHint`, and `touchControls` are React props, not scene params.

## World

The map is `N = 2048` and wraps. Index of `(x, y)` is `(y << 11) | x`, masked with `2047`. Clouds are a separate 1024 map and also wrap.

`buildWorld` runs once at startup and again when seed or land changes.

1. Value noise, octaves from cell size 512 down to 16, then normalized.
2. Sea level is chosen so about `land` of the cells are above water (demo 33%). A thin band above that is sand. Higher ground is terraced: grass in steps of 2, then rock, then snow in steps of 3. Slope picks the lit or shaded material.
3. `floorMap` copies `heightMap` here, before trees. Walking uses it under the canopy.
4. Forests: every 5 cells, on grass, one tree of three kinds. `TREE_KINDS` lists each kind's [trunk, leaves, leaf edge] materials. The center (distance under 1.1) is the trunk, mid leaves the second, the edge the third. Trees overlap, so a forest is mostly those cells. Trees raise `heightMap` but not `floorMap`.
   - Leafy (9–11): a cone of radius 2 or 3. The common kind, anywhere.
   - Fir (37–39): radius 1.7, tall and narrow, a darker blue-green. Groves on high ground (`h0 >= 8`), a few lower down.
   - Round crown (40–42): radius 2.4 or 3, a broad dome taller than the cone, with a cell here and there one higher for clumps of leaves. The same greens as the leafy tree. Groves on low slopes (`h0 <= 6`).

   A grove is a patch of about 32 cells sharing one hash (`grove`), so kinds come in stands. One tree in 8 is a stray leafy tree in any grove.
5. Spawn is open water (material 0–2) with some land within 120, not surrounded by it.
6. Villages, then docks, then free boats.
7. About 200 cloud streaks on the 1024 map. Each cell stores a rank and a thickness. `clouds` shows ranks below a cutoff, so the slider adds or removes whole clouds. They drift slowly (`time * 7` on the cloud map). Clouds sit at `CLOUD_ALT` (40) and stack up to 8 (`CK`). `ZTOP` is 48.

Height of drawn columns is capped by `HMAX` (40). The jet’s clearance looks at the ground ahead, including trees and houses.

## Materials

`MAT_TOP` is the cap color, `MAT_SIDE` the wall. `NMAT` is the length. Adding a material means adding both colors or the palette shifts.

| Index | Material |
| --- | --- |
| 0–3 | Deep, mid, shallow, surf. All count as water. |
| 4–5 | Sand, sand speck. |
| 6–8 | Grass, dark, light. |
| 9–11 | Trunk, leaves, leaf edge. |
| 12–14 | Rock, dark, light. |
| 15–16 | Snow, snow shade. |
| 17–19 | Stucco wall: ochre, cream, salmon. The top colour is the terracotta eave. |
| 20–22 | Roof: hip lines, shaded slope (east, south), sunny slope (west, north). |
| 23–24 | Rubble, scorch. |
| 25–26 | Dock plank, dock plank dark. |
| 27 | Stucco wall, pale yellow. |
| 28–31 | The four walls again, each with a column of shuttered windows. |
| 32–33 | Bell tower wall, tower cap. |
| 34 | Cypress. |
| 35 | Balustrade. |
| 36 | Topiary. |
| 37–39 | Fir: trunk, needles, edge. |
| 40–42 | Round-crowned tree: trunk, leaves, edge. |

Trees of every kind go through `isTree(m)` and `isTrunk(m)` (built from `TREE_KINDS`), not through index ranges. Houses avoid them, yards clear them, bombs scorch them, `standable` rejects trunks, `walkFloor` reads `floorMap` under them, and docks do not pave over trunks. A new tree kind needs an entry in `TREE_KINDS` and colours in both palettes.

Water is anything `< 4`. The person and the boats treat `>= 4` as solid. `isBuilt(m)` is walls, roofs and towers (17–22, 27–33): not walkable, and a bomb knocks them down to the house's floor. `WALLS[i]` and `WINDOWED[i]` pair a wall colour with its windowed version.

## Houses and bombs

Villages prefer grass near water, with a cluster near the spawn coast so there is something to bomb at once. The look is a lake-shore Italian village: stucco walls in ochre, cream, salmon or pale yellow, terracotta hip roofs, green shutters, cypresses. `stampHouse` makes one of two kinds:

- **Villa** (40%): 9–11 by 10–13, 2 or 3 floors, a 3-cell yard. The outer ring is a stone balustrade (35) with gaps for gates, then garden, then a gravel walk against the walls. About half get a 3 by 3 bell tower (32) at one corner, 4 above the eaves, with a cap (33).
- **Townhouse**: 6–8 by 7–9, 2 floors, a 2-cell yard of gravel and garden.

Wall height is `floors * FLOOR_H` (2.5) above the floor. Edge cells are the wall colour, and every other non-corner edge cell uses the windowed version (28–31). The interior is a hip roof: height rises with the distance in from the edge, cells on a hip line (two sides tie) are 20, west and north faces 22 (sunny), east and south faces 21 (shaded). Gardens get 2–4 cypresses (34, 7–10 tall) and 1–3 topiary domes (36). Trees in the yard are cleared. `houseMap` stores the house id on footprint cells. `houses[]` keeps `{x, y, w, d, base, alive}`.

Shutters are not cells. `drawWorld` paints them while it fills a wall column of a windowed material: it recovers the height of each pixel row from the previous depth step's `R` and `m` (`Rp`, `mp`) and draws a band of `shutterLit` or `shutterShade` for 1.3 of every 2.5 units of height, so each floor shows one row of windows in every view.

Bombs come from the jet only. B held calls `dropBomb` every 0.38s, up to 18 in the air. A bomb inherits some of the jet’s horizontal speed, starts a little under the jet, and falls (gravity 95, terminal about 220). It explodes at the ground.

- On land the radius is 12. On water it is 6.
- Any house touched is wrecked once: footprint becomes rubble (23) and scorch (24), one cell tall above the old floor. The yard around it scorches.
- Other land in the inner blast is cratered (height drops, scorch or rubble). Grass, trees, cypresses and topiary in the outer part scorch.
- Sparks and smoke. Water explosions are smaller and shorter.

The person cannot drop bombs. `setBomb(false)` is forced while on foot.

## Person

V calls `toggleFoot`. The jet is left on autopilot (`keyMode` off, no bomb, no boost). The person is placed on standable ground within 480 of the jet. Islands under 2000 cells are skipped, the same specks that get no dock. If that search misses, the nearest pier is used. If there is no pier either, the nearest large island is used. Stepping ashore from a boat can still use a small island. Pressing V again returns to the jet and leaves the boat where it is.

The figure is `PERSON`: boxes of surface voxels (`PERSON_G` 0.25) with normals, in boat units (across, forward, up), drawn by the boat rasterizer. About 5.5 tall: shoes, navy trousers, a white shirt with navy stripes, light brown hair, and a straw boater with a dark band. Its materials are boat materials 24–31 (`YM_SKIN` … `YM_BAND`). Each voxel has a part (body, left and right leg, left and right arm). While `walkMove` is not 0, legs swing about the hip (`PERSON_HIP`) and arms about the shoulder (`PERSON_SHOULDER`), and the body lifts a little each step. `walkerShadow` darkens a small ellipse on the ground under him, offset away from the sun, only on pixels at his own depth.

Walking speed is 20. Turn rate is 2.1 rad/s. Forward is the same axis as the jet, `(sin(yaw), -cos(yaw))`.

`standable` rejects water, house cells, tree trunks of any kind (`isTrunk`), cypresses (34), and anything `isBuilt`. Leaves, sand, grass, rock, snow, gravel, garden, balustrade, topiary and dock planks are allowed. `canStep` also rejects a step up greater than 4. Down is free. `walkFloor` returns `floorMap` on trunk and leaf cells, otherwise `heightMap`, so the person stands on the ground under the trees and the close camera does not climb onto the canopy.

Cameras while walking (`footView` 0 overhead, 1 first):

- Overhead: 9 behind, 12 above the feet, capped under `CLOUD_ALT - 8`, `vS` 16, a little perspective.
- First: eyes 4.5 above the feet, `vQ` 1/26, `vS` 24, shallow look-down. That is a long lens: the true eye point is 26 behind the camera point.

Both use `vYaw = -walker.yaw`, so forward is up the screen in the overhead view and into the picture in first person.

## Docks

After houses, `placeDocks` runs.

The ocean is the single largest connected water body (4-connected, wrapping). Every smaller body is a lake or a pond inside land and is ignored. That is what keeps docks off internal water.

Each island of at least 2000 land cells can get up to 5 docks, at least 340 apart. Smaller islands, including specks and sandbars, get none. A candidate shore cell is sand or grass touching that ocean. The pier direction is not a compass step. It is the average direction from the shore toward nearby ocean. If that average is weak (a point, a tight cove, water on several sides), the site is skipped, because the pier would not sit square to the beach.

The water straight out for 18 cells must stay ocean, and it must be wide at the outer end (open to both sides). Creeks and lagoon mouths fail that test.

The pier is about 3 planks wide and runs along that normal, from a couple of cells on the beach to about 11 out. Wood is materials 25 and 26. Cells over water are height 1. Cells that were already land keep their height so the deck meets the beach. Houses and trunks are not paved.

A moored sloop lies alongside the pier, about 8.6 out and 3.2 to one side, heading out to sea (`yaw = atan2(dx, -dy)` so forward matches the normal). The side is the first one where the water is clear for the whole hull length. If neither side fits, it lies 16 out past the end. `moored` boats are not driven by the free-boat AI.

If a berth has no boat within 26 and the player is more than 48 from it, a new moored sloop is put back. Checked about every 0.6s. Skipped once there are more than `docks.length + 14` boats.

## Boats

The boats are 1920s classic yachts: long overhangs, a counter stern with a transom, white or dark hulls, cream sails. Three models in `YACHTS`, same across / forward / up units as the person:

| kind | Model | Length | Rig |
| --- | --- | --- | --- |
| 0 | Gaff sloop | 9 | One gaff mainsail, one jib. Used at every dock. |
| 1 | Ketch | 12 | Tall Bermuda main and a smaller mizzen aft, one jib. |
| 2 | Schooner | 15 | Three gaff masts with topsails, a long bowsprit, two jibs. |

Each entry gives beam, freeboard, sheer, transom, deckhouse, cockpit, bowsprit, masts (position, height, boom, gaff, topsail) and jibs. Hull colour is per boat (`HULL_PICK`: mostly white, then navy, green, varnished, black). Free boats are 35% sloops, 35% ketches, 30% schooners.

The hull is built once per kind and level of detail by `buildYacht` (`yachtModel(kind, lod)`, voxel sizes in `YACHT_LOD`: 0.5, 0.25, 0.125, and 0.0625 only for the boat you sit in, in first person). It is a shell of voxels with normals: boot-top and cove stripe, toe-rail, planked deck, deckhouse with windows, cockpit. The rig is rebuilt each frame by `buildRig` because it moves: masts, booms and gaffs, sails as curved patches (`rigSail`, with a belly), shrouds, and a pennant at the masthead that streams downwind. At voxel size 0.125 and finer, sails show a cloth seam every 0.9 of height (material 12). Your own boat's pennant is blue and larger. `RIG_MAX` (90000) caps the rig voxels.

`trimSails` runs in `stepBoats` and eases three values per boat:

- `sail`: 1 hoisted while under way, 0 furled (a bundle on the boom) while moored or stopped.
- `boom`: swung out to leeward (`rel = windYaw - yaw`, side `sign(sin rel)`), further the more the wind is from behind. Crossing the wind swings it over, so gybes animate.
- `heel`: leans away from the wind, most on a beam reach.

**The boat you are in.** E boards within 48 and sets `moored` so it holds still. W sets `sailing` and clears `moored`. Letting go of W does not stop it. S clears `sailing`. It does not drift when stopped. A/D turn at 1.15 rad/s even while stopped, so it can be aimed first. Under way:

```
speed = 12 * (1 + 0.42 * windAlong(yaw))
```

That is about 7 straight into the wind and about 17 with the wind. The next step must be water or the boat stays put until it is turned. E ashore needs standable land within 28 and clears `sailing`.

Overhead while aboard is not the close walking camera. It is isometric: no perspective (`vQ = 0`, `vC = 0`, `vK = 0`), `vS = 4`, camera on the boat at sea level, looking down at about 32° (`vTan = BOAT_ISO_TAN`, 0.62: height to depth on screen is 1 : vTan) from a fixed diagonal (`vYaw = BOAT_ISO_YAW`, π/4). The world does not turn with the boat: map cells stay diamonds and the boat turns on the screen. At that shallow angle a cloud would sit over the boat, so `drawWorld` opens a round hole in the clouds around it (`holeR`, 27 × `vS`, its outer 40% dithered with `BAYER4` so it reads as thinning cloud). Cloud shadows on the water stay. The person is not drawn in that view. The blue pennant marks the boat you are in. The figure is not drawn in first person either, because `drawWalker` only runs for the walking overhead.

First person aboard (Space) is a seat at the forward end of the cockpit (`yachtEyeF`: cockpit end minus 0.3), `YACHT_EYE` (2.4) over the deck, rising and falling with the boat's own bob. It does not use the walking camera's long lens. Like the plane's cockpit, it is a true wide lens: the camera point is `BOAT_LOOK` (4) ahead of the eye, `vQ = 1 / BOAT_LOOK`, focal length `0.45 * max(W, H)`, no look-down, horizon at `0.34 H`. The boat you sit in then fills the bottom of the picture as it would: the cabin top and varnished trim close below, the mast and stays ahead, the sail on the leeward side with its seams, the foredeck and bow beyond. Everything of your own boat more than 0.5 behind the eye is cut (`yCut`), and so is the wake behind it. Your boat also writes `zbuf` in this view (`yZW`), so the plane does not show through the sail.

Once you are sailing in first person, the rig turns see-through so it does not hide the view. `rigGhost` eases from 0 to 1 (rate 1.6/s) while `sailing && footView === 1`, and back when you stop. Each rig voxel carries a tag in `rigT`, set by `rigVox` / `rigSail`: 0 never fades (masts, spars, the two-voxel edges of each sail), 1 sail cloth, 2 rope and sail seams. `rasterVox` drops pixels against a 4×4 Bayer pattern (`BAYER4`), keeping `1 - 1.1 * rigGhost` of the cloth (none at the end) and `1 - 0.6 * rigGhost` of rope and seams. Only the boat you sit in, only in first person (`yFadeT` is set just for that rig pass and cleared in `voxBegin`).

**Free boats.** After the dock boats, about 8 more are scattered along coasts, at least 70 apart, in water with some land nearby but not in a tight cove. Speed is 5.2–8.4. Each frame they look 16 ahead and to either side and steer off land. They bob, pitch and heel. A wake (two V arms and a stern wash) is drawn while moving. The boarded boat and any `moored` boat are skipped by this AI.

## Fish and whales

Both are flat shapes on the water, drawn from above rather than as tall stacks, so the overhead views read them as something just under the surface. Scale is the person’s. The figure stacks to about 8 and spans about 4.5 across the arms. A fish is about 5 to 7 long, shorter than that figure. A whale is about 14 to 17 long and a sixth of that across, a few times a person and still a small mark on the map.

Eight schools of 4 or 5 fish. Three of those schools start within a few hundred of the jet’s spawn; the rest are scattered in water that is not the surf line. A school shares a kind (`FISH_KIND`): mackerel (blue-green back with dark bars), yellowtail (yellow side stripe), or coral snapper. Members follow the lead fish’s heading and drift back if they stray past 20. They swim at about 8 to 12 and turn off land. Each fish is a spindle body with a forked tail and pectoral fins, the body bends in a swimming wave, eyes show when close, and a silver flash shows now and then.

Three whales, in the deepest water only (material 0), at least 480 apart. One starts a few hundred from spawn. They cruise at about 3 to 5 and turn gently toward deeper water. Nothing hunts them and they do not interact with boats or the person. They are humpbacks: dark back, pale scalloped flippers, knobs on the head, scars, notched flukes. Each runs a 17 s cycle (`WHALE_CYCLE`, `whaleState`): it surfaces over 1.4 s and stays up about 5 s with a foam ring, a blow of spray drifting downwind, and its back humped above the water, then dives with the flukes raised clear of the water, then cruises under the surface.

Fish and whale bodies are flat shapes under the surface, drawn with `rasterFlat`: for each screen pixel it finds the world point on the water plane and asks a shape function for the colour, blended with the water by depth (`flatSub`). That keeps them crisp at any zoom in every view. The parts above the water (the back hump, the raised flukes) are voxels drawn with the boat rasterizer.

`placeLife` runs at the end of `buildWorld`, so a new seed replaces them. `stepLife` moves them. `drawSeaLife` runs just before the boats.

## Wind

One direction for the whole map, from the seed:

```
windYaw = (seed * 2.399) mod 2π
windAlong(yaw) = sin(yaw) * sin(windYaw) + cos(yaw) * cos(windYaw)
```

That is the dot product of the shared forward axis with the wind. `1` is downwind, `-1` is upwind, `0` is a crosswind.

The plane uses the same function on its cruise speed, then the throttle:

```
speed = params.speed * (1 + 0.26 * windAlong(yaw)) * (1 + (boostAmount - 1) * thrust)
```

Headwind is about three quarters speed, tailwind about a quarter faster. The plane does not start or stop. Thrust eases in while Shift or a long press is held, and eases out after.

## Jet simulation

Only while not on foot does the player steer. On foot, `step` still flies the lead jet: it holds altitude, follows its own heading, and does not take keys.

The lead jet’s forward speed is the wind-adjusted value above. Yaw rate eases toward the key or the pointer, capped by `agility`. Pitch eases toward the key climb or the pointer. Altitude eases toward `altitude`, never below the ground ahead plus `clearance`, never above `ceiling`. Bank follows the turn.

Wingmen, if `wingmen` > 0, follow in a spread. Trails are a ring buffer of 160 samples. Smoke is 96 puffs. Both are cosmetic.

`makeJet` stores position, yaw, pitch, roll, velocity, a trail, stunt state, the bump springs (`jolt*`), and `propAngle`. Slices are decoded once into per-slice lists of across, along, and palette index.

**The model** (`jet-model.ts`) is a Stearman-like biplane built in code, not stored data. `JET_W` 44 across, `JET_L` 34 along (k, nose at 0), `JET_H` 14 slices up (y). Lower wing at y 3, upper wing at y 10, both with rounded tips, ribs and ailerons. Fuselage from k 3 to 33 with a yellow cheat line, two open cockpits with leather rims and windscreens, a pilot in helmet, goggles and white scarf. Cabane and interplane struts, landing gear with tyres, a tail skid, a tailplane, a one-voxel-thick fin with red and white rudder stripes, a radial engine of nine cylinders and an exhaust ring. Constants: pivot (`JET_PIVOT_K` 12.5, `JET_PIVOT_Y` 5), smoke outlet under the tail (`JET_SMOKE_*`), propeller hub and radius (`JET_PROP_K`, `JET_PROP_Y`, `JET_PROP_R` 5.4), wingtips for the trails (`JET_WINGTIP_*`). `JET_PALETTE` families: 1–9 body blue, 17–22 wing yellow, 33–38 metal, then fixed colours 49–57 (tyre, leather, cockpit hole, red, white, goggles, propeller wood, face). `bodyColor`, `accentColor`, `canopyColor` recolour the first three families.

Autopilot stunts and the intro fly-in exist (`stunts`, `intro`, `replayIntro`). The demo turns the intro off.

## Propeller, smoke, bumps, cockpit

The propeller is not voxels. `prop()` in `drawJet` samples a disc of `JET_PROP_R` in front of the nose: a hub, two wooden blades at `propAngle`, a faint ghost blade behind them, and a light blur over the disc. `propAngle` turns at `24 + 26 * boost` rad/s. When the nose faces away from the eye, the disc only lands on pixels that are not the plane.

There are no flames. While the throttle is open (`boost > 0.2`) or during a stunt, white display smoke puffs come out under the tail every 0.03 s. Smoke is drawn white in `drawSmoke`.

Bumps: each plane has damped springs on roll, pitch, yaw and height (`joltR`, `joltP`, `joltY`, `joltZ`). Every 0.8–3.4 s (from `hash8`, no random state) a kick changes their velocities, harder with more speed. They are only seen: `rollOf`, `axes`, the height in `drawJet` and the cockpit camera (`vRoll`, `headY`) add them, but the flight path ignores them. Cost is a few multiplies per plane per frame.

The plane has no dark outline. To keep thin parts (struts, wires, the fin edge) from breaking into dots between slices, `sliceT` flags voxels that have a voxel above and at most one neighbour; `drawJet` repeats their splat partway toward the slice above.

**The cockpit** (`cockpit.ts`) is an open 1920s cockpit, no HUD and no radar. It is rebuilt when the frame size or the plane colours change. Three layers parallax with the head: the nose (blue deck, the front cockpit, three cylinder heads), the wings (the upper wing's underside with ribs, cabane and interplane struts, wires, the lower wing at the sides), and the near layer (windscreen frame, leather coaming with stitches, side walls, the black panel). Drawn live each frame: the propeller disc, the windscreen glass, needles, the throttle knob, and the stick leaning with turn and climb. Gauges are speed, engine rpm (with a red line), altitude (two hands), oil, fuel (dummy, slowly falling), and a card compass under a red lubber line. It only composites when the view is rolled onto the sheet, which is the cockpit and hard rolls.

## Drawing the small actors

Boats, the person, and the parts of whales above the water go through a small voxel rasterizer. `voxBegin(x, y, z, yaw, heel, pitch, g)` sets up the object's transform and screen box. `rasterVox` projects each voxel with the world camera, splats it as a square, and shades it from the sun with four tones per material (shadow, side, top, lit side). Sails are lit from both faces. `voxEnd` clears the object's scratch buffers. There is no dark rim around objects. Each object has its own depth buffer `akey`: squared distance to the eye in the perspective views, depth along the view in the flat ones. The world `zbuf` is read to hide voxels behind terrain. Only your own boat in first person also writes it (`yZW`). `drawBoats` sorts boats far to near, and `drawYacht` picks the level of detail from the screen scale (`m0 >= 9` finest, `>= 2.2` middle), or the extra-fine one for your boat in first person.

`drawWalker` copies the `PERSON` voxels into the rig buffers with the legs and arms swung, then rasterizes them like a boat. It is skipped when `footView !== 0` or when `aboard >= 0`.

Shared palettes (`yachtPal`, `lifePal`, `shutterLit`, `shutterShade`) are rebuilt in `rebuildPalettes`, so they follow the time of day and fog like the world.

## Debug log

`src/lib/log.ts` keeps the last 300 notes and prints them. The browser console has it as `gameLog`.

- `gameLog.dump()` shows recent lines. `gameLog.clear()` wipes them.
- `gameLog.enabled = false` silences it. `gameLog.level = 'warn'` keeps failures only.
- `gameLog.child('foot')` is a scoped logger. The scene already uses `world`, `foot`, and `boat`.

The world line lists islands, specks, docks, boats, fish, and whales. V logs where the person stood (`nearby`, `dock`, or `island`) or `nowhere to stand`. Boarding logs a boat, a missing boat, stepping ashore, or no shore.

## Easy to get wrong

- Flight pitch is inverted in the React key mapper only. The scene’s `setKeys` treats positive climb as up. Walking must keep sending positive move for W.
- Palette arrays must stay the same length. `NMAT` is `MAT_TOP.length`.
- `floorMap` has to be copied before forests. If walking uses `heightMap` in the trees, the person stands on the leaves. If leaves stay in `standable`’s block list, the person cannot pass between trunks.
- Dock normals have to come from the ocean mask. A cardinal step looks diagonal to a diagonal beach, and a lake will accept a “deep water” test that only looks a few cells out.
- Overhead cameras with `vC` or `vK` above 0 draw the sky volume. The walking camera must stay under `CLOUD_ALT` or the view fills with cloud. The boat aerial view stays orthographic (`vQ`, `vC`, and `vK` all 0) so it does not enter that volume. Its look-down is only `vTan`, and only the cloud hole keeps clouds off the boat.
- A moored boat must be skipped in `stepBoats`. Clearing `moored` on W is what casts off. S stops by clearing `sailing` only.
- World rebuild resets `aboard` inside `placeDocks` and reseats the walker if they were on foot. The reseat also skips specks.
- New wall or roof materials have to be added to `isBuilt`, and windowed walls to `WINDOWED` (which feeds `WINDOW_MAT`). Otherwise the person walks on roofs, bombs leave walls standing, or shutters do not show.
- Boats do not write `zbuf`, except your own in first person. Otherwise the jet is drawn after them and lands on top, even when behind a sail.
- The boat first-person camera and the walking first-person camera are different lenses. The walking one is long (the eye 26 behind the camera point), so anything of your own boat near the eye would sit in the middle of the picture as a cut-open hull. Keep the boat on its wide lens.
- Trees are found with `isTree` / `isTrunk`, not by material range. Checking only 9–11 misses firs and round-crowned trees.
- `drawWorld` must capture `Rp` and `mp` before it advances the depth step, or the shutter bands slide up and down the walls as the camera moves.
- A speck is marked from the cells counted in its own flood. Do not flood again after piers exist. A pier is land, so a second flood can walk off the speck onto a real island and then V finds nowhere to stand.

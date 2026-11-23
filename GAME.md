# Enzo's day

Notes for picking this project up later. The flight, the islands, and the pixel look started as a remix of https://remix.ui8.ai/fly (Forge share, remix enabled), which flew a fighter jet. Here it became Enzo's day: a 1920s biplane (yellow wings, blue fuselage, radial engine) over Lake Como–style islands, with houses, bombs, a person, boats, docks, sea life, and wind added. The code still calls the plane "the jet" (`jets`, `drawJet`, `jet-model.ts`). The React component is `EnzoScene`.

There is no 3D engine and no polygon mesh. One software renderer paints a low-resolution buffer. The page scales that buffer with `image-rendering: pixelated`. The ground and clouds can be drawn on the graphics card instead (WebGL2, `gpu-world.ts`), pixel for pixel the same; everything else is drawn on the CPU.

## Run

```
npm install
npm run dev
npm run build
```

Vite 7, React 19, Tailwind 4. Entry is `src/main.jsx`. It mounts `EnzoScene` with the saved demo values (speed 74, seed 7, land 0.33, overhead view). The page title is "Enzo's day". `src/index.css` only makes the page fill the window on `#2468b4`.

React StrictMode runs the canvas effect twice. `EnzoScene` must call `scene.resize` when `scene.width` / `scene.height` do not match the buffer, not only when the canvas element changes size. The frame is copied with `image.data.set(bytes)` rather than sharing the buffer.

## Files

| File | What it is |
| --- | --- |
| `src/main.jsx` | Mounts the scene with the demo parameters. |
| `src/EnzoScene.jsx` | Keys, pointer, touch buttons, hint text, the animation loop. |
| `src/lib/scene.ts` | World, simulation, sprite-stack renderer, villas, yachts, fish and whales, person, bombs. |
| `src/lib/jet-model.ts` | The biplane, built in code by `decodeJet()` as 14 slices of 44 across × 34 along. Palette families: body (blue), accent (yellow wings), metal, and fixed colours. |
| `src/lib/museum-room.ts` | Inside the museum: one gallery in first person, drawn by its own ray caster. |
| `src/lib/paintings.ts` | The museum's nine paintings, painted in code as small pixel pictures. |
| `src/lib/cockpit.ts` | The open biplane cockpit, painted once as three depth layers, then shifted each frame with the pilot’s head. Gauges, propeller and stick are drawn live. |
| `src/lib/gpu-world.ts` | The ground and clouds on the graphics card (WebGL2), read back into the scene's buffers. See "Ground on the GPU". |
| `src/lib/flame-layer.ts` | WebGL canvas over the pixels for jet afterburners. The biplane has no flames, so it now draws nothing. |
| `src/lib/log.ts` | `Log` ring buffer. The page exposes it as `gameLog`. |

`createScene(initial)` in `scene.ts` owns almost all game state. The React component reads `scene.onFoot`, `scene.aboard`, `scene.footView`, and `scene.view`, and calls the methods at the bottom of `createScene`.

## How a frame is drawn

`step(dt)` moves the world. `render()` draws it. Order inside `render`:

1. `updateView` — camera pose.
2. `drawGround` — ground columns and clouds, near pixels win: on the GPU when one is attached, else `drawWorld`.
3. `drawSky` — skipped in a flat overhead view.
4. Trails, smoke, bombs, fish and whales, boats, the walking figure, jets far to near, blast sparks.
5. If the view is rolled (cockpit, or a barrel roll), all of that was drawn on a square sheet and is then rotated into the frame. The cockpit layers go on last.
6. `flames` is returned for the WebGL overlay. Its count is always 0 now.

The ground is a height map. Each cell is a stack of pixels: the side color fills the column, the top color caps it. Clouds are a second stack at a fixed altitude. The plane is the same idea: horizontal slices from the wheels to the top of the fin, rotated to yaw, pitch, and roll.

Depth is a z-buffer of “how far along the view axis,” not a GPU buffer. A pixel that is already nearer is left alone.

On the CPU, `drawWorld` is most of the frame (60–75%). It saves work without changing a pixel: a column drawn up to the top of the frame is skipped, the depth loop stops once every column is (`live`), and the cloud map is not read where every cloud row at that depth (`cTop` to `cBot`) is already drawn. A column is always filled solid from its `colY` down, which is what makes these skips safe.

`worldFrame()` works out what the ground needs for this frame (camera, palettes, plane shadows, water timing, and every depth step in `stepV`). `drawWorld` and the GPU both read it, so they draw from the same numbers.

### Ground on the GPU

`EnzoScene` makes a `createGpuWorld()` and hands it to `scene.setGpu`. Without WebGL2, or when the context is lost, `draw` returns false and the frame falls back to `drawWorld`. Add `?cpu` to the address to force the CPU.

Each pixel walks the same depth steps as `drawWorld`, on its own. For one pixel, "the column at step k covers row y" is a height test against a straight line in depth, and the map cell it samples is a straight line too, so a step is a few multiplies and a texture read. The walk skips:

- Steps above everything: a binary search finds where the line comes below the tallest column (and the clouds).
- Whole 16 × 16 blocks of the map the line passes over (`hBlock`, the tallest column of each), and blocks of the cloud map with no cloud that can show (`cBlock`). A table from depth to step (`stepAt`) finds the step past the block.
- The ground before its band can reach it. Two small passes walk the lowest row of every 64-row band, then of every 8-row band, and store the first step where the ground meets it. A row higher on the screen needs taller columns at every depth, so it meets the ground no nearer. Each pixel then looks only for clouds before that step (clouds float, so they do not follow this rule) and walks the ground from there.

Colours and depths are read back into `fb` and `zbuf` (depth as the float's four bytes, so it is exact). Sky, boats, the person, the plane and the cockpit then draw over them on the CPU as before.

The world goes up as textures once per `buildWorld` (`GW.stamp`). Bombs and wrecked houses lower the ground in place: they push the changed rows onto `GW.dirty`, and only those rows are sent again.

On the development laptop (Intel UHD, 640 × 360), the ground takes about the same time on either side, 7–12 ms. The GPU path frees the CPU, though: in play, about 0.5 cores against 1.3. The read back alone costs about 3 ms.

In development the page exposes the scene as `window.enzoScene`:

- `enzoScene.groundStats`: where the ground is drawn, its average ms, the step count, and the GPU's own times (`setup`, `shade`, `read`).
- `enzoScene.compareGround()`: the next frame is drawn both ways. `enzoScene.groundDiff` then counts the pixels whose colour or depth differ. Expect 0 to 3 (float rounding); a facade seen head-on and close can show a few dozen more, where the edge of a band falls right on a row of pixels.

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

`EnzoScene` keeps the keys that are down and calls `setKeys`, `setWalk`, `setBomb`.

| Key | Flying | On foot, walking | On foot, in a boat |
| --- | --- | --- | --- |
| W / Up | Dive | Walk forward | Start sailing. Stays on after release. If Enzo is out on deck, he climbs back in first. |
| S / Down | Climb | Walk back | Stop. Stays stopped. |
| A, D | Turn | Step left, step right (sideways, no turn) | Turn, sailing or not. If Enzo is out on deck, he climbs back in first. |
| Left, Right | Turn | Turn | Turn, as A and D |
| Shift | Throttle and smoke | — | — |
| V | Become the person | Back to the jet | Back to the jet. The boat stays as it is. |
| E | — | Board the nearest boat within 48 | Step ashore if land is within 28 |
| Space | Next flight view | Overhead ↔ first person | Isometric aerial ↔ first person |
| N | Night, or back to day, over 9 seconds | Same | Same |
| Click | Roll if short, throttle if held | — | — |
| Pointer | Steers until a key is used | Ignored | Ignored |

Pitch is inverted only for the jet, and only in `sendKeys`: Up subtracts from climb, Down adds. Walking uses the same keys with the natural sign (Up adds to move). Do not reuse the flight sign for the person.

Bombing is switched off: `BOMBS = false` in `EnzoScene.jsx` leaves out the B and F keys, the Bomb button and the hints. The scene still has all of it (`setBomb`, `dropBomb`, the blasts, the wrecked houses, see "Houses and bombs"); setting `BOMBS` true brings it back, with B or F dropping bombs while held.

On a coarse pointer, or `touchControls="on"`, there are on-screen buttons. Ctrl is not a game key.

- **The frame on a phone.** Once the screen is known to be touched (`fingerScreen`), `layout` makes the game pixel no bigger than gives the frame `PHONE_PIXELS` (150,000). That is a little more than a 1280 by 720 desktop at `pixelSize` 3, so a phone shows about as much of the world and costs about the same to draw. A fixed `pixelSize` of 3 would give a phone a frame of about 125 by 271. The pixel is a whole number of the screen's own pixels (`devicePixelRatio`), so the art stays crisp: on a 375 by 812 phone at 3× that is 4 screen pixels, a frame of 281 by 609. The buttons and the hint are sized in CSS pixels, so they stay big. The buttons are 80 by 64 and the hint is 12 px.

- **Flying.** View, Boost, and Walk (V) (and Bomb, when `BOMBS` is on). A tap (under 300 ms, moved under 12 pixels) rolls the plane. A drag flies it the way of the drag, on the same stick as on foot. Overhead, `scene.setAim(dx, dy)` passes the drag on the screen and the plane turns toward that heading in the world, as a boat does, until it points the way of the drag. From behind and from the seat the stick goes in with the keys (`setKeys`): sideways turns, up climbs and down dives, so the plane moves on the screen the way the finger drags. Let go and it flies straight on, as after the keys; it goes back to wandering by itself only once the mouse moves. A finger no longer steers by where it is on the screen, as the mouse does.
- **On foot.** Fly (V), View, and Board (E). Board shows only when it would do something, a boat within 48 (`scene.canBoard`, looked at five times a second). Aboard it reads Ashore, and shows when land is within 28. Bomb and Boost are hidden.
- **The stick.** A finger dragged on the screen is a stick from where it went down, shown as a ring and a knob. On foot, sideways turns and up or down walks, at full speed `STICK_R` (46 CSS pixels) out, nothing inside `STICK_DEAD` (8). It is added to the keys in `sendKeys`, and the wrapper captures the pointer so a finger lifted over a button still ends it.
- **Aboard.** A tap (under 300 ms, moved under 12 pixels) calls `scene.sailToggle()`: set sail, or stop. If Enzo is out on deck, he climbs back in first and then the boat sails, as with W. A drag points the boat: `scene.setAim(dx, dy)` passes the drag on the screen, and `stepFoot` turns the boat at the rate of A and D toward that heading in the world (the screen's up is heading `−vYaw`). In the isometric view the world stays still, so the boat turns until it points the way of the drag. In first person the view turns with the boat, so a finger held off to one side keeps it turning, like a tiller. A drag of under 12 pixels does nothing. A drag never sets sail or stops.

Hint text at the bottom follows the mode. While sailing it says W starts and S stops. The first time aboard, how to sail ("Tap to sail or stop" on a phone, "W starts · S stops" on a keyboard) glows softly yellow, over and over (`.sail-cue` in `index.css`), until the boat sets sail or Enzo leaves it. It does not come back on later boardings.

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
| `timeOfDay` | `clock` | `day`, `sunset`, `night`: the light the game starts in. A change eases there, like N. `clock` (resolved in `EnzoScene`, not the scene) is the browser's own clock: day from 7:00, night from 20:00, looked at every minute until N is pressed. See "Day and night". |
| `land` | 0.33 | Fraction of the map above water. |
| `clouds` | 0.45 | How many of the generated cloud clusters are visible. |
| `seed` | 7 | World seed, including wind direction. |
| `shadow` | true | Jet shadow on the ground. |
| `flameStyle`, `afterburner` | `realistic`, 1 | Left from the jet. The biplane has no flames, so they change nothing. |
| `trails` | true | Wingtip trails. |
| `bodyColor`, `accentColor`, `canopyColor` | `#3254a0`, `#f6c022`, `#9ca2ac` | Recolor the plane's palette families: fuselage blue, wing yellow, metal (cowling, struts, engine). |

`pixelSize`, `showHint`, and `touchControls` are React props, not scene params.

## Day and night

The game starts in the light of the browser's clock (`timeOfDay="clock"` in the demo): day from 7 in the morning, night from 8 in the evening. `EnzoScene` looks at the clock every minute, so the light eases over by itself at 7 and at 8, until N is pressed. After that the light is the player's. N turns the light towards night, or back towards day, from wherever it is. The change takes `DAY_FADE` (9) seconds and passes through dusk, so dawn is dusk played backwards. Lamps come on as the dusk deepens and go off at dawn.

- **The phase.** `dayLin` moves at an even pace towards `dayGoal` (0 day, 1 night). `phase` is that, eased at both ends (`easeDay`). `todWeights(phase)` gives the weights of the day, sunset and night colours (`tw`): the day light turns to sunset light up to `DUSK` (0.45), where the sunset colours are `DUSK_PEAK` (85%) of the mix, then the sunset gives way to night. The `timeOfDay` param only says where the light starts (`sunset` is `DUSK`), and a new value eases there like N.
- **Palettes.** Every colour that changes with the light is a mix of its day, sunset and night versions: `gradeT(c, aS, aN)` for graded colours, `mix3` and `mixN` for the sky, haze and other keyframes. `rebuildPalettes(false)` runs every frame of a fade (about 0.15 ms), and the GPU is sent the palette every frame anyway. The light's direction (`sunX`, `sunY`) moves too, so shadows swing round.
- **Sky.** The sun is drawn only around dusk, big and low (by `tw[1]`), and sinks under the horizon as the phase goes on. The moon and the stars come up with `moonK` (phase 0.62 to 0.92). A star is drawn in `starPal`, each sky band brightened towards white by `moonK`.
- **The cockpit** takes 100–270 ms to paint, so it is never repainted for the light. It is painted in the daylight jet palette (`jetPalDay`), and `drawCockpit` tones its layers and live parts by `cockpitTint` as it lays them on. The tint is the jet's grade applied to mid grey, as r, g, b in 256ths.
- **Lamps.** `lampK` goes from 0 to 1 over phase `LAMP_ON0` to `LAMP_ON1` (0.55 to 0.9). Each lamp has its own moment, from a hash (`lampOn(h)`), so they come on one by one.
  - **House windows.** At night some windows are lit (`winLit`, warm yellow): the window's opening shows the light, and far off, a light in the band of its floor. A window is one cell and one floor. It is lit when `hash8(cell * 4 + floor)` is under `winOn`, which goes up to `WIN_LIT` (150 of 256). `drawWorld` and the GPU shader use the same hash, so the two still agree.
  - **Boats** (`drawBoatLamps`). Small yellow lanterns, all the same warm colour: one each side a little forward of the middle, one on the stern and one at the top of the foremast. Each is one voxel drawn by `lampVox` inside the boat's own `voxBegin` … `voxEnd`, so the hull and the sails hide it where they should. Only a lamp that shows gets its glow. The deckhouse windows and the open hatch (`YM_WINDOW`) glow warm with `lampK`.
  - **Gardens.** A lamp post (`P_LAMP`) stands by the end of every bench (`placeLamps`), in the villa gardens, on the terraces and along the promenades, and four in the chapel's garden. At night its lantern is lit (`LAMP_LIT`) and glows. A faint warm light falls on each statue, and each fountain is lit from under the water: a blue glow, and the spray turns pale.
  - **The chapel.** Its windows are `YM_WINDOW`, the boats' window material, so they glow warm with `lampK` the same way.
  - **The glow.** `glow` adds a lamp's light to the frame in quarter steps, dithered with `BAYER` so it keeps the pixel look. Its radius follows the screen scale (1.5 to 9 pixels). `lampGlow` does the same for a world point, and is skipped when the ground or a house is in front of it.
  - **Lamp materials.** `YM_LAMP` is the last boat material. It has the same colour in all four shades and is not graded: it gives light, it does not take it. `YM_GLASS`, just before it, is an unlit lantern.
  - **Stone.** The chapel's and the temple's materials (`YM_TRAV` … `YM_OCHRE`) take the night almost as the ground does (`gradeT(c, 0.8, 0.85)`), not as lightly as the boats, so they read as moonlit stone and not as lit up.

In development, `enzoScene.setLight(s)` jumps the light to `s` along the way from day (0) to night (1), and `enzoScene.phase` reads it.

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
6. Villages with their gardens, then docks, then lakeside viewpoints, then wildflowers, then the chapel, the temple and the museum, then a lamp by every bench, then free boats, then birds.
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
| 32–33 | Unused: the villas' bell tower and its cap, taken out. Still in `isBuilt`. |
| 34 | Cypress. |
| 35 | Balustrade. |
| 36 | Topiary. |
| 37–39 | Fir: trunk, needles, edge. |
| 40–42 | Round-crowned tree: trunk, leaves, edge. |
| 43 | Box hedge. |
| 44 | Stone: fountain and canal rims. |
| 45 | Fountain water. |
| 46 | Plinth: statue plinths, fountain spouts, urn posts. |
| 47–49 | Flowers: pink (no longer used), yellow, white. The side colour is green, for the stems. `drawWorld` draws yellow and white (`BLOOM`) as a small bloom: only the middle of the cell's top (radius 0.3) has the flower's colour, the rest is grass green. Blooms only show near the ground: on foot or aboard, or in the chase and cockpit views while the plane is under `BLOOM_ALT` (16) above the ground. In the overhead flight view, or flying higher, a flower cell is plain green. |
| 50 | Clipped lawn. |
| 51–52 | Paving, light and dark: lakeside terraces and promenades. |
| 53 | A house's white stone (`M_HSTONE`): the corner pilasters, and the colour of all the facade's stone. |
| 54, 55, 59, 60 | The bay with the door (`M_PORTAL`), one in each wall colour, in the order of `WALLS`. |
| 56–58 | Colours only, never on the map: the shutters' slats (`M_SLAT`), iron (`M_IRON`), the door (`M_DOOR`). |

Trees of every kind go through `isTree(m)` and `isTrunk(m)` (built from `TREE_KINDS`), not through index ranges. Houses avoid them, yards clear them, bombs scorch them, the person walks through them (`walkFloor` reads `floorMap` under them), and docks do not pave over trunks. A new tree kind needs an entry in `TREE_KINDS` and colours in both palettes.

`isGreen(m)` is grass, trees, cypresses, topiary, hedges, flowers and lawn: what a bomb scorches.

Water is anything `< 4`. The person and the boats treat `>= 4` as solid. `isBuilt(m)` is walls and roofs (17–22, 27–33, 53–55, 59–60): not walkable, and a bomb knocks them down to the house's floor. `WALLS[i]`, `WINDOWED[i]` and `M_PORTAL[i]` are the plain wall, the wall with a window and the door's bay of one wall colour.

The palette is 64 materials wide (the GPU's palette texture, and `FACADE`, `TREE`, `BLOOM`, `GREEN`): with 61 in use, three are left.

## Houses and bombs

Villages prefer grass near water, with a cluster near the spawn coast so there is something to bomb at once. The look is a lake-shore Italian village: stucco walls in ochre, cream, salmon or pale yellow, terracotta hip roofs, green shutters, cypresses. `stampHouse` makes one of two kinds:

- **Villa** (40%): 14–16 by 15–19, 2 or 3 floors, a 3-cell yard. The outer ring is a stone balustrade (35) with gaps for gates, then garden, then a gravel walk against the walls. Villas used to get a bell tower at one corner; it is gone, but `stampHouse` still makes the random draws it took, so the rest of the world is laid out as before. Most also get a formal garden on one side (see Gardens).
- **Townhouse**: 9–11 by 10–13, 2 floors, a 2-cell yard of gravel and garden.

`isVilla` (for the gardens) is a footprint of 180 cells or more.

Wall height is `floors * FLOOR_H` (5) above the floor. The edge cells are the walls: the four corners white stone (53), the middle cell of one long side the door's bay (`M_PORTAL`, the side by the house's id), and along each side a window (28–31) every other cell, counted from the middle so the door stands where a window would, with plain wall either side of it and never a window in the cell beside a corner. The rest is plain wall (17–19, 27). The interior is a hip roof: height rises with the distance in from the edge, cells on a hip line (two sides tie) are 20, west and north faces 22 (sunny), east and south faces 21 (shaded). Gardens get 2–4 cypresses (34, 7–10 tall), 1–3 topiary domes (36), and flowers on about one cell in seven along the ring. Trees in the yard are cleared. `houseMap` stores the house id on footprint cells. `houses[]` keeps `{x, y, w, d, base, alive}`.

**Facades.** A wall is one column of the height map, so its detail is painted on the face as it is drawn, after the palazzi of southern Italy. `FACADE[m]` says what a material is: 1 plain stucco, 2 stucco with a window, 3 the stone pilaster, 4 the door's bay, 5 a roof (20–22). `facadeAt(fk, dTop, a, mp, cell, on, floors)` gives a role (`F_WALL` … `F_BAND`) for a point of a face, from how far it is below the eaves (`dTop`), across the cell (`a`, 0 to 1), and how many pixels a unit is on screen (`mp`). Each renderer turns the role into a colour: `drawWorld` from `facPal`, the shader (`gpu-world.ts`, a GLSL copy of `facadeAt`) from the palette. The two must give the same roles.

- Every house: a white stone cornice with dentils under the eaves, a stone band at the foot of each floor (the plinth on the ground floor), and windows with green slatted shutters in a white stone frame with a little cornice over them. The corners are white pilasters with joints.
- The door's bay is the house's own stucco: an arched door in a stone surround, and over it the only balcony, iron on a stone slab, on the floor above the ground.
- Every floor is the house's own stucco, the ground floor too, and the pilasters are the same all the way up.
- How many floors a house has is read from the ground in front of the wall: the wall's height over the cell the ray came from (`floors`).
- The detail comes in with `mp`, so far off a wall neither shimmers nor breaks into stripes. Under `FAC_L1` (2.5) a floor shows only its stone and a band where the windows are (`F_BAND`, the wall and the shutters half and half); from `FAC_L1` the windows' shape, the cornice and the bands; from `FAC_L2` (7) the frames, the little cornices, the door's arch and the joints; from `FAC_L3` (14) the slats and the balcony's bars.

Where the ray met the wall: both renderers walk back from the cell a step landed on, towards where the ray was at the step before, cell by cell (up to `FAC_WALK`, 12), to the last cell that is part of the house (`FACADE` not 0). When that is a wall, the ray came in through it, across the line it crossed, and that is the face drawn: its kind, its colour, `a` where the ray crossed, and the heights measured at that depth, so the bands line up from one column of pixels to the next. Mostly it is the cell the step landed on. But up close, at a joint, the ray can run from one wall cell into the next between two steps, and far off a step can jump over the wall onto the roof; without the walk the joints show slivers of side faces and, far off, the roof's sides run down to the ground in stripes. When the step landed on the roof, the facade shows up to the eaves and the roof's own side above them. At night some windows are lit (see "Day and night").

Bombs come from the jet only, and are switched off for now (`BOMBS` in `EnzoScene.jsx`, see "Controls"). B held calls `dropBomb` every 0.38s, up to 18 in the air. A bomb inherits some of the jet’s horizontal speed, starts a little under the jet, and falls (gravity 95, terminal about 220). It explodes at the ground.

- On land the radius is 12. On water it is 6.
- Any house touched is wrecked once: footprint becomes rubble (23) and scorch (24), one cell tall above the old floor. The yard around it scorches.
- Other land in the inner blast is cratered (height drops, scorch or rubble). Anything `isGreen` in the outer part scorches.
- Statues, benches, urns, lamps and fountain sprays inside the radius are knocked down (`alive = false`).
- The chapel and the temple cannot be destroyed: `explode` skips their footprint (`parkMap` 4). The hedges and lawns round them scorch like any garden, and their lamps can be knocked down.
- Sparks and smoke. Water explosions are smaller and shorter.

The person cannot drop bombs. `setBomb(false)` is forced while on foot.

## Gardens

`parkMap` (one byte a cell) records what a cell already belongs to: 1 a house and its yard, 2 a villa garden, 3 a lakeside terrace, promenade, path, or the chapel's garden and the temple's lawn, 4 the footprint of the chapel, the temple or the museum (whose grounds are 3). Every layout checks it is 0 before it builds, and `stampHouse` rejects a footprint or yard that touches any of it, so layouts never run over each other. Docks come after and skip materials 32 and up.

**Villa gardens.** `stampGarden` runs for each villa after its yard. It tries the three layouts, starting from a random one, on the four sides in random order, deepest first (`GARDEN_DEPTHS`), and takes the first that fits: every cell open grass or trees, not in `houseMap` or `parkMap`, and within 4 of the house's floor. The garden is as wide as the yard plus the house on that side, made odd so it is symmetric about the gate's axis, and levelled to the floor. It is open: no hedge round it. The balustrade on that side becomes gravel, with an urn on a post at each end.

`planGarden` paints a plan of codes (`G_LAWN`, `G_WALK`, `G_HEDGE`, …) in garden coordinates, `a` across from the axis and `v` out from the balustrade. Props are placed with a facing in the same coordinates, turned into a world yaw from the side.

- 0, parterre (depth 13 or 11): gravel; four box-edged beds of flowers; a round fountain on the crossing with a stone rim, the gravel round it cutting the beds' inner corners; topiary cones at the beds' outer corners and either side of the entrance; benches at the ends of the cross walk; a statue closing the axis.
- 1, canal (12, 10 or 8): lawn; a gravel forecourt; a stone-rimmed canal 3 wide on the axis, a fountain near the far end and urns on the rim's corners; gravel walks either side with benches facing the water; flower borders; cypresses every third cell; a statue at the end.
- 2, knot garden (13 or 11): gravel; four square beds of clipped box, 5 or 4 on a side, drawn as an X in two opposite beds and a cross in the other two, with flowers between; a statue in the middle with flowers on its diagonals; cones at the beds' outer corners; benches at the ends of the cross walk; lawn with a few flowers beyond.

Raised cells: hedge, rim, flowers and statue plinths 1 above the floor, spout and urn posts 2, cones 3, cypresses 7–9.

**Lakeside viewpoints.** `placeViewpoints` runs after the docks, over the houses in random order, up to 16, at least 120 apart and 36 from a dock's boat. From a house it looks out in the four compass directions for water within 44, then slides along the shore up to 12 either way for a spot `stampBelvedere` accepts: water straight out for 12 cells and either side, a straight enough shore, free land behind, no cliff. The terrace is 7 along the shore by 5, paved, at the shore's height but at least 2, and may fill in the water's edge. Along the water is the balustrade, with a statue on a pedestal in the middle looking back over the terrace and an urn on a post at each end. Two benches face the view and a strip of flowers runs along the back. `views[]` keeps `{x, y, ex, ey}`: the shore cell in the middle and the way out to the water.

The promenade follows the shore from both ends of the terrace. A breadth-first search in a window of 81 by 81 measures each land cell's 4-connected distance from the water, before the terrace fills any in. The promenade is the band at distance 2 and 3, flooded from the terrace's ends for 22–39 steps, paved at the ground's height (at least 1). It stops at houses, gardens, docks, trunks and cypresses. Benches go on the land side of straight stretches, facing the water, at least 10 apart, and flowers grow on one in five cells along the land side of the band. A one-cell gravel path then runs from the back of the terrace toward the house, a step at a time on whichever axis is farther, until it meets the yard.

**Wildflowers.** `placeWildflowers` runs last. Every 6 cells it may start a patch, with a chance set by a smooth meadow field (bilinear over a hash grid of 64-cell squares), so some slopes are thick with flowers and others bare. The chance is `(dens − 0.3) × 0.48` within about 40 of a house (`nearHouse`, a grid of 16-cell squares) and half that elsewhere, so about 10,000 flower cells on a map. A patch has a radius of 0.8–2.6 and fills about 70% of its cells, mostly in one colour. `flowerAt` gives yellow or white, half and half, everywhere: beds, rings, terraces and meadows. Only open grass outside `parkMap` and houses. A flower cell is 1 above `floorMap`.

**Props** are `props[]` `{kind, x, y, z, yaw, alive}`, models in `PROPS`: surface voxels of `PROP_G` (0.2) built by `propModel(build, g)`. Its `box` takes an optional part tag, kept in the model's `P`, and a box one voxel thick is a plate whose voxels all face up. Kinds 0 and 1 are marble statues (an orator with the right arm raised, a figure with a staff), about 3.4 tall. 2 is a bench, dark brown slats on a dark iron frame, 2.8 long, the sitter facing forward. 3 is an urn of yellow flowers. 4 is a garden lamp: a slim iron post with a glass lantern on top, 4.2 tall, by the end of every bench and a little behind it (`placeLamps`, which takes nothing from the random stream). Their colours are boat materials (`YM_MARBLE`, `YM_WOOD`, `YM_IRON`, `YM_BLOOM`, `YM_LEAF`). `fountains[]` `{x, y, z, alive}` are the spouts. `drawGardens` draws the props within 780 of the camera and on screen, then each fountain's spray: a dotted jet up from the spout and four arcs of drops falling outward.

## The chapel, the temple and the museum

Two buildings stand once on the map, each drawn as voxels like the boats, not as ground cells: a small domed chapel in the Roman manner and a garden temple of flint. Each is a function of a point, `chapelAt(a, f, z)` and `templeAt(a, f, z)`, which returns the material there or 0, in map units across, forward (the way the door or the niche faces) and up from the floor. `MONUMENTS` holds both, with their extents. `monumentBuilder` samples one on a grid at a voxel size, keeps the surface voxels and takes each normal from which of its 26 neighbours are empty. There are three levels of detail (`MON_LOD`: 0.5, 0.25, 0.125). The two coarse ones are made when the building is placed. The fine one (1.8M samples for the chapel, about 200 ms) is made a few milliseconds a frame (`monumentFine`) while the middle one is shown, so coming close does not stall.

- **The chapel**, about 21 tall. A square block of brick panels between travertine pilasters, arched windows and niches, a porch of two columns under a pediment, a cornice and a parapet with an obelisk at each corner. On it an octagonal drum with a window in each face, a ribbed lead dome with eight round dormers, and a lantern of eight columns with a cupola, a gilt ball and a cross. Materials `YM_TRAV`, `YM_BRICK`, `YM_LEAD`, `YM_GOLD`, and `YM_WINDOW` for the glass.
- **The temple**, about 11 tall and 10 across, and shallow. A flint wall (`YM_FLINT` and `YM_FLINT2`, speckled by a hash in quarter cells so every level of detail shows the same stones) with a tall round-arched niche, its vault plastered ochre (`YM_OCHRE`), and in it a marble statue on a pedestal. Two pairs of limestone (`YM_LIME`) columns on high plinths carry an entablature that breaks forward over them. Over that an attic with a plain panel in the middle and four dies with round caps.

**Placing them.** Neither draws from the random stream. Both look round every villa, in 16 directions at a few distances, face the villa they were found from (square to the map), and score the spot: villas within 90, a front turned to the sun (`sunward`: facing −x or −y, the lit sides in `voxBegin`), closeness to the spawn, and open ground: `woodAround` is how much of the land within `WOOD_R` (40) is wood, and all wood costs `WOOD_K` (40), as much as four villas near the chapel. The chapel and the museum then clear the trees round their gardens with `clearRound`: within about `CLEARING` (14) of them, with round corners and an edge that comes and goes, so they stand in a clearing, not a cut. Their gravel paths (`gravelPath` with `PATH_CLEAR`, 2) clear the trees either side, so where they go through a wood the way in is open.

- `placeChapel` keeps its middle at least 24 from any house. It stands in a walled garden in the Italian manner, the biggest of `CHAPEL_GARDENS` that fits (39, 33 or 28 long by 25 across), laid out by `chapelPlan`. A low box hedge (`M_HEDGE`, 1 high) runs all round with a gate on the axis, and a gravel walk runs inside it. There is clipped lawn about the chapel and a paved square before the door. Then comes the parterre down to the gate: a gravel walk on the axis, beds of lawn edged with box with a clipped cone in each, and a pair of long stone-rimmed pools. Every cell must be open grass, trees or flowers within 2 of the floor near the chapel and 3 elsewhere. The garden is levelled to that floor. The trees round the hedge are cleared (`clearRound`). There is a lamp at the square's front corners and one either side of the gate, a cypress either side outside the gate, and a gravel path on to the villa's yard (`gravelPath`).
- `placeTemple` keeps at least 300 from the chapel and 18 from any house, and prefers a spot with wood behind and beside it (`templeSite` counts the tree cells). Those trees are kept, so it stands against the wood. In front, the trees are cleared for 24. There is a paved step, a lawn with a gravel walk up the middle, and a gravel path to the villa.

- **The museum**, about 14 tall, 29 across and 16 deep, an exhibition hall of cream stucco in the Viennese manner of the 1860s, from `museumAt`. A raised middle block of three bays: three arched glass doors up a flight of steps, a marble statue on a pedestal either side of each (the temple's statue, smaller), three tall arched windows over them behind little balustrades between engaged columns, a band of sculpted panels (`YM_RELIEF`), a frieze with gilt letters, a cornice and an attic balustrade, and a glass skylight in an iron grid on the roof. Either side a lower wing with a red banner (`YM_BANNER`), and at each end a pavilion standing a little forward with a ball on each outer corner. The ground floor is rusticated (`YM_JOINT` every 0.72), the roofs are lead. The doors and windows are `YM_WINDOW`, so they glow at night. Materials `YM_CREAM`, `YM_JOINT`, `YM_RELIEF`, `YM_BANNER`, with the stone grading.
- `placeMuseum` puts it near the chapel, on a lone outcrop of rock if there is one within 240 (`MUSEUM_R`). The outcrops are flood fills of rock and snow (so a mountain is one piece) of 100 to 1500 cells, no more than 30 across. All of the outcrop must fall inside the ground that is cleared, and no other rock or snow. The rock is levelled to the commonest floor round it and turned to grass. Without such a rock it tries a ring round the chapel (70 to 150 out). The doors face the sun where they can, and else the chapel. Each site is also worth `MG_ROW_K` (0.5) for every row of back garden that fits behind it (`museumBackRows`, `backDepth`), so it goes where there is room for a deep one. Its grounds: a paved forecourt before the steps with a lamp at each corner, three cypresses down either side, a paved walk round the building, lawn, and a gravel path to the nearest villa. Then its gardens (`museumGardens`), in the manner of the lake's villas and open all round (no hedge or wall at the edge, so they can be walked into anywhere):
  - Either side, a gravel walk along the building with two benches facing out, then a lawn panel (out to 27, 25 or 23 across, as far as fits) with a pink border along the walk, a ball at each corner, a cone at each end and a round pink bed with a cone in the middle.
  - Behind, a formal garden of statues, 41 across (`MG_HW` 20 either side of the axis) and as deep as the ground allows (`MG_DEPTH`: 54, 46, 38, 30, 22 or 14 rows). It goes over open land and the beach, so on the shore it runs down to the water. Each row is levelled to its own floor, at most 2 from the last, so it climbs or falls in terraces; a row may cut up to `MG_CUT` (4) into the ground or be built up `MG_FILL` (3) over it. No hedge anywhere: it is open on every side. A cross walk; a parterre of four lawns with balls at their corners and pink borders, round a round pink bed with a statue in the middle, in a gravel ring, and on each outer lawn a statue between two cones; a second cross walk with a bench at each end facing those statues; then (22 rows or more) a long striped grass avenue between gravel walks, with cypresses every third row, statues facing the axis every eighth row from its head, between the benches, cones and balls on the lawns beyond, pink borders, benches facing the grass and a round fountain halfway; and at the far end a terrace with a statue looking back to the museum between two urns, a statue either side, and cypresses. The statues are props 0 and 1 on plinths one high. The trees round it are cleared. In the default world the museum stands on open ground by the shore, with a side garden on one side and 38 rows behind, down to the beach.

Each footprint cell is paved and marked `parkMap` 4, and `monumentTop` keeps the height of the building over it. `groundAt` reads that, so the plane climbs over the building and bombs burst on it. `standable` rejects the footprint, and `explode` leaves it standing. `drawMonuments` runs right after the sky, before everything else that stands in the world, and writes `zbuf` (`yZW`), so what is behind it is hidden.

### Inside the museum

Walking into the middle doors (a step that lands on the museum's steps, `atMuseumDoor`) takes the man inside (`indoors`). `stepFoot` then walks him round the room (`room.step`), and `render` draws only the room (`room.render`) and returns. Walking back out of the door puts him on the forecourt facing away from the steps (`leaveMuseum`). V goes straight back to the plane; View and E do nothing inside. `scene.indoors` tells the page, which shows the gallery's own hint and hides the View button.

The room (`museum-room.ts`) is one gallery, 44 across, 30 deep and 14 high, so the paintings hang with 4 to 6 between them, with the door in the middle of the front wall. It is a ray caster: each column finds the wall its ray meets, each row above or below it the ceiling or the floor at that distance, and the furniture is drawn over that with a depth per pixel. Walls: a dark dado, red cloth with seams, a black band, gilt dentils and a cream frieze. The ceiling is coffered with a rosette in each coffer and a skylight in the middle; at night (`lampK`) the skylight and the view out of the door go dark and the room a little warmer. The floor is an oak herringbone that fades to its own colour far off, so it does not shimmer.

The furniture (`BOXES`) is boxes that may start above the floor (`z0`) and have painted faces: `paint(xFace, along, z)` and `topPaint(x, y)` give a colour, or null where the face is open. The man walks round each piece (`SOLID`, `BODY` 0.9 away), and the floor darkens softly under and round it (`floorShade`).

- **Two benches in the manner of Louis XV**, one either side of the room 8.5 in from the side walls, long side to the wall so you sit facing the paintings there (`benchBoxes`). A gilt frame: four rails whose lower edge (`railEdge`) is serpentine, dipping to a carved shell in the middle of each and to the knees at the ends, and four cabriole legs, each a stack of five short boxes (`LEG`) that swells at the knee, narrows at the ankle and ends in a scroll foot. On it a seat stuffed high in sage silk damask (`damask`: lozenges with a flower), a gold braid at its foot and a rolled edge at its top, and a crown buttoned in a diamond grid with the creases between the buttons.
- **Two porcelain vases in the manner of Sèvres**, either side of the Last Supper against the back wall (`VASE_X`), so they are the first thing seen coming in. Each stands on a column of green marble with pale veins and gilt beads (`pedestalBoxes`, 2.4 high). The vase is 3.2 high, a baluster turned from `VASE_PROFILE` (radius by height, eased between the points, × `VASE_K`): royal blue sprinkled with gilt dots, gilt bands at the foot, stem, shoulder, neck and lip, and on the side facing the room a white panel in a gilt frame with a posy of four blooms (`vaseColour`). A vase is round, so it is not a box: where a column's ray passes within `VASE_R` of the axis, each row marches 24 steps through it and closes in on the first point inside the profile, then lights it from the skylight with a glint where the light reflects to the eye.

The grey sofas back to back against a plinth that stood in the middle of the room are gone; the middle is open floor under the skylight.

The paintings (`paintings.ts`) are painted once in code on small canvases (12 by 16 to 44 by 18 pixels): flat shapes, a glow or two, then every pixel nudged by a hash and the whole warmed and darkened at the edges like old varnish, so they look like a block game's paintings. They are sacred subjects after the old masters: the Assumption (arched, after Rubens), the Last Supper (after Leonardo), the Annunciation, the Madonna of the Meadow (after Raphael), the Crucifixion, the Adoration of the Magi, the Baptism of Christ, the Pietà and the Virgin in Prayer (after Sassoferrato). `HANG` says where each hangs: wall, middle, foot and units a pixel (about 0.3). Each has a gilt frame, two wires up to the cornice (one for the arched one) and a card beside it.

## Person

V calls `toggleFoot`. The jet is left on autopilot (`keyMode` off, no bomb, no boost). The person is placed on standable ground within 480 of the jet. Islands under 2000 cells are skipped, the same specks that get no dock. If that search misses, the nearest pier is used. If there is no pier either, the nearest large island is used. Stepping ashore from a boat can still use a small island. Pressing V again returns to the jet and leaves the boat where it is.

The figure is `PERSON`: boxes of surface voxels (`PERSON_G` 0.25) with normals, in boat units (across, forward, up), drawn by the boat rasterizer. About 5.5 tall: shoes, navy trousers, a white shirt with navy stripes, light brown hair, and a straw boater with a dark band. Its materials are boat materials 24–31 (`YM_SKIN` … `YM_BAND`). Each voxel has a part (body, left and right leg, left and right arm). While `walkMove` or `walkSide` is not 0, legs swing about the hip (`PERSON_HIP`) and arms about the shoulder (`PERSON_SHOULDER`), and the body lifts a little each step. `walkerShadow` darkens a small ellipse on the ground under him, offset away from the sun, only on pixels at his own depth.

Walking speed is 20. Turn rate is 2.1 rad/s. Forward is the same axis as the jet, `(sin(yaw), -cos(yaw))`, and right is `(cos(yaw), sin(yaw))`. On land A and D step sideways (`walkSide`, the third argument of `setWalk`); `sendKeys` takes them out of the turn whenever he is on foot and not aboard, so the arrows still turn. Forward and sideways together are no faster than one alone. Inside the museum `room.step` does the same.

`standable` rejects water, house cells, anything `isBuilt`, box hedge, fountain water and plinths (43, 45, 46), and the chapel, the temple and the museum (`parkMap` 4). Trees do not stop the person: trunks, leaves and cypresses are walked through, on the ground under them. Sand, grass, rock, snow, gravel, garden, flowers, paving, balustrade, topiary and dock planks are allowed too. Benches are props, not cells, so the person walks through them. `canStep` also rejects a step up greater than 4. Down is free. `walkFloor` returns `floorMap` on trunk, leaf and cypress cells, otherwise `heightMap`, so the person stands on the ground under the trees and the close camera does not climb onto the canopy.

Cameras while walking (`footView` 0 overhead, 1 first):

- Overhead: 9 behind, 12 above the feet, capped under `CLOUD_ALT - 8`, `vS` 16, a little perspective.
- First: a true lens at his eyes, 4.5 above the feet and 0.35 ahead of him, like the seat in a boat. The camera point is `WALK_LOOK` (4) ahead of the eyes, `vQ = 1 / WALK_LOOK`, focal length `WALK_FOCAL` (0.8) × the frame's longer side, no look-down, horizon at `WALK_HORIZON` (0.3) of the height. What is behind him, or right beside him, falls outside the picture by itself, so a wall at his back never shows and nothing has to be cut. (It used to be a long lens, `vQ` 1/26 with the eye 26 behind him, and that drew a wall at his back across the screen; cutting at the camera point instead left an edge in the picture, since with that lens what is beside him is well inside it.) Voxels nearer than `WALK_NEAR` (0.8) to the eyes are left out (`vNear`, in `rasterVox`, its point projection, the animals and `lampGlow`), so a bench he walks through does not fill the screen. Every other view sets `vNear` back to −1e9 in `updateView`.

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

**Enzo out on deck.** After `LOUNGE_WAIT` (15) seconds stopped in the overhead view with no key down (`restT`), Enzo comes up through the forehatch, walks out to the rail and sits on it, facing out with his legs hanging over the side. He leans back on one hand, rests the other on his knee, and his shins swing. `loungeStep` runs it and `drawEnzoOut` draws it.

- **Where he sits.** Each yacht has a `seat` (sloop 2.5, ketch 3.4, schooner 5.0). That is where its forehatch is, a little forward of the foremast, clear of the shrouds and of every boom, since booms swing aft. `buildYacht` paints the hatch there: dark (8) in a varnished frame (3).
- **Which side.** He picks the side that faces the camera when he starts: across +1 faces it when `sin(yaw + BOAT_ISO_YAW) > 0`. If the boat points at the camera, both sides are edge-on and either will do.
- **Size.** He is `PERSON` scaled by `LOUNGE_SCALE` (0.52), so about 2.9 tall, the same on every boat. That is a little over life size against the hulls, so he shows from the air. His voxels go into the rig buffers after the rig and are drawn inside the boat's own `voxBegin` … `voxEnd`. The hull and rig hide him where they should, and he heels and bobs with the boat. `voxGrain` sets the smaller splat size.
- **Pose.** It is built from the walking parts plus a knee (`PERSON_KNEE`). Each leg turns at the hip, and below the knee the shin turns back by the knee bend. The upper body leans back about the hip. While he climbs the ladder, nothing of him below the deck is drawn.
- **Timeline.** `lounge` runs from 0 to `LOUNGE_END`: `LOUNGE_RISE` 1s up the ladder, `LOUNGE_WALK` 0.8s to the rail, `LOUNGE_SIT` 0.9s down onto it. `loungeDir` is 1 going out and -1 going back in.
- **Going back in.** W, A or D sends him back. That plays the same timeline backwards, `LOUNGE_BACK` (1.6×) faster, and he turns to walk to the hatch face first. While he is out the boat holds still and does not turn. A W pressed meanwhile casts off as soon as he is down. Switching to first person puts him straight back in his seat, and so do V, E, and a world rebuild (`loungeReset`).

Overhead while aboard is not the close walking camera. It is isometric: no perspective (`vQ = 0`, `vC = 0`, `vK = 0`), `vS = 4`, camera on the boat at sea level, looking down at about 32° (`vTan = BOAT_ISO_TAN`, 0.62: height to depth on screen is 1 : vTan) from a fixed diagonal (`vYaw = BOAT_ISO_YAW`, π/4). The world does not turn with the boat: map cells stay diamonds and the boat turns on the screen. At that shallow angle a cloud would sit over the boat, so `drawWorld` opens a round hole in the clouds around it (`holeR`, 27 × `vS`, its outer 40% dithered with `BAYER4` so it reads as thinning cloud). Cloud shadows on the water stay. Walking, seen from above, a cloud can drift between the camera and the man, so the clouds open the same way around him: centred on his middle (`WALK_MID`, 2 up) as projected, `WALK_HOLE` (8) units across at his scale on the screen. The person is not drawn in that view while sailing, only once he comes out on deck. The blue pennant marks the boat you are in. The figure is not drawn in first person, because `drawWalker` only runs for the walking overhead.

First person aboard (Space) is a seat at the forward end of the cockpit (`yachtEyeF`: cockpit end minus 0.3), `YACHT_EYE` (2.4) over the deck, rising and falling with the boat's own bob. Like the plane's cockpit and walking in first person, it is a true wide lens: the camera point is `BOAT_LOOK` (4) ahead of the eye, `vQ = 1 / BOAT_LOOK`, focal length `0.45 * max(W, H)`, no look-down, horizon at `0.34 H`. The boat you sit in then fills the bottom of the picture as it would: the cabin top and varnished trim close below, the mast and stays ahead, the sail on the leeward side with its seams, the foredeck and bow beyond. Everything of your own boat more than 0.5 behind the eye is cut (`yCut`), and so is the wake behind it. Your boat also writes `zbuf` in this view (`yZW`), so the plane does not show through the sail.

Once you are sailing in first person, the rig turns see-through so it does not hide the view. `rigGhost` eases from 0 to 1 (rate 1.6/s) while `sailing && footView === 1`, and back when you stop. Each rig voxel carries a tag in `rigT`, set by `rigVox` / `rigSail`: 0 never fades (masts, spars, the two-voxel edges of each sail), 1 sail cloth, 2 rope and sail seams. `rasterVox` drops pixels against a 4×4 Bayer pattern (`BAYER4`), keeping `1 - 1.1 * rigGhost` of the cloth (none at the end) and `1 - 0.6 * rigGhost` of rope and seams. Only the boat you sit in, only in first person (`yFadeT` is set just for that rig pass and cleared in `voxBegin`).

**Free boats.** After the dock boats, about 8 more are scattered along coasts, at least 70 apart, in water with some land nearby but not in a tight cove. Speed is 5.2–8.4. They bob, pitch and heel. A wake (two V arms and a stern wash) is drawn while moving. The boarded boat and any `moored` boat are skipped by this AI.

They do not sail onto land. `seaClear` looks up to 52 cells along the heading, and along the beam for the first 20, and a step is refused unless the next cell, the bow, and both sides are water. Inside 34 cells of shore they commit to a turn (`avoid`, held for a short time so they do not wobble into the beach) and slow down. Very close land off the beam turns them away. Otherwise they sail parallel to a nearby coast, or curve back toward land when the sea around them is empty. Another boat within 26 ahead is steered around, and they will not step onto a hull.

Four of them (`intent` 0) keep sailing. Two (`intent` 1) pick the nearest dock whose water just seaward of the moored sloop is clear (`offDock`, 24 out along the pier heading) and tie up there, facing the same way, sails furling, and stay. Two (`intent` 2) sail for at least 28s, then drop the sails and stay when they are a little off a shore (land 16–24 away), with open water ahead and around the hull and no dock within 40. Furling is the same as a boat you have stopped: `moored` makes `trimSails` ease `sail` to 0. W after boarding clears `moored` and the boat sails again. An anchor boat waits another 28s before it will drop sail once more.

## Fish and whales

Both are flat shapes on the water, drawn from above rather than as tall stacks, so the overhead views read them as something just under the surface. Scale is the person’s. The figure stacks to about 8 and spans about 4.5 across the arms. A fish is about 5 to 7 long, shorter than that figure. A whale is about 14 to 17 long and a sixth of that across, a few times a person and still a small mark on the map.

Eight schools of 4 or 5 fish. Three of those schools start within a few hundred of the jet’s spawn; the rest are scattered in water that is not the surf line. A school shares a kind (`FISH_KIND`): mackerel (blue-green back with dark bars), yellowtail (yellow side stripe), or coral snapper. Members follow the lead fish’s heading and drift back if they stray past 20. They swim at about 8 to 12 and turn off land. Each fish is a spindle body with a forked tail and pectoral fins, the body bends in a swimming wave, eyes show when close, and a silver flash shows now and then.

Three whales, in the deepest water only (material 0), at least 480 apart. One starts a few hundred from spawn. They cruise at about 3 to 5 and turn gently toward deeper water. Nothing hunts them and they do not interact with boats or the person. They are humpbacks: dark back, pale scalloped flippers, knobs on the head, scars, notched flukes. Each runs a 17 s cycle (`WHALE_CYCLE`, `whaleState`): it surfaces over 1.4 s and stays up about 5 s with a foam ring, a blow of spray drifting downwind, and its back humped above the water, then dives with the flukes raised clear of the water, then cruises under the surface.

Fish and whale bodies are flat shapes under the surface, drawn with `rasterFlat`: for each screen pixel it finds the world point on the water plane and asks a shape function for the colour, blended with the water by depth (`flatSub`). That keeps them crisp at any zoom in every view. The parts above the water (the back hump, the raised flukes) are voxels drawn with the boat rasterizer.

`placeLife` runs at the end of `buildWorld`, so a new seed replaces them. `stepLife` moves them. `drawSeaLife` runs just before the boats.

## Birds

Gulls only, and few of them: about 20 on a map. `birds[]` holds each one's path, not its position. `drawBirds` works out where it is from `time`, so there is no step function and nothing to save.

8 colonies of 2 to 4, over shallow water (material 1–3) with land on 1 to 5 of 8 rays 22 out, so by a shore but not in a cove. Colonies are at least 220 apart, and the first is 60 to 260 from the spawn. Each gull circles its point at radius 10–18, at 10–16 up with a slow rise and fall, the whole colony turning the same way. It banks 0.3 into the circle and glides with the wings a little raised, flapping for a while now and then. White body, grey wings with black tips, yellow bill.

The model is `GULL`, built with `propModel` at `GULL_G` (0.25). The wing voxels are tagged part 1 (left) and 2 (right), and `drawBirds` turns them about the shoulder (`GULL_SHOULDER`) by the flap angle, both sides up together, normals included. Gulls are drawn within 600 of the camera and on screen, after the boats. From a cruising plane they are specks; they read best on foot, aboard, or flying low. `placeBirds` has its own random stream (seeded from the world seed), so adding birds did not move the clouds.

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

**The cockpit** (`cockpit.ts`) is an open 1920s cockpit, no HUD and no radar. It is rebuilt when the frame size or the plane colours change, not when the light does (see "Day and night"). Three layers parallax with the head: the nose (blue deck, the front cockpit, three cylinder heads), the wings (the upper wing's underside with ribs, cabane and interplane struts, wires, the lower wing at the sides), and the near layer (windscreen frame, leather coaming with stitches, side walls, the black panel). Drawn live each frame: the propeller disc, the windscreen glass, needles, the throttle knob, and the stick leaning with turn and climb. Gauges are speed, engine rpm (with a red line), altitude (two hands), oil, fuel (dummy, slowly falling), and a card compass under a red lubber line. It only composites when the view is rolled onto the sheet, which is the cockpit and hard rolls.

## Drawing the small actors

Boats, the person, and the parts of whales above the water go through a small voxel rasterizer. `voxBegin(x, y, z, yaw, heel, pitch, g)` sets up the object's transform and screen box. `rasterVox` projects each voxel with the world camera, splats it as a square, and shades it from the sun with four tones per material (shadow, side, top, lit side). Sails are lit from both faces. `voxEnd` clears the object's scratch buffers. There is no dark rim around objects. Each object has its own depth buffer `akey`: squared distance to the eye in the perspective views, depth along the view in the flat ones. The world `zbuf` is read to hide voxels behind terrain. Only your own boat in first person also writes it (`yZW`). `drawBoats` sorts boats far to near, and `drawYacht` picks the level of detail from the screen scale (`m0 >= 9` finest, `>= 2.2` middle), or the extra-fine one for your boat in first person.

`drawGardens` draws the statues, benches and urns the same way, after the sea life and before the boats. `drawBirds` follows the boats.

`drawWalker` copies the `PERSON` voxels into the rig buffers with the legs and arms swung, then rasterizes them like a boat. It is skipped when `footView !== 0` or when `aboard >= 0`. Aboard, `drawEnzoOut` poses him into the same buffers from inside `drawYacht` instead (see "Enzo out on deck").

Shared palettes (`yachtPal`, `lifePal`, `shutterLit`, `shutterShade`) are rebuilt in `rebuildPalettes`, so they follow the time of day and fog like the world.

## Debug log

`src/lib/log.ts` keeps the last 300 notes and prints them. The browser console has it as `gameLog`.

- `gameLog.dump()` shows recent lines. `gameLog.clear()` wipes them.
- `gameLog.enabled = false` silences it. `gameLog.level = 'warn'` keeps failures only.
- `gameLog.child('foot')` is a scoped logger. The scene already uses `world`, `foot`, `boat`, and `night`.

The world line lists islands, specks, docks, boats, fish, whales, gardens, viewpoints, props, wildflower cells, birds, and where the chapel and the temple are. Each of those two also has its own line: the villas near it, the garden's length or the wood round it, the path, and how far it is from the spawn. If one finds no room, it warns. V logs where the person stood (`nearby`, `dock`, or `island`) or `nowhere to stand`. Boarding logs a boat, a missing boat, stepping ashore, or no shore.

## Easy to get wrong

- Flight pitch is inverted in the React key mapper only. The scene’s `setKeys` treats positive climb as up. Walking must keep sending positive move for W.
- Palette arrays must stay the same length. `NMAT` is `MAT_TOP.length`.
- A colour that changes with the light goes through `gradeT`, `mix3` or `mixN` in `rebuildPalettes`, never through a test of `p.timeOfDay`, which is only where the light starts. Lamp materials stay at the end of `YACHT_COL`, because `k >= YM_LAMP` is what makes a material a lamp. The window hash in `drawWorld` and in the GPU shader must stay the same.
- `floorMap` has to be copied before forests. If walking uses `heightMap` in the trees, the person stands on the leaves. If leaves stay in `standable`’s block list, the person cannot pass between trunks.
- Dock normals have to come from the ocean mask. A cardinal step looks diagonal to a diagonal beach, and a lake will accept a “deep water” test that only looks a few cells out.
- Overhead cameras with `vC` or `vK` above 0 draw the sky volume. The walking camera must stay under `CLOUD_ALT` or the view fills with cloud. The boat aerial view stays orthographic (`vQ`, `vC`, and `vK` all 0) so it does not enter that volume. Its look-down is only `vTan`, and only the cloud hole keeps clouds off the boat. The walking view overhead opens a hole around the man the same way (`f.holeR` in `worldFrame`, used by the CPU and the GPU).
- A moored boat must be skipped in `stepBoats`. Clearing `moored` on W is what casts off (`castOff`). S stops by clearing `sailing` only.
- Enzo out on deck is drawn from the rig buffers after the rig has been rasterized, so `drawEnzoOut` must come after the rig's `rasterVox` in `drawYacht`. Anything new that resets or leaves the boat you are in should call `loungeReset`, or he can come back sitting on a different boat. A new yacht needs a `seat` clear of its shrouds and booms, on a part of the deck wide enough for the walk out (`yachtHalf` there minus 0.5).
- World rebuild resets `aboard` inside `placeDocks` and reseats the walker if they were on foot. The reseat also skips specks.
- New wall or roof materials have to be added to `isBuilt`, and a house's walls and roofs to `FACADE`. Otherwise the person walks on roofs, bombs leave walls standing, or the facade does not show.
- `facadeAt` in `scene.ts` and in the shader, and the walk back to where a ray came into a house, must stay the same in both renderers. `enzoScene.compareGround()` counts the pixels where they differ.
- Boats do not write `zbuf`, except your own in first person. Otherwise the jet is drawn after them and lands on top, even when behind a sail. The chapel and the temple always write it, and are drawn before anything else that stands, so they hide what is behind them.
- A building drawn as voxels over ground cells needs its cells in `parkMap` 4 with a height in `monumentTop`. Without it, the plane flies through it, the person walks into it, and bombs crater the ground under it.
- The boat first-person camera and the walking first-person camera are different lenses. The walking one is long (the eye 26 behind the camera point), so anything of your own boat near the eye would sit in the middle of the picture as a cut-open hull. Keep the boat on its wide lens.
- Trees are found with `isTree` / `isTrunk`, not by material range. Checking only 9–11 misses firs and round-crowned trees.
- `drawWorld` must capture `Rp` and `mp` before it advances the depth step, or the shutter bands slide up and down the walls as the camera moves.
- Any change to how `drawWorld` colours a pixel has to be made in the shader in `gpu-world.ts` too. Check with `compareGround()` in every view.
- Anything that changes `heightMap` or `matMap` after `buildWorld` must push the changed rows onto `GW.dirty` (or bump `GW.stamp`), or the GPU keeps drawing the old ground. The tallest column (`uHMax`) is only measured on a full upload, so changes may lower the ground but not raise it above that.
- Garden materials are 43 and up, and `stampHouse` rejects any of them under a new yard. Gravel walks are 4–5 like the yard and the sand, so they are protected by `parkMap`, not by material. Keep every new layout marking `parkMap` and checking it.
- Prop and bird colours are boat materials. Append them to `YACHT_COL` and give each a `YM_` constant; `yachtPal` follows `NYM`.
- Anything new placed in `buildWorld` that draws random numbers should get its own `mulberry32` stream, as `placeBirds` does. Drawing from the shared one shifts everything after it, clouds included.
- The flower bloom reads the pixel's world position inside its cell (`wx − gx`, `wy − gy`). Close up, depth steps are half a cell, so the bloom is about one step deep, and far away most samples miss it, so flowers thin out with distance.
- `stampBelvedere` must measure the distance from the water before it stamps the terrace. The terrace fills in water cells, so measuring after would leave no band at its ends to start the promenade from.
- A speck is marked from the cells counted in its own flood. Do not flood again after piers exist. A pier is land, so a second flood can walk off the speck onto a real island and then V finds nowhere to stand.

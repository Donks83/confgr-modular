# A1 — what is wrong with the YouK connection rules, measured

Branch `rework/a1-audit`, 12 November 2026. No product code was changed to produce this; the
only new code is the audit harness in `tools/audit/`.

**How to reproduce everything here**

| Evidence | Command |
|---|---|
| Every guided product, checked against physical invariants, plus every move / dot / add / remove / option change replayed the way the runtime records it | `npx vite-node tools/audit/sweep.mjs` → `docs/audit/sweep.json`, `sweep.txt` |
| What deleting a part in the editor leaves behind | `npx vite-node tools/audit/editor-delete.mjs` |
| Every editor probe scenario, with the collision survey appended | `tools/probe-bay.ps1 -Scenario <name> -Append collisions` → `docs/audit/probe/` |
| Do the joints fit the metal | `npm run joints` |

Every finding has an `?o=` link. Paste it after `confgr-youk.netlify.app/` or after the local
runtime to open the exact product.

**Severity:** **S1** a customer can order something that cannot be built or is not what they saw ·
**S2** the configurator does something other than what it offered · **S3** wrong but harmless,
or polish.

**Layer:** where the fix belongs. *rule* is the connection/support logic, *state* is
choices/slots/ids, *data* is guided.json / snap-spec.json, and *UI* is the runtime's surface.

## Summary

Across **480 products and 16,531 builds**, five things **held without exception**: every frame
stands on the floor, every bay's own shelf is held at both ends, nothing passes through anything,
no assembly is invalid, and every configuration id gives back the identical product.

So the faults are not in the joint geometry. They are in four places:

- **(a) What gets placed by default.**
- **(b) The interaction paths** (dots, drag, the move list), which ask different questions from
  the rebuild.
- **(c) The editor's delete.**
- **(d) The schema and the surface.**

Every row below was reproduced, not reasoned. Rows marked *known* were already in the project
doc and are confirmed still true.

## The table

| # | Configuration | Expected | Actual (evidence) | Layer | Sev |
|---|---|---|---|---|---|
| **F01** | Any grounded product with a **side rack** (008542/43) — L1 | Refused with a reason, or placed where it clears the floor (your rule: refused below the floor when grounded) | Placed on rung 1, its base **58.5 mm below the floor**. In 4,462 of the swept builds (d320 and d200 racks). **Live on confgr-youk.netlify.app**: the runtime's own layout says `008543 … @ -57.8,-58.5`, and the product reads **1559 mm** tall on a 1500 frame | rule | S1 |
| **F02** | Any grounded product with a **YouboXx** (008547) — L2 | As F01 | Base **12.3 mm below the floor**. In 988 builds. Live: `008547-youboxx-set-4 @ 62.4,-12.3` | rule | S1 |
| **F03** | The floor rule exists in **one** path only | One rule, used by place, move, guided auto-placement and validation | `moveCandidates` filters below-floor heights (guided.js:638); `autoAttach`, `addPoints`, `validateAssembly`, the editor and `resolveConfiguration` do not. That is why F01/F02 are placed and then **never offered again** in the move list — the part is somewhere the panel would refuse to put it | rule | S1 |
| **F04** | **200 mm deep, on feet** — the d200 variant's **default** mounting — L3 | Feet not offered for d200, or refused in words where the customer sees them | `guided.json` d200 `defaultMounting: "feet"`; 200 mm frames have no foot fixing. The engine refuses (`NO_FOOT_FIXING`) and **the runtime never shows it**: live, the product reads "3 parts" with no feet and no sentence. In 674 builds | data + UI | S1 |
| **F05** | Every invalid or unbuildable product (F04, F06) | Draft quote, not orderable (your decision today) | A full quote is produced and shown. `resolveConfiguration` computes `validity` and `quote` independently. The viewer's warning counts only `missingRequiredSnaps`, so a back-to-front part reads "0 parts not fully supported" (Viewer.jsx:485) | rule + UI | S1 |
| **F06** | Editor: **delete a frame or a span** in a 2–3 bay run with extra shelves, a rail or a full hook strip (`tools/audit/editor-delete.mjs`) | Refused, or the parts it carried are removed or flagged | **19 of 19** deletions leave a shelf, rail or strip **held at one end**, and `validateAssembly` says **valid** in all 19. `detach` cascades the graph's subtree; the graph is a tree, so the far end is never anybody's child. §8 risk 4, now measured | rule | S1 |
| **F07** | Guided: **move a ladder** (frame#1) to a height the panel offers — L4 | It goes there | It **springs back** to the floor. The move list offered a point on an **extra shelf** (`g6 mount-right`); the rebuild places frames **before** accessories, so that shelf does not exist yet and the record is dropped ("That position is no longer part of this product"). 128 panel moves and 213 drag/dot moves. **This is the spring-back fault; the root is build order, not the move list** | state + rule | S2 |
| **F08** | Guided: **tap a green dot** to add a shelf outboard of the first ladder (`g1 rung-1-left`) — L5 | Placed at the dot, or no dot | A dot is shown; the shelf goes **somewhere else** (g3 rung 2). `addPoints` asks only `attachMatrix`; the rebuild also requires both ends held, refuses the dot, and auto-places. 912 cases (metal, timber, d200 timber) | rule | S2 |
| **F09** | Guided: tap a dot to add a **depth hook strip** at `g3 rung-1-left` — L6 | Placed at the dot | Placed on the next ladder instead (the survey refuses the dot for a clash `addPoints` never checks). 24 cases | rule | S2 |
| **F10** | Guided: **remove an accessory**, where the others were auto-placed — L7 | Nothing else moves | Other auto-placed parts **jump**: removing the metal shelf moves the timber shelf from bay 2 to bay 1 (x 705 → 235). Removing a rail flips a side rack to the other face of the ladder. 228 cases. Only parts with a recorded position stay put | state | S3 |
| **F11** | **Clothes rail**, auto-placed | At a usable hanging height | Placed on **rung 1, its base 26 mm above the floor** — "lowest first" is right for shelves and wrong for a rail | rule (policy) | S2 |
| **F12** | **Clothes rail in a 3-bay wardrobe** | One per bay should be possible | `max: 1` is per **run**, not per bay (`perBay` is documented in guided.json and never read) | data + state | S2 |
| **F13** | **d200, 900 wide** (and a 450+900 mixed run) — L8 | Only what fits is offered | Clothes rail and full-width hook strip are **listed** for d200 w900, and can never fit (both are `youk-d320` parts). Already greyed with a reason, so it is honest, but they should not be in the d200 schema | data | S3 |
| **F14** | **Cabinets over two or more bays** (Carcass holder sheet, MA 406214 p.1 & 4) | The middle ladder takes **one extension bracket** carrying **two** cabinets, one each side | The extension bracket's single `carries` socket is on its centreline (§3.6). The sheet shows the wide plate holding the left and the right cabinet, so it needs **two** sockets, each 15.1 mm inboard of the ladder centre like the outer bracket | rule + data | S2 *(known, now explained)* — **fixed in A3/F14** (branch `rework/a4-cabinets`): the extension bracket carries at ±15.1 mm; two 900 cabinets sit either side of the middle ladder, every end held (`tests/cabinets.test.js`, render `docs/audit/img/F14-two-cabinets.png`) |
| **F15** | Cabinet sheet p.3 | A cabinet is fixed to the wall at its top by an angle | Not modelled and not on the quote as a note, unlike the wall fixings and packers, which are | data | S3 |
| **F16** | Configurations from Kesseböhmer's photography and sheets that the **guided** options cannot reach | Reachable | Cabinets, desks, umbrella stands, shoe racks, 450/600 width hook strips, d200 at 600/1200, YouboXx sets 2/3/5. And the **staggered floating run** in the sideboard photograph (frames hung at different heights, shelves spanning between them), reachable only one ladder at a time through the move panel | data (scope) | S2 |
| **F17** | Clothes rail and width hook strip seated on a rung (`npm run joints`) | Flush | **1.00 mm** inside the rung on all seven parts — the one family whose plug is computed rather than measured. Coat-rail sheet step 3 shows a 1.5 mm packer between the bracket and the shelf above | data | S3 *(known — for Kesseböhmer)* |
| **F18** | Office arm + clamping angle (`probe-bay.ps1 -Scenario officeclamp -Append collisions`) | The clamp sits at the board's edge | Clamp **25.0 mm into a 20 mm** desktop, plus 11.0 into 4.0. Unchanged since §5.16: the handed-arm question | data | S2 *(known — for Kesseböhmer)* |
| **F19** | Two configurators on one page (§2 hard rule) | Fully independent | Four violations in the shipped runtime: `window.__viewerLayout` (ViewerHost.jsx:131,159), the URL read and written by every instance (Guided.jsx:140,215–218), `window.location` read for AR and QR (Viewer.jsx:378,402), and `window.confgr` branching (ViewerHost.jsx:28). Found by reading; a two-instance page proving it is part of C | UI | S2 |
| **F20** | First load on the live site | Something on screen quickly; loading looks like loading | **32 requests, 4.6 MB, about 6 s** on desktop broadband before the product draws, all loaded one after another. Meanwhile "Loading the parts…" sits in the **error** box's styling | UI / perf | S2 |
| **F21** | The quote | A readable table | A monospace `<pre>` that scrolls sideways; the art. no. for timber reads `??` | UI | S3 |
| **F22** | Refusal sentences | Human | "Every position for that part is already taken **(11 tried)**". The capacity refusals themselves are **correct**: shelves fill the rungs in order and stop where the rungs run out | UI | S3 |
| **F23** | **A metal shelf and a timber shelf** in the same bay, e.g. 2 bays w900, 2 extra metal + 2 timber (found **after** the first table, by rendering it for the UI mockups) | One shelf per rung | **Both shelves at the same rung, in the same space, both on the bill of materials** (bay 1: metal and timber both at x 460, y 455). The metal shelf records only its near ladder, so the far ladder's rung looks free and the timber shelf takes it. Two coincident boards measure as a *lap*, not a pass-through, so neither the collision rule nor the survey objects. Now oracle O11 in the sweep: 1,082 builds, at every width. The same fault puts a **clothes rail and a full-width hook strip** in one space under rung 1 (142 builds) | rule | **S1** |

**Suspected, and not found:** stale `g#` ids moving parts after a count change. 360 option
changes (one more of each kind, one more bay) with a moved part on the product, and the moved
part stayed put in all of them.

**Not tested here, and needing your phone:** touch drag, the bottom sheet on a real phone, Quick
Look / Scene Viewer, and the AR files since the normals change.

## Links

Each link is `https://confgr-youk.netlify.app/?o=<code>`.

- **L1** side rack below floor: `eyJ2YXJpYW50SWQiOiJkMzIwIiwic2l6ZUlkIjoidzQ1MCIsImZyYW1lSWQiOiIyMzY3NTAtbGFkZGVyLWRlcHRoLTMyMG1tIiwiZnJhbWVzIjp7fSwid2lkdGhzIjp7fSwiYmF5cyI6MSwiYWRkcyI6eyJzaWRlLXJhY2siOjF9LCJhdCI6e30sIm1vdW50aW5nIjoiZmxvb3IiLCJmb290SGVpZ2h0TW0iOjEwMH0`
- **L2** YouboXx below floor: `eyJ2YXJpYW50SWQiOiJkMzIwIiwic2l6ZUlkIjoidzkwMCIsImZyYW1lSWQiOiIyMzY3NTAtbGFkZGVyLWRlcHRoLTMyMG1tIiwiZnJhbWVzIjp7fSwid2lkdGhzIjp7fSwiYmF5cyI6MSwiYWRkcyI6eyJ5b3Vib3h4IjoxfSwiYXQiOnt9LCJtb3VudGluZyI6ImZsb29yIiwiZm9vdEhlaWdodE1tIjoxMDB9`
- **L3** d200 on feet: `eyJ2YXJpYW50SWQiOiJkMjAwIiwic2l6ZUlkIjoidzQ1MCIsImZyYW1lSWQiOiIyMzY3NDYtbGVpdGVycmVnYWwtbGFkZGVyLWRlcHRoLTIwMG1tIiwiZnJhbWVzIjp7fSwid2lkdGhzIjp7fSwiYmF5cyI6MSwiYWRkcyI6e30sImF0Ijp7fSwibW91bnRpbmciOiJmZWV0IiwiZm9vdEhlaWdodE1tIjoxMDB9`
- **L4** ladder springs back: `eyJ2YXJpYW50SWQiOiJkMzIwIiwic2l6ZUlkIjoidzQ1MCIsImZyYW1lSWQiOiIyMzY3NTAtbGFkZGVyLWRlcHRoLTMyMG1tIiwiZnJhbWVzIjp7fSwid2lkdGhzIjp7fSwiYmF5cyI6MiwiYWRkcyI6eyJtZXRhbC1zaGVsZiI6MSwidGltYmVyLXNoZWxmIjoxLCJzaWRlLXJhY2siOjEsImhvb2stc3RyaXAiOjF9LCJhdCI6eyJmcmFtZSMxIjp7Imluc3RhbmNlSWQiOiJnNiIsInNuYXBJZCI6Im1kLXNuYXAueW91ay1kMzIwLm1vdW50LXJpZ2h0IiwibW91bnRTbmFwSWQiOiJtZC1zbmFwLnlvdWstZDMyMC5ydW5nLTEtbGVmdCJ9fSwibW91bnRpbmciOiJmbG9vciIsImZvb3RIZWlnaHRNbSI6MTAwfQ`
- **L5** shelf dot lands elsewhere: `eyJ2YXJpYW50SWQiOiJkMzIwIiwic2l6ZUlkIjoidzQ1MCIsImZyYW1lSWQiOiIyMzY3NTAtbGFkZGVyLWRlcHRoLTMyMG1tIiwiZnJhbWVzIjp7fSwid2lkdGhzIjp7fSwiYmF5cyI6MiwiYWRkcyI6eyJtZXRhbC1zaGVsZiI6MiwidGltYmVyLXNoZWxmIjoxLCJzaWRlLXJhY2siOjEsImhvb2stc3RyaXAiOjF9LCJhdCI6eyJtZXRhbC1zaGVsZiMxIjp7Imluc3RhbmNlSWQiOiJnMSIsInNuYXBJZCI6Im1kLXNuYXAueW91ay1kMzIwLnJ1bmctMS1sZWZ0In19LCJtb3VudGluZyI6ImZsb29yIiwiZm9vdEhlaWdodE1tIjoxMDB9`
- **L6** hook strip dot lands elsewhere: `eyJ2YXJpYW50SWQiOiJkMzIwIiwic2l6ZUlkIjoidzYwMCIsImZyYW1lSWQiOiIyMzY3NTAtbGFkZGVyLWRlcHRoLTMyMG1tIiwiZnJhbWVzIjp7fSwid2lkdGhzIjp7fSwiYmF5cyI6MiwiYWRkcyI6eyJtZXRhbC1zaGVsZiI6MSwidGltYmVyLXNoZWxmIjoxLCJjbG90aGVzLXJhaWwiOjEsInNpZGUtcmFjayI6MSwiaG9vay1zdHJpcCI6Mn0sImF0Ijp7Imhvb2stc3RyaXAjMSI6eyJpbnN0YW5jZUlkIjoiZzMiLCJzbmFwSWQiOiJtZC1zbmFwLnlvdWstZDMyMC5ydW5nLTEtbGVmdCJ9fSwibW91bnRpbmciOiJmbG9vciIsImZvb3RIZWlnaHRNbSI6MTAwfQ`
- **L7** after removal (timber shelf now in bay 1): `eyJ2YXJpYW50SWQiOiJkMzIwIiwic2l6ZUlkIjoidzQ1MCIsImZyYW1lSWQiOiIyMzY3NTAtbGFkZGVyLWRlcHRoLTMyMG1tIiwiZnJhbWVzIjp7fSwid2lkdGhzIjp7fSwiYmF5cyI6MiwiYWRkcyI6eyJ0aW1iZXItc2hlbGYiOjEsInNpZGUtcmFjayI6MSwiaG9vay1zdHJpcCI6MX0sImF0Ijp7fSwibW91bnRpbmciOiJmbG9vciIsImZvb3RIZWlnaHRNbSI6MTAwfQ`
- **L8** d200 w900 dead controls: `eyJ2YXJpYW50SWQiOiJkMjAwIiwic2l6ZUlkIjoidzkwMCIsImZyYW1lSWQiOiIyMzY3NDYtbGVpdGVycmVnYWwtbGFkZGVyLWRlcHRoLTIwMG1tIiwiZnJhbWVzIjp7fSwid2lkdGhzIjp7fSwiYmF5cyI6MSwiYWRkcyI6e30sImF0Ijp7fSwibW91bnRpbmciOiJmbG9vciIsImZvb3RIZWlnaHRNbSI6MTAwfQ`

## What the harness got wrong first, and how it was corrected

- Add-dots replayed past the schema's `max` produced false "not placed" rows for the rail and the
  full strip. The runtime disables + at max, so the harness now does too.
- "Removing X moved Y" rows that reported the same height turned out to be real moves sideways,
  between bays. The message now prints x as well as y.
- Rows for d200 parts that never existed (`from (x ?, y ?)`) are artefacts and are excluded above.

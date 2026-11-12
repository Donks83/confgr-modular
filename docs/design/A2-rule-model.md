# A2 — the connection rule model (proposal, not built)

**Status:** for Matt to approve, argue with or change before any of it is built. Written
12 November 2026, against the audit in `docs/audit/A1-failures.md`.

## The idea in five sentences

1. **A range's rules live in one data file**, `youk/rules.json`. It sits beside the catalogue,
   ships inside every bundle, and is checked when it loads: a rule the engine does not
   understand stops the load with its name, rather than being ignored.
2. **The rules are written per family** (frames, spans, hang-ons, cabinets, bolted parts, wall
   parts), and every rule carries the sentence a customer sees when it refuses something, plus
   where the rule came from (instruction sheet and page, FINDINGS line, or "Matt").
3. **The engine stops asking a tree what is holding what.** It works out every real contact,
   **both ends of everything**, from where the parts actually are. "Is this held up", "can I
   delete this" and "is this valid" are all answered from that.
4. **There is one judge.** A single `evaluate(product, action)` answers *"is this legal, and if
   not, why"*. The dots, the move list, drag, the guided builder, the editor, validation and the
   quote all call it. Nothing gets offered that the judge would refuse, because the offer *is*
   the judge's list of yeses.
5. **Nothing in it is Kesseböhmer's.** The engine knows contacts, families, ends, floors and
   sentences. "Rung", "ladder", "1.5 mm packer" and the foot's article number move out of the
   code (they are in it today) and into YouK's own file.

## Why this, and not the fixes one at a time

The audit found the joints themselves sound. All 22 failures come from **six places asking six
slightly different questions**:

| The question | Asked today by | So that |
|---|---|---|
| Below the floor? | the move list only | auto-placement puts a side rack 58.5 mm underground (F01–F03) |
| Held at both ends? | guided adds marked `spans` only | dots offer shelves the rebuild refuses (F08), and deletes leave shelves cantilevered (F06) |
| Collides? | guided survey only | the editor and the dots skip it (F09) |
| What is holding it? | the connection tree | the second end of every shelf is invisible to delete (F06) |
| Where was it put? | `g#` instance ids, in build order | a ladder moved onto an extra shelf springs back (F07); unrelated parts jump on remove (F10) |
| Can it be ordered? | nobody | invalid products get a full quote (F05) |

Fixing those one at a time is how the project got here: each fix is right, and lives in one path.

## 1. The rules file

A sketch of YouK's. Real values come from `snap-spec.json`, FINDINGS and the sheets, and
nothing here is a new measurement.

```jsonc
{
  "range": "youk",
  "version": 1,

  // How parts meet. A joint type is a kind of contact, not a part.
  "joints": {
    "rung": {
      "mask": "youk-d{depth}",              // the masks the GLBs already carry - unchanged
      "socket": { "sides": ["above", "below"] },   // one part rests on a rung, one hangs under it
      "toleranceMm": 1,
      "because": "A rung carries a shelf on it and an accessory hooked over it (MA 406209)."
    },
    "carry":  { "mask": "youk-{carries}-d{depth}", "vertical": true, "toleranceMm": 1 },
    "bolt":   { "mask": "youk-{boltMask}", "toleranceMm": 0.5 },
    "foot":   { "mask": "youk-foot", "implied": true }
  },

  // What every member of a family must satisfy. Parts join a family in the catalogue.
  "families": {
    "frame": {
      "stands": "floor-or-held",            // on the floor, or hanging from something that is held
      "rules": [
        { "rule": "mountingNeeds", "mounting": "feet", "socket": "foot",
          "says": "The {depth} mm ladders have no fixing for a foot. Stand it on the floor or hang it on the wall.",
          "source": "MA 405462 / FINDINGS 'Foot'" }
      ]
    },
    "span": {
      "held": "every-end",                  // both plugs in contact, always - not only for guided adds
      "says": "A {label} must rest on a ladder at both ends."
    },
    "hang":    { "held": "any-end" },
    "carcase": {
      "held": "every-end",
      "says": "A cabinet sits across two brackets; there is nothing under its {end} end.",
      "source": "MA 406214 step 3"
    },
    "bolted":  { "held": "every-end" },
    "wall":    { "stands": "wall" }
  },

  // True of the whole product, whatever the part.
  "product": [
    { "rule": "notBelowFloor", "when": "grounded", "toleranceMm": 1,
      "says": "That would put the {label} {mm} mm below the floor.", "source": "Matt, 12 Nov 2026" },
    { "rule": "noPassThrough",
      "says": "The {label} would pass through the {other}." },
    { "rule": "notTwiceInOnePlace" }
  ],

  // Where a part may go, beyond what the joint allows. Today's `condition` moves here.
  "placements": [
    { "parts": ["008551-base-brackets-for-office-solution"], "onlyAt": { "rungFromBottom": { "min": 3 } },
      "says": "The office solution fits from the third rung up.", "source": "Office solution sheet, rungs 1–2 drawn red" }
  ],

  // Not legality: what auto-placement prefers when several places are legal.
  "preferences": {
    "default": "lowest",
    "byKind": { "clothes-rail": "highest" }   // F11 - for Matt to confirm
  }
}
```

**The closed vocabulary.** `stands`, `held`, `mountingNeeds`, `notBelowFloor`,
`noPassThrough`, `notTwiceInOnePlace`, `onlyAt` and `preferences`. That list is everything the
audit and the last nine sessions needed, and nothing else.

**Why it is checked on load.** Loading checks every rule against a schema. A misspelt key, a
rule naming a part that is not in the catalogue, or a sentence with an unknown `{placeholder}`
all **stop the load with a message**, the way `condition` fails closed today. A rule that is
silently ignored is worse than no rule.

**The future snap editor edits this file.** Every rule is a row someone can read: a family, a
condition, a sentence, a source. That is the table §6 Phase 1 asks for ("rules authored in a
table, not code").

**What stays in the GLBs.** Snap positions, masks and roles: geometry, measured by the pipeline
exactly as now. The rules file says what those snaps *mean*; it never repeats a position.
`snap-spec.json` stays the authoring input for geometry; `required`, `minRung → condition` and
the implied foot's hard-coded ids move out of it, and out of `implied.js`, into the rules.

## 2. Contacts instead of a tree

After every change the engine computes the **contact set**: every pair of compatible snaps, a
socket and a plug, that touch within the joint's tolerance, facing each other. Both ends of a
shelf, both brackets under a cabinet, a ladder hanging off a shelf's free end. This is what
`supportedByGeometry` already does for one question; it becomes the structure everything reads.

- **Held** means: the part's family rule is met by its contacts. A span needs every end, a
  hang-on needs one, a frame stands on the floor or hangs from something held.
- **Supported** means: following contacts from the ground (or the wall) reaches the part. This is
  one pass over the contacts, so a shelf whose last ladder was deleted is found immediately.
- **The recorded connections stay**, as the *intent* (which joint the customer chose, which of a
  ladder's rungs it hangs by). They no longer decide what is holding what. Positions are still
  derived from them, so ids, URLs and the AR export keep working unchanged.

**Deleting**, with the judge in charge:
- **Guided runtime:** a part that would leave something unsupported can't be removed, and the
  panel says which parts it holds ("This ladder holds 2 shelves and a rail."). Bays and widths
  stay the way to change the structure, as now.
- **Editor:** delete removes the part and everything that is then unsupported, and **lists what
  went**, with undo. Never a cantilever left behind looking valid (F06).

## 3. One judge

```
evaluate(product, action)  →  { ok, product?, reasons: [{ rule, says, part, source }] }

action = place(part, at) | move(part, to) | remove(part) | setOption(name, value)
```

Every caller uses it:

| Caller | Today | With the judge |
|---|---|---|
| Green dots / ghost | `attachMatrix` only | candidates from `attachMatrix`, **kept only if `evaluate` says ok** |
| Move list, drag | `moveCandidates` (its own floor check) | the same: `evaluate(move)` per candidate |
| Guided builder | `autoAttach` + `survey` + `requireFullyHeld` | `evaluate(place)` per candidate, then `preferences` to choose |
| Editor attach / delete | none / `detach` | `evaluate(place)` / `evaluate(remove)` |
| Validity | `validateAssembly` (required + back-to-front) | `evaluate` of the whole product: every family and product rule |
| Quote | ignores validity | `quote.status = "orderable"` or `"draft"` with the reasons (your decision: the BOM and price stay visible, send/order disabled) |

**"The move list must never offer what the rebuild refuses" then becomes a test, not a hope.**
A property test takes every offer the dots and the move list make, applies it, rebuilds, and
asserts the part is where it was offered. That is exactly the sweep's I1–I3 oracles, kept as a
permanent test.

**Cost.** `evaluate` on a hypothetical product is what `survey` does today for every guided
candidate, so the price is known: the full sweep (16,531 builds plus 11,000 replays) ran in
8 minutes. The interactive cases are one product at a time. I'll measure it on a mid-range phone
in C rather than assume it is fine.

## 4. Where a part was put: addresses, not instance ids

The spring-back (F07) and the jumping parts (F10) have one cause. A recorded position names an
**instance** (`g6`), and instance ids come from build order, so a record can point at something
the rebuild has not placed yet, or at a different part after a removal.

Proposal: a recorded position names a **slot** and a snap. "`frame#1` hangs from the right end
of `metal-shelf#0` by its rung 1", not "from g6".

- The builder places slots in **dependency order**: a slot whose record refers to another slot
  waits for it. A ladder hung off an extra shelf therefore gets built after that shelf (F07).
  A loop is refused by the judge with a sentence.
- Auto-placed parts get their address **recorded once placed**, so removing one part does not
  re-place the others (F10). They stay where the customer saw them.
- Old `?o=` records with `g#` ids are translated on load; the translation is the migration in §6.

## 5. How each failure from the audit is closed

| Failure | Closed by |
|---|---|
| F01–F03 below the floor | `notBelowFloor` product rule, enforced by the judge in every path. The default rack goes to a rung where it clears the floor, or is refused with the sentence |
| F04 d200 on feet | `mountingNeeds` on the frame family. The mounting control greys "Feet" for 200 mm with the reason; the d200 default becomes the floor (data fix) |
| F05 quote while invalid | `quote.status` from the judge: a draft with its reasons |
| F06 delete leaves cantilevers | contacts + supported-from-the-ground (§2) |
| F23 two shelves on one rung | contacts again: a rung under a shelf's far end is **occupied**, because occupancy is read from contacts rather than from recorded joints. Plus the `notTwiceInOnePlace` rule widened from "same part" to "same space" |
| F07 ladder springs back | addresses + dependency order (§4), and the property test |
| F08, F09 dots that lie | dots filtered by the judge |
| F10 parts jump on remove | auto-placed addresses recorded (§4) |
| F11 rail at the floor | `preferences.byKind` |
| F12 one rail per run | `max` gains `per: "bay"`, which `guided.json` already documents and never reads |
| F13 dead controls on d200 | data fix in `guided.json`, plus a load check that every offered kind can attach to at least one of the variant's frames |
| F14 multi-bay cabinets | data: the extension bracket gets **two** carry sockets, each 15.1 mm inboard, per MA 406214 p.1/4. Re-run snap → declare → normals → materials, then a probe scenario of two cabinets over two bays |
| F15 cabinet wall angle | a counted note like the wall fixings, from the rules file |
| F16 configurations not reachable | not a rule. This is guided-schema scope, to decide separately (cabinets and desks in the guided options) |
| F17, F18 | still Kesseböhmer's questions; no rule change |
| F19–F22 | workstreams B and C |

## 6. Keeping old links working

- **Configuration ids (`?c=`)** store part ids and snap ids (`md-snap.youk-d320.rung-2-right`).
  Nothing above renames a mask or a snap, so **v1 ids keep resolving unchanged**. If a later
  change ever has to rename one, `decodeConfiguration` gains an alias table and the id version
  goes to 2, refusing nothing it can translate.
- **Choices (`?o=`)** gain a version field. Version-less links are today's format:
  - `g#` instance ids in `at` are translated into slot addresses by building the old product
    once and reading which slot each `g#` was;
  - the old component-keyed `adds`, which `normaliseChoices` already migrates, keep that
    migration.
- **The test that proves it:** a fixture file of real ids and `?o=` strings, taken from the
  deployed site and the audit links (L1–L8) **before any code changes**, each opened by the new
  engine and compared part-for-part with what the current engine draws. Where the new engine
  differs, it must be one of the audit's failures being fixed (a rack lifted off the floor),
  listed in the fixture beside the link.

## 7. Coverage generated from the range, not written by hand

`tests/rules-matrix.test.js` builds its cases from `catalogue.json` + `rules.json` + the GLBs, so
a part added to the range is covered the moment it is added.

- **Every socket × every plug that shares a mask:** the joint holds, faces the right way, sits
  within tolerance, and leaves nothing below the floor when grounded.
- **Every family rule:** one case that passes and one that is refused, with the refusal's sentence
  asserted to contain the part's label.
- **Every placement rule** (`onlyAt`): every snap it allows and every snap it forbids.
- **Every guided kind × every variant:** offered means placeable somewhere (F13 can't recur).
- **The sweep's interaction oracles** on a fixed sample, as above.

The matrix also has to pass on the **synthetic test rack** in `test-assets/` (a second, made-up
range), which is the cheap proof of §2's "does this work for the next client's range?". It is
also how the suite keeps working on a checkout with no supplier geometry.

## 8. What this does not change

- Joint geometry, masks, snap names, the pipeline order, Matt's colours, the light build space.
- Guided options remaining **intent** (choices plus addresses), with the product a pure function
  of them.
- The engine staying headless, and the runtime staying free of the editor.

## Decisions I need from you

1. **Deleting in the guided runtime:** refuse with "this ladder holds …" (proposed), or remove
   the ladder and everything it holds, with undo?
2. **The clothes rail's default height:** the highest rung that fits (proposed). On a 2210 that
   is about 1.76–2.1 m, on a 905 the top rung. Or a fixed hanging band, e.g. 1.6–1.9 m where the
   frame reaches it?
3. **Clothes rails per bay rather than per run** (`max: 1` per bay): yes?
4. **Should a ladder be allowed to hang off an extra shelf in a floor-standing product** (a
   staggered run, its foot in the air, held by its wall fixings)? The editor's `stagger` scenario
   says yes; the sideboard photograph shows it on a floating run. Proposed: yes for floating,
   yes for floor-standing.

## Size

About 2–3 sessions, as planned:

1. The rules file, schema and loader, with YouK's rules written from snap-spec, FINDINGS and the
   sheets.
2. Contacts, the judge, every caller moved onto it, and addresses.
3. The migration fixtures, the generated matrix and the extension-bracket data fix.

Each step ends green with the sweep re-run; the sweep's failure count is the progress measure.

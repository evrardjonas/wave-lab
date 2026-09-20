import { Multilink } from "scenerystack/axon";
import type { TReadOnlyProperty } from "scenerystack/axon";
import { clamp } from "scenerystack/dot";
import { Node, Path, RichText } from "scenerystack/scenery";
import { Shape } from "scenerystack/kite";
import { PhetFont } from "scenerystack/scenery-phet";
import { AIR_DENSITY, FREQUENCY_RANGE, SoundWavesModel, angularFrequency } from "../model/SoundWavesModel.js";
import { VIEW_WIDTH_METERS, type ViewZoom } from "./ParticleFieldNode.js";

// This file is VIEW code. All physics (the pressure values themselves) lives in the model; this file only
// reads model.sampleAtRadius(r).pressure - the SAME spherical-mode API PressureFieldNode.ts and
// CompressionTrackerNode.ts already read - at a 2D grid of (x, y) points and renders it as a pseudo-3D
// "ridge plot" (a layered, isometric-style mountain-range silhouette) instead of PressureFieldNode's flat
// shading or PressureGraphNode's flat line chart. NOT a new pressure computation, and NOT a new physical
// effect - see the caption built in the constructor below, which says exactly that on-screen (and spells
// out several other read-it-carefully caveats - see CAPTION_TEXT's own comment).
//
// WHY THIS EXISTS: PressureGraphNode.ts is gated to PLANE mode only (it only ever samples model.sampleAt(x),
// never sampleAtRadius(r) - see that file's own class doc) - so before this file existed, checking "Show
// pressure graph" while in SPHERICAL mode showed nothing at all. This Node is that Property's spherical-mode
// counterpart (see SoundWavesScreenView.ts's isometricMapVisibleProperty), reusing the SAME checkbox/Property
// rather than adding a second one.
//
// RENDERING TECHNIQUE ("ridge plot" / "joy-division-style" layered silhouette): sample a square (x, y) grid
// centered on the spherical source, compute r=hypot(x,y) at every sample, look up model.sampleAtRadius(r)
// .pressure there, and draw each row of samples as a separate filled+stroked profile, with FARTHER rows
// drawn first and shifted up-and-sideways by a small per-row amount, and NEARER rows drawn last (so they
// occlude the farther rows behind them) - a real, widely-used 2D charting technique for faking a 3D
// mountain-range view with no actual 3D transform, not anything modeled on a specific existing simulation.
// Because the model's spherical pressure field is radially symmetric (a function of r alone), sampling a
// SQUARE grid this way naturally reproduces the field's true concentric-ripple structure once projected -
// no special-casing for "draw rings" is needed anywhere in this file.
//
// SCREEN-SPACE DESIGN, NOT A PHYSICAL SCALE: unlike ParticleFieldNode/PressureFieldNode (which convert
// meters to pixels via sphericalPixelsPerMeterForZoom so their geometry matches the visible particle field
// 1:1), this ridge plot's on-screen row spacing/skew and PLOT_WIDTH are a FIXED, purely artistic pixel
// layout - only the SAMPLED PHYSICAL (x, y) positions feeding into model.sampleAtRadius(r), and (see
// "SAMPLE GRID RESOLUTION" below) how many columns get packed across that fixed pixel width, depend on the
// current zoom. This is intentional: this diagram's job is to show the wave's 3D SHAPE compactly in a
// narrow strip of free stage space (see SoundWavesScreenView.ts's placement comment), not to be a to-scale
// companion to the particle field - see the on-screen caption's own "not to scale" sentence.
//
// REBUILD/REDRAW SPLIT (mirrors ParticleFieldNode.ts/PressureFieldNode.ts/PressureGraphNode.ts's own
// established convention): rebuild() - triggered by viewZoomProperty and model.speedOfSoundProperty (the
// latter is currently a fixed constant - see SoundWavesModel.ts - but included for the same
// future-proofing reason ParticleFieldNode.ts's own rebuild Multilink already includes it) - recomputes
// BOTH the current column count (see computeColumnCount() below - this is the MUST-FIX numerical
// correctness fix: column count now scales with zoom, it does not stay fixed) and the cached grid of
// sampled RADII (this.rGrid). redraw() - called every frame from step() - re-samples
// model.sampleAtRadius(r).pressure fresh at every cached radius and rebuilds each row's Shape, never
// advancing the model.

// ---- Sample grid resolution ----
//
// BUG FIX (physics re-review): this used to hardcode ROW_COUNT=20/COLUMN_COUNT=48 regardless of zoom. That
// is fine at Local zoom (span=VIEW_WIDTH_METERS.local=DOMAIN_LENGTH=4m) but badly undersamples at Field zoom
// (span=VIEW_WIDTH_METERS.field=16m): with c=343m/s and FREQUENCY_RANGE.max=500Hz, the shortest wavelength
// this sim ever produces is lambdaMin=343/500=0.686m. At Field zoom, 48 FIXED columns over a 16m span gives
// a column spacing of 16/47=0.340m, i.e. only 0.686/0.340~=2.0 samples per wavelength (right at the bare
// Nyquist limit, no margin - a genuinely aliased/jagged profile at high frequency). The 20 FIXED rows were
// worse still: 16/19=0.842m spacing, only 0.686/0.842~=0.81 samples per wavelength (BELOW Nyquist).
//
// FIX (columns): computeColumnCount() below scales the column count with the CURRENT zoom's span so the
// PHYSICAL samples-per-meter density - and therefore samples-per-wavelength at the worst-case (shortest)
// wavelength - stays constant at every zoom, mirroring PressureGraphNode.ts's own rebuildForZoom(), which
// already scales ITS sample count by the same widthMeters/DOMAIN_LENGTH ratio for exactly this reason.
// TARGET_SAMPLES_PER_WAVELENGTH=8 is chosen to reproduce this file's OWN original Local-zoom density
// (48 columns / 4m = 12 samples/m; 12*0.686=8.23 samples/wavelength at FREQUENCY_RANGE.max) - i.e. the fix
// preserves the density this file always had at Local zoom, it just now also delivers it at Field zoom:
//   computeColumnCount(4, 0.686)  = ceil(8*4/0.686)+1  = ceil(46.6)+1  = 48  (Local  - unchanged from before)
//   computeColumnCount(16, 0.686) = ceil(8*16/0.686)+1 = ceil(186.6)+1 = 188 (Field - was 48, now fixed)
// (This target is deliberately less strict than PressureGraphNode.ts's own >=30-samples/wavelength floor for
// its precision line chart - this file draws a compact schematic diagram, not a scientific instrument, and
// >=8x already clears the bare 2x Nyquist minimum with a real, comfortable margin.)
//
// FIX (rows) - a DELIBERATE, DOCUMENTED TRADEOFF, not a full fix: ROW_COUNT stays a FIXED 20 at every zoom,
// NOT scaled the same way columns are. Reasoning: (1) PERFORMANCE - fully scaling both axes the same way
// columns are scaled would make Field zoom cost columnCount(188)*rowCount(scaled to ~80) ~= 15,040
// model.sampleAtRadius() calls per frame, a ~16x jump over Local zoom's 48*20=960 and well outside the order
// of magnitude every other Field-zoom-heavy view in this sim costs (PressureGraphNode's own worst case is
// 960 total samples; ParticleFieldNode's Field-zoom particle grid caps at MAX_FIELD_GRID_PARTICLES=56*56=
// 3136). Keeping ROW_COUNT fixed instead bounds Field zoom's worst case to 188*20=3760 - a ~3.9x increase
// over Local, the same order of magnitude (thousands, not tens of thousands) as those other views, not a
// runaway cost. (2) CORRECTNESS - rows do not need to individually resolve wavelength detail the way each
// row's OWN horizontal profile does: each row is sampled and drawn as an independent curve (never
// interpolated across neighboring rows), so under-sampling in the row/y direction cannot alias or corrupt
// any SINGLE row's own profile the way under-sampling columns would - COLUMN_COUNT alone (scaled above)
// governs whether any one ridge line is a faithful curve. What a coarse row spacing DOES cost is visual
// coherence between adjacent rows at Field zoom (with wavelengths much shorter than the ~0.84m row spacing,
// consecutive rows can land on quite different phases of the concentric ripple pattern, so the stack can
// look a bit more jagged/less smoothly "layered" there than at Local zoom) - a real but purely aesthetic
// tradeoff, accepted here in exchange for keeping this decorative, opt-in diagram's per-frame cost bounded.
const TARGET_SAMPLES_PER_WAVELENGTH = 8;
const MIN_COLUMN_COUNT = 8; // defensive floor only - never binds at this sim's actual constants (see the worked examples above)
const MAX_COLUMN_COUNT = 300; // defensive ceiling only (mirrors e.g. MAX_FIELD_GRID_PARTICLES in ParticleFieldNode.ts) - never binds today; guards against a future change to FREQUENCY_RANGE/speedOfSound/VIEW_WIDTH_METERS silently exploding this Node's per-frame cost

/** Scales the sampled column count with the current zoom's span so the PHYSICAL samples-per-meter density
 * (and therefore samples-per-wavelength at the worst-case, shortest, wavelength) stays constant at every
 * zoom - see the "SAMPLE GRID RESOLUTION" section's own worked-example comment above for the exact
 * before/after numbers this produces at Local vs. Field zoom. The "+1" accounts for sampling N POINTS
 * (endpoints included) rather than N-1 intervals. */
function computeColumnCount(spanMeters: number, minWavelengthMeters: number): number {
  const raw = Math.ceil((TARGET_SAMPLES_PER_WAVELENGTH * spanMeters) / minWavelengthMeters) + 1;
  return clamp(raw, MIN_COLUMN_COUNT, MAX_COLUMN_COUNT);
}

// See the "SAMPLE GRID RESOLUTION" section's own "FIX (rows)" paragraph above for why this stays a plain
// fixed constant (not zoom-scaled) - within this task's specified 18-24 row range.
const ROW_COUNT = 20;

// ---- Fixed pixel "ridge plot" layout (a screen-space design, not a physical scale - see the class doc
// above). All of the geometry below is derived from these few constants so the row footprint and the
// skew-driven "3D" illusion stay consistent if any one of them is tuned. ----

// px - each row's own profile width, before any per-row skew is added. The CURRENT zoom's columns (see
// computeColumnCount() above) are always packed evenly across this SAME fixed pixel width, however many
// there are - more columns at Field zoom simply means a finer-grained (denser-plotted) curve within the
// same on-screen footprint, not a wider one.
//
// MEASURED IN A REAL BROWSER: reduced from 125 to 100 - SoundWavesScreenView.ts's placement comment for
// ISOMETRIC_MAP_X0/ISOMETRIC_MAP_Y0 found ControlPanel's real rendered width left only ~3.6px of clearance
// between this Node's content and the panel at the original 125px width - see that file's own comment for
// the full measured numbers. Shrinking this by 20% restores a real, comfortable margin without materially
// hurting legibility (the ridge plot's shape reads the same at either width; it's a compact schematic
// diagram, not a precision instrument - see this file's own "SCREEN-SPACE DESIGN" doc comment).
const PLOT_WIDTH = 100;

// A small diagonal offset applied per row index j (rowOffsetX = j*ROW_SKEW_X, rowOffsetY = -j*ROW_SKEW_Y),
// farther rows shifting up-and-right - the entire "3D" illusion here; see the class doc's "RENDERING
// TECHNIQUE" paragraph. Chosen small enough that, over ROW_COUNT=20 rows, the accumulated skew (the
// farthest row's total sideways shift is (ROW_COUNT-1)*ROW_SKEW_X=22.8px, its total upward shift is
// (ROW_COUNT-1)*ROW_SKEW_Y=85.5px, see MAX_SKEW_Y below) still keeps this diagram's total footprint
// comfortably inside the narrow ~180px-wide free-space strip SoundWavesScreenView.ts allocates for it (see
// that file's placement comment).
const ROW_SKEW_X = 1.2; // px per row
const ROW_SKEW_Y = 4.5; // px per row
const MAX_SKEW_Y = (ROW_COUNT - 1) * ROW_SKEW_Y; // px, the farthest row's total upward shift = 85.5

// Ridge peak height ceiling (px) - a display-only scale constant, NOT a physical distance. Chosen well
// within this task's suggested ~14-20px range, the same order of magnitude as
// SPHERICAL_VISUAL_TARGET_NEAR_SOURCE_PX=12 (ParticleFieldNode.ts's own comparable "make a small physical
// effect visible on screen" display boost for spherical mode). |pressure| is normalized to 0..1 via
// estimatePeakPressure() below (the SAME normalization PressureFieldNode.ts's spherical-mode shading uses),
// then scaled by this ceiling and SIGNED (not abs()'d) - see redraw() - so compression reads as a ridge
// rising above the row's baseline and rarefaction as a dip below it, matching this diagram's "waves" framing
// rather than folding both into one-sided "mountains". (Physics review confirmed this data/normalization is
// correct; the on-screen caption below spells out the up=compression/down=rarefaction convention for
// students, since there is no color-coding or zero-line label on this diagram to convey it otherwise.)
const HEIGHT_CEILING_PX = 16;

// Extra vertical room (px) below each row's baseline, down to that row's own flat floor - must comfortably
// exceed HEIGHT_CEILING_PX so the deepest possible rarefaction dip (a full -HEIGHT_CEILING_PX excursion)
// never pokes through the floor into the row drawn behind-and-below it.
const FLOOR_PAD_PX = HEIGHT_CEILING_PX + 4; // 20

// Small fixed clearance (px) above the farthest row's highest possible peak and this Node's own local
// y=0 - keeps the tallest possible ridge from being clipped or crowding whatever sits directly above this
// Node's placement in SoundWavesScreenView.ts.
const TOP_MARGIN_PX = 4;

// The NEAREST row (j=0, no skew) sits at this baseline y; every other row's baseline is offset upward from
// here by that row's own rowOffsetY. Derived (not hardcoded) from the constants above so the farthest row's
// highest possible peak (baseline - MAX_SKEW_Y - HEIGHT_CEILING_PX) lands exactly TOP_MARGIN_PX below this
// Node's own top edge (local y=0): ROW_BASE_Y - MAX_SKEW_Y - HEIGHT_CEILING_PX = TOP_MARGIN_PX.
const ROW_BASE_Y = TOP_MARGIN_PX + MAX_SKEW_Y + HEIGHT_CEILING_PX; // px, = 105.5

// Ridge-plot-only footprint (excluding the caption below it), used only in this file's own comments/
// placement math and by SoundWavesScreenView.ts's placement comment for this Node - not a named constant
// since nothing in the code itself reads it, only documentation does. Width: the nearest row spans local
// x:[0, PLOT_WIDTH]; the farthest row, shifted right by MAX_SKEW_X, spans local x:[MAX_SKEW_X,
// PLOT_WIDTH+MAX_SKEW_X] - so the overall plot width is PLOT_WIDTH+MAX_SKEW_X = 100+22.8 = 122.8px. Height:
// from local y=0 (TOP_MARGIN_PX above the farthest row's highest peak) down to the nearest row's own floor
// (ROW_BASE_Y+FLOOR_PAD_PX, the lowest point any row ever reaches, since every other row's floor sits higher
// up due to its own negative skew) - see PLOT_HEIGHT below.
const PLOT_HEIGHT = ROW_BASE_Y + FLOOR_PAD_PX; // px, ~= 125.5

// MEASURED IN A REAL BROWSER: the caption is wrapped WIDER than the plot itself (122.8px, see above) rather
// than matching it exactly - wrapping the caption at the plot's own (narrow) width, after PLOT_WIDTH was
// narrowed for horizontal clearance (see that constant's own "MEASURED IN A REAL BROWSER" comment), pushed
// the caption's real rendered height up enough to overflow the stage bottom (measured ~2.5px overflow at the
// placement this file's caption height budget originally assumed) - narrower wrap width means more line
// breaks means a taller caption. The free horizontal strip SoundWavesScreenView.ts places this Node in has
// room for the caption to be wider than the plot without encroaching on the ControlPanel (see that file's own
// placement-margin arithmetic) - see also this file's class doc's own "FLAGGED FOR VISUAL RE-VERIFICATION"
// note for why constants like this are anchored to a measured render.
const CAPTION_WRAP_WIDTH = 135;

// Pale, mostly-opaque neutral fill so a nearer row fully occludes whatever farther row(s) it overlaps (the
// entire hidden-surface "3D" look depends on this being close to opaque, not translucent) - deliberately
// NOT a compression/rarefaction red/blue (that color encoding already exists via PressureFieldNode's
// shading; this diagram's whole job is the wave's 3D SHAPE, kept visually distinct and simple per this
// task's own instructions).
const RIDGE_FILL = "rgba(238, 236, 230, 0.94)";
const RIDGE_STROKE = "#54524c"; // single neutral dark stroke for the profile line on top of each ridge's fill
const RIDGE_STROKE_WIDTH = 1.2;

const CAPTION_FONT = new PhetFont({ size: 10, style: "italic" }); // matches PressureGraphNode.ts's own CAPTION_FONT exactly - same tone/style convention for an "this isn't new physics" disclaimer caption.
const CAPTION_GAP = 8; // px, between the ridge plot's own floor and the caption text below it

// PEDAGOGY RE-REVIEW: both the physics and pedagogy reviews independently flagged this diagram as HIGHER
// misreading-risk than PressureGraphNode's flat line chart, and asked for four explicit caveats a student
// actually sees (not just in a source comment). This single caption covers all four:
//  (1) same data / not a new physical effect (this diagram already existed as a source comment; now on-screen).
//  (2) ridge height is NOT a picture of a real bump or vertical air motion - sound is longitudinal, and this
//      "mountain range" framing is at HIGHER risk of the transverse-wave misconception than a flat line chart
//      is, since a pale terrain-colored 3D silhouette reads as literal topography far more readily than a 2D
//      line does. Mirrors PressureGraphNode.ts's own equivalent "NOT a picture of vertical air motion" line.
//  (3) every row is the SAME instant in time, sampled at a different position - NOT a time-history the way a
//      waterfall/spectrogram plot (which this rendering technique closely visually resembles) would be.
//  (4) up=compression / down=rarefaction - there is no color-coding or zero-line label on this diagram (that
//      encoding already exists via PressureFieldNode's shading; see RIDGE_FILL's own comment for why it was
//      deliberately not duplicated here), so this convention must be stated in words.
//  (5) not to scale / schematic, not a to-scale companion to the particle field above (see this file's own
//      "SCREEN-SPACE DESIGN" section - that caveat previously only lived in a source comment).
const CAPTION_TEXT =
  "This is the SAME pressure field as the shading behind the spherical wave above, drawn here as a 3D-style ripple surface instead of flat color - not a new or different physical effect. " +
  "Ridge height encodes pressure magnitude only: it is NOT a picture of a real bump or of air moving up and down (sound is a squeeze-and-stretch wave, not an up-and-down one). " +
  "All of the rows show this SAME instant in time, sampled at different positions - despite how it may look, this is not a waterfall-style history of the wave over time. " +
  "Ridges above the flat baseline are compression; dips below are rarefaction. " +
  "Like the diagram above it, this view is schematic, not drawn to scale.";

export type PressureIsometricMapNodeOptions = {
  x0: number; // screen x (px) of this Node's local origin (the ridge plot's own top-left, BEFORE any
  // per-row skew - see PLOT_HEIGHT's comment above for how far content extends to the right of this)
  y0: number; // screen y (px) of this Node's local origin
  visibleProperty: TReadOnlyProperty<boolean>;
  viewZoomProperty: TReadOnlyProperty<ViewZoom>;
};

type RowVisual = {
  screenXs: number[]; // local x per column, INCLUDING this row's own fixed skew offset - RECOMPUTED on
  // every rebuild() (see that method), since the number of columns packed across the fixed PLOT_WIDTH now
  // depends on the current zoom (see computeColumnCount() above) - unlike baselineY/floorY below, this is
  // NOT fixed for the Node's whole lifetime.
  baselineY: number; // fixed local y of this row's zero-pressure baseline, including its skew offset - set
  // once at construction and never recomputed (depends only on ROW_SKEW_Y/ROW_BASE_Y, never on zoom).
  floorY: number; // fixed local y of this row's own flat floor (baselineY + FLOOR_PAD_PX) - fixed, see above.
  fillPath: Path; // closed, filled profile - see redraw()
  strokePath: Path; // open, stroked profile line on top of fillPath - see redraw()
};

/**
 * Opt-in (shares SoundWavesScreenView.ts's existing showPressureGraphProperty / "Show pressure graph"
 * checkbox - no separate checkbox), SPHERICAL-mode-only pseudo-3D "ridge plot" of the pressure field - see
 * the file-level doc comment above for the full rendering technique and rationale. This is the spherical
 * counterpart to PressureGraphNode.ts's plane-only line chart: same checkbox, same underlying
 * model.sampleAtRadius(r).pressure data PressureFieldNode.ts's spherical shading and
 * CompressionTrackerNode.ts already read, just drawn as a layered isometric mountain-range silhouette
 * instead of flat shading or a 2D line - it does not compute or represent any different physics. See
 * CAPTION_TEXT above for the several on-screen caveats a physics + pedagogy review both asked for.
 *
 * FLAGGED FOR VISUAL RE-VERIFICATION (this file's own convention, e.g. PressureGraphNode.ts's class doc,
 * and SoundWavesScreenView.ts's own layout comments): the pixel layout constants above and the placement
 * this Node is given in SoundWavesScreenView.ts are sized against that file's own documented layout
 * arithmetic (the free strip between the spherical field and the ControlPanel), not against a measured
 * render - re-check the actual on-screen fit/legibility in a real browser.
 */
export class PressureIsometricMapNode extends Node {
  private readonly model: SoundWavesModel;
  private readonly viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  private readonly rows: RowVisual[] = [];

  // Cached PHYSICAL radii (m) per (row, column), rebuilt whenever the zoom (or column count - see
  // rebuild()) changes - re-sampled fresh via model.sampleAtRadius() every frame in redraw(), matching
  // PressureGraphNode.ts's cachedSamplePositions precedent.
  private rGrid: number[][] = [];

  // The CURRENT zoom's column count (see computeColumnCount()) - recomputed in rebuild(), read in redraw()
  // to know how many cached samples/screen-x entries each row actually has.
  private currentColumnCount = 0;

  public constructor(model: SoundWavesModel, options: PressureIsometricMapNodeOptions) {
    super({ visibleProperty: options.visibleProperty, x: options.x0, y: options.y0, pickable: false }); // purely decorative, like PressureFieldNode/PressureGraphNode - never intercepts input

    this.model = model;
    this.viewZoomProperty = options.viewZoomProperty;

    // Build every row's fixed (zoom-independent) vertical layout - baselineY/floorY - and its Path Nodes
    // ONCE here (ROW_COUNT never changes, see that constant's own comment); screenXs is populated by the
    // very first rebuild() call below, not here (see RowVisual's own doc comment for why). Rows are pushed
    // in construction order j=0 (nearest) .. ROW_COUNT-1 (farthest), then added to this.children in the
    // REVERSE order (farthest first, nearest last) so nearer rows are painted ON TOP of - and therefore
    // visually occlude - farther ones, per the class doc's "RENDERING TECHNIQUE" paragraph.
    for (let j = 0; j < ROW_COUNT; j++) {
      const rowOffsetY = -j * ROW_SKEW_Y;
      const baselineY = ROW_BASE_Y + rowOffsetY;
      this.rows.push({
        screenXs: [],
        baselineY,
        floorY: baselineY + FLOOR_PAD_PX,
        fillPath: new Path(null, { fill: RIDGE_FILL }),
        strokePath: new Path(null, { stroke: RIDGE_STROKE, lineWidth: RIDGE_STROKE_WIDTH }),
      });
    }

    const rowChildren: Node[] = [];
    for (let j = ROW_COUNT - 1; j >= 0; j--) {
      rowChildren.push(this.rows[j].fillPath, this.rows[j].strokePath);
    }

    const caption = new RichText(CAPTION_TEXT, {
      font: CAPTION_FONT,
      fill: "#707070",
      lineWrap: CAPTION_WRAP_WIDTH,
      top: PLOT_HEIGHT + CAPTION_GAP,
    });

    this.children = [...rowChildren, caption];

    // Rebuilds this.currentColumnCount/each row's screenXs/this.rGrid whenever the zoom changes (or, in
    // principle, speedOfSoundProperty - see the class doc's REBUILD/REDRAW SPLIT paragraph for why that's
    // included). Fires immediately on construction (standard Multilink behavior, same as every other
    // rebuild-Multilink in this codebase), populating everything above and calling redraw() - no separate
    // initial redraw() call is needed.
    Multilink.multilink([this.viewZoomProperty, model.speedOfSoundProperty], () => this.rebuild());
  }

  /** View-local per-frame redraw - reads model state, never advances it. */
  public step(): void {
    if (this.visible) {
      this.redraw();
    }
  }

  /** The shortest wavelength this sim can ever produce, read LIVE from the model - the same quantity (and
   * the same "read live, never hardcode" reasoning) as ParticleFieldNode.ts's own private minWavelength(). */
  private minWavelength(): number {
    return this.model.speedOfSoundProperty.value / FREQUENCY_RANGE.max;
  }

  /** Recomputes this.currentColumnCount, every row's screenXs (see RowVisual's own doc comment for why that
   * depends on zoom, unlike baselineY/floorY), and the cached PHYSICAL sample grid (this.rGrid) for the
   * CURRENT zoom - see the class doc's REBUILD/REDRAW SPLIT paragraph. Not called every frame; see redraw()
   * for the per-frame work. */
  private rebuild(): void {
    const zoom = this.viewZoomProperty.value;
    const spanMeters = VIEW_WIDTH_METERS[zoom];
    // The SAME maxRadiusMeters value ParticleFieldNode.ts's rebuildSpherical()/PressureFieldNode.ts already
    // use for spherical mode - see this file's own import of VIEW_WIDTH_METERS/ViewZoom from
    // ParticleFieldNode.ts.
    const halfExtentMeters = spanMeters / 2;

    const columnCount = computeColumnCount(spanMeters, this.minWavelength());
    this.currentColumnCount = columnCount;

    // Every row packs its (possibly just-changed) column count evenly across the SAME fixed PLOT_WIDTH -
    // see that constant's own comment - then adds its own fixed rowOffsetX on top.
    const columnBaseXs: number[] = new Array(columnCount);
    for (let i = 0; i < columnCount; i++) {
      columnBaseXs[i] = columnCount > 1 ? (i / (columnCount - 1)) * PLOT_WIDTH : 0;
    }
    for (let j = 0; j < ROW_COUNT; j++) {
      const rowOffsetX = j * ROW_SKEW_X;
      this.rows[j].screenXs = columnBaseXs.map((x) => x + rowOffsetX);
    }

    const grid: number[][] = [];
    for (let j = 0; j < ROW_COUNT; j++) {
      const yMeters = ROW_COUNT > 1 ? -halfExtentMeters + (j / (ROW_COUNT - 1)) * 2 * halfExtentMeters : 0;
      const rowR: number[] = new Array(columnCount);
      for (let i = 0; i < columnCount; i++) {
        const xMeters = columnCount > 1 ? -halfExtentMeters + (i / (columnCount - 1)) * 2 * halfExtentMeters : 0;
        // Because the model's spherical pressure field depends only on r=hypot(x,y), sampling this SQUARE
        // (x,y) grid naturally reproduces the field's true concentric-ripple structure once projected - see
        // the class doc's "RENDERING TECHNIQUE" paragraph.
        rowR[i] = Math.hypot(xMeters, yMeters);
      }
      grid.push(rowR);
    }
    this.rGrid = grid;

    this.redraw();
  }

  /** Upper bound on |pressure|, used only to normalize each sample to a -1..1 signed magnitude before
   * scaling by HEIGHT_CEILING_PX below - the IDENTICAL formula (and identical reasoning) as
   * PressureFieldNode.ts's own estimatePeakPressure() uses for SPHERICAL mode: AIR_DENSITY * speedOfSound *
   * angularFrequency(frequency) * sphericalAmplitudeProperty.rangeProperty.value.max (the amplitude
   * control's own current MAX, a fixed reference - see that file's own doc comment for why this must NOT be
   * the live amplitude value, which would make the normalization cancel amplitude out algebraically). Read
   * fresh every frame (redraw() calls this every step()), same as PressureFieldNode.ts, so no separate
   * Multilink wiring is needed. Do not invent a different scaling law here - this Node's whole purpose is to
   * render the SAME field PressureFieldNode already shades, just shaped instead of colored. */
  private estimatePeakPressure(): number {
    const speedOfSound = this.model.speedOfSoundProperty.value;
    const omega = angularFrequency(this.model.frequencyProperty.value);
    const maxAmplitude = this.model.sphericalAmplitudeProperty.rangeProperty.value.max;
    return AIR_DENSITY * speedOfSound * omega * maxAmplitude;
  }

  private redraw(): void {
    const peakPressure = this.estimatePeakPressure();
    const columnCount = this.currentColumnCount;
    if (columnCount === 0) {
      return; // defensive - only true before the construction-time Multilink's first rebuild() call
    }

    for (let j = 0; j < ROW_COUNT; j++) {
      const row = this.rows[j];
      const radii = this.rGrid[j];
      if (radii === undefined) {
        continue; // defensive - matches the columnCount===0 guard above
      }

      // One sampling pass per column - reused for both the filled profile and the stroked profile line
      // below, rather than sampling model.sampleAtRadius() twice per point.
      const ys: number[] = new Array(columnCount);
      for (let i = 0; i < columnCount; i++) {
        const pressure = this.model.sampleAtRadius(radii[i]).pressure;
        // SIGNED (not Math.abs()'d) magnitude - see HEIGHT_CEILING_PX's own comment for why compression
        // rises above the baseline and rarefaction dips below it, rather than both reading as one-sided
        // "mountains".
        const magnitude = peakPressure > 0 ? clamp(pressure / peakPressure, -1, 1) : 0;
        ys[i] = row.baselineY - magnitude * HEIGHT_CEILING_PX;
      }

      const xs = row.screenXs;
      const fillShape = new Shape().moveTo(xs[0], row.floorY).lineTo(xs[0], ys[0]);
      const strokeShape = new Shape().moveTo(xs[0], ys[0]);
      for (let i = 1; i < columnCount; i++) {
        fillShape.lineTo(xs[i], ys[i]);
        strokeShape.lineTo(xs[i], ys[i]);
      }
      fillShape.lineTo(xs[columnCount - 1], row.floorY).close();

      row.fillPath.shape = fillShape;
      row.strokePath.shape = strokeShape;
    }
  }
}

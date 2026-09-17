import type { TReadOnlyProperty } from "scenerystack/axon";
import { Circle, Node, Rectangle } from "scenerystack/scenery";
import { SPHERICAL_SOURCE_RADIUS, SoundWavesModel } from "../model/SoundWavesModel.js";
import { pixelsPerMeterForZoom, sphericalPixelsPerMeterForZoom, type ViewZoom } from "./ParticleFieldNode.js";

// This file is VIEW code. Schematic (non-photorealistic) styling, matching the established
// Standing Waves convention (see StringNode.ts's oscillator post+disc) - simple shapes, not an
// illustration of a real loudspeaker or a real point source.

const HOUSING_WIDTH = 34;
const HOUSING_HEIGHT = 80;
const HOUSING_FILL = "#3a3a3a";

const DIAPHRAGM_RADIUS = 10;
const DIAPHRAGM_FILL = "#5c5c5c";
const DIAPHRAGM_STROKE = "black";

export type LoudspeakerNodeOptions = {
  x0: number; // view x (px) of x=0
  y0: number; // view y (px) of the particle field's vertical center
  viewZoomProperty: TReadOnlyProperty<ViewZoom>;
};

/**
 * A schematic loudspeaker at x=0 (PLANE mode only - see PointSourceNode below for spherical mode's
 * equivalent), whose diaphragm's own visible excursion is driven by xi(0,t) read from the model, at the
 * EXACT SAME pixels-per-meter scale as ParticleFieldNode (pixelsPerMeterForZoom(), imported from there
 * rather than redefined here, read live every frame from the shared viewZoomProperty) - a scale
 * mismatch between the speaker's motion and the first particles' motion would break the causal "speaker
 * pushes air" read even with correct underlying physics.
 */
export class LoudspeakerNode extends Node {
  private readonly model: SoundWavesModel;
  private readonly viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  private readonly diaphragm: Circle;
  private readonly originX: number;
  private readonly diaphragmRestX: number;

  public constructor(model: SoundWavesModel, options: LoudspeakerNodeOptions) {
    super();

    this.model = model;
    this.viewZoomProperty = options.viewZoomProperty;
    this.originX = options.x0;

    const housing = new Rectangle(-HOUSING_WIDTH, -HOUSING_HEIGHT / 2, HOUSING_WIDTH, HOUSING_HEIGHT, {
      fill: HOUSING_FILL,
      stroke: "black",
      lineWidth: 1,
      x: this.originX,
      y: options.y0,
      cornerRadius: 4,
    });

    this.diaphragmRestX = this.originX;
    this.diaphragm = new Circle(DIAPHRAGM_RADIUS, {
      fill: DIAPHRAGM_FILL,
      stroke: DIAPHRAGM_STROKE,
      lineWidth: 1.5,
      x: this.diaphragmRestX,
      y: options.y0,
    });

    this.children = [housing, this.diaphragm];

    this.redraw();
  }

  /** View-local per-frame redraw - reads model state, never advances it. */
  public step(): void {
    this.redraw();
  }

  private redraw(): void {
    const pixelsPerMeter = pixelsPerMeterForZoom(this.viewZoomProperty.value);
    const displacementAtSource = this.model.sampleAt(0).displacement;
    this.diaphragm.x = this.diaphragmRestX + displacementAtSource * pixelsPerMeter;
  }
}

const POINT_SOURCE_FILL = "#3a3a3a";
const POINT_SOURCE_STROKE = "black";

export type PointSourceNodeOptions = {
  x0: number; // view x (px) of the point source
  y0: number; // view y (px) of the point source
  viewZoomProperty: TReadOnlyProperty<ViewZoom>;
};

/**
 * SPHERICAL mode's counterpart to LoudspeakerNode - a small, schematic, non-directional point-source
 * icon (a filled circle at radius SPHERICAL_SOURCE_RADIUS, the same finite source radius the model uses
 * for its far-field amplitude falloff, see SoundWavesModel.ts) rather than a directional
 * loudspeaker-in-a-box shape, so its silhouette itself communicates "radiates equally in every
 * direction" rather than "radiates one way". Deliberately static (does not oscillate) - unlike
 * LoudspeakerNode's diaphragm, there is no single well-defined excursion direction for a point source to
 * visibly move in, so showing the source itself pulsing would risk misreading as a physical size change
 * rather than the air's own oscillation (which the surrounding spherical particle field already shows).
 */
export class PointSourceNode extends Circle {
  public constructor(options: PointSourceNodeOptions) {
    // PointSourceNode only ever appears in SPHERICAL mode (see SoundWavesScreenView.ts's mode-visibility
    // link), so it must use sphericalPixelsPerMeterForZoom - the SAME spherical-only scale the particle
    // rings, pressure shading rings, and compression-tracker rings use (see that function's doc comment
    // in ParticleFieldNode.ts) - never the plane-mode-shared pixelsPerMeterForZoom, or this icon would be
    // sized on a different scale than the field surrounding it.
    const pixelsPerMeter = sphericalPixelsPerMeterForZoom(options.viewZoomProperty.value);
    super(SPHERICAL_SOURCE_RADIUS * pixelsPerMeter, {
      fill: POINT_SOURCE_FILL,
      stroke: POINT_SOURCE_STROKE,
      lineWidth: 1.5,
      x: options.x0,
      y: options.y0,
    });

    // The icon's own radius should track zoom (it represents a fixed physical size, SPHERICAL_SOURCE_RADIUS,
    // which occupies fewer pixels at Field zoom's smaller scale) even though it never animates otherwise.
    options.viewZoomProperty.lazyLink((zoom) => {
      this.radius = SPHERICAL_SOURCE_RADIUS * sphericalPixelsPerMeterForZoom(zoom);
    });
  }
}

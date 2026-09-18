import type { TReadOnlyProperty } from "scenerystack/axon";
import { Circle, Line, Node } from "scenerystack/scenery";
import { SoundWavesModel } from "../model/SoundWavesModel.js";
import { VIEW_WIDTH_METERS, pixelsPerMeterForZoom, sphericalPixelsPerMeterForZoom, type ViewZoom } from "./ParticleFieldNode.js";

// This file is VIEW code. All physics (the wavefront's position) lives in the model
// (model.getWavefrontDistance()) - this file only converts that one number to a screen position.

// Vertical half-extent (px, plane mode) of the marker line - same "+/-60px particle-row span, +10px
// margin" convention CompressionTrackerNode.ts's TRIANGLE_Y_OFFSET already uses for the same reason
// (ParticleFieldNode's rows span +/-(ROW_COUNT*ROW_SPACING)/2 = +/-60px around the diagram's vertical
// center), re-derived independently here per this project's existing convention of each overlay file
// owning its own layout constant rather than importing one across files.
const PLANE_MARKER_HALF_HEIGHT = 70; // px

const MARKER_LINE_WIDTH = 2.5;

// Deliberately a different hue/weight from both the compression tracker (ghosted, warm-red, dashed -
// see CompressionTrackerNode.ts's MARKER_STROKE) and the pressure shading's red/blue convention - the
// wavefront is a single, solid, physically-exact boundary (not a repeated bookkeeping overlay), so a
// bolder, neutral color is appropriate and avoids implying "this is a compression" or "this is pressure".
const MARKER_STROKE = "#2f2f2f";

export type WavefrontMarkerNodeOptions = {
  planeOriginX: number;
  planeOriginY: number;
  sphericalOriginX: number;
  sphericalOriginY: number;
  viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  visibleProperty: TReadOnlyProperty<boolean>;
};

/**
 * Opt-in (default hidden, see ControlPanel.ts's "Show wavefront" checkbox) overlay marking the single
 * leading edge of the disturbance - how far the wave has traveled from the source so far. Distinct from
 * CompressionTrackerNode, which marks every individual periodic compression: this Node draws exactly one
 * marker, at model.getWavefrontDistance(), in whichever propagation mode is active. Hidden once the
 * wavefront has traveled past the currently-visible domain/radius - at that point the whole visible field
 * is already disturbed, so there is no boundary left to point at (matches the model's own physical
 * retardedTime<=0 "at rest" condition, not a display fudge).
 */
export class WavefrontMarkerNode extends Node {
  private readonly model: SoundWavesModel;
  private readonly viewZoomProperty: TReadOnlyProperty<ViewZoom>;
  private readonly planeOriginX: number;
  private readonly planeOriginY: number;
  private readonly sphericalOriginX: number;
  private readonly sphericalOriginY: number;

  private readonly planeMarker: Line;
  private readonly sphericalMarker: Circle;

  public constructor(model: SoundWavesModel, options: WavefrontMarkerNodeOptions) {
    super({ pickable: false, visibleProperty: options.visibleProperty }); // purely informational overlay - never intercepts input

    this.model = model;
    this.viewZoomProperty = options.viewZoomProperty;
    this.planeOriginX = options.planeOriginX;
    this.planeOriginY = options.planeOriginY;
    this.sphericalOriginX = options.sphericalOriginX;
    this.sphericalOriginY = options.sphericalOriginY;

    this.planeMarker = new Line(0, -PLANE_MARKER_HALF_HEIGHT, 0, PLANE_MARKER_HALF_HEIGHT, {
      stroke: MARKER_STROKE,
      lineWidth: MARKER_LINE_WIDTH,
      visible: false,
    });
    this.sphericalMarker = new Circle(1, {
      stroke: MARKER_STROKE,
      lineWidth: MARKER_LINE_WIDTH,
      fill: null,
      visible: false,
      x: this.sphericalOriginX,
      y: this.sphericalOriginY,
    });
    this.children = [this.planeMarker, this.sphericalMarker];
  }

  /** View-local per-frame redraw - reads model state, never advances it. */
  public step(): void {
    if (this.visible) {
      this.redraw();
    }
  }

  private redraw(): void {
    const mode = this.model.propagationModeProperty.value;
    const zoom = this.viewZoomProperty.value;
    const wavefrontDistance = this.model.getWavefrontDistance();

    if (mode === "plane") {
      const visibleWidthMeters = VIEW_WIDTH_METERS[zoom];
      const withinView = wavefrontDistance < visibleWidthMeters;
      this.planeMarker.visible = withinView;
      this.sphericalMarker.visible = false;
      if (withinView) {
        const pixelsPerMeter = pixelsPerMeterForZoom(zoom);
        this.planeMarker.x = this.planeOriginX + wavefrontDistance * pixelsPerMeter;
        this.planeMarker.y = this.planeOriginY;
      }
    } else {
      const maxRadiusMeters = VIEW_WIDTH_METERS[zoom] / 2;
      const withinView = wavefrontDistance < maxRadiusMeters;
      this.sphericalMarker.visible = withinView;
      this.planeMarker.visible = false;
      if (withinView) {
        const pixelsPerMeter = sphericalPixelsPerMeterForZoom(zoom);
        this.sphericalMarker.radius = Math.max(0.5, wavefrontDistance * pixelsPerMeter);
      }
    }
  }
}

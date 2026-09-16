import type { TReadOnlyProperty } from "scenerystack/axon";
import { Shape } from "scenerystack/kite";
import { Circle, Line, Node, Path, Rectangle } from "scenerystack/scenery";
import { predictedNodePositions, STRING_GRID_INTERVALS, type FarBoundaryType } from "../model/StandingWavesModel.js";
import type { StandingWavesModel } from "../model/StandingWavesModel.js";

// Model-to-view coordinate mapping. This is intentionally NOT a single aspect-ratio-preserving
// ModelViewTransform2 (see node_modules/scenerystack/src/phetcommon/js/view/ModelViewTransform2.ts):
// the string's along-length extent (meters, up to 2.0 m) and its transverse displacement (meters,
// capped at a few % of length) live on completely different visual scales, so plain, decoupled
// scalar factors for x and y are simpler and are exactly what's needed here.
const PIXELS_PER_METER_X = 320;
const PIXELS_PER_METER_Y = 1200;

const STRING_STROKE = "#2b4b8f";
const STRING_LINE_WIDTH = 3;
const EQUILIBRIUM_STROKE = "#9aa0a8";
const PREDICTED_NODE_STROKE = "#8a8a8a";
const RAIL_HALF_HEIGHT = 150; // px, fixed regardless of amplitude - just a visual travel guide

export type StringNodeOptions = {
  x0: number; // view x (px) of the driven end, x=0
  y0: number; // view y (px) of the equilibrium line
};

/**
 * The main visualization: a live transverse-wave string, a schematic driven-end oscillator, a
 * far-end termination (rigid wall for 'fixed', bead-on-a-rail for 'free'), an equilibrium
 * reference line, and an optional "predicted nodes" overlay for the nearest harmonic.
 *
 * All drawing is rebuilt every frame from model.displacements in step(dt) - this is plain,
 * view-local per-frame redraw, NOT model stepping (Joist already steps the model independently -
 * see the scenerystack skill's architecture.md).
 */
export class StringNode extends Node {
  private readonly model: StandingWavesModel;
  private readonly showPredictedNodesProperty: TReadOnlyProperty<boolean>;
  private readonly originX: number;
  private readonly originY: number;

  private readonly predictedNodesLayer: Node;
  private readonly wavePath: Path;
  private readonly oscillatorPost: Rectangle;
  private readonly oscillatorDisc: Circle;
  private readonly wallNode: Node;
  private readonly freeEndRail: Line;
  private readonly freeEndBead: Circle;
  private readonly equilibriumLine: Line;
  private readonly freeEndGroup: Node;

  public constructor(model: StandingWavesModel, showPredictedNodesProperty: TReadOnlyProperty<boolean>, options: StringNodeOptions) {
    super();

    this.model = model;
    this.showPredictedNodesProperty = showPredictedNodesProperty;
    this.originX = options.x0;
    this.originY = options.y0;

    // Equilibrium reference line - its width is rebuilt in redraw() since L changes live.
    const equilibriumLine = new Line(this.originX, this.originY, this.originX, this.originY, {
      stroke: EQUILIBRIUM_STROKE,
      lineWidth: 1,
      lineDash: [6, 4],
    });

    this.predictedNodesLayer = new Node({ visible: false, pickable: false });

    this.wavePath = new Path(null, {
      stroke: STRING_STROKE,
      lineWidth: STRING_LINE_WIDTH,
      lineJoin: "round",
      lineCap: "round",
    });

    // Schematic driven-end oscillator: a short post plus a small disc/paddle - deliberately
    // non-representational (no character/mechanism illustration), just enough to read as "the
    // thing shaking the string".
    this.oscillatorPost = new Rectangle(-4, 0, 8, 46, {
      fill: "#5c5c5c",
      x: this.originX,
      y: this.originY + 10,
    });
    this.oscillatorDisc = new Circle(11, {
      fill: "#3a3a3a",
      stroke: "black",
      lineWidth: 1,
      x: this.originX,
      y: this.originY,
    });

    // Fixed-far-end termination: a rigid wall/clamp, drawn as a vertical bar with a hatched
    // (diagonal-line) pattern - a conventional "rigid support" physics-diagram symbol.
    this.wallNode = StringNode.createWallNode();

    // Free-far-end termination: a bead free to slide on a short vertical rail.
    this.freeEndRail = new Line(0, -RAIL_HALF_HEIGHT, 0, RAIL_HALF_HEIGHT, {
      stroke: "#9aa0a8",
      lineWidth: 2,
    });
    // Deliberately styled as a HOLLOW ring (not a solid dark disc) so it reads as a passive slider
    // riding on the rail, not as a second oscillator - the driven-end disc above is solid/dark
    // specifically to look like an active actuator; this must look visually distinct from that, not
    // just a slightly smaller copy of it (a real bead-vs-oscillator ambiguity flagged in review).
    this.freeEndBead = new Circle(9, {
      fill: "#eef3fb",
      stroke: STRING_STROKE,
      lineWidth: 2.5,
    });
    const freeEndNode = new Node({ children: [this.freeEndRail, this.freeEndBead] });

    this.equilibriumLine = equilibriumLine;
    this.freeEndGroup = freeEndNode;

    this.children = [equilibriumLine, this.predictedNodesLayer, this.wavePath, this.wallNode, freeEndNode, this.oscillatorPost, this.oscillatorDisc];

    this.redraw();
  }

  /** View-local per-frame redraw - reads model state, never advances it. */
  public step(): void {
    this.redraw();
  }

  private redraw(): void {
    const length = this.model.lengthProperty.value;
    const boundary = this.model.farBoundaryTypeProperty.value;
    const endX = this.originX + length * PIXELS_PER_METER_X;

    this.equilibriumLine.setLine(this.originX, this.originY, endX, this.originY);

    const shape = new Shape();
    const displacements = this.model.displacements;
    const dxPixels = (length * PIXELS_PER_METER_X) / STRING_GRID_INTERVALS;
    for (let i = 0; i <= STRING_GRID_INTERVALS; i++) {
      const x = this.originX + i * dxPixels;
      const y = this.originY - displacements[i] * PIXELS_PER_METER_Y;
      if (i === 0) {
        shape.moveTo(x, y);
      } else {
        shape.lineTo(x, y);
      }
    }
    this.wavePath.shape = shape;

    this.oscillatorDisc.y = this.originY - displacements[0] * PIXELS_PER_METER_Y;
    this.oscillatorPost.y = this.oscillatorDisc.y + 10;

    const isFixed = boundary === "fixed";
    this.wallNode.visible = isFixed;
    this.wallNode.x = endX;
    this.wallNode.y = this.originY;

    this.freeEndGroup.visible = !isFixed;
    this.freeEndGroup.x = endX;
    this.freeEndBead.y = -displacements[STRING_GRID_INTERVALS] * PIXELS_PER_METER_Y;

    this.redrawPredictedNodes(length, boundary);
  }

  private redrawPredictedNodes(length: number, boundary: FarBoundaryType): void {
    const visible = this.showPredictedNodesProperty.value;
    this.predictedNodesLayer.visible = visible;
    if (!visible) {
      return;
    }

    const n = this.model.nearestHarmonicProperty.value;
    const positions = predictedNodePositions(n, length, boundary);
    const markers: Node[] = [];
    for (const positionMeters of positions) {
      const x = this.originX + positionMeters * PIXELS_PER_METER_X;
      markers.push(
        new Line(x, this.originY - RAIL_HALF_HEIGHT, x, this.originY + RAIL_HALF_HEIGHT, {
          stroke: PREDICTED_NODE_STROKE,
          lineWidth: 1.5,
          lineDash: [4, 4],
        }),
      );
      markers.push(
        new Circle(6, {
          x,
          y: this.originY,
          stroke: PREDICTED_NODE_STROKE,
          lineWidth: 1.5,
          fill: null,
        }),
      );
    }
    this.predictedNodesLayer.children = markers;
  }

  private static createWallNode(): Node {
    const barWidth = 10;
    const barHalfHeight = 70;
    const bar = new Rectangle(-barWidth / 2, -barHalfHeight, barWidth, barHalfHeight * 2, {
      fill: "#6b6b6b",
      stroke: "black",
      lineWidth: 1,
    });
    const hatches: Node[] = [];
    const hatchCount = 7;
    for (let i = 0; i < hatchCount; i++) {
      const y = -barHalfHeight + (i * (barHalfHeight * 2)) / (hatchCount - 1);
      hatches.push(
        new Line(barWidth / 2, y, barWidth / 2 + 12, y + 12, {
          stroke: "#6b6b6b",
          lineWidth: 2,
        }),
      );
    }
    return new Node({ children: [...hatches, bar] });
  }
}

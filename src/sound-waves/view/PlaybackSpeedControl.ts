import type { StringUnionProperty } from "scenerystack/axon";
import { HBox, Text } from "scenerystack/scenery";
import { RectangularRadioButtonGroup } from "scenerystack/sun";
import { PhetFont } from "scenerystack/scenery-phet";
import type { PlaybackSpeed } from "../model/SoundWavesModel.js";

// This file is VIEW code. Binds directly to model.playbackSpeedProperty (a real model Property, exactly
// like PropagationModeControl.ts binds to model.propagationModeProperty) - construction pattern mirrored
// from that file: an HBox pairing a bold label with a RectangularRadioButtonGroup, each option carrying
// its own accessibleName/accessibleHelpText.
//
// V3 addition: replaces the old TimeControlNode-built-in speed radio group (Normal/Slow only, from
// scenery-phet's closed TimeSpeed enum - see SoundWavesModel.ts's PlaybackSpeed doc comment for why that
// enum cannot be extended with an Ultra Slow member). ControlPanel.ts now passes
// `timeSpeedProperty: null` to TimeControlNode (cleanly disabling just its built-in speed radio group
// while keeping play/pause/step - see the installed TimeControlNode source) and places this control
// directly below it instead, so play/pause/step/speed stay visually grouped together.

const LABEL_FONT = new PhetFont({ size: 12, weight: "bold" });
const OPTION_FONT = new PhetFont(12);

/**
 * A 3-option segmented control choosing playbackSpeedProperty's value - Normal, Slow (1/4 real-time,
 * matching the sim's original slow-motion speed), or Ultra Slow (1/1000 real-time, new in V3, slow enough
 * to watch a single oscillation cycle unfold over several real seconds).
 */
export class PlaybackSpeedControl extends HBox {
  public constructor(playbackSpeedProperty: StringUnionProperty<PlaybackSpeed>) {
    const radioGroup = new RectangularRadioButtonGroup<PlaybackSpeed>(
      playbackSpeedProperty,
      [
        { value: "normal", createNode: () => new Text("Normal", { font: OPTION_FONT }), options: { accessibleName: "Normal", accessibleHelpText: "Run the simulation at real-time speed." } },
        { value: "slow", createNode: () => new Text("Slow", { font: OPTION_FONT }), options: { accessibleName: "Slow", accessibleHelpText: "Run the simulation at one quarter real-time speed." } },
        {
          value: "ultraSlow",
          createNode: () => new Text("Ultra Slow", { font: OPTION_FONT }),
          options: { accessibleName: "Ultra Slow", accessibleHelpText: "Run the simulation extremely slowly, so a single wave cycle can be watched unfold." },
        },
      ],
      {
        orientation: "horizontal",
        spacing: 4,
        radioButtonOptions: { xMargin: 6, yMargin: 4 },
        accessibleName: "Playback speed",
        accessibleHelpText: "Choose how fast the simulation runs.",
      },
    );

    super({
      spacing: 8,
      children: [new Text("Speed:", { font: LABEL_FONT }), radioGroup],
    });
  }
}

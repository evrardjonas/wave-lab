import { ScreenView, ScreenViewOptions } from "scenerystack/sim";
import { SoundWavesModel } from "../model/SoundWavesModel.js";
import { ResetAllButton } from "scenerystack/scenery-phet";
import { Text } from "scenerystack/scenery";

export class SoundWavesScreenView extends ScreenView {
  public constructor(model: SoundWavesModel, options?: ScreenViewOptions) {
    super(options);

    // Placeholder content - physics/visualization not implemented yet.
    this.addChild(
      new Text("Sound Waves — scaffold only", {
        font: "24px sans-serif",
        center: this.layoutBounds.center,
      }),
    );

    const resetAllButton = new ResetAllButton({
      listener: () => {
        model.reset();
        this.reset();
      },
      right: this.layoutBounds.maxX - 10,
      bottom: this.layoutBounds.maxY - 10,
    });
    this.addChild(resetAllButton);
  }

  public reset(): void {
    // Called when the user presses the reset-all button
  }
}

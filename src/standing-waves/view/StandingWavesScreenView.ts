import { ScreenView, ScreenViewOptions } from "scenerystack/sim";
import { StandingWavesModel } from "../model/StandingWavesModel.js";
import { ResetAllButton } from "scenerystack/scenery-phet";
import { Text } from "scenerystack/scenery";

export class StandingWavesScreenView extends ScreenView {
  public constructor(model: StandingWavesModel, options?: ScreenViewOptions) {
    super(options);

    // Placeholder content - physics/visualization not implemented yet.
    this.addChild(
      new Text("Standing Waves — scaffold only", {
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

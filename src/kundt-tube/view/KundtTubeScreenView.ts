import { ScreenView, ScreenViewOptions } from "scenerystack/sim";
import { KundtTubeModel } from "../model/KundtTubeModel.js";
import { ResetAllButton } from "scenerystack/scenery-phet";
import { Text } from "scenerystack/scenery";

export class KundtTubeScreenView extends ScreenView {
  public constructor(model: KundtTubeModel, options?: ScreenViewOptions) {
    super(options);

    // Placeholder content - physics/visualization not implemented yet.
    this.addChild(
      new Text("Kundt Tube — scaffold only", {
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

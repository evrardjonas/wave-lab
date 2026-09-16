import { Screen, ScreenOptions } from "scenerystack/sim";
import { StandingWavesModel } from "./model/StandingWavesModel.js";
import { StandingWavesScreenView } from "./view/StandingWavesScreenView.js";

export class StandingWavesScreen extends Screen<StandingWavesModel, StandingWavesScreenView> {
  public constructor(options: ScreenOptions) {
    super(
      () => new StandingWavesModel(),
      (model) => new StandingWavesScreenView(model),
      options,
    );
  }
}

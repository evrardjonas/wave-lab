import { Screen, ScreenOptions } from "scenerystack/sim";
import { SoundWavesModel } from "./model/SoundWavesModel.js";
import { SoundWavesScreenView } from "./view/SoundWavesScreenView.js";

export class SoundWavesScreen extends Screen<SoundWavesModel, SoundWavesScreenView> {
  public constructor(options: ScreenOptions) {
    super(
      () => new SoundWavesModel(),
      (model) => new SoundWavesScreenView(model),
      options,
    );
  }
}

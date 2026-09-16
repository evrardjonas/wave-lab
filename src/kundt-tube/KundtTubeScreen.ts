import { Screen, ScreenOptions } from "scenerystack/sim";
import { KundtTubeModel } from "./model/KundtTubeModel.js";
import { KundtTubeScreenView } from "./view/KundtTubeScreenView.js";

export class KundtTubeScreen extends Screen<KundtTubeModel, KundtTubeScreenView> {
  public constructor(options: ScreenOptions) {
    super(
      () => new KundtTubeModel(),
      (model) => new KundtTubeScreenView(model),
      options,
    );
  }
}

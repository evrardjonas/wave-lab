// NOTE: brand.js needs to be the first import. This is because SceneryStack for sims needs a very specific loading
// order: init.ts => assert.ts => splash.ts => brand.ts => everything else (here)
import "./brand.js";

import { onReadyToLaunch, Sim } from "scenerystack/sim";
import { StringProperty } from "scenerystack/axon";
import { Tandem } from "scenerystack/tandem";
import { KundtTubeScreen } from "./KundtTubeScreen.js";

onReadyToLaunch(() => {
  // The title, like most string-like things, is a StringProperty that can change to different values (e.g. for
  // different languages, see localeProperty from scenerystack/joist)
  const titleStringProperty = new StringProperty("Kundt Tube");

  const screens = [
    new KundtTubeScreen({ tandem: Tandem.ROOT.createTandem("kundtTubeScreen") }),
  ];

  const sim = new Sim(titleStringProperty, screens);
  sim.start();
});

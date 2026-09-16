// NOTE: brand.js needs to be the first import. This is because SceneryStack for sims needs a very specific loading
// order: init.ts => assert.ts => splash.ts => brand.ts => everything else (here)
import "./brand.js";

import { onReadyToLaunch, Sim } from "scenerystack/sim";
import { StringProperty } from "scenerystack/axon";
import { Tandem } from "scenerystack/tandem";
import { SoundWavesScreen } from "./SoundWavesScreen.js";

onReadyToLaunch(() => {
  // The title, like most string-like things, is a StringProperty that can change to different values (e.g. for
  // different languages, see localeProperty from scenerystack/joist)
  const titleStringProperty = new StringProperty("Sound Waves");

  const screens = [
    new SoundWavesScreen({ tandem: Tandem.ROOT.createTandem("soundWavesScreen") }),
  ];

  const sim = new Sim(titleStringProperty, screens);
  sim.start();
});

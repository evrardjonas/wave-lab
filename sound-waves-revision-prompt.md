# Sound Waves — correctifs et révisions (prompt de travail)

Contexte : simulation `sound-waves` (SceneryStack) dans `src/sound-waves/`. Ce
document liste, avec les fichiers concernés, tout ce qui a été remonté en
session de test le 2026-09-18, avec pour chaque point son statut :
**BUG CONFIRMÉ** (reproduit en direct, à corriger), **À CLARIFIER** (ne se
reproduit pas tel que décrit), ou **DEMANDE DE DESIGN** (changement de
comportement/UX voulu, pas un bug).

Suivre le workflow déjà défini dans `CLAUDE.md` : planification (fait, ici) →
`scenery-developer` (implémentation) → `physics-reviewer` +
`pedagogy-reviewer` (revue) → `qa-tester` (validation réelle, pas supposée).

**Statut final (2026-09-18) : tout ce qui suit a été implémenté et vérifié**
(`npx tsc --noEmit`, `npx eslint .`, `npm run build`, `npx vitest run
src/sound-waves` tous verts, plus vérification manuelle dans le navigateur
pour chaque point) :
- A3 (seul vrai bug) : corrigé — l'amplitude suit maintenant la bonne
  Property selon le mode.
- C (front d'onde) : nouveau composant `WavefrontMarkerNode.ts` + case
  "Show wavefront", séparé du compression tracker.
- D (Color) : `RepresentationModeControl.ts` supprimé, case "Color" ajoutée
  à côté d'Amplitude, remplace "Show pressure field".
- E1 (ruler) : fonctionne maintenant en Local ET Field (deux `RulerNode`,
  calibrages différents, même position partagée).
- E2 (grille rectangulaire) : implémenté en zoom Field pour Spherical wave —
  Local garde les anneaux polaires.
- Bonus : `eslint.config.js` corrigé (ignorait `dist/` mais pas
  `dist-publish/`, ce qui faisait échouer `npx eslint .` dès qu'un build de
  publication existait localement) ; 4 nouveaux tests unitaires pour
  `getWavefrontDistance()`.

**Round 2 (2026-09-18, même jour) : vraie revue indépendante via
`scenery-developer`/`physics-reviewer`/`pedagogy-reviewer`/`qa-tester`**,
lancée depuis un terminal séparé où le CLI Claude Code reconnaît bien les
agents/skill de ce projet (contrairement à la session qui a fait le round 1).
Deux must-fix trouvés et corrigés sur le commit `56430de` :

1. **Ruler mal calibré en mode Spherical** (physics-reviewer, bug réel que
   je n'avais pas vu) — le ruler était dimensionné avec
   `pixelsPerMeterForZoom()` (l'échelle Plane) même en mode Spherical, alors
   que le champ de particules et les anneaux de compression utilisent
   `sphericalPixelsPerMeterForZoom()` (420px vs 600px de diamètre de champ)
   → sous-lecture silencieuse de 30% de toute distance mesurée en mode
   Spherical, aux deux zooms. Préexistant pour le zoom Local (pas introduit
   par ce commit), mais étendu par erreur au nouveau ruler Field lors du
   round 1. **Corrigé** : 4 instances de `RulerNode` au lieu de 2 (une par
   couple zoom×mode), avec calibrage dédié pour Spherical
   (`SPHERICAL_RULER_METERS`/`SPHERICAL_FIELD_RULER_METERS` dans
   [SoundWavesScreenView.ts](src/sound-waves/view/SoundWavesScreenView.ts)).
2. **Case "Color" sans légende visible** (pedagogy-reviewer) — seule case
   du panneau sans texte explicatif à l'écran, alors que son rendu par
   paliers nets pouvait laisser croire à une pression physiquement
   quantifiée. **Corrigé** : ajout de `colorCaption` ("Same wave, shown
   more boldly - this doesn't change the physics.") dans
   [ControlPanel.ts](src/sound-waves/view/ControlPanel.ts), même pattern
   que les autres cases.

Revérifié indépendamment (moi, après coup) : lecture directe du code
final, `tsc`/`eslint`/`build`/`vitest` (64/64) à nouveau verts, **et
vérification visuelle en navigateur des deux nouveaux rulers Spherical**
(chose que la session du round 2 n'a pas pu faire, faute de navigateur
connecté chez elle) - les labels et le calibrage rendent correctement aux
deux zooms.

Laissé de côté (nice-to-have, pas must-fix) : pas d'anneaux-repères dans le
champ de particules en Spherical+Field (perte d'un indice visuel
Plane/Spherical à ce zoom précis) ; renommer "Color" en quelque chose de
plus descriptif ; commentaires obsolètes référençant l'ancien
`RepresentationModeControl` ailleurs dans `SoundWavesScreenView.ts` ;
`dragBoundsProperty` du ruler n'exclut pas sa propre largeur (pattern
préexistant, pas introduit ici) ; eslint sur `scripts/*.mjs` (sans rapport).

**Décisions prises (2026-09-18, confirmées par l'utilisateur) :**
- Implémenter maintenant, pas juste remettre un prompt.
- Le futur bouton « Color » (section D) **remplace** la case « Show pressure
  field » — un seul mécanisme, pas deux qui se recouvrent.
- Spherical + zoom Field (section E2) passe à une **vraie grille
  cartésienne** (lignes/colonnes comme Plane wave), pas un simple recadrage
  visuel des anneaux polaires existants.

---

## A. Bugs — après vérification poussée (deux rétractés, un confirmé)

**Important, à lire avant tout le reste :** la première passe de test en
navigateur avait fait conclure à 2 « bugs » qui ne survivent pas à une
vérification plus rigoureuse (coordonnées de clic exactes via le DOM, appels
directs à `model.step()` pour éliminer les artefacts de rendu de
l'environnement de test). Je le documente quand même en détail ci-dessous
pour être transparent sur ce qui a été testé et pourquoi la conclusion a
changé — pas pour te faire perdre ton temps.

### A1. Amplitude « ne répond à aucune interaction » — RÉTRACTÉ
**Fichier :** [ControlPanel.ts:77-85](src/sound-waves/view/ControlPanel.ts).

Premier constat (drag + flèches ◀▶ + clavier sans effet, valeur bloquée à
0.030 m) reproduit avec des clics approximatifs. En retrouvant les
coordonnées EXACTES du thumb et des boutons flèche via le DOM
(`getBoundingClientRect()` sur les `<rect>`/`<path>` réels de la piste et des
boutons), le clic précis sur la flèche ▶ fait bien passer la valeur de
0.030 à 0.031 m, et le drag précis du thumb fonctionne aussi. **Le contrôle
fonctionne correctement — mes clics précédents rataient simplement la petite
cible (thumb ~17px, boutons flèche ~19×18px) de quelques pixels.**

Nuance qui reste utile : les cibles sont petites, et l'effet visuel d'un
petit changement d'amplitude est lui-même subtil (quelques pixels
d'oscillation en plus/moins). Si tu revois « rien ne se passe » en testant
toi-même : essaie de viser bien le centre du petit bouton ▶ (pas le slider)
plusieurs fois de suite, et regarde la valeur numérique affichée (0.030 m →
elle doit changer à chaque clic par pas de 0.001 m) plutôt que le champ de
particules. Si la valeur numérique elle-même ne bouge pas chez toi, dis-le
moi — ce serait alors un vrai bug que je n'ai pas reproduit, potentiellement
spécifique à ton navigateur/ta façon de cliquer/glisser.

### A2. Spherical wave : « les particules ne bougent pas » — RÉTRACTÉ
**Fichier :** [ParticleFieldNode.ts](src/sound-waves/view/ParticleFieldNode.ts)
(`redrawSpherical()`, ligne ~665).

Premier constat : comparaison de captures d'écran espacées de 2s, à vitesse
Normal — le champ semblait figé en Spherical alors que Plane bougeait
clairement. Deux facteurs ont faussé ce test : (1) l'environnement de
navigateur de ce test ne semble faire réellement avancer/re-peindre la
simulation qu'au moment où une capture d'écran est explicitement demandée,
pas en continu pendant les périodes d'attente — donc « attendre puis
capturer » ne garantit pas un temps modèle proportionnel écoulé ; (2) à
l'amplitude sphérique par défaut (0.03 m à la source), la décroissance en
1/r fait que les particules loin de la source (la plupart du champ visible)
bougent de bien moins d'1 pixel — invisible même si tout fonctionne.

Test décisif (qui élimine les deux biais) : appeler `model.step(1/60)` 30
fois directement (0.5s de temps modèle d'un coup, sans dépendre du rendu
automatique) avec l'amplitude sphérique poussée au maximum, puis
`view.step()` pour forcer un redraw — la particule suivie s'est bien déplacée
(+1.29 px en x) en cohérence exacte avec le déplacement recalculé par le
modèle. **`redrawSpherical()` fonctionne correctement.**

### A3. Aucun contrôle d'amplitude en mode Spherical wave — CONFIRMÉ (le seul vrai bug de cette liste)
**Fichiers :** [ControlPanel.ts](src/sound-waves/view/ControlPanel.ts),
[SoundWavesModel.ts](src/sound-waves/model/SoundWavesModel.ts) (Property
`sphericalAmplitudeProperty`, ligne ~421).

Confirmé par grep : `sphericalAmplitudeProperty` n'est lu QUE côté rendu
(`PressureFieldNode.ts`, `CompressionTrackerNode.ts`) et dans le modèle —
jamais référencé dans `ControlPanel.ts` ni `SoundWavesScreenView.ts`. Le
slider « Amplitude » du panneau ne pilote QUE `model.amplitudeProperty` (la
version plane), qu'on soit en Plane ou en Spherical wave. Résultat concret :
en mode Spherical, il n'existe **aucun moyen dans l'UI** de changer
l'amplitude — `sphericalAmplitudeProperty` reste figée à sa valeur par
défaut (0.03 m) pour toute la session.

À corriger : le contrôle « Amplitude » doit piloter la Property pertinente
selon `model.propagationModeProperty` (`amplitudeProperty` en Plane,
`sphericalAmplitudeProperty` en Spherical) — probablement en construisant un
`NumberControl` dont le `numberProperty`/`enabledRangeProperty` suivent le
mode actif (voir comment ce fichier gère déjà d'autres branchements
mode-dépendants), plutôt que deux `NumberControl` séparés visibles en même
temps. C'est exactement le genre d'écart de rigueur Plane vs Spherical
mentionné en section F.

---

## B. Signalé mais non reproduit — à clarifier

### B1. « Le compression tracker est affiché par défaut »
**Fichier :** [SoundWavesScreenView.ts:174](src/sound-waves/view/SoundWavesScreenView.ts)

Le code initialise `showCompressionTrackerProperty` à `false`, et testé en
direct : la case « Show compression tracker » est bien DÉCOCHÉE au chargement.
Ne se reproduit pas tel que décrit.

Ce qui, lui, **s'active bien automatiquement** : la case « Show pressure
field » passe cochée-et-désactivée dès qu'on passe en mode **Simplified**
(voir [ControlPanel.ts:171-186](src/sound-waves/view/ControlPanel.ts)) — c'est
volontaire et documenté dans le code (le champ de pression est déjà montré au
maximum en Simplified, donc la case devient un no-op visuel désactivé plutôt
que caché).

**Question pour toi :** est-ce à ce comportement-là que tu penses (pressure
field, pas compression tracker) ? Si tu observais vraiment le compression
tracker cochée au chargement, dis-moi dans quel état exact (build `dist`,
autre navigateur, autre séquence de clics) pour qu'on creuse.

---

## C. Compression tracker vs. « front d'onde »

Vérifié en direct : la détection de pics de compression est **correcte** —
en zoom Field (Spherical wave), on voit clairement 5-6 anneaux pointillés
régulièrement espacés d'une longueur d'onde, comme prévu.

Le souci est réel mais différent de ce qu'il semble : en zoom **Local**
(le zoom par défaut), le rayon visible (2 m) dépasse à peine une longueur
d'onde (1.37 m à 250 Hz par défaut) → il n'y a jamais qu'1 (rarement 2)
anneau(x) visibles, et cet anneau est toujours proche du bord, donc proche du
front d'onde réel. D'où l'impression que « compression tracker = front
d'onde » : ce n'est pas un bug de détection, c'est que le zoom par défaut ne
laisse jamais voir la nature périodique de l'outil.

**Proposition (validée par le raisonnement ci-dessus, pas encore par toi) :**
- Garder « Show compression tracker » tel quel (outil multi-anneaux,
  espacement = une longueur d'onde) — éventuellement rendre sa nature
  périodique plus évidente même en Local.
- Ajouter un **nouveau** bouton/toggle « Front d'onde » séparé : un marqueur
  unique à la position actuelle du front d'onde. Ne pas réutiliser
  `CompressionTrackerNode` pour ça — nouveau composant, nouveau concept.

---

## D. Real / Simplified / bouton « Color »

**Fichiers :** [RepresentationModeControl.ts](src/sound-waves/view/RepresentationModeControl.ts),
[ControlPanel.ts](src/sound-waves/view/ControlPanel.ts),
[PressureFieldNode.ts](src/sound-waves/view/PressureFieldNode.ts),
[ParticleFieldNode.ts](src/sound-waves/view/ParticleFieldNode.ts).

Constat en direct : le mode actuellement nommé **« Real »** est visuellement
le plus discret (ombrage continu très subtil, `SUBTLE_MAX_ALPHA=0.14`,
particules grises simples) — il « a l'air » basique. Le mode actuellement
nommé **« Simplified »** est en fait le plus riche visuellement (bandes de
couleur par paliers, particules pâles à contour marqué). Les noms actuels
sont donc contre-intuitifs par rapport à ce qu'on voit à l'écran — c'est ce
que tu pointes.

**Demande de design (confirmée) :**
1. Renommer le bouton actuel « Real » → **« Simplified »** dans
   `RepresentationModeControl.ts` (garder la valeur interne `'real'` si plus
   simple, ne changer que le label visible + `accessibleName`/
   `accessibleHelpText` — ou renommer aussi la valeur interne si
   `scenery-developer` juge que c'est plus propre ; dans tous les cas, ne
   pas casser `PressureFieldNode`/`ParticleFieldNode`, qui branchent sur la
   valeur `'pedagogical'`/`'real'` de `RepresentationMode`).
2. Sortir l'effet actuel de « Simplified » (bandes par paliers +
   particules pâles, tout ce que fait `redrawPedagogical()` dans
   `PressureFieldNode.ts` et `applyRepresentationStyling()` dans
   `ParticleFieldNode.ts`) du sélecteur de mode en haut. Le proposer comme un
   bouton/checkbox **« Color »** à côté du contrôle Amplitude dans
   `ControlPanel.ts`.
3. **« Color » remplace « Show pressure field »** (la case actuelle
   `pressureFieldCheckbox`/`showPressureFieldProperty` disparaît — un seul
   mécanisme pour intensifier/enrichir l'affichage, pas deux qui se
   chevauchent). Le rendu « Simplified » actuel (tiers de couleur discrets)
   devient ce que « Color » active ; le rendu « Real » continu
   (`redrawReal()`) reste le comportement par défaut quand Color est décoché.
4. Conséquence logique de 1-3 : une fois que « Color » porte tout l'effet
   visuel qui distinguait Real de Simplified, il ne reste qu'UNE seule vue de
   base — le sélecteur à 2 options en haut (`RepresentationModeControl`,
   dans la rangée `propagationModeControl`/`representationModeControl` de
   `SoundWavesScreenView.ts`) n'a plus rien à sélectionner et doit être
   **retiré du chrome du haut**, pas juste réduit à une seule option. Sous le
   capot, `representationModeProperty`/`RepresentationMode` peuvent être
   réutilisés tels quels (renommer si plus clair) comme la Property booléenne
   que le nouveau bouton « Color » pilote — pas besoin de tout réécrire,
   juste de changer qui expose ce choix et où. Confirmer ce point précis avec
   `pedagogy-reviewer` avant de considérer le travail fini (charge cognitive,
   cohérence des libellés), mais c'est la lecture qui découle directement des
   points 1-3 ci-dessus.

---

## E. Mode Field à revoir

### E1. Ruler — « il en faut une vraie »
**Fichier :** [SoundWavesScreenView.ts:271-346](src/sound-waves/view/SoundWavesScreenView.ts),
constantes `RULER_WIDTH`/`RULER_MAJOR_TICK_SPACING` lignes ~99-107.

La règle utilise déjà le vrai composant `RulerNode` de scenery-phet (pas un
faux dessin), mais :
- Elle est **entièrement masquée en zoom Field** (`rulerVisibleProperty`
  n'est vraie qu'à `zoom === 'local'`) — donc dès qu'on élargit la vue, plus
  aucun outil de mesure.
- Son calibrage (espacement des graduations en pixels) n'est fait que pour
  l'échelle Local.

**À faire :** rendre la règle utilisable aux deux zooms (Local ET Field),
avec un recalibrage des graduations selon l'échelle active, et revérifier
que sa position par défaut / ses limites de drag ne chevauchent pas le
chrome à chaque zoom et dans les deux modes de propagation.

### E2. Spherical + Field : cercle d'atomes → rectangle
**Fichier :** [ParticleFieldNode.ts](src/sound-waves/view/ParticleFieldNode.ts)
(`rebuildSpherical()`, ligne ~480).

Demande confirmée : ne pas garder un disque circulaire complet d'anneaux
concentriques en zoom Field pour l'onde sphérique — passer à une **vraie
grille cartésienne** (lignes/colonnes, comme Plane wave), uniquement en zoom
Field. Le zoom Local garde l'agencement polaire actuel (anneaux
concentriques) — seul Field change.

C'est un changement plus profond que du recadrage visuel : `rebuildSpherical()`
(ligne ~480) construit aujourd'hui `sphericalSpecs` en coordonnées polaires
(`equilibriumRadiusMeters`/`angleRadians`), et `redrawSpherical()` (ligne
~665) déplace chaque particule le long de son propre rayon
(`r-hat = (cos(angle), sin(angle))` fixe). Pour une grille rectangulaire en
Field :
- Construire une grille de particules en (x,y) cartésien (comme
  `rebuildPlane()`), centrée sur `sphericalOriginX/Y`, couvrant le cadre
  rectangulaire visible en Field.
- Le déplacement de chaque particule reste radial par rapport à la source
  (c'est la physique — `model.sampleAtRadius(r)` où `r` = distance de la
  particule à l'origine, pas son ancien rayon polaire figé), mais son adresse
  d'équilibre `(x,y)` est maintenant cartésienne, pas `(radius, angle)`. Le
  vecteur radial unitaire doit être recalculé par particule à partir de sa
  position d'équilibre `(x,y)` fixe (`r_equilibrium = sqrt(x²+y²)`,
  `r-hat = (x,y)/r_equilibrium`), toujours fixé une fois à la construction —
  garder la même garantie qu'aujourd'hui (aucune dérive tangentielle
  possible).
- `CompressionTrackerNode`/`PressureFieldNode` en Spherical restent des
  anneaux concentriques dans les deux zooms (ce sont des overlays de
  pression/compression, pas l'arrangement des particules elles-mêmes) — ne
  changer QUE l'arrangement des particules dans `ParticleFieldNode`, pas ces
  deux autres fichiers, sauf si `pedagogy-reviewer` juge que le mélange
  « particules en grille + anneaux de pression en cercle » est confus une
  fois vu à l'écran (à vérifier visuellement après implémentation).
- Vérifier `MAX_SPHERICAL_PARTICLES`/densité et les marges par rapport au
  chrome (mêmes contraintes que `computeRightMargin()` côté Plane) pour la
  nouvelle grille Field.

### E3. Autres griefs sur le mode Field ?
Le message d'origine dit juste « il faut revoir le mode field » sans détail
au-delà de E1/E2. Si tu as d'autres points précis (mise en page, lisibilité,
autre chose observé), à préciser avant que `scenery-developer` ne se lance.

---

## F. Exigence égale entre Plane wave et Spherical wave

Instruction explicite : appliquer le même niveau de rigueur (configuration,
tests, QA) à Spherical wave qu'à Plane wave. Le message s'est coupé sur
« parce » — la raison précise n'est pas connue, mais le constat se vérifie
par lui-même : A3 (aucun contrôle d'amplitude en Spherical) montre que ce
mode n'a pas eu le même passage fonctionnel que Plane wave, malgré les
nombreux commentaires de revue qualité déjà présents dans le code pour sa
mise en page.

Concrètement : chaque correctif/ajout de ce document doit être vérifié dans
**les deux** modes de propagation avant d'être considéré fini, pas seulement
dans celui où il a été écrit/testé en premier.

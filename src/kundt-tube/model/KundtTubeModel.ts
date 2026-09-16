export class KundtTubeModel {
  public reset(): void {
    // Called when the user presses the reset-all button
  }

  // No step(dt) yet: this model has no time-dependent physics state to advance. Add one only once real
  // wave physics is implemented here - Joist will start calling it automatically the moment it exists
  // (see the "Stepping / time evolution" section of the scenerystack skill's architecture.md).
}

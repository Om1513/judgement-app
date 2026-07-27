import { useEffect, useState } from "react";
import audioManager from "../services/audioManager";

/**
 * Current sound preference, kept in sync with the shared audioManager.
 *
 * Lives outside any component because more than one control reads it (the
 * in-game settings gear and the home screen's mute button) and they must never
 * disagree - toggling either one updates both.
 */
export default function useSoundEnabled() {
  const [enabled, setEnabled] = useState(audioManager.getSoundEnabled());

  useEffect(() => {
    // initialize() resolves once the stored preference has been read, so adopt
    // the real value rather than the optimistic default.
    audioManager.initialize().then(() => setEnabled(audioManager.getSoundEnabled()));
    return audioManager.subscribe(setEnabled);
  }, []);

  return enabled;
}

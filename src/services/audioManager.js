// Centralized game audio.
//
// One looping background track plus one-shot sound effects, owned by this
// module rather than by any screen. That ownership is the whole point: the
// player walks Bidding -> GameTable -> ScoreBoard -> Bidding every round, and
// if a screen owned the track it would restart on every one of those mounts.
// Screens only ever ask this singleton to start/stop; it decides whether that
// is a no-op.
//
// Music and effects are tracked as separate flags (musicEnabled /
// soundEffectsEnabled, musicVolume / soundEffectsVolume) so they can be split
// into independent controls later. Today the single Sound toggle drives both.

import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

// Matches the existing @kachuful_* key convention (player name, client id).
const SOUND_ENABLED_KEY = '@kachuful_sound_enabled';

// Background music sits well under the effects so it never buries them.
const DEFAULT_MUSIC_VOLUME = 0.35;
const DEFAULT_SFX_VOLUME = 0.8;

const BACKGROUND_MUSIC = require('../../assets/music/background_music.mp3');

// Registry of one-shot effects. Adding a new sound means dropping the asset in
// and adding a line here - callers just use playSound('<key>'), and calls for
// unknown or disabled sounds are silently ignored.
const SOUND_EFFECTS = {
  cardPlay: require('../../assets/music/card_play_animation.wav'),
};

class AudioManager {
  constructor() {
    this.musicPlayer = null;
    this.sfxPlayers = {};

    this.soundEnabled = true;
    this.musicEnabled = true;
    this.soundEffectsEnabled = true;
    this.musicVolume = DEFAULT_MUSIC_VOLUME;
    this.soundEffectsVolume = DEFAULT_SFX_VOLUME;

    // True once music has been asked for and not stopped. Distinct from
    // "currently audible": muting must not erase the intent to play, or
    // returning from the background would wrongly stay silent.
    this.shouldBePlaying = false;
    // Set only when the OS backgrounded us, so foregrounding knows whether the
    // pause was ours to undo (vs. the player having muted deliberately).
    this.pausedForBackground = false;

    this.initialized = false;
    this.initPromise = null;
    this.appStateSub = null;
    this.listeners = new Set();
  }

  // Idempotent and safe to call from several screens at once - concurrent
  // callers await the same promise instead of racing to build two players.
  initialize() {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const stored = await AsyncStorage.getItem(SOUND_ENABLED_KEY);
        // Absent key means a fresh install: default to sound on.
        if (stored !== null) {
          this.soundEnabled = stored === 'true';
          this.musicEnabled = this.soundEnabled;
          this.soundEffectsEnabled = this.soundEnabled;
        }
      } catch (error) {
        console.log('[audio] could not read sound preference:', error);
      }

      try {
        await setAudioModeAsync({
          // Respect the hardware silent switch - conventional for a game whose
          // audio is ambient rather than the point of the app.
          playsInSilentMode: false,
          // Lower other apps' audio rather than stopping it outright.
          interruptionMode: 'duckOthers',
          shouldPlayInBackground: false,
          allowsRecording: false,
        });
      } catch (error) {
        console.log('[audio] could not configure audio mode:', error);
      }

      if (!this.appStateSub) {
        this.appStateSub = AppState.addEventListener('change', this.handleAppStateChange);
      }

      this.initialized = true;
      this.notify();
    })();

    return this.initPromise;
  }

  // Phone calls, app switches, screen lock. Only resume what we paused, and
  // only if music is still wanted - a deliberate mute must survive an app
  // switch.
  handleAppStateChange = (nextState) => {
    if (nextState === 'active') {
      if (this.pausedForBackground) {
        this.pausedForBackground = false;
        if (this.shouldBePlaying && this.musicEnabled) {
          this.safePlay();
        }
      }
      return;
    }
    // 'background' or 'inactive'
    if (this.musicPlayer?.playing) {
      this.pausedForBackground = true;
      this.safePause();
    }
  };

  // --- internals -----------------------------------------------------------

  // Built once and reused for the life of the app. Never call this more than
  // once per session, or two copies of the track can overlap.
  ensureMusicPlayer() {
    if (this.musicPlayer) return this.musicPlayer;
    try {
      const player = createAudioPlayer(BACKGROUND_MUSIC);
      player.loop = true;
      player.volume = this.musicVolume;
      this.musicPlayer = player;
    } catch (error) {
      console.log('[audio] could not create music player:', error);
      this.musicPlayer = null;
    }
    return this.musicPlayer;
  }

  safePlay() {
    try {
      this.ensureMusicPlayer()?.play();
    } catch (error) {
      console.log('[audio] play failed:', error);
    }
  }

  safePause() {
    try {
      this.musicPlayer?.pause();
    } catch (error) {
      console.log('[audio] pause failed:', error);
    }
  }

  // --- background music ----------------------------------------------------

  // Called on every navigation. Deliberately does nothing if the track is
  // already rolling, which is what keeps moving between screens seamless.
  async playBackgroundMusic() {
    await this.initialize();
    this.shouldBePlaying = true;

    if (!this.musicEnabled) return;
    if (this.musicPlayer?.playing) return;

    this.safePlay();
  }

  // Mute without forgetting position, so sound can resume mid-phrase.
  pauseBackgroundMusic() {
    this.safePause();
  }

  resumeBackgroundMusic() {
    if (!this.musicEnabled || !this.shouldBePlaying) return;
    if (this.musicPlayer?.playing) return;
    this.safePlay();
  }

  // Full stop and rewind. Nothing calls this today (music is ambient for the
  // whole session), but it is what a "silence on screen X" rule would use. The
  // player object is kept, since rebuilding it is wasteful.
  stopBackgroundMusic() {
    this.shouldBePlaying = false;
    this.pausedForBackground = false;
    this.safePause();
    // seekTo is async; swallow both the throw and the rejection so a failed
    // rewind can never surface as an unhandled promise rejection.
    try {
      this.musicPlayer?.seekTo(0)?.catch(() => {});
    } catch (error) {
      console.log('[audio] rewind failed:', error);
    }
  }

  // --- sound effects -------------------------------------------------------

  // No-ops when sound is off or the key is unknown, so call sites never need
  // to check anything: audioManager.playSound('cardPlay').
  playSound(name) {
    if (!this.soundEffectsEnabled) return;

    const source = SOUND_EFFECTS[name];
    if (!source) return;

    try {
      let player = this.sfxPlayers[name];
      if (!player) {
        player = createAudioPlayer(source);
        player.volume = this.soundEffectsVolume;
        this.sfxPlayers[name] = player;
      }
      // Rewind so rapid repeats (several cards in a row) retrigger instead of
      // being swallowed by an already-finished player.
      player.seekTo(0)?.catch(() => {});
      player.play();
    } catch (error) {
      console.log(`[audio] could not play "${name}":`, error);
    }
  }

  // --- settings ------------------------------------------------------------

  getSoundEnabled() {
    return this.soundEnabled;
  }

  async setSoundEnabled(enabled) {
    this.soundEnabled = enabled;
    this.musicEnabled = enabled;
    this.soundEffectsEnabled = enabled;

    if (enabled) {
      // Resumes from the stored position rather than restarting.
      this.resumeBackgroundMusic();
    } else {
      this.pauseBackgroundMusic();
    }

    this.notify();

    try {
      await AsyncStorage.setItem(SOUND_ENABLED_KEY, enabled ? 'true' : 'false');
    } catch (error) {
      console.log('[audio] could not save sound preference:', error);
    }
  }

  // --- change notification -------------------------------------------------

  // Lets the settings UI stay in sync with a manager that also changes state
  // on its own (preference load, app backgrounding).
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.soundEnabled);
      } catch (error) {
        console.log('[audio] listener failed:', error);
      }
    });
  }
}

// Module-scope singleton: importing this anywhere yields the same instance, so
// there is exactly one background track for the life of the app.
const audioManager = new AudioManager();

export default audioManager;

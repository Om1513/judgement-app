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

// Ducking ramps rather than jumps; abrupt volume steps are very audible.
const DUCK_FADE_MS = 250;
const RESTORE_FADE_MS = 600;
const FADE_STEP_MS = 40;

const BACKGROUND_MUSIC = require('../../assets/music/background_music.mp3');

// Registry of one-shot effects. Adding a sound means dropping the asset in and
// adding a line here - callers just use playSound('<key>'), and calls for
// unknown or disabled sounds are silently ignored.
//
//   volume      - relative to soundEffectsVolume
//   duckMusicTo - fraction of normal music volume to drop to while this plays
//   duckMs      - how long to hold the duck before ramping back up
//
// The duck fields encode the priority tiers: button presses never touch the
// music, the hand-winner sting leans on it slightly, and the end-of-game
// fanfare pushes it right down.
const SOUND_EFFECTS = {
  // LOW - must never interrupt or dip the music.
  // AAC rather than the original .ogg: iOS AVFoundation, which expo-audio uses,
  // has no Ogg Vorbis decoder, so the .ogg loaded fine on Android and web but
  // was silent on iPhone. button_pop.ogg is still in assets as the source.
  buttonPop: {
    source: require('../../assets/music/button_pop.m4a'),
    volume: 0.7,
  },
  cardPlay: {
    source: require('../../assets/music/card_play_animation.wav'),
    volume: 0.8,
  },
  // NORMAL - sits over the music with a light dip so it cuts through.
  handWon: {
    source: require('../../assets/music/handwon.mp3'),
    volume: 0.9,
    duckMusicTo: 0.55,
    duckMs: 1600,
  },
  // HIGH - success confirmation, no need to disturb the music much.
  createLobby: {
    source: require('../../assets/music/create_lobby.mp3'),
    volume: 0.9,
    duckMusicTo: 0.5,
    duckMs: 1800,
  },
  // HIGHEST - the celebration owns the mix.
  gameWon: {
    source: require('../../assets/music/game_won.mp3'),
    volume: 1.0,
    duckMusicTo: 0.15,
    // Held just under FinalWinnerScreen's 7s auto-advance so the music is back
    // up by the time the final scoreboard appears.
    duckMs: 6200,
  },
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

    // Ducking state. Kept separate from musicVolume, which stays the baseline
    // to return to.
    this.duckFadeTimer = null;
    this.duckReleaseTimer = null;

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

      this.preloadSoundEffects();

      if (!this.appStateSub) {
        this.appStateSub = AppState.addEventListener('change', this.handleAppStateChange);
      }

      this.initialized = true;
      this.notify();
    })();

    return this.initPromise;
  }

  // Build every effect player up front. Decoding on first press is exactly the
  // lag that makes a button feel unresponsive.
  preloadSoundEffects() {
    for (const name of Object.keys(SOUND_EFFECTS)) {
      this.ensureSfxPlayer(name);
    }
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

  ensureSfxPlayer(name) {
    if (this.sfxPlayers[name]) return this.sfxPlayers[name];
    const spec = SOUND_EFFECTS[name];
    if (!spec) return null;
    try {
      const player = createAudioPlayer(spec.source);
      player.volume = (spec.volume ?? 1) * this.soundEffectsVolume;
      this.sfxPlayers[name] = player;
    } catch (error) {
      console.log(`[audio] could not preload "${name}":`, error);
      this.sfxPlayers[name] = null;
    }
    return this.sfxPlayers[name];
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

  // --- ducking -------------------------------------------------------------

  // expo-audio has no built-in fade, so step the volume manually. Always clear
  // the previous ramp first: two overlapping fades fight each other and leave
  // the volume wherever the loser stopped.
  fadeMusicTo(target, durationMs) {
    if (this.duckFadeTimer) {
      clearInterval(this.duckFadeTimer);
      this.duckFadeTimer = null;
    }
    const player = this.musicPlayer;
    if (!player) return;

    const from = player.volume ?? this.musicVolume;
    const steps = Math.max(1, Math.round(durationMs / FADE_STEP_MS));
    let step = 0;

    this.duckFadeTimer = setInterval(() => {
      step += 1;
      const next = from + (target - from) * (step / steps);
      try {
        player.volume = Math.max(0, Math.min(1, next));
      } catch {
        // Player torn down mid-fade; stop rather than spam.
      }
      if (step >= steps) {
        clearInterval(this.duckFadeTimer);
        this.duckFadeTimer = null;
      }
    }, FADE_STEP_MS);
  }

  /** Drop the music to a fraction of its normal level. */
  duckMusic(fraction, fadeMs = DUCK_FADE_MS) {
    this.fadeMusicTo(this.musicVolume * fraction, fadeMs);
  }

  /** Ramp the music back to its normal level. */
  restoreMusicVolume(fadeMs = RESTORE_FADE_MS) {
    if (this.duckReleaseTimer) {
      clearTimeout(this.duckReleaseTimer);
      this.duckReleaseTimer = null;
    }
    this.fadeMusicTo(this.musicVolume, fadeMs);
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
  // to check anything: audioManager.playSound('buttonPop').
  playSound(name) {
    if (!this.soundEffectsEnabled) return;

    const spec = SOUND_EFFECTS[name];
    if (!spec) return;

    const player = this.ensureSfxPlayer(name);
    if (!player) return;

    try {
      // Rewind so rapid repeats (a run of button taps) retrigger instead of
      // being swallowed by an already-finished player.
      player.seekTo(0)?.catch(() => {});
      player.play();
    } catch (error) {
      console.log(`[audio] could not play "${name}":`, error);
      return;
    }

    if (spec.duckMusicTo && this.musicPlayer?.playing) {
      this.duckMusic(spec.duckMusicTo);
      if (this.duckReleaseTimer) clearTimeout(this.duckReleaseTimer);
      this.duckReleaseTimer = setTimeout(() => {
        this.duckReleaseTimer = null;
        this.fadeMusicTo(this.musicVolume, RESTORE_FADE_MS);
      }, spec.duckMs ?? 1500);
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
      // Drop any in-flight duck so re-enabling doesn't come back quiet.
      this.restoreMusicVolume(0);
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

// The 2x2 grid of game settings - players, rounds, trump order, scoring - used
// both when creating a game and from the lobby's Game Settings panel, so the two
// always offer the same choices under the same rules (utils/lobbySettings).

import React from "react";
import { View, Text } from "react-native";
import SettingCard from "./SettingCard";
import RoundSelector from "./RoundSelector";
import OrderModeToggle from "./OrderModeToggle";
import ScoringModeToggle from "./ScoringModeToggle";
import InfoHint from "./InfoHint";
import { TrumpOrder } from "./SuitLegend";
import { useScaledStyles } from "../utils/responsive";
import { MIN_PLAYERS, settingsLimits, withPlayers, withRounds } from "../utils/lobbySettings";

/**
 * What the two order modes actually do. Lives behind the ⓘ on the Order card
 * rather than under it: the fixed Kachuful rotation needs the four suits spelled
 * out, which is more than a settings card should carry inline.
 *
 * The active mode is marked so the panel answers "what will my game do?", not
 * just "what are the options?".
 */
function OrderInfo({ orderMode }) {
  const styles = useScaledStyles(rawStyles);
  const isRandom = orderMode === "Random";

  return (
    <View>
      <View style={styles.infoMode}>
        <Text style={[styles.infoModeName, !isRandom && styles.infoModeActive]}>
          Kachuful{!isRandom ? "  ·  selected" : ""}
        </Text>
        <Text style={styles.infoText}>
          Trump follows a fixed cycle and repeats every four rounds.
        </Text>
        <TrumpOrder />
      </View>

      <View style={styles.infoDivider} />

      <View>
        <Text style={[styles.infoModeName, isRandom && styles.infoModeActive]}>
          Random{isRandom ? "  ·  selected" : ""}
        </Text>
        <Text style={styles.infoText}>
          A trump is drawn for every round when the game starts. Suits can
          repeat, and the whole sequence is fixed once dealt - reconnecting never
          re-rolls it.
        </Text>
      </View>
    </View>
  );
}

/**
 * What the two scoring modes pay out. Both only ever pay for an exact
 * judgement - that is the part players get wrong, so it is stated first and the
 * worked examples come from the same rule the server scores with
 * (calculateScore in server/src/utils/cardUtils.ts).
 */
function ScoringInfo({ scoringMode }) {
  const styles = useScaledStyles(rawStyles);
  const isPlusOne = scoringMode === "+1";

  return (
    <View>
      <Text style={styles.infoText}>
        You only score by making your bid exactly. Missing it either way scores
        nothing, however close.
      </Text>

      <View style={styles.infoDivider} />

      <View style={styles.infoMode}>
        <Text style={[styles.infoModeName, !isPlusOne && styles.infoModeActive]}>
          +10{!isPlusOne ? "  ·  selected" : ""}
        </Text>
        <Text style={styles.infoText}>
          10 × your bid. Bid 0 → 10, bid 2 → 20, bid 4 → 40.
        </Text>
      </View>

      <View>
        <Text style={[styles.infoModeName, isPlusOne && styles.infoModeActive]}>
          +1{isPlusOne ? "  ·  selected" : ""}
        </Text>
        <Text style={styles.infoText}>
          10 + your bid. Bid 0 → 11, bid 2 → 12, bid 4 → 14.
        </Text>
      </View>
    </View>
  );
}

/**
 * @param {object}   value       { maxPlayers, rounds, orderMode, scoringMode }
 * @param {function} onChange    called with the whole next settings object
 * @param {number}   minPlayers  floor for players - in a lobby, who is already seated
 */
export default function LobbySettingsForm({ value, onChange, minPlayers = MIN_PLAYERS }) {
  const styles = useScaledStyles(rawStyles);
  const limits = settingsLimits(value, minPlayers);

  return (
    <>
      <View style={styles.settingsRow}>
        <SettingCard label="Players" compact>
          <RoundSelector
            value={value.maxPlayers}
            onChange={(players) => onChange(withPlayers(value, players))}
            min={limits.minPlayers}
            max={limits.maxPlayers}
          />
        </SettingCard>

        <SettingCard label="Rounds" compact>
          <RoundSelector
            value={value.rounds}
            onChange={(rounds) => onChange(withRounds(value, rounds, limits.minPlayers))}
            min={limits.minRounds}
            max={limits.maxRounds}
          />
        </SettingCard>
      </View>

      <View style={styles.settingsRow}>
        <SettingCard label="Order" compact>
          <OrderModeToggle
            value={value.orderMode}
            onChange={(orderMode) => onChange({ ...value, orderMode })}
          />
          <InfoHint title="TRUMP ORDER" label="How trump order works">
            <OrderInfo orderMode={value.orderMode} />
          </InfoHint>
        </SettingCard>

        <SettingCard label="Scoring" compact>
          <ScoringModeToggle
            value={value.scoringMode}
            onChange={(scoringMode) => onChange({ ...value, scoringMode })}
          />
          <InfoHint title="SCORING" label="How scoring works">
            <ScoringInfo scoringMode={value.scoringMode} />
          </InfoHint>
        </SettingCard>
      </View>
    </>
  );
}

const rawStyles = {
  infoMode: {
    marginBottom: 10,
  },
  infoModeName: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#C9BEDC",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoModeActive: {
    color: "#FFD700",
  },
  infoText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#C9BEDC",
    lineHeight: 17,
  },
  infoDivider: {
    height: 1,
    backgroundColor: "rgba(255, 215, 0, 0.25)",
    marginVertical: 12,
  },
  settingsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "stretch",
    marginVertical: 5,
    overflow: "visible",
  },
};

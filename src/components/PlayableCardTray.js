import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useScaledStyles } from "../utils/responsive";

const SUIT_SYMBOLS = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

// Timings, in ms.
const STAGGER = 55; // between each card leaving the hand
const RETURN_MS = 220; // cards sliding back into the hand
const FLY_MS = 240; // the picked card travelling to the table

const PRESS_SCALE = 1.08;

/** A card's identity. Unique within a deck, and stable as the hand shrinks. */
export const cardKey = (card) => `${card.suit}-${card.rank}`;

/**
 * The cards the player may play, lifted out of the hand on their turn.
 *
 * - When `open` turns true, a copy of each playable card rises from its place
 *   in the hand (`getSourceRect`) up into its slot in a row above the hand,
 *   one after another. The hand itself is left exactly as it is.
 * - Tapping a card calls `onPick(card)` and flies it to `target` - the pose
 *   PlayedCard starts its entrance from - while the rest sink back into the
 *   hand. Once it arrives, `onPlace(card)` is called.
 * - The flying card is held at the target until `landed` turns true (our card
 *   is drawn on the table by PlayedCard, which takes over from here).
 * - If the play is rejected, bump `resetSignal` and the row comes back - even
 *   after the card has landed, since a play is shown before it is confirmed.
 * - If `open` turns false without a pick (the turn ended some other way), the
 *   row slides back into the hand.
 *
 * While a card is up in the row, its place in the hand should be empty, so the
 * hand shows only the cards that cannot be played. `onHiddenChange(keys)`
 * reports which cards those are, timed so a card reappears in the hand in the
 * same frame its copy here lands back on it.
 *
 * All positions are in the coordinate space of the tray's parent, which this
 * fills.
 */
export default function PlayableCardTray({
  open,
  cards,
  slots,
  getSourceRect,
  target,
  landed,
  resetSignal,
  onPick,
  onPlace,
  onHiddenChange,
}) {
  const styles = useScaledStyles(rawStyles);

  // [{ key, card, source, p, press }]. `p` runs 0 (in the hand) -> 1 (in the
  // row); `press` drives the touch feedback.
  const [entries, setEntries] = useState([]);
  const [pickedKey, setPickedKey] = useState(null);
  // Cards that sank back into the hand after another was picked. The hand
  // shows them again, so they are no longer drawn here.
  const [returnedKeys, setReturnedKeys] = useState([]);
  // closed | open | closing | picked. A ref, because animation callbacks need
  // the current phase, not the one from the render that started them.
  const phaseRef = useRef("closed");
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  // The picked card's flight, 0 (in its slot) -> 1 (at the target).
  const fly = useRef(new Animated.Value(0)).current;

  const signature = cards.map((c) => cardKey(c.card)).join("|");

  const deal = () => {
    const next = cards.map(({ card }) => ({
      key: cardKey(card),
      card,
      source: getSourceRect(cardKey(card)),
      p: new Animated.Value(0),
      press: new Animated.Value(0),
    }));
    fly.setValue(0);
    phaseRef.current = "open";
    setPickedKey(null);
    setReturnedKeys([]);
    setEntries(next);
    onHiddenChange(next.map((e) => e.key));
    Animated.stagger(
      STAGGER,
      next.map((e) =>
        Animated.spring(e.p, {
          toValue: 1,
          friction: 7,
          tension: 80,
          useNativeDriver: true,
        })
      )
    ).start();
  };

  // Deal the row out on our turn; gather it back if the turn ends untouched.
  useEffect(() => {
    if (open && cards.length > 0) {
      // Mid-flight: the update that ends the turn is on its way.
      if (phaseRef.current === "picked") return;
      deal();
      return;
    }

    if (!open && phaseRef.current === "open") {
      phaseRef.current = "closing";
      Animated.parallel(
        entriesRef.current.map((e) =>
          Animated.timing(e.p, {
            toValue: 0,
            duration: RETURN_MS,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          })
        )
      ).start(() => {
        if (phaseRef.current !== "closing") return;
        phaseRef.current = "closed";
        setEntries([]);
        onHiddenChange([]);
      });
    }
    // The signature stands in for `cards`, which is a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, signature]);

  // Our card is on the table; PlayedCard has it from here.
  useEffect(() => {
    if (!landed || phaseRef.current !== "picked") return;
    phaseRef.current = "closed";
    setEntries([]);
    setPickedKey(null);
    onHiddenChange([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);

  // The play was rejected: put the row back and let the player choose again.
  const lastResetSignal = useRef(resetSignal);
  useEffect(() => {
    // Only a change is a rejection - not the first render.
    if (resetSignal === lastResetSignal.current) return;
    lastResetSignal.current = resetSignal;
    // Already landed and handed over: deal the row out afresh.
    if (phaseRef.current === "closed") {
      if (open && cards.length > 0) deal();
      return;
    }
    if (phaseRef.current !== "picked") return;
    phaseRef.current = "open";
    setPickedKey(null);
    setReturnedKeys([]);
    onHiddenChange(entriesRef.current.map((e) => e.key));
    Animated.parallel([
      Animated.timing(fly, {
        toValue: 0,
        duration: RETURN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      ...entriesRef.current.map((e) =>
        Animated.spring(e.p, {
          toValue: 1,
          friction: 7,
          tension: 80,
          useNativeDriver: true,
        })
      ),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  const pick = (entry) => {
    // One pick per turn: ignores a second tap, and taps while the row is still
    // being gathered back.
    if (phaseRef.current !== "open") return;
    phaseRef.current = "picked";
    setPickedKey(entry.key);
    onPick(entry.card);

    const others = entriesRef.current.filter((e) => e !== entry);
    Animated.parallel(
      others.map((e) =>
        Animated.timing(e.p, {
          toValue: 0,
          duration: RETURN_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        })
      )
    ).start(() => {
      if (phaseRef.current !== "picked") return;
      // Back in the hand: hand them over to it in one commit.
      setReturnedKeys(others.map((e) => e.key));
      onHiddenChange([entry.key]);
    });

    Animated.parallel([
      // Finish its trip out of the hand if it was tapped mid-deal.
      Animated.timing(entry.p, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(fly, {
        toValue: 1,
        duration: FLY_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (phaseRef.current === "picked") onPlace(entry.card);
    });
  };

  const pressTo = (entry, toValue) =>
    Animated.spring(entry.press, {
      toValue,
      friction: 6,
      tension: 160,
      useNativeDriver: true,
    }).start();

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {entries.map((entry, i) => {
        const slot = slots[i];
        if (!slot) return null;
        const isPicked = entry.key === pickedKey;
        // PlayedCard is already showing this card in the same spot.
        if (isPicked && landed) return null;
        if (returnedKeys.includes(entry.key)) return null;

        const isRed = entry.card.suit === "hearts" || entry.card.suit === "diamonds";
        const slotX = slot.left + slot.width / 2;
        const slotY = slot.top + slot.height / 2;
        // Unmeasured hand (the very first frame): rise from just below the slot.
        const source = entry.source || {
          left: slot.left,
          top: slot.top + slot.height,
          width: slot.width,
          height: slot.height,
        };

        // Everything is a transform about the slot, so it runs on the native
        // driver. Centres are what get translated; scale is about the centre.
        const fromHand = {
          x: entry.p.interpolate({
            inputRange: [0, 1],
            outputRange: [source.left + source.width / 2 - slotX, 0],
          }),
          y: entry.p.interpolate({
            inputRange: [0, 1],
            outputRange: [source.top + source.height / 2 - slotY, 0],
          }),
          scale: entry.p.interpolate({
            inputRange: [0, 1],
            outputRange: [source.width / slot.width, 1],
          }),
        };
        const toTable = isPicked && target
          ? {
              x: fly.interpolate({ inputRange: [0, 1], outputRange: [0, target.cx - slotX] }),
              y: fly.interpolate({ inputRange: [0, 1], outputRange: [0, target.cy - slotY] }),
              scale: fly.interpolate({
                inputRange: [0, 1],
                outputRange: [1, target.width / slot.width],
              }),
            }
          : null;
        const pressScale = entry.press.interpolate({
          inputRange: [0, 1],
          outputRange: [1, PRESS_SCALE],
        });

        return (
          <Animated.View
            key={entry.key}
            // Once one card is picked the rest are on their way back to the hand.
            pointerEvents={pickedKey && !isPicked ? "none" : "auto"}
            style={[
              styles.card,
              {
                left: slot.left,
                top: slot.top,
                width: slot.width,
                height: slot.height,
                zIndex: isPicked ? 2 : 1,
                elevation: isPicked ? 14 : 10,
                transform: [
                  { translateX: toTable ? Animated.add(fromHand.x, toTable.x) : fromHand.x },
                  { translateY: toTable ? Animated.add(fromHand.y, toTable.y) : fromHand.y },
                  {
                    scale: Animated.multiply(
                      Animated.multiply(fromHand.scale, toTable ? toTable.scale : 1),
                      pressScale
                    ),
                  },
                ],
              },
            ]}
          >
            <Pressable
              testID={`tray-card-${entry.key}`}
              accessibilityRole="button"
              accessibilityLabel={`Play ${entry.card.rank} of ${entry.card.suit}`}
              onPress={() => pick(entry)}
              onPressIn={() => pressTo(entry, 1)}
              onPressOut={() => pressTo(entry, 0)}
              style={styles.pressable}
            >
              {!isPicked && <View pointerEvents="none" style={styles.glowBorder} />}
              <LinearGradient
                colors={["#FFFFFF", "#F7F7F7", "#E9E9E9"]}
                style={styles.inner}
              >
                <Text style={[styles.rank, isRed && styles.red]}>{entry.card.rank}</Text>
                <Text style={[styles.suit, isRed && styles.red]}>
                  {SUIT_SYMBOLS[entry.card.suit]}
                </Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

// Baseline (iPhone 17 Pro) numbers; useScaledStyles maps them onto the current
// viewport. Size and position come from the slots.
const rawStyles = {
  card: {
    position: "absolute",
    borderRadius: 8,
    // Solid surface so Android draws the elevation shadow under the card rather
    // than as a dark box while it is moving.
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
  },
  pressable: {
    flex: 1,
  },
  // Marks the row as "pick one of these".
  glowBorder: {
    position: "absolute",
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#FFD700",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  inner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    overflow: "hidden",
  },
  rank: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1a1a2e",
  },
  suit: {
    fontSize: 18,
    color: "#1a1a2e",
  },
  red: {
    color: "#e53935",
  },
};

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useScaledStyles } from "../utils/responsive";
import { getHandPositions } from "../utils/tableLayout";
import { SUIT_SYMBOLS, cardKey, isRedSuit } from "../utils/cards";

// Every motion in the hand, in one place.
const MOTION = {
  // Cards moving between the fan and the popped group.
  move: { friction: 8, tension: 90 },
  // Between each playable card as they pop up.
  popStagger: 45,
  // A played card travelling to the table: one eased path, no bounce, so it
  // reads as placed rather than thrown.
  flightMs: 300,
  // Touch feedback on a popped card.
  press: { friction: 6, tension: 160 },
  pressScale: 1.08,
};

/**
 * The local player's hand, as the real cards - nothing is drawn twice.
 *
 * - Cards fan along the bottom of the screen. On the player's turn the ones in
 *   `poppedKeys` rise out of the hand as their own centred group, and the rest
 *   close up beneath them as if the popped cards were not there
 *   (utils/tableLayout getHandPositions). Every change springs from wherever a
 *   card is to where it now belongs, so nothing jumps.
 * - One tap on a popped card calls `onPlay(card)`. The parent then names it
 *   `flyingCard`, and it travels in a single motion to `flightTarget` - its
 *   final pose on the table - while the others drop back into the hand.
 *   `onArrive(card)` fires when it lands, which is when PlayedCard takes over
 *   in exactly that pose.
 * - A landed card the server has not confirmed yet is `hiddenKey`: still in
 *   the hand data, kept where it landed, drawn by the table instead. If the
 *   play is rejected the parent clears it and pops the playable cards up
 *   again, and the card springs back from the table into the group.
 *
 * Positions are in screen space; the component fills its parent, which must be
 * the screen-sized container the table is laid out in.
 */
function PlayerHand({
  cards,
  poppedKeys,
  dimmedKeys,
  flyingCard,
  flightTarget,
  hiddenKey,
  areaWidth,
  bottom,
  cardWidth,
  cardHeight,
  handInset,
  poppedInset,
  onPlay,
  onArrive,
}) {
  const styles = useScaledStyles(rawStyles);
  const flyingKey = flyingCard ? cardKey(flyingCard) : null;

  // What is drawn: the hand, plus a card still in flight that the server has
  // already taken out of it - it must finish its journey before it goes.
  const shown = useMemo(() => {
    const list = [...cards];
    if (flyingCard && !list.some((c) => cardKey(c) === flyingKey)) list.push(flyingCard);
    return list;
  }, [cards, flyingCard, flyingKey]);

  // Where each card in the hand belongs. A card on its way to the table, or
  // already there, is out of the hand and takes no room in it.
  const positions = useMemo(() => {
    const keys = cards.map(cardKey).filter((k) => k !== flyingKey && k !== hiddenKey);
    return getHandPositions({
      keys,
      poppedKeys: poppedKeys.filter((k) => keys.includes(k)),
      areaWidth,
      bottom,
      cardWidth,
      cardHeight,
      handInset,
      poppedInset,
    });
  }, [cards, poppedKeys, flyingKey, hiddenKey, areaWidth, bottom, cardWidth, cardHeight, handInset, poppedInset]);

  // One set of animated values per card, kept for as long as the card is shown.
  // A mutable map held in state: created once, and grown or trimmed as cards
  // come and go, without re-rendering for it.
  const [anims] = useState(() => new Map());
  const wasPopped = useRef(new Set());
  const flight = useRef(null);
  // A tap is answered by the parent re-rendering with a flying card; this stops
  // a second tap landing in between.
  const tapped = useRef(false);

  const shownKeys = shown.map(cardKey);
  for (const key of shownKeys) {
    if (!anims.has(key)) {
      const start = positions[key] || { left: areaWidth / 2 - cardWidth / 2, top: bottom - cardHeight };
      anims.set(key, {
        pos: new Animated.ValueXY({ x: start.left, y: start.top }),
        scale: new Animated.Value(1),
        press: new Animated.Value(0),
      });
    }
  }
  for (const key of [...anims.keys()]) {
    if (!shownKeys.includes(key)) anims.delete(key);
  }

  // Move every card in the hand to where it belongs.
  const signature = Object.entries(positions)
    .map(([k, p]) => `${k}:${Math.round(p.left)},${Math.round(p.top)}`)
    .join("|");
  useEffect(() => {
    const popped = new Set(poppedKeys);
    let stagger = 0;
    for (const [key, target] of Object.entries(positions)) {
      const a = anims.get(key);
      if (!a) continue;
      // Cards newly rising out of the hand go one after another; everything
      // else moves together.
      const delay = popped.has(key) && !wasPopped.current.has(key) ? stagger++ * MOTION.popStagger : 0;
      Animated.parallel([
        Animated.spring(a.pos, {
          toValue: { x: target.left, y: target.top },
          ...MOTION.move,
          delay,
          useNativeDriver: true,
        }),
        // Back to hand size, should it be returning from the table.
        Animated.spring(a.scale, { toValue: 1, ...MOTION.move, delay, useNativeDriver: true }),
      ]).start();
    }
    wasPopped.current = new Set(poppedKeys.filter((k) => positions[k]));
    // The signature stands in for `positions`, a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Fly a played card to the table.
  useEffect(() => {
    if (!flyingKey || !flightTarget || flight.current === flyingKey) return;
    const a = anims.get(flyingKey);
    if (!a) return;
    flight.current = flyingKey;
    const card = flyingCard;
    // Scale is about the card's centre, so line the centres up.
    const toScale = flightTarget.width / cardWidth;
    const x = flightTarget.left + flightTarget.width / 2 - cardWidth / 2;
    const y = flightTarget.top + flightTarget.height / 2 - cardHeight / 2;
    const easing = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(a.pos, { toValue: { x, y }, duration: MOTION.flightMs, easing, useNativeDriver: true }),
      Animated.timing(a.scale, { toValue: toScale, duration: MOTION.flightMs, easing, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished && flight.current === cardKey(card)) onArrive(card);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyingKey, flightTarget]);
  const poppedSignature = poppedKeys.join("|");
  useEffect(() => {
    if (!flyingKey) {
      flight.current = null;
      // Ready for the next tap once nothing is flying - including whenever the
      // playable cards change, so a tap can never leave the hand stuck.
      tapped.current = false;
    }
  }, [flyingKey, poppedSignature]);

  const pressTo = (a, toValue) =>
    Animated.spring(a.press, { toValue, ...MOTION.press, useNativeDriver: true }).start();

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {shown.map((card) => {
        const key = cardKey(card);
        const a = anims.get(key);
        if (!a) return null;
        const isFlying = key === flyingKey;
        const isHidden = key === hiddenKey && !isFlying;
        const isPopped = !isFlying && !isHidden && poppedKeys.includes(key) && !!positions[key];
        const canPlay = isPopped && !flyingKey;
        const red = isRedSuit(card.suit);
        const pressScale = a.press.interpolate({
          inputRange: [0, 1],
          outputRange: [1, MOTION.pressScale],
        });

        return (
          <Animated.View
            key={key}
            pointerEvents={canPlay ? "auto" : "none"}
            style={[
              styles.card,
              {
                width: cardWidth,
                height: cardHeight,
                zIndex: isFlying ? 3 : isPopped ? 2 : 1,
                elevation: isFlying ? 14 : isPopped ? 10 : 4,
                opacity: isHidden ? 0 : dimmedKeys.includes(key) ? 0.5 : 1,
                transform: [
                  { translateX: a.pos.x },
                  { translateY: a.pos.y },
                  { scale: Animated.multiply(a.scale, pressScale) },
                ],
              },
            ]}
          >
            <Pressable
              testID={`hand-card-${key}`}
              accessibilityRole="button"
              accessibilityLabel={`${card.rank} of ${card.suit}`}
              accessibilityState={{ disabled: !canPlay }}
              disabled={!canPlay}
              onPress={() => {
                if (tapped.current) return;
                tapped.current = true;
                onPlay(card);
              }}
              onPressIn={() => pressTo(a, 1)}
              onPressOut={() => pressTo(a, 0)}
              style={styles.pressable}
            >
              {isPopped && <View pointerEvents="none" style={styles.glowBorder} />}
              <LinearGradient colors={["#FFFFFF", "#F7F7F7", "#E9E9E9"]} style={styles.inner}>
                <Text style={[styles.rank, red && styles.red]}>{card.rank}</Text>
                <Text style={[styles.suit, red && styles.red]}>{SUIT_SYMBOLS[card.suit]}</Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

export default memo(PlayerHand);

// Baseline (iPhone 17 Pro) numbers; useScaledStyles maps them onto the current
// viewport. Size and position come from props.
const rawStyles = {
  card: {
    position: "absolute",
    left: 0,
    top: 0,
    borderRadius: 8,
    // Solid surface so Android draws the elevation shadow under the card rather
    // than as a dark box while it is moving.
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
  },
  pressable: {
    flex: 1,
  },
  // Marks a card that can be played.
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
